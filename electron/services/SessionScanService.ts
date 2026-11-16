import fs from 'fs'
import path from 'path'
import type { Session } from '../../shared/types.js'
import type { AccountManager } from '../AccountManager.js'
import { readMeta } from './SessionMetaService.js'

// Список сессий для сайдбара. Повторяет AccountManager.getSessionsForAccount
// (его не трогаем), но не перечитывает всё каждый раз: там на каждый вызов
// синхронно читался и дважды парсился каждый jsonl — сотни мегабайт, и
// main-процесс замирал на всё это время.
//
// Здесь по каждому файлу помним, сколько байт уже разобрано, и дочитываем
// только прирост. Чтение асинхронное, между файлами отдаём очередь, а
// одновременные запросы одного аккаунта ждут одно и то же сканирование.

interface FileState {
  ino: number
  offset: number          // сколько байт разобрано (до последнего \n)
  msgCount: number
  slug?: string
  firstUserMsg: string
}

const cache = new Map<string, FileState>()
const inflight = new Map<string, Promise<Session[]>>()
const CHUNK = 8 * 1024 * 1024

const tick = () => new Promise<void>(r => setImmediate(r))

/** Одна строка jsonl → счётчик, заголовок, первое сообщение. Логика как в AccountManager */
function takeLine(st: FileState, line: string) {
  if (!line.trim()) return
  let e: { type?: string; aiTitle?: string; slug?: string; message?: { content?: unknown } }
  try { e = JSON.parse(line) } catch { return }
  if (e.type === 'user' || e.type === 'assistant') st.msgCount++
  if (!st.slug) {
    if (e.type === 'ai-title' && e.aiTitle) st.slug = e.aiTitle
    else if (e.slug) st.slug = e.slug
  }
  if (e.type === 'user' && !st.firstUserMsg) {
    const c = e.message?.content
    const text = typeof c === 'string' ? c : (Array.isArray(c) ? (c[0] as { text?: string } | undefined)?.text : '') || ''
    st.firstUserMsg = text.trim()
  }
}

/** Дочитать файл от st.offset до конца; неполную последнюю строку оставить на потом */
async function readGrowth(filePath: string, st: FileState, size: number) {
  const fh = await fs.promises.open(filePath, 'r')
  try {
    let pos = st.offset
    let rest = Buffer.alloc(0)
    while (pos < size) {
      const len = Math.min(CHUNK, size - pos)
      const buf = Buffer.alloc(len)
      const { bytesRead } = await fh.read(buf, 0, len, pos)
      if (!bytesRead) break
      pos += bytesRead
      const data = rest.length ? Buffer.concat([rest, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead)
      const nl = data.lastIndexOf(0x0a)
      if (nl === -1) { rest = data; continue }
      // Режем по байту \n, а не по строке: так не рвём многобайтные символы
      for (const line of data.subarray(0, nl).toString('utf8').split('\n')) takeLine(st, line)
      // data — байты [pos - data.length, pos); разобрано до \n включительно
      st.offset = pos - (data.length - nl - 1)
      rest = data.subarray(nl + 1)
      await tick()
    }
  } finally {
    await fh.close()
  }
}

async function scanFile(filePath: string): Promise<{ st: FileState; stat: fs.Stats } | null> {
  let stat: fs.Stats
  try { stat = await fs.promises.stat(filePath) } catch { return null }
  let st = cache.get(filePath)
  // Файл заменили или укоротили — разбираем заново
  if (!st || st.ino !== stat.ino || stat.size < st.offset) {
    st = { ino: stat.ino, offset: 0, msgCount: 0, firstUserMsg: '' }
    cache.set(filePath, st)
  }
  if (stat.size > st.offset) {
    try { await readGrowth(filePath, st, stat.size) } catch { /* файл пишется — дочитаем в следующий раз */ }
  }
  return { st, stat }
}

async function scan(accountManager: AccountManager, accountId: string): Promise<Session[]> {
  const account = accountManager.getAccount(accountId)
  if (!account) return []
  const projectsDir = path.join(account.configDir, 'projects')
  let projects: fs.Dirent[]
  try { projects = (await fs.promises.readdir(projectsDir, { withFileTypes: true })).filter(e => e.isDirectory()) } catch { return [] }

  const usageId = accountManager.getUsageSessionId(accountId)
  const seen = new Set<string>()
  const sessions: Session[] = []

  for (const proj of projects) {
    const projPath = path.join(projectsDir, proj.name)
    let files: string[]
    try { files = (await fs.promises.readdir(projPath)).filter(f => f.endsWith('.jsonl')) } catch { continue }
    for (const file of files) {
      const filePath = path.join(projPath, file)
      seen.add(filePath)
      const r = await scanFile(filePath)
      if (!r) continue
      const { st, stat } = r
      const sessionId = file.replace('.jsonl', '')
      // Служебные сессии (usage, /context) не показываем
      if (sessionId === usageId) continue
      if (st.firstUserMsg.startsWith('/context') || st.firstUserMsg === '') continue
      const meta = readMeta(filePath)
      sessions.push({
        id: sessionId,
        projectPath: projPath,
        projectName: decodeURIComponent(proj.name.replace(/-/g, '/')),
        accountId,
        lastModified: stat.mtimeMs,
        createdAt: stat.birthtimeMs || stat.mtimeMs,
        messageCount: st.msgCount,
        title: meta.customTitle ?? st.slug ?? (st.firstUserMsg ? st.firstUserMsg.slice(0, 60) : undefined),
        archived: meta.archived,
        tags: meta.tags,
        order: meta.order,
      })
    }
    await tick()
  }
  // Удалённые файлы — из кэша вон
  for (const p of cache.keys()) if (p.startsWith(projectsDir) && !seen.has(p)) cache.delete(p)

  return sessions.sort((a, b) => b.lastModified - a.lastModified)
}

/** Список сессий аккаунта. Параллельные вызовы ждут одно сканирование */
export function getSessionsCached(accountManager: AccountManager, accountId: string): Promise<Session[]> {
  const running = inflight.get(accountId)
  if (running) return running
  const p = scan(accountManager, accountId).finally(() => inflight.delete(accountId))
  inflight.set(accountId, p)
  return p
}
