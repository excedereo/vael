import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import type { StreamEvent } from '../shared/types.js'
import { findClaudeBin } from './services/ClaudeBin.js'

export type StreamCallback = (event: StreamEvent) => void
export type DoneCallback = (exitCode: number | null) => void

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
