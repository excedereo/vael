import { useState, useRef, useEffect } from 'react'
import { api } from '../lib/api.js'

export interface ConsoleLogEntry {
  level: string
  text: string
  ts: number
  id: number
}

export function useConsoleCapture() {
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLogEntry[]>([])
  const [devConsole, setDevConsole] = useState(() => {
    try { return JSON.parse(localStorage.getItem('vaeliDevConsole') ?? 'false') } catch { return false }
  })
  const consoleIdRef = useRef(0)

  // Flush buffered main-process logs on mount
  useEffect(() => {
    api.consoleFlush()
    const unsub = api.onConsoleLog((entry) => {
      setConsoleLogs(prev => [...prev.slice(-500), { ...entry, id: consoleIdRef.current++ }])
    })
    return unsub
  }, [])

  // Capture renderer-side errors
  useEffect(() => {
    const addLog = (level: string, text: string) =>
      setConsoleLogs(prev => [...prev.slice(-500), { level, text, ts: Date.now(), id: consoleIdRef.current++ }])

    const onError = (e: ErrorEvent) => {
      addLog('error', `${e.message}${e.filename ? ` (${e.filename}:${e.lineno})` : ''}`)
    }
    const onUnhandled = (e: PromiseRejectionEvent) => {
      const msg = e.reason instanceof Error ? e.reason.stack || e.reason.message : String(e.reason)
      addLog('error', `Unhandled rejection: ${msg}`)
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandled)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandled)
    }
  }, [])

  // Listen for devConsole toggle from settings
  useEffect(() => {
    const h = () => {
      try { setDevConsole(JSON.parse(localStorage.getItem('vaeliDevConsole') ?? 'false')) } catch { setDevConsole(false) }
    }
    window.addEventListener('vaeli:devConsoleChanged', h)
    return () => window.removeEventListener('vaeli:devConsoleChanged', h)
  }, [])

  return { consoleLogs, setConsoleLogs, devConsole }
}
