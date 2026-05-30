import { spawn, ChildProcess, execSync } from 'child_process'
import os from 'os'
import fs from 'fs'
import path from 'path'
import type { StreamEvent } from '../shared/types.js'

export type StreamCallback = (event: StreamEvent) => void
export type DoneCallback = (exitCode: number | null) => void

function findClaudeBin(): string {
  // 1. Явная переменная окружения
  if (process.env.CLAUDE_BIN && fs.existsSync(process.env.CLAUDE_BIN)) {
    return process.env.CLAUDE_BIN
  }
  // 2. Ищем через where/which
  try {
    const found = execSync(process.platform === 'win32' ? 'where claude.cmd' : 'which claude', {
      stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8'
    }).trim().split('\n')[0].trim()
    if (found && fs.existsSync(found)) return found
  } catch { /* not in PATH */ }
  // 3. Стандартные пути npm global
  const home = os.homedir()
  const candidates = process.platform === 'win32'
    ? [
        path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
        'C:\\Program Files\\nodejs\\claude.cmd',
      ]
    : [
        path.join(home, '.npm-global', 'bin', 'claude'),
        '/usr/local/bin/claude',
        '/usr/bin/claude',
      ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  // 4. Фоллбек — пусть PATH разберётся сам
  return process.platform === 'win32' ? 'claude.cmd' : 'claude'
}

const CLAUDE_BIN = findClaudeBin()
console.log('[ClaudeRunner] using claude bin:', CLAUDE_BIN)

function spawnClaude(
  args: string[],
  configDir: string,
  onEvent: StreamCallback,
  onDone: DoneCallback,
  stdinText?: string,
): ChildProcess {
  // Mirror Python's approach: cmd /c <path> ...args as array (no shell:true)
  // This uses CreateProcessW (Unicode) so Cyrillic text passes correctly
  const proc = spawn('cmd.exe', ['/c', CLAUDE_BIN, ...args], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    cwd: os.homedir(),
    shell: false,
    stdio: [stdinText !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  })

  if (stdinText !== undefined && proc.stdin) {
    proc.stdin.write(stdinText, 'utf8')
    proc.stdin.end()
  }

  let buffer = ''

  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed)
        const t = parsed?.type
        const sub = parsed?.subtype
        if (t === 'system') console.log('[ClaudeRunner] system FULL:', trimmed)
        else if (t === 'result') console.log('[ClaudeRunner] result FULL:', trimmed)
        else console.log('[ClaudeRunner] stdout:', trimmed.slice(0, 120))
      } catch {
        console.log('[ClaudeRunner] non-json stdout:', trimmed.slice(0, 200))
      }
      try {
        onEvent(JSON.parse(trimmed))
      } catch { /* non-json line */ }
    }
  })

  proc.stderr?.on('data', (chunk: Buffer) => {
    const msg = chunk.toString('utf8').trim()
    if (msg) {
      console.log('[ClaudeRunner] stderr:', msg.slice(0, 200))
      onEvent({ type: 'error', error: msg })
    }
  })

  proc.on('close', (code) => {
    if (buffer.trim()) {
      try { onEvent(JSON.parse(buffer.trim())) } catch { /* skip */ }
    }
    onDone(code)
  })

  return proc
}

export class ClaudeRunner {
  private activeProcess: ChildProcess | null = null

  sendMessage(
    sessionId: string,
    text: string,
    configDir: string,
    model: string,
    effort: string | null,
    permissionMode: string,
    onEvent: StreamCallback,
    onDone: DoneCallback,
  ): void {
    this.activeProcess?.kill()

    const args = [
      '--resume', sessionId,
      '--model', model,
      ...(effort ? ['--effort', effort] : []),
      '--permission-mode', permissionMode,
      '--output-format', 'stream-json',
      '--verbose',
    ]

    console.log('[ClaudeRunner] sendMessage:', args.slice(0, 4).join(' '), '...')

    this.activeProcess = spawnClaude(args, configDir, onEvent, (code) => {
      this.activeProcess = null
      onDone(code)
    }, text)
  }

  startNewSession(
    text: string,
    configDir: string,
    model: string,
    effort: string | null,
    permissionMode: string,
    onEvent: StreamCallback,
    onDone: DoneCallback,
  ): void {
    this.activeProcess?.kill()

    const args = [
      '--model', model,
      ...(effort ? ['--effort', effort] : []),
      '--permission-mode', permissionMode,
      '--output-format', 'stream-json',
      '--verbose',
    ]

    console.log('[ClaudeRunner] startNewSession:', args.slice(0, 2).join(' '), '...')

    this.activeProcess = spawnClaude(args, configDir, onEvent, (code) => {
      this.activeProcess = null
      onDone(code)
    }, text)
  }

  abort(): void {
    if (this.activeProcess) {
      const pid = this.activeProcess.pid
      this.activeProcess = null
      if (pid) {
        try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch { /* already dead */ }
      }
    }
  }

  isRunning(): boolean {
    return this.activeProcess !== null
  }
}
