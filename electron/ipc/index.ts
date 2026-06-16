import { BrowserWindow } from 'electron'
import type { AccountManager } from '../AccountManager.js'
import type { ModuleRegistry } from '../ModuleRegistry.js'

import { registerAccountHandlers } from './accounts.js'
import { registerSessionHandlers } from './sessions.js'
import { registerClaudeHandlers } from './claude.js'
import { registerMemoryHandlers } from './memory.js'
import { registerModuleHandlers } from './modules.js'
import { registerWindowHandlers } from './window.js'
import { registerSettingsHandlers } from './settings.js'
import { registerTempHandlers } from './temp.js'
import { registerNativeConsoleHandlers } from './nativeConsole.js'
import { registerPtyHandlers } from './pty.js'

export interface HandlerDeps {
  getWindow: () => BrowserWindow | null
  accountManager: AccountManager
  moduleRegistry: ModuleRegistry
  flushLogBuffer: () => void
}

export function registerAllHandlers(deps: HandlerDeps) {
  const { getWindow, accountManager, moduleRegistry, flushLogBuffer } = deps

  registerAccountHandlers(accountManager, getWindow)
  registerSessionHandlers(accountManager, getWindow)
  registerClaudeHandlers(getWindow)
  registerMemoryHandlers()
  registerModuleHandlers(moduleRegistry)
  registerWindowHandlers(getWindow)
  registerSettingsHandlers(null, flushLogBuffer)
  registerTempHandlers(getWindow)
  registerNativeConsoleHandlers(getWindow)
  registerPtyHandlers(getWindow)
}
