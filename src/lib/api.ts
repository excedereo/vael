import { Account, Session, JsonlEntry, StreamEvent, UsageData, ContextData, SessionMeta } from '../types/index'

/** Запись в очереди побудок Heartbeat. Держать в синхроне с electron/modules/heartbeat.ts */
export interface WakeEntry {
  id: string
  kind: 'one' | 'every'
  at?: number
  intervalMs?: number
  nextAt?: number
  text?: string
  source: 'vaeli' | 'user'
  createdAt: number
}

export interface SessionInfo {
  model: string | null
  effort: string | null
  permissionMode: string | null
  lastText: string | null
  lastAt: string | null
}

export interface AuthInfo {
  loggedIn: boolean
  /** refreshToken истёк — продлить нечем, нужен повторный вход */
  expired: boolean
  /** когда истекает accessToken (продлевается сам) */
  expiresAt: number | null
  /** когда истекает refreshToken — вот это и есть смерть сессии */
  refreshExpiresAt: number | null
  subscriptionType?: string | null
}

export interface NetworkInfo {
  ok: boolean
  /** внешний IP, каким его видит Anthropic */
  ip: string | null
  /** ISO-код страны выхода */
  country: string | null
  /** дата-центр Cloudflare (WAW, FRA, …) */
  colo: string | null
  /** сеть недоступна — вердикт о стране выносить нельзя */
  offline: boolean
  error?: string
}

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
  /** id активных в этот день сессий — чтобы считать их за период без повторов */
  sessionIds?: string[]
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
  /** день → модель → разбивка токенов (для фильтра по периоду) */
  dailyModelUsage?: Record<string, Record<string, StatsModelUsage>>
  totalSessions?: number
  firstSessionDate?: string
  /** Сообщения по часам суток, 0..23 */
  hourCounts?: number[]
}

// Type-safe wrapper around window.api exposed by preload
export interface ElectronAPI {
  getAccounts: () => Promise<Account[]>
  createAccount: (id: string) => Promise<Account>
  deleteAccount: (id: string) => Promise<{ ok: boolean }>
  logoutAccount: (id: string) => Promise<{ ok: boolean }>
  openAuth: (configDir: string) => Promise<{ ok: boolean }>
  checkCredentials: (configDir: string) => Promise<boolean>
  getAuthInfo: (configDir: string) => Promise<AuthInfo>
  checkNetwork: () => Promise<NetworkInfo>

  getSessions: (accountId: string) => Promise<Session[]>
  readSession: (sessionPath: string) => Promise<JsonlEntry[]>
  deleteSession: (sessionPath: string) => Promise<{ ok: boolean }>
  readSessionMeta: (jsonlPath: string) => Promise<SessionMeta>
  writeSessionMeta: (jsonlPath: string, patch: Partial<SessionMeta>) => Promise<SessionMeta>
  getSessionInfo: (jsonlPath: string) => Promise<SessionInfo>
  findNewSessions: (configDir: string, excludeIds: string[]) => Promise<string[]>
  importSessions: (configDir: string) => Promise<{ ok: boolean; imported: string[] }>
  saveAttachment: (buffer: ArrayBuffer, filename: string) => Promise<{ ok: boolean; filePath: string }>
  clipboardRead: () => Promise<{ type: 'text'; text: string } | { type: 'file'; filePath: string } | { type: 'paths'; paths: string[] } | { type: 'empty' }>
  attachmentsGetDirSize: () => Promise<{ bytes: number; count: number }>
  attachmentsClear: (maxAgeDays?: number) => Promise<{ ok: boolean; count: number }>
  attachmentsOpenFolder: () => Promise<{ ok: boolean }>

  switchAccount: (fromId: string, toId: string) => Promise<{ ok: boolean; error?: string }>
  setActiveAccount: (id: string) => Promise<{ ok: boolean }>
  getSettings: () => Promise<Record<string, unknown>>
  saveSettings: (data: unknown) => Promise<{ ok: boolean }>
  getClaudeVersion: () => Promise<string>
  openExternal: (url: string) => Promise<void>

  abortRun: () => Promise<{ ok: boolean }>

  // PTY terminal
  ptySpawn: (termId: string, sessionId: string, projectPath: string, configDir: string, cols: number, rows: number, model?: string, effort?: string, permissionMode?: string) => Promise<{ ok: boolean }>
  ptyWrite: (termId: string, data: string) => void
  ptyResize: (termId: string, cols: number, rows: number) => Promise<{ ok: boolean }>
  ptyKill: (termId: string) => Promise<{ ok: boolean }>
  ptyAlive: (termId: string) => Promise<{ alive: boolean }>
  onPtyData: (cb: (termId: string, data: string) => void) => () => void
  onPtyExit: (cb: (termId: string) => void) => () => void

  // Native console window
  nconSpawn: (sessionPath: string, x: number, y: number, w: number, h: number) => Promise<{ ok: boolean }>
  nconMove: (x: number, y: number, w: number, h: number) => Promise<{ ok: boolean }>
  nconKill: () => Promise<{ ok: boolean }>
  nconIsAlive: () => Promise<{ alive: boolean }>
  nconSetVisible: (visible: boolean) => Promise<{ ok: boolean }>

  pickAvatar: () => Promise<string | null>

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
  installClaudeVersion: (version: string) => Promise<{ ok: boolean; log: string }>
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
  tgDetectChatId: (botToken: string) => Promise<{ ok: boolean; error?: string; chats?: { id: string; name: string }[] }>
  tgStart: () => Promise<{ ok: boolean }>
  tgStop: () => Promise<{ ok: boolean }>
  tgReply: (chatId: string, text: string) => Promise<{ ok: boolean }>
  onTgMessage: (cb: (chatId: string, text: string, filePath?: string) => void) => () => void
  onSessionReload: (cb: (sessionId: string) => void) => () => void
  onSessionCreated: (cb: (sessionId: string) => void) => () => void

  // Session status watching
  watchSession: (sessionId: string, jsonlPath: string) => Promise<{ ok: boolean }>
  unwatchSession: (sessionId: string) => Promise<{ ok: boolean }>
  onSessionStatus: (cb: (sessionId: string, status: string) => void) => () => void
  onSessionStatusLog: (cb: (sessionId: string, transition: string) => void) => () => void
  setActiveSessionForNotify: (sessionId: string | null) => void
  setSessionTitleForNotify: (sessionId: string, title: string) => void
  onNotificationOpenSession: (cb: (sessionId: string) => void) => () => void
  applyNotificationSettings: (settings: {
    enabled: boolean
    corner: string
    width: number
    scale: number
    maxStack: number
    holdSeconds: number
    holdForever: boolean
    soundEnabled: boolean
    soundFile: string
    soundVolume: number
  }) => void
  previewNotifications: () => void
  previewNotification: (kind: 'asking' | 'done' | 'error') => void
  getNotificationMaxStack: (scale: number) => Promise<number>
  getNotificationSounds: () => Promise<string[]>
  getNotificationWorkArea: () => Promise<{ width: number; height: number; scaleFactor: number }>
  onSessionReply: (cb: (sessionId: string, text: string) => void) => () => void

  // Pyre modules
  modulesList: () => Promise<{ id: string; name: string; icon?: string; running: boolean }[]>
  modulesGetSettings: (id: string) => Promise<Record<string, unknown> | null>
  modulesSetSettings: (id: string, settings: Record<string, unknown>) => Promise<{ ok: boolean }>
  modulesStart: (id: string) => Promise<{ ok: boolean }>
  modulesStop: (id: string) => Promise<{ ok: boolean }>

  // Heartbeat
  heartbeatQueue: () => Promise<WakeEntry[]>
  heartbeatCancel: (id: string) => Promise<{ ok: boolean }>
  heartbeatAdd: (entry: WakeEntry) => Promise<{ ok: boolean }>
  heartbeatClear: () => Promise<{ ok: boolean }>
  heartbeatHealth: () => Promise<{ blocked: string | null; alive: string[] }>
  onHeartbeatSettingsChanged: (cb: (s: Record<string, unknown>) => void) => () => void
  onHeartbeatQueue: (cb: (queue: WakeEntry[]) => void) => () => void
  onHeartbeatFired: (cb: (info: { message: string; at: number }) => void) => () => void

  getStats: (configDir?: string) => Promise<{ ok: boolean; data: StatsCache | null }>
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
