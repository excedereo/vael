import { useRef, useState, useCallback } from 'react'

type NavEntry = { sessionId: string | null; tab: 'sessions' | 'pyre' | 'console' }

export function useNavHistory() {
  const stackRef = useRef<NavEntry[]>([])
  const idxRef = useRef(-1)
  const suppressRef = useRef(false) // prevent push when navigating via back/forward

  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)

  const sync = () => {
    setCanGoBack(idxRef.current > 0)
    setCanGoForward(idxRef.current < stackRef.current.length - 1)
  }

  // Call this on every "user-initiated" nav change (session select, tab change)
  const push = useCallback((entry: NavEntry) => {
    if (suppressRef.current) return
    // truncate forward history
    stackRef.current = stackRef.current.slice(0, idxRef.current + 1)
    // don't push duplicate
    const cur = stackRef.current[idxRef.current]
    if (cur && cur.sessionId === entry.sessionId && cur.tab === entry.tab) return
    stackRef.current.push(entry)
    idxRef.current = stackRef.current.length - 1
    sync()
  }, [])

  const goBack = useCallback((navigate: (e: NavEntry) => void) => {
    if (idxRef.current <= 0) return
    idxRef.current--
    suppressRef.current = true
    navigate(stackRef.current[idxRef.current])
    suppressRef.current = false
    sync()
  }, [])

  const goForward = useCallback((navigate: (e: NavEntry) => void) => {
    if (idxRef.current >= stackRef.current.length - 1) return
    idxRef.current++
    suppressRef.current = true
    navigate(stackRef.current[idxRef.current])
    suppressRef.current = false
    sync()
  }, [])

  return { push, goBack, goForward, canGoBack, canGoForward }
}
