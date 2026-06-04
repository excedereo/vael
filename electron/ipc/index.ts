import { BrowserWindow } from 'electron'
import type { AccountManager } from '../AccountManager.js'
import type { PtySessionManager } from '../PtySessionManager.js'
import type { ModuleRegistry } from '../ModuleRegistry.js'
import type { ContextData } from '../usageParser.js'

import { registerAccountHandlers } from './accounts.js'
import { registerSessionHandlers } from './sessions.js'
import { registerClaudeHandlers } from './claude.js'
import { registerMemoryHandlers } from './memory.js'
import { registerModuleHandlers } from './modules.js'
import { registerWindowHandlers } from './window.js'
import { registerSettingsHandlers } from './settings.js'
import { registerPtyHandlers } from './pty.js'
import { registerTempHandlers } from './temp.js'

export interface HandlerDeps {
  getWindow: () => BrowserWindow | null
  accountManager: AccountManager
  claudeRunner: PtySessionManager
  moduleRegistry: ModuleRegistry
  contextCache: Map<string, ContextData>
  lastUsageData: () => { usage: unknown; context: unknown } | null
  getLastSessionId: () => string | null
  setLastSessionId: (id: string) => void
  getLastConfigDir: () => string
  setLastConfigDir: (dir: string) => void
  trackCacheFromEvent: (event: unknown) => void
  flushLogBuffer: () => void
}

export function registerAllHandlers(deps: HandlerDeps) {
  const {
    getWindow, accountManager, claudeRunner, moduleRegistry,
    contextCache, lastUsageData, getLastSessionId, setLastSessionId,
    getLastConfigDir, setLastConfigDir, trackCacheFromEvent, flushLogBuffer,
  } = deps

  registerAccountHandlers(accountManager, getWindow)
  registerSessionHandlers(accountManager, contextCache, lastUsageData, getLastSessionId, setLastSessionId, getWindow)
  registerClaudeHandlers(claudeRunner, accountManager, getLastSessionId, setLastSessionId, getLastConfigDir, setLastConfigDir, trackCacheFromEvent, getWindow)
  registerMemoryHandlers()
  registerModuleHandlers(moduleRegistry)
  registerWindowHandlers(getWindow)
  registerSettingsHandlers(setLastConfigDir, flushLogBuffer)
  registerPtyHandlers(claudeRunner)
  registerTempHandlers(getWindow)
}
