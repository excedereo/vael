import { ClaudeRunner } from '../ClaudeRunner.js'
import { AccountManager } from '../AccountManager.js'

export interface ModuleContext {
  claudeRunner: ClaudeRunner
  accountManager: AccountManager
  getLastConfigDir: () => string
  getLastSessionId: () => string | null
  sendToWindow: (channel: string, ...args: unknown[]) => void
  userData: string
}

export interface PyreModule {
  id: string
  name: string
  icon?: string
  init(ctx: ModuleContext): void
  destroy(): void
  getSettings(): Record<string, unknown>
  setSettings(settings: Record<string, unknown>): void
  isRunning(): boolean
}
