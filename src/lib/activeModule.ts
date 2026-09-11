import { useSyncExternalStore } from 'react'

// Какой модуль Pyre открыт сейчас.
//
// Состояние живёт здесь, а не в App, потому что читателей двое и они не связаны
// пропсами: сайдбар (внутри App) и сама панель (рендерится через panels[].render(),
// которому аргументы не передаются). Раньше у каждого была своя копия — сайдбар
// подсвечивал один модуль, а панель показывала другой.

let current: string | null = null
const listeners = new Set<() => void>()

export function setActiveModule(id: string | null) {
  if (current === id) return
  current = id
  for (const l of listeners) l()
}

export function getActiveModule(): string | null {
  return current
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function useActiveModule(): string | null {
  return useSyncExternalStore(subscribe, getActiveModule, getActiveModule)
}
