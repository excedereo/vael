import fs from 'fs'
import path from 'path'

/**
 * Статистика по jsonl-файлам сессий.
 *
 * Раньше читался `~/.claude/stats-cache.json`, но CLI перестал его обновлять
 * (у пользователя файл замер на несколько месяцев), да и путь был жёстко
 * дефолтным — статистика другого аккаунта туда не попадала в принципе.
 * Считаем сами из логов активного аккаунта: они пишутся всегда и содержат
 * и модель, и разбивку токенов, и время.
 *
 * Логи — сотни мегабайт, и синхронный разбор вешал весь main-процесс.
 * Поэтому: jsonl только дописываются — для каждого файла помним, до какого
 * байта он разобран, и при следующем подсчёте читаем только хвост. Чтение
 * асинхронное, а разбор уступает очередь событий каждые несколько тысяч строк.
 */

export interface StatsDailyActivity {
  date: string
  messageCount: number
  sessionCount: number
  toolCallCount: number
  /**
   * id сессий, активных в этот день. Нужны, чтобы посчитать сессии за период
   * без двойного учёта: сумма sessionCount по дням завышает результат —
   * сессия, шедшая три дня, попадает в каждый из них.
   */
  sessionIds?: string[]
}

export interface StatsModelUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  webSearchRequests?: number
}

export interface StatsCache {
  version: number
  lastComputedDate: string
  dailyActivity: StatsDailyActivity[]
  modelUsage: Record<string, StatsModelUsage>
  dailyModelTokens?: Record<string, Record<string, number>>
  /**
   * Подневная разбивка по типам токенов: день → модель → usage.
   * Нужна, чтобы фильтр периода показывал in/out, а не только общий объём.
   */
  dailyModelUsage?: Record<string, Record<string, StatsModelUsage>>
  totalSessions?: number
  firstSessionDate?: string
  /** Распределение сообщений по часам суток, 0..23 */
  hourCounts?: number[]
  /** день → сессия → токены всех типов: топ затратных сессий за период */
  dailySessionTokens?: Record<string, Record<string, number>>
  /** id сессии → название (своё имя из .meta.json, заголовок CLI или первое сообщение) */
  sessionTitles?: Record<string, string>
}

interface JsonlUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  server_tool_use?: { web_search_requests?: number }
}

interface JsonlLine {
  type?: string
  timestamp?: string
  aiTitle?: string
  message?: {
    model?: string
    usage?: JsonlUsage
    content?: Array<{ type?: string }> | string
  }
}

/** Вклад одного файла: всё, что из него уже разобрано */
interface FileAgg {
  offset: number
  size: number
  sessionId: string
  aiTitle?: string
  firstUser?: string
  firstTs: number | null
  daily: Map<string, { messageCount: number; toolCallCount: number }>
  hourCounts: number[]
  modelUsage: Record<string, StatsModelUsage>
  dailyModelUsage: Record<string, Record<string, StatsModelUsage>>
  dailyTokens: Record<string, number>
}

const cache = new Map<string, FileAgg>()

/** YYYY-MM-DD в локальной зоне: сутки должны совпадать с теми, что видит человек */
function localDay(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function emptyUsage(): StatsModelUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0 }
}

function addUsage(acc: StatsModelUsage, u: StatsModelUsage) {
  acc.inputTokens += u.inputTokens
  acc.outputTokens += u.outputTokens
  acc.cacheReadInputTokens += u.cacheReadInputTokens
  acc.cacheCreationInputTokens += u.cacheCreationInputTokens
  acc.webSearchRequests = (acc.webSearchRequests ?? 0) + (u.webSearchRequests ?? 0)
}

const yieldLoop = () => new Promise<void>(r => setImmediate(r))

function newAgg(sessionId: string): FileAgg {
  return {
    offset: 0, size: 0, sessionId, firstTs: null,
    daily: new Map(), hourCounts: new Array(24).fill(0),
    modelUsage: {}, dailyModelUsage: {}, dailyTokens: {},
  }
}

/** Разбирает строки в агрегат файла */
async function parseInto(agg: FileAgg, text: string) {
  let n = 0
  for (const line of text.split('\n')) {
    if (++n % 3000 === 0) await yieldLoop()
    if (!line.trim()) continue
    let d: JsonlLine
    try { d = JSON.parse(line) } catch { continue }

    if (d.type === 'ai-title' && d.aiTitle && !agg.aiTitle) agg.aiTitle = d.aiTitle
    if (!agg.firstUser && d.type === 'user' && typeof d.message?.content === 'string') agg.firstUser = d.message.content.slice(0, 80)

    const day = d.timestamp ? localDay(d.timestamp) : null
    if (day) {
      const ts = new Date(d.timestamp!).getTime()
      if (agg.firstTs === null || ts < agg.firstTs) agg.firstTs = ts
      let bucket = agg.daily.get(day)
      if (!bucket) agg.daily.set(day, bucket = { messageCount: 0, toolCallCount: 0 })
      if (d.type === 'user' || d.type === 'assistant') {
        bucket.messageCount++
        agg.hourCounts[new Date(ts).getHours()]++
      }
      if (d.type === 'assistant' && Array.isArray(d.message?.content)) {
        bucket.toolCallCount += d.message!.content!.filter(c => c.type === 'tool_use').length
      }
    }

    if (d.type !== 'assistant' || !d.message?.usage) continue
    const model = d.message.model
    // <synthetic> — служебные записи без реального запроса к модели
    if (!model || model === '<synthetic>') continue

    const u = d.message.usage
    const usage: StatsModelUsage = {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
      webSearchRequests: u.server_tool_use?.web_search_requests ?? 0,
    }
    addUsage(agg.modelUsage[model] ?? (agg.modelUsage[model] = emptyUsage()), usage)
    if (day) {
      const byModel = agg.dailyModelUsage[day] ?? (agg.dailyModelUsage[day] = {})
      addUsage(byModel[model] ?? (byModel[model] = emptyUsage()), usage)
      agg.dailyTokens[day] = (agg.dailyTokens[day] ?? 0) + usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens
    }
  }
}

/** Догоняет агрегат файла до текущего размера: читает только дописанное */
async function updateFile(filePath: string, sessionId: string): Promise<FileAgg | null> {
  let size: number
  try { size = (await fs.promises.stat(filePath)).size } catch { return null }
  let agg = cache.get(filePath)
  // Файл стал короче — его переписали (компакт, правка руками): разбираем заново
  if (!agg || size < agg.size) agg = newAgg(sessionId)
  if (size > agg.offset) {
    let fh: fs.promises.FileHandle | null = null
    try {
      fh = await fs.promises.open(filePath, 'r')
      const buf = Buffer.alloc(size - agg.offset)
      await fh.read(buf, 0, buf.length, agg.offset)
      // Берём только целые строки: хвост без \n могут дописывать прямо сейчас
      const end = buf.lastIndexOf(0x0a)
      if (end >= 0) {
        await parseInto(agg, buf.subarray(0, end + 1).toString('utf-8'))
        agg.offset += end + 1
      }
    } catch {
      return cache.get(filePath) ?? null
    } finally {
      await fh?.close()
    }
  }
  agg.size = size
  cache.set(filePath, agg)
  return agg
}

/**
 * @param configDir конфиг-дир аккаунта (в нём лежит projects/<encoded>/<id>.jsonl)
 */
// Два подсчёта одновременно разобрали бы один и тот же хвост дважды — второй ждёт первый
const inflight = new Map<string, Promise<StatsCache | null>>()

export function computeStats(configDir: string): Promise<StatsCache | null> {
  let p = inflight.get(configDir)
  if (!p) {
    p = compute(configDir).finally(() => inflight.delete(configDir))
    inflight.set(configDir, p)
  }
  return p
}

async function compute(configDir: string): Promise<StatsCache | null> {
  const projectsDir = path.join(configDir, 'projects')
  let projects: fs.Dirent[]
  try { projects = await fs.promises.readdir(projectsDir, { withFileTypes: true }) } catch { return null }

  const aggs: FileAgg[] = []
  const titles: Record<string, string> = {}
  const seen = new Set<string>()

  for (const proj of projects) {
    if (!proj.isDirectory()) continue
    const dir = path.join(projectsDir, proj.name)
    let files: string[]
    try { files = await fs.promises.readdir(dir) } catch { continue }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      const sessionId = file.replace(/\.jsonl$/, '')
      const filePath = path.join(dir, file)
      seen.add(filePath)
      const agg = await updateFile(filePath, sessionId)
      if (!agg) continue
      aggs.push(agg)

      let customTitle: string | undefined
      try { customTitle = JSON.parse(await fs.promises.readFile(path.join(dir, sessionId + '.meta.json'), 'utf-8')).customTitle } catch {}
      const title = customTitle || agg.aiTitle || agg.firstUser
      if (title) titles[sessionId] = title
    }
  }
  // Удалённые сессии не должны висеть в кэше и в цифрах
  for (const p of cache.keys()) if (p.startsWith(projectsDir) && !seen.has(p)) cache.delete(p)

  const modelUsage: Record<string, StatsModelUsage> = {}
  const dailyModelUsage: Record<string, Record<string, StatsModelUsage>> = {}
  const dailyModelTokens: Record<string, Record<string, number>> = {}
  const dailySessionTokens: Record<string, Record<string, number>> = {}
  const daily = new Map<string, { messageCount: number; toolCallCount: number; sessions: Set<string> }>()
  const hourCounts = new Array(24).fill(0) as number[]
  let firstTs: number | null = null

  for (const a of aggs) {
    if (a.firstTs !== null && (firstTs === null || a.firstTs < firstTs)) firstTs = a.firstTs
    for (let h = 0; h < 24; h++) hourCounts[h] += a.hourCounts[h]
    for (const [m, u] of Object.entries(a.modelUsage)) addUsage(modelUsage[m] ?? (modelUsage[m] = emptyUsage()), u)
    for (const [day, byModel] of Object.entries(a.dailyModelUsage)) {
      const dm = dailyModelUsage[day] ?? (dailyModelUsage[day] = {})
      const dt = dailyModelTokens[day] ?? (dailyModelTokens[day] = {})
      for (const [m, u] of Object.entries(byModel)) {
        addUsage(dm[m] ?? (dm[m] = emptyUsage()), u)
        dt[m] = (dt[m] ?? 0) + u.inputTokens + u.outputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens
      }
    }
    for (const [day, t] of Object.entries(a.dailyTokens)) {
      (dailySessionTokens[day] ?? (dailySessionTokens[day] = {}))[a.sessionId] = t
    }
    for (const [day, v] of a.daily) {
      let b = daily.get(day)
      if (!b) daily.set(day, b = { messageCount: 0, toolCallCount: 0, sessions: new Set() })
      b.messageCount += v.messageCount
      b.toolCallCount += v.toolCallCount
      b.sessions.add(a.sessionId)
    }
  }

  const dailyActivity: StatsDailyActivity[] = [...daily.entries()]
    .map(([date, v]) => ({
      date,
      messageCount: v.messageCount,
      sessionCount: v.sessions.size,
      toolCallCount: v.toolCallCount,
      sessionIds: [...v.sessions],
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    version: 6,
    lastComputedDate: localDay(new Date().toISOString())!,
    dailyActivity,
    modelUsage,
    dailyModelTokens,
    dailyModelUsage,
    totalSessions: aggs.length,
    firstSessionDate: firstTs ? localDay(new Date(firstTs).toISOString())! : undefined,
    hourCounts,
    dailySessionTokens,
    sessionTitles: titles,
  }
}
