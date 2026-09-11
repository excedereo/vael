import { ClaudeRunner } from '../ClaudeRunner.js'
import { AccountManager } from '../AccountManager.js'

export interface ModuleContext {
  claudeRunner: ClaudeRunner | null
  accountManager: AccountManager
  getLastConfigDir: () => string
  getLastSessionId: () => string | null
  sendToWindow: (channel: string, ...args: unknown[]) => void
  watchSession: (sessionId: string, jsonlPath: string) => void
  unwatchSession: (sessionId: string) => void
  subscribeReply: (sessionId: string, cb: (text: string) => void) => void
  unsubscribeReply: (sessionId: string) => void
  ptyWrite: (sessionId: string, data: string) => void
  userData: string
  /** Текущий статус сессии: idle | thinking | streaming | tool | asking, либо null если сессия не найдена */
  getSessionStatus: (sessionId: string) => string | null
  /** Путь к <sessionId>.jsonl активного аккаунта, либо null */
  findSessionJsonl: (sessionId: string) => string | null
  /** Достучаться до другого модуля — например heartbeat → telegram */
  getModule: (id: string) => PyreModule | null
  /** Запущен ли PTY сессии: без него писать в неё бессмысленно */
  isPtyAlive: (sessionId: string) => boolean
  /** sessionId всех сессий с живым PTY */
  listAlivePtySessions: () => string[]
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

// Runtime sentinel — keeps rollup from treating this as an empty module (interfaces are TS-only)
export const _types = true
