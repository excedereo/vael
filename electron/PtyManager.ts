import * as pty from 'node-pty'
import path from 'path'
import os from 'os'
import { stripAnsi } from './usageParser.js'

export type PtyOutputCallback = (data: string) => void

const CLAUDE_BIN = process.env.CLAUDE_BIN
  || 'C:\\Users\\reaya\\AppData\\Roaming\\npm\\claude.cmd'

// Derive the actual exe from the .cmd wrapper location
const CLAUDE_EXE = path.join(
  path.dirname(CLAUDE_BIN),
  'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe',
)

export class PtyManager {
  private ptyProcess: pty.IPty | null = null
  private outputCallback: PtyOutputCallback | null = null
  private outputBuffer = ''
  private isQuerying = false
  private configDir = ''

  spawn(configDir: string, sessionId?: string, skipPermissions = true): void {
    this.ptyProcess?.kill()
    this.ptyProcess = null
    this.configDir = configDir

    const args: string[] = [
      ...(skipPermissions ? ['--dangerously-skip-permissions'] : []),
      ...(sessionId ? ['--resume', sessionId] : []),
    ]

    try {
      this.ptyProcess = pty.spawn(CLAUDE_EXE, args, {
        name: 'xterm-256color',
        cols: 220,
        rows: 50,
        cwd: os.homedir(),
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir } as Record<string, string>,
      })
    } catch (e) {
      console.error('[PtyManager] spawn failed:', e)
      return
    }

    this.outputBuffer = ''

    let trustAnswered = false
    let bypassAnswered = false
    let themeAnswered = false
    this.ptyProcess.onData((data) => {
      this.outputBuffer += data
      const s = stripAnsi(this.outputBuffer).replace(/\s+/g, '')
      // Auto-answer trust dialog ("Is this a project you trust?")
      if (!trustAnswered && (s.includes('trustthisfolder') || s.includes('Isthisaproject'))) {
        trustAnswered = true
        console.log('[PtyManager] answering trust dialog')
        setTimeout(() => this.ptyProcess?.write('1'), 100)
      }
      // Auto-answer bypass permissions warning ("2. Yes, I accept")
      if (!bypassAnswered && (s.includes('BypassPermissionsmode') || s.includes('dangerously-skip-permissions')) && s.includes('Iaccept')) {
        bypassAnswered = true
        console.log('[PtyManager] answering bypass dialog')
        setTimeout(() => this.ptyProcess?.write('2'), 300)
      }
      // Auto-answer theme selection (first launch)
      if (!themeAnswered && s.includes('Darkmode') && s.includes('Lightmode') && s.includes('Syntaxtheme')) {
        themeAnswered = true
        console.log('[PtyManager] answering theme dialog')
        setTimeout(() => this.ptyProcess?.write('1'), 100)
      }
      if (!this.isQuerying) this.outputCallback?.(data)
    })

    this.ptyProcess.onExit(() => {
      this.ptyProcess = null
    })
  }

  async waitForPrompt(timeout = 8000): Promise<boolean> {
    if (!this.ptyProcess) return false

    const isReady = (s: string) =>
      s.includes('for agents') || s.includes('shift+tab to cycle') ||
      s.includes('bypass permissions on') || s.includes('? for shortcuts') ||
      s.includes('Not logged in') || s.includes('Run /login')

    // Check if prompt already arrived in buffer
    const bufSnap = stripAnsi(this.outputBuffer)
    if (isReady(bufSnap)) {
      console.log('[PtyManager] waitForPrompt: early resolve from buffer, tail:', bufSnap.slice(-200).replace(/\s+/g, ' '))
      // Small wait to ensure claude is fully ready to accept commands
      await new Promise(r => setTimeout(r, 800))
      return true
    }

    return new Promise((resolve) => {
      let buf = ''
      const disposable = this.ptyProcess!.onData((data) => {
        buf += data
        if (isReady(stripAnsi(buf))) {
          disposable.dispose()
          clearTimeout(timer)
          setTimeout(() => resolve(true), 300)
        }
      })
      const timer = setTimeout(() => {
        disposable.dispose()
        console.log('[PtyManager] waitForPrompt timeout, buffer stripped:\n' + stripAnsi(this.outputBuffer).slice(-800))
        resolve(false)
      }, timeout)
    })
  }

  async queryUsage(): Promise<string> {
    if (!this.ptyProcess) {
      if (this.configDir) this.spawn(this.configDir)
    }
    if (!this.ptyProcess) return ''
    if (this.isQuerying) return ''

    this.isQuerying = true
    try {
      console.log('[PtyManager] queryUsage: calling waitForPrompt, ptyProcess alive:', !!this.ptyProcess)
      const ready = await this.waitForPrompt(15000)
      if (!ready) { console.log('[PtyManager] waitForPrompt timed out for usage'); return '' }
      console.log('[PtyManager] queryUsage: prompt ready, sending /usage')
      this.outputBuffer = '' // clear so context query won't reuse stale buffer
      const out = await this._query('/usage\r', /\d+%\s+used/, 6000)
      this.ptyProcess?.write('\x1b') // close overlay
      await new Promise(r => setTimeout(r, 500))
      console.log('[PtyManager] usage result length:', out.length)
      return out
    } finally {
      this.isQuerying = false
    }
  }

  async queryContext(): Promise<string> {
    if (!this.ptyProcess || this.isQuerying) return ''

    this.isQuerying = true
    try {
      const ready = await this.waitForPrompt(20000)
      if (!ready) {
        console.log('[PtyManager] waitForPrompt timed out for context, buffer tail:\n' + stripAnsi(this.outputBuffer).slice(-400))
        return ''
      }
      this.outputBuffer = ''
      const out = await this._query('/context all\r', /tokens?\s*\(/, 6000)
      console.log('[PtyManager] context result length:', out.length)
      return out
    } finally {
      this.isQuerying = false
    }
  }

  private _query(command: string, donePattern: RegExp, timeout: number): Promise<string> {
    return new Promise((resolve) => {
      if (!this.ptyProcess) { resolve(''); return }

      let collected = ''

      const disposable = this.ptyProcess.onData((data) => {
        collected += data
        const stripped = stripAnsi(collected)
        if (donePattern.test(stripped)) {
          disposable.dispose()
          clearTimeout(timer)
          resolve(stripped)
        }
      })

      const timer = setTimeout(() => {
        disposable.dispose()
        const stripped = stripAnsi(collected)
        console.log('[PtyManager] query timeout full stripped:\n' + stripped)
        resolve(stripped)
      }, timeout)

      this.ptyProcess.write(command)
    })
  }

  sendCommand(command: string): void {
    if (!this.ptyProcess || this.isQuerying) return
    this.ptyProcess.write(command + '\r')
  }

  onOutput(cb: PtyOutputCallback): void {
    this.outputCallback = cb
  }

  isAlive(): boolean {
    return this.ptyProcess !== null
  }

  kill(): void {
    this.ptyProcess?.kill()
    this.ptyProcess = null
  }

  getConfigDir(): string {
    return this.configDir
  }
}
