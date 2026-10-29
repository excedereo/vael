import { spawn, execFile, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { BrowserWindow } from 'electron'
import type { ChatStartOptions } from '../../shared/types.js'
import { claudeExe } from './ClaudeBin.js'

// Жизнь чат-процессов в файле: консоль main видна только в dev-панели окна,
// а «процесс тихо умер посреди ответа» иначе не разобрать
const LOG_FILE = path.join(os.homedir(), '.vael', 'logs', 'chat.log')
const LOG_MAX = 2 * 1024 * 1024

function chatLog(sessionId: string, text: string) {
  const line = `${new Date().toISOString()} [${sessionId.slice(0, 8)}] ${text}\n`
  console.log('[chat]', line.trim())
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
    // Без ротации лог рос бы вечно: при переполнении начинаем заново
    try { if (fs.statSync(LOG_FILE).size > LOG_MAX) fs.renameSync(LOG_FILE, LOG_FILE + '.old') } catch {}
    fs.appendFileSync(LOG_FILE, line)
  } catch {}
}

// Чат-режим сессии: один живой процесс `claude -p` в stream-json на сессию.
// В отличие от старого ClaudeRunner процесс НЕ перезапускается на каждое
// сообщение — иначе каждый раз заново грузится контекст и расход растёт.
// Сообщения идут JSON-строками в stdin, события из stdout уходят в окно как есть.


interface ChatEntry {
  child: ChildProcess
  sessionId: string
  buf: string
  /** текст, набранный модулями через ptyWrite до '\r' */
  pendingInput: string
  pending: Map<string, (r: ControlResponse) => void>
  announced: boolean
  isNew: boolean
  /** ответ на initialize: команды, модели, аккаунт — окно после перезагрузки берёт отсюда */
  init?: { commands: unknown; models: unknown; account: unknown }
  /** аккаунт процесса — лимиты помним для каждого отдельно */
  configDir: string | null
}

// Последний rate_limit_event по аккаунтам. CLI шлёт его только после ответа
// модели, а при открытии сессии лимиты должны быть видны сразу — берём отсюда.
// Отдельных запросов за лимитами не делаем: только то, что пришло в потоке
const LIMITS_FILE = path.join(os.homedir(), '.vael', 'chat-limits.json')

type LimitsCache = Record<string, { info: unknown; at: number }>

function readLimitsCache(): LimitsCache {
  try { return JSON.parse(fs.readFileSync(LIMITS_FILE, 'utf-8')) as LimitsCache } catch { return {} }
}

function saveLimits(configDir: string | null, info: unknown) {
  const value = { info, at: Date.now() }
  try {
    const cache = readLimitsCache()
    cache[configDir ?? 'default'] = value
    fs.mkdirSync(path.dirname(LIMITS_FILE), { recursive: true })
    fs.writeFileSync(LIMITS_FILE, JSON.stringify(cache, null, 2))
  } catch {}
  // Лимиты общие на аккаунт — окно показывает их вне чата, поэтому рассылаем отдельно
  send('limits:update', configDir ?? 'default', value)
}

/** Последние известные лимиты аккаунта — без живого процесса и без запросов */
export function getAccountLimits(configDir: string | null): { info: unknown; at: number } | null {
  return readLimitsCache()[configDir ?? 'default'] ?? null
}

interface ControlResponse {
  subtype: 'success' | 'error'
  request_id: string
  response?: Record<string, unknown>
  error?: string
}

const chats = new Map<string, ChatEntry>()
let getWindow: () => BrowserWindow | null = () => null

export function initChatService(windowGetter: () => BrowserWindow | null) {
  getWindow = windowGetter
}

function send(channel: string, ...args: unknown[]) {
  const win = getWindow()
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

function killTree(child: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    if (child.exitCode !== null || !child.pid) return resolve()
    child.once('exit', () => resolve())
    if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {})
    else child.kill()
    setTimeout(resolve, 3000)
  })
}

export function isChatAlive(sessionId: string): boolean {
  return chats.has(sessionId)
}

export function listChatSessions(): string[] {
  return [...chats.keys()]
}

/** Для окна после перезагрузки: какие чаты живы и есть ли у них уже jsonl */
export function describeChats(): { sessionId: string; hasJsonl: boolean }[] {
  return [...chats.values()].map(e => ({ sessionId: e.sessionId, hasJsonl: !e.isNew || e.announced }))
}

export async function startChat(opts: ChatStartOptions): Promise<string> {
  const sessionId = opts.sessionId ?? randomUUID()
  const prev = chats.get(sessionId)
  if (prev) {
    chatLog(sessionId, `restart: убиваю прежний процесс pid=${prev.child.pid}`)
    chats.delete(sessionId)
    await killTree(prev.child)
  }

  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--verbose', '--include-partial-messages', '--replay-user-messages',
    // Без этого флага на живом процессе нельзя переключиться в bypass
    '--allow-dangerously-skip-permissions']
  args.push(opts.sessionId ? '--resume' : '--session-id', sessionId)
  if (opts.model) args.push('--model', opts.model)
  if (opts.effort) args.push('--effort', opts.effort)
  if (opts.permissionMode) args.push('--permission-mode', opts.permissionMode)

  const env = { ...process.env } as Record<string, string>
  if (opts.configDir) env.CLAUDE_CONFIG_DIR = opts.configDir
  else delete env.CLAUDE_CONFIG_DIR


  // Как в pty.ts: cwd всегда домашняя папка, claude.exe напрямую без shell —
  // через cmd кириллица в аргументах ломается
  // .cmd-обёртку без shell Node на Windows запускать отказывается — это запасной путь
  const exe = claudeExe()
  const child = spawn(exe, args, { cwd: os.homedir(), env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: exe.endsWith('.cmd') })
  const entry: ChatEntry = { child, sessionId, buf: '', pendingInput: '', pending: new Map(), announced: false, isNew: !opts.sessionId, init: undefined, configDir: opts.configDir }
  chats.set(sessionId, entry)
  chatLog(sessionId, `start pid=${child.pid} ${args.filter(a => a !== sessionId).join(' ')}`)

  child.stdout?.on('data', (chunk: Buffer) => {
    entry.buf += chunk.toString('utf8')
    let i: number
    while ((i = entry.buf.indexOf('\n')) >= 0) {
      const line = entry.buf.slice(0, i).trim()
      entry.buf = entry.buf.slice(i + 1)
      if (line) handleLine(entry, line)
    }
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    const msg = chunk.toString('utf8').trim()
    if (msg) chatLog(sessionId, 'stderr: ' + msg.slice(0, 2000))
  })
  child.on('exit', (code, signal) => {
    chatLog(sessionId, `exit pid=${child.pid} code=${code} signal=${signal}`)
    if (chats.get(sessionId) === entry) chats.delete(sessionId)
    for (const done of entry.pending.values()) done({ subtype: 'error', request_id: '', error: 'процесс завершился' })
    send('chat:exit', sessionId, code)
  })
  child.on('error', err => {
    chatLog(sessionId, 'spawn error: ' + String(err.message ?? err))
    send('chat:event', sessionId, { type: 'vael_error', error: String(err.message ?? err) })
  })

  // Рукопожатие SDK: в ответ список команд с описаниями — для подсказок по "/"
  control(sessionId, { subtype: 'initialize' }, 30000)
    .then(r => {
      entry.init = { commands: r.commands ?? [], models: r.models ?? [], account: r.account ?? null }
      send('chat:event', sessionId, { type: 'vael_init', ...entry.init })
    })
    .catch(() => {})

  return sessionId
}

function handleLine(entry: ChatEntry, line: string) {
  let ev: Record<string, unknown>
  try { ev = JSON.parse(line) } catch { return }

  if (ev.type === 'rate_limit_event' && ev.rate_limit_info) saveLimits(entry.configDir, ev.rate_limit_info)

  if (ev.type === 'control_response') {
    const r = ev.response as ControlResponse
    const done = entry.pending.get(r?.request_id)
    if (done) { entry.pending.delete(r.request_id); done(r) }
    return
  }
  // Новая сессия получает jsonl только с первым сообщением — тогда же
  // её можно показывать в списке
  if (entry.isNew && !entry.announced && ev.type === 'system' && ev.subtype === 'init') {
    entry.announced = true
    send('chat:created', entry.sessionId)
  }
  send('chat:event', entry.sessionId, ev)
}

export function control(sessionId: string, request: Record<string, unknown>, timeoutMs = 10000): Promise<Record<string, unknown>> {
  const entry = chats.get(sessionId)
  if (!entry?.child.stdin) return Promise.reject(new Error('чат-процесс не запущен'))
  const id = randomUUID()
  entry.child.stdin.write(JSON.stringify({ type: 'control_request', request_id: id, request }) + '\n')
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { entry.pending.delete(id); reject(new Error('нет ответа на ' + request.subtype)) }, timeoutMs)
    entry.pending.set(id, r => {
      clearTimeout(t)
      if (r.subtype === 'success') resolve(r.response ?? {})
      else reject(new Error(r.error ?? 'ошибка'))
    })
  })
}

/** content — строка или блоки Messages API: так картинки и PDF уходят прямо в сообщение */
export function sendChatMessage(sessionId: string, content: string | unknown[]): boolean {
  const entry = chats.get(sessionId)
  if (!entry?.child.stdin) return false
  entry.child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n')
  return true
}

export function getChatInit(sessionId: string) {
  return chats.get(sessionId)?.init ?? null
}

/**
 * Совместимость с модулями, которые пишут в сессию как в терминал:
 * текст отдельно, потом '\r'. Копим до '\r' и отправляем одним сообщением.
 */
export function chatWriteLikePty(sessionId: string, data: string): boolean {
  const entry = chats.get(sessionId)
  if (!entry) return false
  for (const ch of data) {
    if (ch === '\r') {
      const text = entry.pendingInput.trim()
      entry.pendingInput = ''
      if (text) sendChatMessage(sessionId, text)
    } else {
      entry.pendingInput += ch
    }
  }
  return true
}

export async function killChat(sessionId: string): Promise<void> {
  const entry = chats.get(sessionId)
  if (!entry) return
  chatLog(sessionId, `kill pid=${entry.child.pid} по запросу окна`)
  chats.delete(sessionId)
  await killTree(entry.child)
}

export function killAllChats() {
  for (const [sessionId, entry] of chats) {
    chats.delete(sessionId)
    if (entry.child.pid && process.platform === 'win32') {
      try { execFile('taskkill', ['/PID', String(entry.child.pid), '/T', '/F'], () => {}) } catch {}
    } else {
      try { entry.child.kill() } catch {}
    }
  }
}
