import { Account, Session, JsonlEntry, StreamEvent, UsageData, ContextData } from '../types/index'

export interface FsEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  mtime?: number
  auto?: boolean
  tag?: string
}

export interface StatsDailyActivity {
  date: string
  messageCount: number
  sessionCount: number
  toolCallCount: number
}

export interface StatsModelUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  webSearchRequests?: number
}

export interface StatsCache {
  version: number
  lastComputedDate: string
  dailyActivity: StatsDailyActivity[]
  modelUsage: Record<string, StatsModelUsage>
  dailyModelTokens?: Record<string, Record<string, number>>
}

// Type-safe wrapper around window.api exposed by preload
export interface ElectronAPI {
  getAccounts: () => Promise<Account[]>
  createAccount: (id: string) => Promise<Account>
  deleteAccount: (id: string) => Promise<{ ok: boolean }>
  logoutAccount: (id: string) => Promise<{ ok: boolean }>
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
  sessionCommand: (command: string) => Promise<{ ok: boolean; error?: string }>

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
  memoryListDir: (dirPath?: string) => Promise<{ ok: boolean; entries: FsEntry[]; rootDir: string }>
  memoryReadFile: (filePath: string) => Promise<{ ok: boolean; content: string }>
  memoryWriteFile: (filePath: string, content: string) => Promise<{ ok: boolean }>
  memoryCreateFile: (name: string, dirPath?: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  memoryCreateDir: (name: string, dirPath?: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  memoryDeleteFile: (filePath: string) => Promise<{ ok: boolean }>
  memoryGetClaudeMd: () => Promise<{ ok: boolean; path: string; content: string }>
  memoryGetDir: () => Promise<string>
  memoryRename: (oldPath: string, newName: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  memoryGetMeta: () => Promise<Record<string, { auto: boolean }>>
  memoryGetTokens: () => Promise<{ auto: number; total: number }>
  memorySetMeta: (relativePath: string, data: { auto: boolean }) => Promise<{ ok: boolean }>
  memoryRebuildAll: () => Promise<{ ok: boolean }>

  // Telegram integration
  tgGetSettings: () => Promise<{ botToken: string; chatId: string; enabled: boolean; sessionId?: string; model?: string; effort?: string }>
  tgSetSettings: (settings: { botToken: string; chatId: string; enabled: boolean; sessionId?: string; model?: string; effort?: string }) => Promise<{ ok: boolean }>
  tgStart: () => Promise<{ ok: boolean }>
  tgStop: () => Promise<{ ok: boolean }>
  tgReply: (chatId: string, text: string) => Promise<{ ok: boolean }>
  onTgMessage: (cb: (chatId: string, text: string, filePath?: string) => void) => () => void
  onSessionReload: (cb: (sessionId: string) => void) => () => void

  getStats: () => Promise<{ ok: boolean; data: StatsCache | null }>
  getVaelVersion: () => Promise<string>
  setAutoDownload: (enabled: boolean) => Promise<void>
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
