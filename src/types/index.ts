// Re-export из shared/types.ts — не добавлять сюда ничего своего
export * from '../../shared/types.js'

// Backward compat — AppState был здесь, переносим в store когда будет готово
export interface AppState {
  accounts: import('../../shared/types.js').Account[]
  activeAccountId: string
  sessions: import('../../shared/types.js').Session[]
  activeSessionId: string | null
  syncStatus: import('../../shared/types.js').SyncStatus
  syncMessage?: string
}
