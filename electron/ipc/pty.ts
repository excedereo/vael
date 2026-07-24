import { ipcMain, BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { findClaudeBin, findClaudeExe } from '../services/ClaudeBin.js'

const CLAUDE_BIN = findClaudeBin()
const CLAUDE_EXE = findClaudeExe(CLAUDE_BIN)

interface PtyEntry {
  proc: pty.IPty
  sessionPath: string
}

const sessions = new Map<string, PtyEntry>()

// Map: sessionId → FSWatcher
const sessionWatchers = new Map<string, fs.FSWatcher>()
// Map: sessionId → polling-таймер (см. STATUS_POLL_MS)
const sessionPollers = new Map<string, NodeJS.Timeout>()
// Map: sessionId → последний отправленный статус (для детекции idle после streaming)
const sessionLastStatus = new Map<string, string>()
// Main-process колбэки на reply (для модулей) — очередь, FIFO
const replyCallbacks = new Map<string, Array<(text: string) => void>>()

export type StatusChangeListener = (
  sessionId: string,
  status: string,
  prev: string,
  replyText: string | null,
) => void

// Подписчики на смену статуса (уведомления и т.п.) — чтобы не вшивать их сюда
const statusChangeListeners = new Set<StatusChangeListener>()

export function onSessionStatusChange(listener: StatusChangeListener): () => void {
  statusChangeListeners.add(listener)
  return () => { statusChangeListeners.delete(listener) }
}

export type PtyErrorListener = (sessionId: string, message: string) => void

const ptyErrorListeners = new Set<PtyErrorListener>()

export function onPtyError(listener: PtyErrorListener): () => void {
  ptyErrorListeners.add(listener)
  return () => { ptyErrorListeners.delete(listener) }
}

// fs.watch на Windows схлопывает события во время активной записи в jsonl:
// пока Claude Code пишет ответ, коллбэк молчит и стреляет один раз в конце —
// промежуточные состояния (tool, asking) так не увидеть вообще. Поэтому поверх
// watcher'а крутим лёгкий опрос: пара readFileSync в секунду на сессию.
const STATUS_POLL_MS = 400

export function ptyWriteDirect(termId: string, data: string) {
  sessions.get(termId)?.proc.write(data)
}

export function ptyWriteBySessionId(sessionId: string, data: string) {
  for (const [, entry] of sessions) {
    if (entry.sessionPath === sessionId) {
      entry.proc.write(data)
      return
    }
  }
}

export function subscribeSessionReply(sessionId: string, cb: (text: string) => void) {
  const queue = replyCallbacks.get(sessionId) ?? []
  queue.push(cb)
  replyCallbacks.set(sessionId, queue)
}

export function unsubscribeSessionReply(sessionId: string) {
  replyCallbacks.delete(sessionId)
}

function fireNextReplyCallback(sessionId: string, text: string) {
  const queue = replyCallbacks.get(sessionId)
  if (!queue || queue.length === 0) return
  const cb = queue.shift()!
  if (queue.length === 0) replyCallbacks.delete(sessionId)
  cb(text)
}
/**
 * Статус сессии по данным самого CLI.
 *
 * claude пишет живое состояние процесса в `<configDir>/sessions/<pid>.json`
 * (поля sessionId + status). Это ЕДИНСТВЕННЫЙ источник, где видно, что сессия
 * ждёт ответа на вопрос: в jsonl запись про AskUserQuestion попадает только
 * ПОСЛЕ того, как пользователь ответил, поэтому по jsonl «ждёт» не поймать.
 *
 * @returns 'waiting' | 'busy' | 'idle' по версии CLI, либо null если файла нет
 */
function detectCliStatus(jsonlPath: string, sessionId: string): string | null {
  // jsonlPath = <configDir>/projects/<encoded-cwd>/<sessionId>.jsonl
  const configDir = path.dirname(path.dirname(path.dirname(jsonlPath)))
  const sessionsDir = path.join(configDir, 'sessions')

  let files: string[]
  try { files = fs.readdirSync(sessionsDir) } catch { return null }

  // На одну сессию может быть НЕСКОЛЬКО файлов: старый процесс завершился, но
  // его <pid>.json остался и навсегда застыл в 'idle'. Берём самый свежий по
  // updatedAt, иначе читаем статус трупа и статус никогда не меняется.
  let best: { status: string; updatedAt: number } | null = null

  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf-8')) as {
        sessionId?: string
        status?: string
        updatedAt?: number
        pid?: number
      }
      if (data.sessionId !== sessionId || !data.status) continue

      // Отсеиваем мёртвые процессы — их файл остаётся лежать после выхода
      if (typeof data.pid === 'number' && !isProcessAlive(data.pid)) continue

      const ts = typeof data.updatedAt === 'number' ? data.updatedAt : 0
      if (!best || ts > best.updatedAt) best = { status: data.status, updatedAt: ts }
    } catch {}
  }
  return best?.status ?? null
}

/** Жив ли процесс с таким pid (сигнал 0 — проверка без отправки). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM — процесс есть, но чужой; ESRCH — процесса нет
    return (err as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

/** Останавливает watcher и poller сессии, если они были заведены. */
function stopSessionWatch(sessionId: string) {
  const watcher = sessionWatchers.get(sessionId)
  if (watcher) {
    try { watcher.close() } catch {}
    sessionWatchers.delete(sessionId)
  }
  const poller = sessionPollers.get(sessionId)
  if (poller) {
    clearInterval(poller)
    sessionPollers.delete(sessionId)
  }
}

/**
 * Единая точка подписки на статус сессии: fs.watch + polling поверх него.
 * Оба варианта входа (IPC-хендлер и watchSessionDirect для модулей) идут сюда,
 * чтобы логика не разъезжалась между копиями.
 */
function startSessionWatch(
  sessionId: string,
  jsonlPath: string,
  getWindow: () => import('electron').BrowserWindow | null,
) {
  stopSessionWatch(sessionId)

  try {
    // Сразу читаем текущий статус и последний ответ при подписке
    const initStatus = detectStatus(jsonlPath, sessionId)
    sessionLastStatus.set(sessionId, initStatus)
    const win0 = getWindow()
    if (win0 && !win0.isDestroyed()) {
      win0.webContents.send('session:status', sessionId, initStatus)
      if (initStatus === 'idle') {
        const initText = extractLastAssistantText(jsonlPath)
        if (initText) win0.webContents.send('session:reply', sessionId, initText)
      }
    }

    const check = () => {
      const status = detectStatus(jsonlPath, sessionId)
      const prev = sessionLastStatus.get(sessionId)
      if (status === prev) return   // шлём только реальные переходы
      sessionLastStatus.set(sessionId, status)

      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('session:status', sessionId, status)
        win.webContents.send('session:status-log', sessionId, `${prev ?? '-'} → ${status}`)
      }

      const shouldFire = status === 'idle' && prev !== undefined && prev !== 'idle'
      const replyText = shouldFire ? extractLastAssistantText(jsonlPath) : null
      if (replyText) {
        const win2 = getWindow()
        if (win2 && !win2.isDestroyed()) win2.webContents.send('session:reply', sessionId, replyText)
        fireNextReplyCallback(sessionId, replyText)
      }

      if (prev !== undefined) {
        for (const listener of statusChangeListeners) {
          try { listener(sessionId, status, prev, replyText) } catch {}
        }
      }
    }

    // Отдельная ветка: ответ на мета-команду (/context и т.п.) приходит без
    // смены статуса (idle → idle), поэтому check() его пропустит.
    let lastMetaSize = -1
    const checkMetaReply = () => {
      if (sessionLastStatus.get(sessionId) !== 'idle') return
      let size = -1
      try { size = fs.statSync(jsonlPath).size } catch { return }
      if (size === lastMetaSize) return
      const known = lastMetaSize !== -1
      lastMetaSize = size
      if (!known || !isLastEntryMeta(jsonlPath)) return
      const text = extractLastAssistantText(jsonlPath)
      if (text) {
        const win = getWindow()
        if (win && !win.isDestroyed()) win.webContents.send('session:reply', sessionId, text)
        fireNextReplyCallback(sessionId, text)
      }
    }

    const watcher = fs.watch(jsonlPath, { persistent: false }, () => { check(); checkMetaReply() })
    sessionWatchers.set(sessionId, watcher)

    const poller = setInterval(() => { check(); checkMetaReply() }, STATUS_POLL_MS)
    sessionPollers.set(sessionId, poller)
  } catch (e) {
    console.warn(`[startSessionWatch] failed to watch ${jsonlPath}:`, e)
  }
}

export function watchSessionDirect(sessionId: string, jsonlPath: string, getWindow: () => import('electron').BrowserWindow | null) {
  startSessionWatch(sessionId, jsonlPath, getWindow)
}

/** Гасит все watcher'ы и polling-таймеры — вызывать при выходе из приложения. */
export function stopAllSessionWatches() {
  for (const sessionId of [...sessionWatchers.keys(), ...sessionPollers.keys()]) {
    stopSessionWatch(sessionId)
  }
}

// Убить все живые PTY при выходе — иначе node-pty/claude процессы остаются
// висеть после закрытия окна. Зовётся из before-quit.
export function killAllPtys() {
  for (const [termId, entry] of sessions) {
    try { entry.proc.kill() } catch {}
    sessions.delete(termId)
  }
}

function isLastEntryMeta(jsonlPath: string): boolean {
  try {
    const content = fs.readFileSync(jsonlPath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]) as { type?: string; isMeta?: boolean }
        if (entry.type === 'user' && entry.isMeta) return true
        break
      } catch {}
    }
  } catch {}
  return false
}

// Инструменты, которые блокируют сессию в ожидании действия пользователя.
// Пока такой tool_use не получил tool_result — Клод не «думает», а ждёт нас.
const WAITING_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])

/** Статус по одной содержательной записи jsonl, или null если запись служебная. */
function statusFromEntry(entry: JsonlLike): SessionStatusValue | null {
  if (entry.type === 'user') {
    // isMeta — служебные ответы команд (/context и т.п.), не запрос к модели
    return entry.isMeta ? 'idle' : 'thinking'
  }
  if (entry.type !== 'assistant') return null

  const stopReason = entry.message?.stop_reason
  if (!stopReason) return 'streaming'

  // stop_reason: 'tool_use' — Claude Code пишет текст и tool_use как отдельные
  // assistant-записи, каждая со своим stop_reason. Пока не пройден tool_result
  // и не пришёл финальный ответ — это не idle.
  if (stopReason === 'tool_use') {
    const blocks = Array.isArray(entry.message?.content) ? entry.message!.content as ContentBlock[] : []
    const toolUses = blocks.filter(b => b.type === 'tool_use')
    if (toolUses.length === 0) return 'thinking'
    if (toolUses.some(b => b.name && WAITING_TOOLS.has(b.name))) return 'asking'
    return 'tool'
  }
  return 'idle'
}

/**
 * Итоговый статус сессии: CLI-файл + jsonl.
 *
 * CLI знает только busy/waiting/idle, зато знает про ожидание ответа.
 * jsonl не знает про ожидание, зато различает streaming/tool/thinking.
 * Берём waiting от CLI, детализацию — от jsonl.
 */
function detectStatus(jsonlPath: string, sessionId?: string): SessionStatusValue {
  if (sessionId) {
    const cliStatus = detectCliStatus(jsonlPath, sessionId)
    if (cliStatus === 'waiting') return 'asking'
    if (cliStatus === 'idle') return 'idle'
    // 'busy' — работаем дальше и уточняем по jsonl, чем именно занята сессия
  }
  return detectJsonlStatus(jsonlPath)
}

function detectJsonlStatus(jsonlPath: string): SessionStatusValue {
  try {
    const content = fs.readFileSync(jsonlPath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    if (lines.length === 0) return 'idle'

    // Идём с конца: служебные записи (attachment, system, last-prompt, ai-title,
    // mode, permission-mode и т.п.) сами по себе не меняют статус — берём первую
    // содержательную (user/assistant) запись.
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry: JsonlLike | null = null
      try { entry = JSON.parse(lines[i]) } catch { continue }
      if (!entry) continue
      const status = statusFromEntry(entry)
      if (status) return status
    }
  } catch {}
  return 'idle'
}

type ContentBlock = { type: string; text?: string; name?: string }
type AssistantMessage = { role?: string; content?: ContentBlock[] | string; stop_reason?: string }
type JsonlLike = { type?: string; isMeta?: boolean; message?: AssistantMessage }
/** Держать в синхроне с SessionStatus в src/context/SessionContext.tsx */
type SessionStatusValue = 'idle' | 'thinking' | 'streaming' | 'tool' | 'asking'

function extractLastAssistantText(jsonlPath: string): string | null {
  try {
    const content = fs.readFileSync(jsonlPath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]) as { type?: string; isMeta?: boolean; message?: AssistantMessage & { role?: string; content?: unknown } }
        // Мета-ответы команд вроде /context
        if (entry.type === 'user' && entry.isMeta && typeof entry.message?.content === 'string' && entry.message.content) {
          return entry.message.content
        }
        if (entry.type !== 'assistant' || !entry.message?.stop_reason) continue
        const msg = entry.message
        if (Array.isArray(msg.content)) {
          const text = (msg.content as ContentBlock[])
            .filter((b: ContentBlock) => b.type === 'text' && b.text)
            .map((b: ContentBlock) => b.text!)
            .join('')
          if (text) return text
        } else if (typeof msg.content === 'string' && msg.content) {
          return msg.content
        }
      } catch {}
    }
  } catch {}
  return null
}

export function registerPtyHandlers(getWindow: () => BrowserWindow | null) {
  // Spawn claude --resume <sessionId> for a terminal session
  // sessionId: UUID, projectPath: path to project dir (cwd), configDir: claude config dir
  ipcMain.handle('pty:spawn', async (_, termId: string, sessionId: string, projectPath: string, configDir: string, cols: number, rows: number, model?: string, effort?: string, permissionMode?: string) => {
    const existing = sessions.get(termId)
    if (existing) {
      try { existing.proc.kill() } catch {}
      sessions.delete(termId)
    }

    const cwd = os.homedir()

    const env = { ...process.env } as Record<string, string>
    if (configDir) {
      env.CLAUDE_CONFIG_DIR = configDir
    } else {
      delete env.CLAUDE_CONFIG_DIR
    }

    console.log(`[pty:spawn] sessionId=${sessionId} cwd=${cwd} configDir=${configDir || '(default)'}`)

    const args: string[] = []
    if (!permissionMode || permissionMode === 'bypassPermissions') {
      args.push('--dangerously-skip-permissions')
    } else {
      args.push('--permission-mode', permissionMode)
    }
    if (model)     args.push('--model', model)
    if (effort)    args.push('--effort', effort)
    if (sessionId) args.push('--resume', sessionId)

    console.log(`[pty:spawn] args:`, args.join(' '))

    const proc = pty.spawn(CLAUDE_EXE, args, {
      name: 'xterm-256color',
      cols: cols || 120,
      rows: rows || 30,
      cwd,
      env,
    })

    let rawBuf = ''
    let trustAnswered = false
    let bypassAnswered = false
    let themeAnswered = false

    // Для новой сессии — polling файловой системы чтобы найти появившийся jsonl
    if (!sessionId && configDir) {
      // Снимаем snapshot всех существующих jsonl ДО запуска claude
      const knownIds = new Set<string>()
      const projectsDir = path.join(configDir, 'projects')
      if (fs.existsSync(projectsDir)) {
        for (const proj of fs.readdirSync(projectsDir, { withFileTypes: true })) {
          if (!proj.isDirectory()) continue
          for (const file of fs.readdirSync(path.join(projectsDir, proj.name))) {
            if (file.endsWith('.jsonl')) knownIds.add(file.replace('.jsonl', ''))
          }
        }
      }
      let attempts = 0
      const MAX_ATTEMPTS = 150 // 5 минут при интервале 2с
      const poll = setInterval(() => {
        attempts++
        const projectsDir = path.join(configDir, 'projects')
        if (!fs.existsSync(projectsDir)) {
          if (attempts >= MAX_ATTEMPTS) clearInterval(poll)
          return
        }
        let found: string | null = null
        outer: for (const proj of fs.readdirSync(projectsDir, { withFileTypes: true })) {
          if (!proj.isDirectory()) continue
          for (const file of fs.readdirSync(path.join(projectsDir, proj.name))) {
            if (!file.endsWith('.jsonl')) continue
            const sid = file.replace('.jsonl', '')
            if (!knownIds.has(sid)) { found = sid; break outer }
          }
        }
        if (found) {
          clearInterval(poll)
          sessions.set(termId, { proc, sessionPath: found })
          console.log(`[pty:spawn] new session detected via fs: ${found}`)
          const win = getWindow()
          if (win && !win.isDestroyed()) win.webContents.send('session:created', found)
        }
        if (attempts >= MAX_ATTEMPTS) clearInterval(poll)
      }, 2000)
    }

    proc.onData((data) => {
      rawBuf += data
      const s = rawBuf.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\s+/g, '')

      if (!trustAnswered && (s.includes('trustthisfolder') || s.includes('Isthisaproject'))) {
        trustAnswered = true
        setTimeout(() => proc.write('1'), 100)
      }
      if (!bypassAnswered && s.includes('dangerously-skip-permissions') && s.includes('Iaccept')) {
        bypassAnswered = true
        setTimeout(() => proc.write('2'), 300)
      }
      if (!themeAnswered && s.includes('Darkmode') && s.includes('Lightmode')) {
        themeAnswered = true
        setTimeout(() => proc.write('1'), 100)
      }

      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('pty:data', termId, data)
      }
    })

    proc.onExit(({ exitCode }) => {
      sessions.delete(termId)
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('pty:exit', termId)
      }
      // Ненулевой код — процесс упал, а не был закрыт штатно
      if (exitCode !== 0 && sessionId) {
        for (const listener of ptyErrorListeners) {
          try { listener(sessionId, `Процесс завершился с кодом ${exitCode}`) } catch {}
        }
      }
    })

    sessions.set(termId, { proc, sessionPath: sessionId })
    return { ok: true }
  })

  ipcMain.on('pty:write', (_, termId: string, data: string) => {
    sessions.get(termId)?.proc.write(data)
  })

  ipcMain.handle('pty:resize', (_, termId: string, cols: number, rows: number) => {
    sessions.get(termId)?.proc.resize(cols, rows)
    return { ok: true }
  })

  ipcMain.handle('pty:kill', (_, termId: string) => {
    const entry = sessions.get(termId)
    if (entry) {
      try { entry.proc.kill() } catch {}
      sessions.delete(termId)
    }
    return { ok: true }
  })

  ipcMain.handle('pty:alive', (_, termId: string) => {
    return { alive: sessions.has(termId) }
  })

  // Запустить слежение за jsonl файлом сессии (fs.watch + polling)
  ipcMain.handle('pty:watch-session', (_, sessionId: string, jsonlPath: string) => {
    startSessionWatch(sessionId, jsonlPath, getWindow)
    return { ok: true }
  })

  // Остановить слежение
  ipcMain.handle('pty:unwatch-session', (_, sessionId: string) => {
    stopSessionWatch(sessionId)
    return { ok: true }
  })
}
