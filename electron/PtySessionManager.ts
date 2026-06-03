import * as pty from 'node-pty'
import os from 'os'
import fs from 'fs'
import { execSync } from 'child_process'
import path from 'path'
import { stripAnsi } from './usageParser.js'
import type { StreamEvent } from '../shared/types.js'
// @ts-ignore — @xterm/headless has no bundled types in this version
import xtermPkg from '@xterm/headless'
const { Terminal: XTerminal } = xtermPkg as { Terminal: any }

export type StreamCallback = (event: StreamEvent) => void
export type DoneCallback = (exitCode: number | null) => void

// ── find claude binary ────────────────────────────────────────────────────────

function findClaudeBin(): string {
  if (process.env.CLAUDE_BIN && fs.existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN
  if (process.platform === 'win32') {
    for (const name of ['claude.cmd', 'claude']) {
      try {
        const found = execSync(`where ${name}`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' }).trim().split('\n')[0].trim()
        if (found && fs.existsSync(found)) return found
      } catch {}
    }
  } else {
    try {
      const found = execSync('which claude', { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' }).trim()
      if (found) return found
    } catch {}
  }
  const home = os.homedir()
  const candidates = process.platform === 'win32'
    ? [
        path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
        path.join(home, 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
      ]
    : [path.join(home, '.npm-global', 'bin', 'claude'), '/usr/local/bin/claude']
  for (const p of candidates) { if (fs.existsSync(p)) return p }
  return process.platform === 'win32' ? 'claude.cmd' : 'claude'
}

function findClaudeExe(bin: string): string {
  if (bin.endsWith('.exe')) return bin
  if (bin.endsWith('.cmd')) {
    const exeNext = bin.replace('.cmd', '.exe')
    if (fs.existsSync(exeNext)) return exeNext
    const viaModules = path.join(path.dirname(bin), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    if (fs.existsSync(viaModules)) return viaModules
  }
  return bin
}

const CLAUDE_BIN = findClaudeBin()
const CLAUDE_EXE = findClaudeExe(CLAUDE_BIN)
console.log('[PtySessionManager] claude exe:', CLAUDE_EXE)

// ── ANSI strip (lightweight, for init prompt detection only) ─────────────────

function stripAnsiLocal(s: string): string {
  return s
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B\[[0-9;]*[HfABDEFGST]/g, '')
    .replace(/\x1B\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1B[()][AB012UK]/g, '')
    .replace(/\x1B[MNOPRST78=><FEDM]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\r/g, '')
}

// ── PTY output parser — xterm-headless delta streaming ───────────────────────

const COLS = 120
const ROWS = 60

const SPINNER_CHARS = new Set(['✻', '✽', '✶', '·', '✢', '⠂', '⠐', '⠄'])
const THINKING_WORDS = ['Smooshing', 'Brewing', 'Baking', 'Cooking', 'Cogitating', 'Churning', 'Sautéed', 'Cooked', 'Brewed', 'Hashing', 'Propagating', 'Calculating', 'Unravelling', 'Worked', 'Crunched', 'Processed']
const TOOL_START_RE = /^●\s+(\w[\w.]*)\((.{0,300})\)/
const TOOL_RESULT_RE = /^⎿\s+(.*)/
const READY_RE = /\? for shortcuts|for agents|← for agents/
const SPINNER_LINE_RE = /^[✻✽✶·✢⠂⠐⠄*]\s/

// Детектор spinner-строк: начинается со spinner char или содержит thinking word
function isSpinnerLine(line: string): boolean {
  if (SPINNER_LINE_RE.test(line)) return true
  return THINKING_WORDS.some(w => line.includes(w + ' for') || line.includes(w + '…'))
}

class PtyParser {
  private term = new XTerminal({ cols: COLS, rows: ROWS, allowProposedApi: true })
  private prevScreen: string[] = []
  private started = false
  private seenOurEcho = false
  private sentMessage = ''
  private responseText = ''
  private pendingToolId: string | null = null
  private lastToolId: string | null = null  // id последнего tool_use для diff patch
  private pendingToolInput: Record<string, string> = {}
  private collectingDiff = false
  private diffRemoved: string[] = []
  private diffAdded: string[] = []
  private streamingTextEmitted = false
  // Дедупликация: не эмитим одну и ту же строку дважды
  private _lastTokenCount = 0
  private emittedTools = new Set<string>()
  private emittedResults = new Set<string>()  // дедупликация tool_result по toolId+content
  private emittedTexts = new Set<string>()

  constructor(private onEvent: (e: StreamEvent) => void) {}

  private readScreen(): string[] {
    const lines: string[] = []
    for (let i = 0; i < ROWS; i++) {
      const line = this.term.buffer.active.getLine(i)
      if (line) {
        const text = line.translateToString(false)
        lines.push(text)
      }
    }
    return lines
  }

  feed(data: string, sessionKey: string): void {
    this.term.write(data, () => this._afterWrite(sessionKey))
  }

  private _afterWrite(sessionKey: string): void {
    const screen = this.readScreen()

    // Находим последнее вхождение echo нашего сообщения на экране
    // Всё ниже него — новый контент, всё выше — история
    let echoRow = -1
    if (this.sentMessage) {
      const tail = this.sentMessage.slice(-15)  // последние 15 символов уникальны
      for (let i = screen.length - 1; i >= 0; i--) {
        const line = screen[i].trim()
        if ((line.startsWith('>') || line.startsWith('❯')) && line.includes(tail)) {
          echoRow = i
          if (!this.seenOurEcho) {
            this.seenOurEcho = true
            console.log(`[PtyParser:${sessionKey}] echo at row ${i}: "${line.slice(0, 60)}"`)
          }
          break
        }
      }
    }

    // Читаем счётчик токенов — ищем по всему экрану строку с XXXXX tokens
    // TUI рисует их через абсолютное позиционирование, место непредсказуемо
    for (let i = 0; i < screen.length; i++) {
      const m = screen[i].match(/(\d{4,})\s+tokens/)
      if (m && !/[↓↑]/.test(screen[i])) {
        const count = parseInt(m[1], 10)
        if (count !== this._lastTokenCount) {
          this._lastTokenCount = count
          this.onEvent({ type: 'pty_tokens', count } as unknown as StreamEvent)
        }
        break
      }
    }

    // Если echo ещё не найден — игнорируем весь экран (всё история)
    if (echoRow < 0) {
      this.prevScreen = [...screen]
      return
    }

    // Строки после echo — наш контент
    const contentScreen = screen.slice(echoRow + 1)

    // вычисляем дельту только в контентной зоне
    const delta: string[] = []
    const prevContent = this.prevScreen.slice(echoRow + 1)
    for (let i = 0; i < contentScreen.length; i++) {
      const line = contentScreen[i]
      if (!line.trim()) continue
      if (line !== prevContent[i]) {
        delta.push(line.trim())
      }
    }
    this.prevScreen = [...screen]

    if (delta.length === 0) return

    // лог дельты для отладки
    console.log(`[PtyParser:${sessionKey}] delta(row${echoRow}+):`, delta.map(l => '  |' + l.slice(0, 80)).join('\n'))

    for (const line of delta) {
      this.processLine(line, sessionKey)
    }
  }

  private processLine(line: string, sessionKey: string): void {
    // контекстные токены — "32720 tokens" (без ↓/↑ перед числом)
    const tokensLineMatch = line.match(/(?<![↓↑·]\s*)(\d+)\s+tokens$/)
    if (tokensLineMatch && !/[↓↑]/.test(line)) {
      const count = parseInt(tokensLineMatch[1], 10)
      if (!isNaN(count) && count > 0) {
        this.onEvent({ type: 'pty_tokens', count } as unknown as StreamEvent)
      }
      return
    }

    // голое число — контекстные токены если > 1000, иначе фильтруем
    if (/^\d+$/.test(line.trim())) {
      const count = parseInt(line.trim(), 10)
      if (count > 1000) {
        this.onEvent({ type: 'pty_tokens', count } as unknown as StreamEvent)
      }
      return
    }

    // ready prompt — финализируем
    if (READY_RE.test(line)) {
      if (!this.started) return
      console.log(`[PtyParser:${sessionKey}] ready, responseText: "${this.responseText.slice(0, 80)}"`)

      // Если стриминг текста был — он уже в liveEntries через streaming_text events.
      // Если нет (например только tool calls без текста) — шлём пустой ответ.
      // result коммитит всё из liveEntries.
      if (this.responseText && !this.streamingTextEmitted) {
        // fallback: не стримили, шлём целиком
        this.onEvent({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: this.responseText }] },
        } as StreamEvent)
      }
      this.onEvent({ type: 'result', subtype: 'success' } as StreamEvent)
      return
    }

    // spinner / thinking — стриминг старт
    if (isSpinnerLine(line)) {
      if (!this.started) {
        this.started = true
        console.log(`[PtyParser:${sessionKey}] streaming_start`)
        this.onEvent({ type: 'assistant_streaming_start' } as StreamEvent)
      }
      return
    }

    if (!this.started) return

    // diff строки после ⎿ (для Edit/Update): "17 -909" или "17 +606"
    if (this.collectingDiff) {
      const removed = line.match(/^\s*\d+\s+-(.+)$/)
      const added   = line.match(/^\s*\d+\s+\+(.+)$/)
      if (removed) { this.diffRemoved.push(removed[1]); return }
      if (added)   { this.diffAdded.push(added[1]);     return }
      // контекстная строка (без +/-) — тоже часть diff, пропускаем
      if (/^\s*\d+\s+\s/.test(line)) return
      // дошли до не-diff строки — заканчиваем сбор
      this.collectingDiff = false
      // шлём обновление input для последнего tool_use блока
      if ((this.diffRemoved.length || this.diffAdded.length) && this.lastToolId) {
        this.onEvent({
          type: 'pty_tool_update',
          tool_use_id: this.lastToolId,
          patch: { old_string: this.diffRemoved.join('\n'), new_string: this.diffAdded.join('\n') },
        } as unknown as StreamEvent)
      }
    }

    // tool result: ⎿  ...
    const toolResultMatch = line.match(TOOL_RESULT_RE)
    if (toolResultMatch) {
      const resultText = toolResultMatch[1].trim()
      // если результат содержит "line" — вероятно Edit/Update, начинаем собирать diff
      if (/Added|removed|line/i.test(resultText)) {
        this.collectingDiff = true
        this.diffRemoved = []
        this.diffAdded = []
      }
      if (this.pendingToolId) {
        const resultKey = this.pendingToolId + ':' + resultText.slice(0, 30)
        if (!this.emittedResults.has(resultKey)) {
          this.emittedResults.add(resultKey)
          this.onEvent({
            type: 'user',
            message: {
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: this.pendingToolId, content: resultText }],
            },
          } as StreamEvent)
          console.log(`[PtyParser:${sessionKey}] tool_result for ${this.pendingToolId}: "${resultText.slice(0, 60)}"`)
        }
        this.pendingToolId = null
      }
      return
    }

    // tool call: ● ToolName(args)
    const toolMatch = line.match(TOOL_START_RE)
    if (toolMatch) {
      // дедупликация — одну и ту же строку не эмитим дважды
      const toolKey = toolMatch[1] + '(' + toolMatch[2].slice(0, 40)
      if (this.emittedTools.has(toolKey)) return
      this.emittedTools.add(toolKey)
      // если был streaming text до tool call — коммитим его (фиксируем в liveEntries)
      if (this.streamingTextEmitted && this.responseText) {
        this.onEvent({ type: 'commit_streaming_text' } as unknown as StreamEvent)
        this.responseText = ''
        this.streamingTextEmitted = false
      }
      const toolId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      this.pendingToolId = toolId
      this.lastToolId = toolId
      this.collectingDiff = false
      this.diffRemoved = []
      this.diffAdded = []
      const toolName = toolMatch[1]
      const rawArgs = toolMatch[2]
      const cleanPath = rawArgs.replace(/^["']|["']$/g, '').replace(/\\\\/g, '\\')
      const toolInput: Record<string, string> = {
        command: rawArgs, args: rawArgs,
        file_path: cleanPath,
        pattern: rawArgs, query: rawArgs, url: rawArgs,
      }
      this.pendingToolInput = toolInput
      console.log(`[PtyParser:${sessionKey}] tool_use: ${toolName}(${rawArgs.slice(0, 60)})`)
      this.onEvent({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: toolName, id: toolId, input: toolInput }],
        },
      } as StreamEvent)
      return
    }

    // ● текст — ответ claude
    if (line.startsWith('●')) {
      // частичный tool call (ещё не дописаны аргументы) — одно слово без пробелов, с заглавной
      const afterBullet = line.slice(1).trim()
      if (/^\w[\w.]*$/.test(afterBullet)) return  // только одно слово — это имя тула без скобок
      const content = line.slice(1).trim()
      if (!content) return
      // дедупликация текста — не эмитим один и тот же текст дважды
      if (this.emittedTexts.has(content)) return
      this.emittedTexts.add(content)
      // если раньше был tool call — это новый ответ после инструментов
      this.responseText = content
      this.streamingTextEmitted = false
      // стримим текст в реальном времени через streaming_text event
      this.onEvent({ type: 'assistant_streaming_text', text: content } as StreamEvent)
      this.streamingTextEmitted = true
      console.log(`[PtyParser:${sessionKey}] streaming_text: "${content.slice(0, 60)}"`)
      return
    }

    // продолжение текста ответа (строки без ●, после того как responseText начался)
    if (this.responseText && this.streamingTextEmitted) {
      // не берём служебное
      if (line.startsWith('❯') || line.startsWith('>') || line.startsWith('⎿')) return
      if (line.startsWith('●')) return  // новый bullet — не continuation
      if (isSpinnerLine(line)) return
      if (READY_RE.test(line)) return
      if (/^\d[\d\s]*tokens?/.test(line)) return  // "29666 tokens" — счётчик контекста
      if (/^\d+$/.test(line.trim())) return        // голое число — перехвачено выше или строка файла
      if (/^esc to interrupt/.test(line)) return
      if (/^globalVersion/.test(line)) return
      // это continuation строка
      this.responseText += '\n' + line
      this.onEvent({ type: 'assistant_streaming_text', text: this.responseText } as StreamEvent)
    }
  }

  forceFinalize(sessionKey: string): void {
    if (!this.started) return
    console.log(`[PtyParser:${sessionKey}] forceFinalize, text: "${this.responseText.slice(0, 80)}"`)
    if (this.responseText) {
      this.onEvent({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: this.responseText }] },
      } as StreamEvent)
    }
    this.onEvent({ type: 'result', subtype: 'success' } as StreamEvent)
  }

  reset(sentMessage = ''): void {
    this.term.reset()
    this.prevScreen = []
    this.started = false
    this.seenOurEcho = false
    this.sentMessage = sentMessage
    this.responseText = ''
    this.pendingToolId = null
    this.lastToolId = null
    this.pendingToolInput = {}
    this.collectingDiff = false
    this.diffRemoved = []
    this.diffAdded = []
    this.streamingTextEmitted = false
    this._lastTokenCount = 0
    this.emittedTools.clear()
    this.emittedResults.clear()
    this.emittedTexts.clear()
  }
}

// ── Session state ─────────────────────────────────────────────────────────────

interface PtySession {
  proc: pty.IPty
  configDir: string
  sessionId: string | null   // null for new sessions until we detect it
  ready: boolean
  busy: boolean
  parser: PtyParser
  onEvent: StreamCallback | null
  onDone: DoneCallback | null
  trustAnswered: boolean
  bypassAnswered: boolean
  themeAnswered: boolean
  rawBuf: string
  model: string
  effort: string | null
  permissionMode: string
  idleTimer: ReturnType<typeof setTimeout> | null
}

// ── Manager ───────────────────────────────────────────────────────────────────

export class PtySessionManager {
  private sessions = new Map<string, PtySession>()

  // key used before we know the real sessionId (for new sessions)
  private pendingKey = '__new__'

  private spawnSession(
    key: string,
    configDir: string,
    sessionId: string | null,
    model: string,
    effort: string | null,
    permissionMode: string,
  ): PtySession {
    const args: string[] = [
      '--dangerously-skip-permissions',
      ...(sessionId ? ['--resume', sessionId] : []),
    ]

    const parser = new PtyParser((event) => {
      const sess = this.sessions.get(key)
      if (!sess) return
      sess.onEvent?.(event)
      if (event.type === 'result') {
        // держим busy ещё 600мс чтобы поймать "31783 tokens" который приходит после ready
        const done = sess.onDone
        const onEv = sess.onEvent
        sess.onDone = null
        setTimeout(() => {
          const s = this.sessions.get(key)
          if (s) { s.busy = false; s.onEvent = null }
          done?.(0)
        }, 600)
      }
    })

    const proc = pty.spawn(CLAUDE_EXE, args, {
      name: 'xterm-256color',
      cols: COLS,
      rows: 50,
      cwd: os.homedir(),
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir } as Record<string, string>,
    })

    const sess: PtySession = {
      proc,
      configDir,
      sessionId,
      ready: false,
      busy: false,
      parser,
      onEvent: null,
      onDone: null,
      trustAnswered: false,
      bypassAnswered: false,
      themeAnswered: false,
      rawBuf: '',
      model,
      effort,
      permissionMode,
      idleTimer: null,
    }

    proc.onData((data) => {
      sess.rawBuf += data
      const s = stripAnsi(sess.rawBuf).replace(/\s+/g, '')

      if (!sess.trustAnswered && (s.includes('trustthisfolder') || s.includes('Isthisaproject'))) {
        sess.trustAnswered = true
        setTimeout(() => proc.write('1'), 100)
      }
      if (!sess.bypassAnswered && (s.includes('BypassPermissionsmode') || s.includes('dangerously-skip-permissions')) && s.includes('Iaccept')) {
        sess.bypassAnswered = true
        setTimeout(() => proc.write('2'), 300)
      }
      if (!sess.themeAnswered && s.includes('Darkmode') && s.includes('Lightmode')) {
        sess.themeAnswered = true
        setTimeout(() => proc.write('1'), 100)
      }

      const plain = stripAnsiLocal(data)
      const promptVisible = plain.includes('? for shortcuts') || plain.includes('for agents')

      if (!sess.ready && promptVisible) {
        sess.ready = true
      }

      if (sess.busy) {
        sess.parser.feed(data, key)
      }

      // ловим "31783 tokens" всегда — приходит после ready prompt
      const plainStripped = stripAnsiLocal(data)
      const tokMatch = plainStripped.match(/^(\d+)\s+tokens$/m)
      if (tokMatch && !/[↓↑]/.test(plainStripped)) {
        const count = parseInt(tokMatch[1], 10)
        console.log(`[PtySession:${key}] tokens: ${count}`)
        sess.onEvent?.({ type: 'pty_tokens', count } as unknown as StreamEvent)
      }
    })

    proc.onExit(() => {
      console.log('[PtySessionManager] session exited:', key)
      this.sessions.delete(key)
      if (sess.busy) {
        sess.busy = false
        sess.onDone?.(-1)
      }
    })

    this.sessions.set(key, sess)
    return sess
  }

  private async waitReady(sess: PtySession, timeout = 15000): Promise<boolean> {
    if (sess.ready) return true

    const isReady = (s: string) => s.includes('? for shortcuts') || s.includes('for agents')

    // check already-buffered output first
    const bufStripped = stripAnsiLocal(sess.rawBuf)
    if (isReady(bufStripped)) {
      sess.ready = true
      return true
    }

    return new Promise((resolve) => {
      const t = setTimeout(() => { disposable.dispose(); resolve(false) }, timeout)
      let accumulated = ''
      const disposable = sess.proc.onData((data) => {
        accumulated += stripAnsiLocal(data)
        if (isReady(accumulated)) {
          sess.ready = true
          clearTimeout(t)
          disposable.dispose()
          console.log('[waitReady] prompt detected')
          resolve(true)
        }
      })
    })
  }

  // ── public API ──────────────────────────────────────────────────────────────

  async sendMessage(
    sessionId: string,
    text: string,
    configDir: string,
    model: string,
    effort: string | null,
    permissionMode: string,
    onEvent: StreamCallback,
    onDone: DoneCallback,
  ): Promise<void> {
    let sess = this.sessions.get(sessionId)

    const isNewSession = !sess
    if (!sess) {
      sess = this.spawnSession(sessionId, configDir, sessionId, model, effort, permissionMode)
      // wait for PTY to initialize
      await new Promise(r => setTimeout(r, 2000))
    } else if (sess.busy) {
      sess.proc.write('\x03')
      await new Promise(r => setTimeout(r, 500))
      sess.busy = false
    }

    sess.onEvent = onEvent
    sess.onDone = onDone
    sess.busy = true
    sess.ready = false
    sess.parser.reset(text)

    console.log(`[PtySession:${sessionId}] send: ${text.slice(0, 80)}`)
    sess.proc.write(text + '\r')
  }

  async startNewSession(
    text: string,
    configDir: string,
    model: string,
    effort: string | null,
    permissionMode: string,
    onEvent: StreamCallback,
    onDone: DoneCallback,
  ): Promise<void> {
    // kill previous pending if any
    const prev = this.sessions.get(this.pendingKey)
    if (prev) {
      prev.proc.kill()
      this.sessions.delete(this.pendingKey)
    }

    const sess = this.spawnSession(this.pendingKey, configDir, null, model, effort, permissionMode)

    const ready = await this.waitReady(sess)
    if (!ready) console.warn('[PtySessionManager] waitReady timed out for new session')

    sess.onEvent = onEvent
    sess.onDone = onDone
    sess.busy = true
    sess.ready = false
    sess.parser.reset(text)

    console.log(`[PtySession:__new__] send: ${text.slice(0, 80)}`)
    sess.proc.write(text + '\r')
  }

  abort(sessionId?: string): void {
    const key = sessionId ?? this.pendingKey
    const sess = this.sessions.get(key)
    if (!sess) return
    if (sess.idleTimer) { clearTimeout(sess.idleTimer); sess.idleTimer = null }
    sess.proc.write('\x03')   // Ctrl+C
    sess.busy = false
    sess.onDone?.(null)
    sess.onEvent = null
    sess.onDone = null
  }

  killSession(sessionId: string): void {
    const sess = this.sessions.get(sessionId)
    if (!sess) return
    sess.proc.kill()
    this.sessions.delete(sessionId)
  }

  killAll(): void {
    for (const [, sess] of this.sessions) {
      try { sess.proc.kill() } catch {}
    }
    this.sessions.clear()
  }

  isRunning(sessionId?: string): boolean {
    const key = sessionId ?? this.pendingKey
    const sess = this.sessions.get(key)
    return sess?.busy ?? false
  }

  isAlive(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  getSessionCount(): number {
    return this.sessions.size
  }
}
