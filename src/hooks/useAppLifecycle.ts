import { useEffect } from 'react'
import { DepsState, useDependencies } from './useDependencies.js'
import { UpdateState, useUpdateManager } from './useUpdateManager.js'
import { useAppState } from './useAppState.js'
import { api } from '../lib/api.js'
import { Account, Session, SyncStatus } from '../types/index'

export type AppPhase = 'splash' | 'no-deps' | 'no-accounts' | 'ready'

export interface AppLifecycle {
  phase: AppPhase
  deps: DepsState | null
  installing: boolean
  installLog: string | null
  handleInstallClaude: () => Promise<void>
  updateState: UpdateState | null
  setUpdateState: (s: UpdateState | null) => void
  handleUpdateClick: () => void
  tempCleanupBanner: { autoDelete: string; cancelled: boolean } | null
  tempCleanupCountdown: number
  // forwarded from useAppState
  accounts: Account[]
  activeAccountId: string
  sessions: Session[]
  activeSessionId: string | null
  setActiveSessionId: (id: string | null) => void
  syncStatus: SyncStatus
  syncMessage: string | undefined
  isLocked: boolean
  accountsLoaded: boolean
  switchAccount: (id: string) => Promise<void>
  refreshSessions: () => void
  refreshAccounts: () => Promise<void>
}

export function useAppLifecycle(): AppLifecycle {
  const appState = useAppState()
  const { deps, installing, installLog, handleInstallClaude } = useDependencies()
  const { updateState, setUpdateState, handleUpdateClick, tempCleanupBanner, tempCleanupCountdown } = useUpdateManager()

  // Cleanup: kill active PTY on window close
  useEffect(() => {
    const handleBeforeUnload = () => {
      api.ptyKill().catch(() => {})
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // Determine phase
  let phase: AppPhase = 'splash'

  const depsLoaded = deps !== null
  const accountsLoaded = appState.accountsLoaded

  if (depsLoaded && accountsLoaded) {
    if (!deps.ready) {
      phase = 'no-deps'
    } else if (appState.accounts.length === 0) {
      phase = 'no-accounts'
    } else {
      phase = 'ready'
    }
  }

  return {
    phase,
    deps,
    installing,
    installLog,
    handleInstallClaude,
    updateState,
    setUpdateState,
    handleUpdateClick,
    tempCleanupBanner,
    tempCleanupCountdown,
    accounts: appState.accounts,
    activeAccountId: appState.activeAccountId,
    sessions: appState.sessions,
    activeSessionId: appState.activeSessionId,
    setActiveSessionId: appState.setActiveSessionId,
    syncStatus: appState.syncStatus,
    syncMessage: appState.syncMessage,
    isLocked: appState.syncStatus === 'syncing',
    accountsLoaded: appState.accountsLoaded,
    switchAccount: appState.switchAccount,
    refreshSessions: appState.refreshSessions,
    refreshAccounts: appState.refreshAccounts,
  }
}
