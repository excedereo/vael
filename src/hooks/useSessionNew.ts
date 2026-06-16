import { useCallback } from 'react'
import { Session, JsonlEntry } from '../types/index'
import { useSessionHistory } from './useSessionHistory.js'
import { useSessionStream } from './useSessionStream.js'

export type { StreamStatus, StreamState } from './useSessionStream.js'

export function useSessionNew(session: Session | null) {
  const history = useSessionHistory(session)

  const handleCommit = useCallback((live: JsonlEntry[]) => {
    history.commitLive(live)
  }, [history.commitLive])

  const stream = useSessionStream(session, handleCommit)

  return {
    // история
    entries: history.entries,
    reload: history.reload,
    appendOptimistic: history.appendOptimistic,
    // стриминг
    status: stream.status,
    liveEntries: stream.liveEntries,
    activeTool: stream.activeTool,
    tokens: stream.tokens,
    seconds: stream.seconds,
  }
}
