import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { api } from '../lib/api.js'

export type SessionStatus = 'idle' | 'thinking' | 'streaming' | 'tool'

export interface SessionConfig {
  model: string
  effort: string
  permissionMode: string
  prompt: string
}

const DEFAULT_SESSION_CONFIG: SessionConfig = {
  model: 'claude-sonnet-4-6',
  effort: 'high',
  permissionMode: 'bypassPermissions',
  prompt: '',
}

const SESSION_MODEL_MIGRATION: Record<string, string> = {
  'sonnet': 'claude-sonnet-4-6',
  'opus':   'claude-opus-4-8',
  'haiku':  'claude-haiku-4-5-20251001',
  'fable':  'claude-fable-5',
}

function loadConfig(sessionId: string | null): SessionConfig {
  if (!sessionId) return { ...DEFAULT_SESSION_CONFIG }
  try {
    const raw = localStorage.getItem(`vaeli:session-config:${sessionId}`)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SessionConfig>
      if (parsed.model && SESSION_MODEL_MIGRATION[parsed.model]) {
        parsed.model = SESSION_MODEL_MIGRATION[parsed.model]
        localStorage.setItem(`vaeli:session-config:${sessionId}`, JSON.stringify({ ...DEFAULT_SESSION_CONFIG, ...parsed }))
      }
      return { ...DEFAULT_SESSION_CONFIG, ...parsed }
    }
  } catch {}
  return { ...DEFAULT_SESSION_CONFIG }
}

function saveConfig(sessionId: string, config: SessionConfig) {
  try {
    localStorage.setItem(`vaeli:session-config:${sessionId}`, JSON.stringify(config))
  } catch {}
}

export interface SessionContextValue {
  // состояние
  spawnedSessions: Record<string, number>       // termId → spawnTrigger
  termToSession: Record<string, string>         // termId → sessionId
  sessionStatuses: Record<string, SessionStatus>

  // управление
  spawn(termId: string, sessionId: string | null, projectPath: string | null, configDir: string, config: SessionConfig): void
  kill(sessionId: string): void
  resolveTermId(sessionId: string): string | undefined
  isAlive(sessionId: string): boolean

  // программный API
  sendMessage(sessionId: string, text: string): void
  watchSession(sessionId: string, jsonlPath: string): void
  unwatchSession(sessionId: string): void

  // конфиг
  getConfig(sessionId: string | null): SessionConfig
  setConfig(sessionId: string, config: SessionConfig): void

  // внутреннее — для App.tsx во время перехода
  setTermToSession: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setSpawnedSessions: React.Dispatch<React.SetStateAction<Record<string, number>>>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function useSessionContext(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSessionContext must be used inside SessionProvider')
  return ctx
}

interface Props {
  children: ReactNode
}

export function SessionProvider({ children }: Props) {
  const [spawnedSessions, setSpawnedSessions] = useState<Record<string, number>>({})
  const [termToSession, setTermToSession] = useState<Record<string, string>>({})
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatus>>({})

  // Подписка на статусы сессий от main process
  useEffect(() => {
    const unsub = api.onSessionStatus((sessionId: string, status: string) => {
      const validStatus = (['idle', 'thinking', 'streaming', 'tool'] as const).includes(status as SessionStatus)
        ? (status as SessionStatus)
        : 'idle'
      setSessionStatuses(prev => ({ ...prev, [sessionId]: validStatus }))
    })
    return unsub
  }, [])

  const resolveTermId = useCallback((sessionId: string): string | undefined => {
    return Object.entries(termToSession).find(([, sid]) => sid === sessionId)?.[0]
  }, [termToSession])

  const isAlive = useCallback((sessionId: string): boolean => {
    const termId = resolveTermId(sessionId)
    if (!termId) return false
    return termId in spawnedSessions
  }, [resolveTermId, spawnedSessions])

  const spawn = useCallback((
    termId: string,
    _sessionId: string | null,
    _projectPath: string | null,
    _configDir: string,
    _config: SessionConfig,
  ) => {
    setSpawnedSessions(prev => ({ ...prev, [termId]: (prev[termId] ?? 0) + 1 }))
  }, [])

  const kill = useCallback((sessionId: string) => {
    const termId = Object.entries(termToSession).find(([, sid]) => sid === sessionId)?.[0]
      ?? (sessionId === '__new__' ? '__new__' : undefined)

    if (termId) {
      api.ptySessionKill(termId)
      setSpawnedSessions(prev => { const next = { ...prev }; delete next[termId]; return next })
      setTermToSession(prev => { const next = { ...prev }; delete next[termId]; return next })
    }

    api.unwatchSession(sessionId)
    setSessionStatuses(prev => { const next = { ...prev }; delete next[sessionId]; return next })
  }, [termToSession])

  const sendMessage = useCallback((sessionId: string, text: string) => {
    // В этой архитектуре PTY работает через PtySessionManager, не через termId
    // Используем прямую запись через ptyWrite если termId найден, иначе sessionCommand
    const termId = resolveTermId(sessionId)
    if (termId) {
      // PTY mode — не используется в этой ветке, но интерфейс готов
      console.warn('[SessionContext] sendMessage: PTY termId mode not implemented in this branch')
    } else {
      // Используем IPC sessionCommand как fallback
      api.sessionCommand(text)
    }
  }, [resolveTermId])

  const watchSession = useCallback((sessionId: string, jsonlPath: string) => {
    api.watchSession(sessionId, jsonlPath)
  }, [])

  const unwatchSession = useCallback((sessionId: string) => {
    api.unwatchSession(sessionId)
  }, [])

  const getConfig = useCallback((sessionId: string | null): SessionConfig => {
    return loadConfig(sessionId)
  }, [])

  const setConfig = useCallback((sessionId: string, config: SessionConfig) => {
    saveConfig(sessionId, config)
  }, [])

  const value: SessionContextValue = {
    spawnedSessions,
    termToSession,
    sessionStatuses,
    spawn,
    kill,
    resolveTermId,
    isAlive,
    sendMessage,
    watchSession,
    unwatchSession,
    getConfig,
    setConfig,
    setTermToSession,
    setSpawnedSessions,
  }

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  )
}
