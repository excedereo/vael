/**
 * SessionContext — центральное хранилище состояния сессий.
 * Этап 1 рефакторинга: здесь будет PTY spawn/kill/sendMessage/watchSession.
 * Сейчас минимальная реализация для совместимости.
 */

import { createContext, useContext, ReactNode } from 'react'
import { SessionStatus } from '../types/panel.js'

export interface SpawnTrigger {
  model: string
  effort: string | null
  permission: string
}

export interface SessionContextValue {
  spawnedSessions: Record<string, SpawnTrigger>
  termToSession: Record<string, string>
  sessionStatuses: Record<string, SessionStatus>
  sendMessage(sessionId: string, text: string): Promise<void>
  onResponse(sessionId: string, cb: (text: string) => void): () => void
}

const defaultValue: SessionContextValue = {
  spawnedSessions: {},
  termToSession: {},
  sessionStatuses: {},
  sendMessage: async () => {},
  onResponse: () => () => {},
}

const SessionContext = createContext<SessionContextValue>(defaultValue)

export function SessionProvider({ children }: { children: ReactNode }) {
  // Минимальная обёртка — полная реализация в этапе 1
  return (
    <SessionContext.Provider value={defaultValue}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSessionContext() {
  return useContext(SessionContext)
}
