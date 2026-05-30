import { Account, Session, JsonlEntry, StreamEvent, UsageData, ContextData } from '../types/index'

// Type-safe wrapper around window.api exposed by preload
export interface ElectronAPI {
  getAccounts: () => Promise<Account[]>
  createAccount: (id: string) => Promise<Account>
  deleteAccount: (id: string) => Promise<{ ok: boolean }>
  openAuth: (configDir: string) => Promise<{ ok: boolean }>
  checkCredentials: (configDir: string) => Promise<boolean>

  getSessions: (accountId: string) => Promise<Session[]>
  readSession: (sessionPath: string) => Promise<JsonlEntry[]>
  deleteSession: (sessionPath: string) => Promise<{ ok: boolean }>

  switchAccount: (fromId: string, toId: string) => Promise<{ ok: boolean; error?: string }>
  setActiveAccount: (id: string) => Promise<{ ok: boolean }>
  getSettings: () => Promise<Record<string, unknown>>
  saveSettings: (data: unknown) => Promise<{ ok: boolean }>
  getClaudeVersion: () => Promise<string>
  openExternal: (url: string) => Promise<void>

  sendMessage: (sessionId: string, text: string, accountId: string, model: string, effort: string, permissionMode: string) => Promise<{ ok: boolean }>
  newSession: (text: string, accountId: string, model: string, effort: string, permissionMode: string) => Promise<{ ok: boolean }>
  abortRun: () => Promise<{ ok: boolean }>

  ptySpawn: (configDir: string, sessionId?: string) => Promise<{ ok: boolean }>
  ptySend: (command: string) => Promise<{ ok: boolean }>
  ptyKill: () => Promise<{ ok: boolean }>

  pickAvatar: () => Promise<string | null>

  onStreamEvent: (cb: (event: StreamEvent) => void) => () => void
  onStreamDone: (cb: (code: number | null) => void) => () => void
  onPtyOutput: (cb: (data: string) => void) => () => void
  onSyncStatus: (cb: (status: string, message?: string) => void) => () => void
  fetchUsage: () => Promise<{ ok: boolean }>
  fetchContext: () => Promise<{ ok: boolean }>
  getCachedUsage: () => Promise<{ ok: boolean }>
  selectSession: (sessionId: string) => Promise<void>
  onUsageData: (cb: (data: { usage: UsageData | null; context: ContextData | null }) => void) => () => void
  consoleFlush: () => Promise<{ ok: boolean }>
  onConsoleLog: (cb: (entry: { level: string; text: string; ts: number }) => void) => () => void
  listThemes: () => Promise<Array<{ file: string; name: string; vars: Record<string, string> }>>
  openThemesFolder: () => Promise<{ ok: boolean }>

  checkDeps: () => Promise<{ npm: string | null; claude: string | null; ready: boolean }>
  installClaude: () => Promise<{ ok: boolean; log: string }>
  tempSave: (buffer: ArrayBuffer, filename: string) => Promise<{ ok: boolean; filePath: string }>
  tempDelete: (filePath: string) => Promise<{ ok: boolean }>
  tempClear: () => Promise<{ ok: boolean; count: number }>
  tempGetSettings: () => Promise<Record<string, unknown>>
  tempSaveSettings: (data: Record<string, unknown>) => Promise<{ ok: boolean }>
  tempCancelCleanup: () => Promise<{ ok: boolean }>
  tempGetDirSize: () => Promise<{ bytes: number; count: number }>
  onTempCleanupStart: (cb: (autoDelete: string) => void) => () => void
  onTempCleanupDone: (cb: (count: number) => void) => () => void
  onTempCleanupCancelled: (cb: () => void) => () => void

  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>

  updateDownload: () => Promise<void>
  updateInstall: () => Promise<void>
  onUpdateAvailable: (cb: (version: string) => void) => () => void
  onUpdateProgress: (cb: (progress: number) => void) => () => void
  onUpdateReady: (cb: () => void) => () => void
  onUpdateError: (cb: (message: string) => void) => () => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

export const api: ElectronAPI = window.api
