// Как показывать сессию: живой TUI в терминале или чат поверх stream-json.
// Режим помнится для каждой сессии; у новой — последний выбранный.
import { useSyncExternalStore } from 'react'

export type ViewMode = 'terminal' | 'chat'

const DEFAULT_KEY = 'vaeli:view-mode:default'
const keyFor = (sessionId: string) => `vaeli:view-mode:${sessionId}`

const listeners = new Set<() => void>()
let version = 0
function emit() { version++; listeners.forEach(l => l()) }

function read(key: string): ViewMode | null {
  try {
    const v = localStorage.getItem(key)
    return v === 'chat' || v === 'terminal' ? v : null
  } catch { return null }
}

export function getViewMode(sessionId: string | null): ViewMode {
  return (sessionId ? read(keyFor(sessionId)) : null) ?? read(DEFAULT_KEY) ?? 'terminal'
}

export function setViewMode(sessionId: string | null, mode: ViewMode) {
  try {
    if (sessionId) localStorage.setItem(keyFor(sessionId), mode)
    localStorage.setItem(DEFAULT_KEY, mode)
  } catch {}
  emit()
}

function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } }

export function useViewMode(sessionId: string | null): ViewMode {
  useSyncExternalStore(subscribe, () => version)
  return getViewMode(sessionId)
}
