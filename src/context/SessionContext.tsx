import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { api } from '../lib/api.js'

// Держать в синхроне с SessionStatusValue в electron/ipc/pty.ts
//   thinking  — обрабатывает запрос
//   streaming — печатает ответ
//   tool      — работает инструментом (Read/Edit/Bash/…)
//   asking    — ждёт ответа пользователя (AskUserQuestion / ExitPlanMode)
export type SessionStatus = 'idle' | 'thinking' | 'streaming' | 'tool' | 'asking'

export interface SessionConfig {
  model: string
  effort: string
  permissionMode: string
  prompt: string
}

const DEFAULT_SESSION_CONFIG: SessionConfig = {
  model: 'claude-sonnet-5',
  effort: 'high',
  permissionMode: 'bypassPermissions',
  prompt: '',
}

const SESSION_MODEL_MIGRATION: Record<string, string> = {
  'sonnet': 'claude-sonnet-5',
  'opus':   'claude-opus-5',
  'haiku':  'claude-haiku-4-5-20251001',
  'fable':  'claude-fable-5',
  'claude-sonnet-4-6': 'claude-sonnet-5',
  'claude-opus-4-8':   'claude-opus-5',
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
  sessionReplies: Record<string, string>        // sessionId → последний ответ

  // чат-режим: ключ ('__new__' или sessionId) → реальный sessionId живого чат-процесса
  chatSessions: Record<string, string>

  // управление
  spawn(termId: string, sessionId: string | null, projectPath: string | null, configDir: string, config: SessionConfig): void
  /** Гасит и PTY, и чат сессии, снимает слежение — единственный способ закрыть сессию */
  kill(sessionId: string): void
  /** Только PTY: при переключении в чат слежение за статусом должно остаться */
  killPty(sessionId: string): void
  startChat(key: string, sessionId: string | null, configDir: string | null, config: SessionConfig): Promise<string>
  stopChat(sessionId: string): Promise<void>
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
  const [sessionReplies, setSessionReplies] = useState<Record<string, string>>({})
  const [chatSessions, setChatSessions] = useState<Record<string, string>>({})

  // Новый чат живёт под ключом '__new__', пока CLI не создал jsonl — потом
  // переезжает под свой id. Упавший процесс убираем из карты
  useEffect(() => {
    // Без перезапуска main старый preload этих методов не знает — HMR не должен ронять окно
    if (!api.onChatCreated || !api.onChatExit) return
    // Перезагрузка окна не трогает процессы в main: подхватываем живые чаты,
    // а не запускаем их заново — иначе обрывается ответ на середине
    api.chatList?.().then(list => {
      if (!list.length) return
      setChatSessions(prev => {
        const next = { ...prev }
        for (const c of list) next[c.hasJsonl ? c.sessionId : '__new__'] = c.sessionId
        return next
      })
    }).catch(() => {})
    const unsubCreated = api.onChatCreated((sessionId) => {
      setChatSessions(prev => {
        if (prev['__new__'] !== sessionId) return prev
        const next = { ...prev, [sessionId]: sessionId }
        delete next['__new__']
        return next
      })
    })
    const unsubExit = api.onChatExit((sessionId) => {
      setChatSessions(prev => {
        const keys = Object.keys(prev).filter(k => prev[k] === sessionId)
        if (keys.length === 0) return prev
        const next = { ...prev }
        for (const k of keys) delete next[k]
        return next
      })
    })
    return () => { unsubCreated(); unsubExit() }
  }, [])

  // Подписка на статусы и ответы сессий от main process
  useEffect(() => {
    const unsubStatus = api.onSessionStatus((sessionId: string, status: string) => {
      const validStatus = (['idle', 'thinking', 'streaming', 'tool', 'asking'] as const).includes(status as SessionStatus)
        ? (status as SessionStatus)
        : 'idle'
      setSessionStatuses(prev => ({ ...prev, [sessionId]: validStatus }))
    })
    const unsubReply = api.onSessionReply((sessionId: string, text: string) => {
      setSessionReplies(prev => ({ ...prev, [sessionId]: text }))
    })
    return () => { unsubStatus(); unsubReply() }
  }, [])

  const resolveTermId = useCallback((sessionId: string): string | undefined => {
    return Object.entries(termToSession).find(([, sid]) => sid === sessionId)?.[0]
  }, [termToSession])

  const isChatAlive = useCallback((sessionId: string): boolean => {
    return Object.values(chatSessions).includes(sessionId)
  }, [chatSessions])

  const isAlive = useCallback((sessionId: string): boolean => {
    if (isChatAlive(sessionId)) return true
    const termId = resolveTermId(sessionId)
    if (!termId) return false
    return termId in spawnedSessions
  }, [resolveTermId, spawnedSessions, isChatAlive])

  const spawn = useCallback((
    termId: string,
    _sessionId: string | null,
    _projectPath: string | null,
    _configDir: string,
    _config: SessionConfig,
  ) => {
    setSpawnedSessions(prev => ({ ...prev, [termId]: (prev[termId] ?? 0) + 1 }))
  }, [])

  const killPty = useCallback((sessionId: string) => {
    // У сессии, открытой из списка, termId совпадает с sessionId, но в
    // termToSession она может и не попасть — тогда ищем по самому ключу
    const termId = Object.entries(termToSession).find(([, sid]) => sid === sessionId)?.[0]
      ?? (sessionId in spawnedSessions ? sessionId : undefined)
      ?? (sessionId === '__new__' ? '__new__' : undefined)

    if (termId) {
      api.ptyKill(termId)
      setSpawnedSessions(prev => { const next = { ...prev }; delete next[termId]; return next })
      setTermToSession(prev => { const next = { ...prev }; delete next[termId]; return next })
    }
  }, [termToSession, spawnedSessions])

  const startChat = useCallback(async (key: string, sessionId: string | null, configDir: string | null, config: SessionConfig) => {
    const r = await api.chatStart({
      sessionId,
      configDir,
      model: config.model || undefined,
      effort: config.effort || undefined,
      permissionMode: config.permissionMode || undefined,
    })
    setChatSessions(prev => ({ ...prev, [key]: r.sessionId }))
    return r.sessionId
  }, [])

  const stopChat = useCallback(async (sessionId: string) => {
    setChatSessions(prev => {
      const next = { ...prev }
      for (const k of Object.keys(next)) if (next[k] === sessionId || k === sessionId) delete next[k]
      return next
    })
    await api.chatKill(sessionId)
  }, [])

  const kill = useCallback((sessionId: string) => {
    killPty(sessionId)
    const chatId = chatSessions[sessionId] ?? (Object.values(chatSessions).includes(sessionId) ? sessionId : undefined)
    if (chatId) stopChat(chatId)

    api.unwatchSession(sessionId)
    setSessionStatuses(prev => { const next = { ...prev }; delete next[sessionId]; return next })
  }, [killPty, stopChat, chatSessions])

  const sendMessageRef = useRef<(sessionId: string, text: string) => void>(() => {})

  const sendMessage = useCallback((sessionId: string, text: string) => {
    if (isChatAlive(sessionId)) {
      api.chatSend(sessionId, text)
      return
    }
    const termId = resolveTermId(sessionId)
    if (termId) {
      api.ptyWrite(termId, text + '\r')
    }
  }, [resolveTermId, isChatAlive])

  sendMessageRef.current = sendMessage

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
    sessionReplies,
    chatSessions,
    spawn,
    kill,
    killPty,
    startChat,
    stopChat,
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
