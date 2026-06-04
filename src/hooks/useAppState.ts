import { useState, useEffect, useCallback } from 'react'
import { Account, Session, SyncStatus } from '../types/index'
import { api } from '../lib/api.js'

export function useAppState() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [activeAccountId, setActiveAccountIdRaw] = useState<string>(() =>
    localStorage.getItem('activeAccountId') || ''
  )

  const setActiveAccountId = (id: string) => {
    setActiveAccountIdRaw(id)
    localStorage.setItem('activeAccountId', id)
    api.setActiveAccount(id).catch(() => {})
  }
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [syncMessage, setSyncMessage] = useState<string>()
  const [runningSessions, setRunningSessions] = useState<Set<string>>(() => new Set())

  const isRunning = runningSessions.size > 0
  const isLocked = syncStatus === 'syncing' || isRunning

  const addRunning = useCallback((sessionKey: string) => {
    setRunningSessions(prev => new Set(prev).add(sessionKey))
  }, [])

  const removeRunning = useCallback((sessionKey: string) => {
    setRunningSessions(prev => { const next = new Set(prev); next.delete(sessionKey); return next })
  }, [])

  const replaceRunning = useCallback((oldKey: string, newKey: string) => {
    setRunningSessions(prev => { const next = new Set(prev); next.delete(oldKey); next.add(newKey); return next })
  }, [])

  const loadAccounts = useCallback(async () => {
    const accs = await api.getAccounts()
    setAccounts(accs)
    setAccountsLoaded(true)
    if (accs.length > 0) {
      const saved = localStorage.getItem('activeAccountId')
      const valid = saved && accs.find(a => a.id === saved)
      const chosen = valid ? saved : accs[0].id
      setActiveAccountId(chosen)
    }
  }, [activeAccountId])

  const loadSessions = useCallback(async (accountId: string) => {
    const sess = await api.getSessions(accountId)
    setSessions(sess)
  }, [])

  useEffect(() => {
    loadAccounts()
  }, [])

  useEffect(() => {
    if (activeAccountId) loadSessions(activeAccountId)
  }, [activeAccountId, loadSessions])

  useEffect(() => {
    const unsub = api.onSyncStatus((status, message) => {
      setSyncStatus(status as SyncStatus)
      setSyncMessage(message)
    })
    return unsub
  }, [])

  const switchAccount = useCallback(async (toId: string) => {
    if (toId === activeAccountId || isRunning || syncStatus === 'syncing') return
    const result = await api.switchAccount(activeAccountId, toId)
    if (result.ok) {
      setActiveAccountId(toId)
      await loadSessions(toId)
    }
  }, [activeAccountId, isLocked, loadSessions])

  const refreshSessions = useCallback(() => {
    if (activeAccountId) loadSessions(activeAccountId)
  }, [activeAccountId, loadSessions])

  const refreshAccounts = useCallback(async () => {
    const accs = await api.getAccounts()
    setAccounts(accs)
    // Activate newly added account (last one if it wasn't there before)
    const currentIds = accounts.map(a => a.id)
    const newAcc = accs.find(a => !currentIds.includes(a.id))
    if (newAcc) setActiveAccountId(newAcc.id)
    else if (accs.length > 0 && !accs.find(a => a.id === activeAccountId)) {
      setActiveAccountId(accs[0].id)
    }
  }, [accounts, activeAccountId])

  return {
    accounts,
    activeAccountId,
    sessions,
    activeSessionId,
    setActiveSessionId,
    syncStatus,
    syncMessage,
    isLocked,
    isRunning,
    addRunning,
    removeRunning,
    replaceRunning,
    accountsLoaded,
    switchAccount,
    refreshSessions,
    refreshAccounts,
  }
}
