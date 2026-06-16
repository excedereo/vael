import { useState, useEffect, useCallback } from 'react'
import { JsonlEntry, Session } from '../types/index'
import { api } from '../lib/api.js'

function getEntryText(entry: JsonlEntry): string {
  const msg = (entry as { message?: { content?: unknown } }).message
  const content = msg?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text?: string }) => b.text ?? '')
      .join('')
  }
  return ''
}

function filterEntries(entries: JsonlEntry[]): JsonlEntry[] {
  const skip = new Set<number>()
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.type === 'user') {
      const text = getEntryText(e).trim()
      if (text === 'No response requested.') { skip.add(i); continue }
      if (text.startsWith('/context') || text.startsWith('## Context Usage')) {
        skip.add(i)
        const next = entries[i + 1]
        if (next?.type === 'assistant') {
          const t = getEntryText(next).trimStart()
          if (t.startsWith('## Context Usage') || t.startsWith('**Model:**')) skip.add(i + 1)
        }
      }
    } else if (e.type === 'assistant') {
      const text = getEntryText(e).trimStart()
      if (text.startsWith('## Context Usage') || text.startsWith('**Model:**')) {
        skip.add(i)
        const prev = entries[i - 1]
        if (prev?.type === 'user' && getEntryText(prev).trim().startsWith('/context')) skip.add(i - 1)
      }
    }
  }
  return entries.filter((_, i) => !skip.has(i))
}

export function useSessionHistory(session: Session | null) {
  const [entries, setEntries] = useState<JsonlEntry[]>([])
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!session) { setEntries([]); return }
    const path = `${session.projectPath}\\${session.id}.jsonl`
    api.readSession(path).then(raw => setEntries(filterEntries(raw)))
  }, [session?.id, reloadKey])

  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  const appendOptimistic = useCallback((text: string) => {
    setEntries(prev => [...prev, {
      type: 'user' as const,
      message: { role: 'user' as const, content: text },
      timestamp: new Date().toISOString(),
    }])
  }, [])

  const commitLive = useCallback((live: JsonlEntry[]) => {
    setEntries(prev => [...prev, ...live])
  }, [])

  return { entries, setEntries, reload, appendOptimistic, commitLive }
}
