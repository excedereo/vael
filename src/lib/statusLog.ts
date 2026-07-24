import { api } from './api.js'

export interface StatusLogEntry {
  id: string
  transition: string
  ts: number
}

const MAX_ENTRIES = 200

/**
 * История переходов статуса сессий. Живёт вне React, потому что Dev-панель
 * рендерится условно и при переключении вкладок размонтируется — локальный
 * useState терял бы всю историю. Подписка на IPC заводится один раз при первом
 * обращении и больше не снимается.
 */
let entries: StatusLogEntry[] = []
const listeners = new Set<() => void>()
let started = false

function emit() {
  for (const listener of listeners) listener()
}

function ensureStarted() {
  if (started) return
  started = true
  api.onSessionStatusLog((id, transition) => {
    entries = [{ id, transition, ts: Date.now() }, ...entries].slice(0, MAX_ENTRIES)
    emit()
  })
}

export const statusLog = {
  /** Начать копить историю (зовётся из App при старте, до открытия Dev-панели). */
  start: ensureStarted,
  subscribe(listener: () => void): () => void {
    ensureStarted()
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  getSnapshot(): StatusLogEntry[] {
    return entries
  },
  clear() {
    entries = []
    emit()
  },
}
