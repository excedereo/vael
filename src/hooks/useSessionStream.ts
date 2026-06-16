import { useState, useEffect, useRef, useCallback } from 'react'
import { JsonlEntry, StreamEvent, Session } from '../types/index'
import { api } from '../lib/api.js'
import { toolLabel } from '../lib/toolLabel.js'

export type StreamStatus = 'idle' | 'thinking' | 'streaming' | 'tool' | 'compacting'

export interface StreamState {
  status: StreamStatus
  liveEntries: JsonlEntry[]
  activeTool: { name: string; label: string } | null
  tokens: number | null
  seconds: number
}

const INITIAL_STATE: StreamState = {
  status: 'idle',
  liveEntries: [],
  activeTool: null,
  tokens: null,
  seconds: 0,
}

export function useSessionStream(
  session: Session | null,
  onCommit: (live: JsonlEntry[]) => void,
) {
  const [state, setState] = useState<StreamState>(INITIAL_STATE)
  const liveRef = useRef<JsonlEntry[]>([])
  const pendingToolsRef = useRef<JsonlEntry[]>([])
  const currentSessionIdRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number | null>(null)
  const streamingTextCommittedRef = useRef(false)

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    startTimeRef.current = null
  }, [])

  const startTimer = useCallback(() => {
    stopTimer()
    startTimeRef.current = Date.now()
    timerRef.current = setInterval(() => {
      if (startTimeRef.current)
        setState(s => ({ ...s, seconds: Math.floor((Date.now() - startTimeRef.current!) / 1000) }))
    }, 1000)
  }, [stopTimer])

  const reset = useCallback(() => {
    stopTimer()
    liveRef.current = []
    pendingToolsRef.current = []
    streamingTextCommittedRef.current = false
    setState(INITIAL_STATE)
  }, [stopTimer])

  // сброс при смене сессии
  useEffect(() => {
    currentSessionIdRef.current = session?.id ?? null
    reset()
  }, [session?.id, reset])

  useEffect(() => {
    const unsub = api.onStreamEvent((event: StreamEvent) => {
      const evId = (event as unknown as { _sessionId?: string })._sessionId
      if (evId && currentSessionIdRef.current && evId !== currentSessionIdRef.current) return

      // ── thinking start ────────────────────────────────────────────────────────
      if (event.type === 'assistant_streaming_start') {
        streamingTextCommittedRef.current = false
        startTimer()
        setState(s => ({ ...s, status: 'thinking', seconds: 0 }))
        return
      }

      // ── system events ─────────────────────────────────────────────────────────
      if (event.type === 'system') {
        const sub = (event as unknown as { subtype?: string }).subtype
        if (sub === 'status') {
          const se = event as unknown as { status?: string | null }
          if (se.status === 'compacting') {
            if (!startTimeRef.current) startTimer()
            setState(s => ({ ...s, status: 'compacting' }))
          }
          return
        }
        if (sub === 'api_retry') {
          const e = event as unknown as { attempt?: number; error?: string; error_status?: number | null }
          const attempt = e.attempt ?? 0
          if (attempt >= 3) {
            const errEntry: JsonlEntry = {
              type: 'error_bubble',
              message: errorMessage(e.error ?? '', e.error_status ?? null),
              known: true,
            }
            onCommit([...liveRef.current, errEntry])
            reset()
          } else {
            setState(s => ({ ...s, activeTool: { name: 'retry', label: `Нет соединения, повтор ${attempt}/3...` } }))
          }
          return
        }
        // session start
        startTimer()
        setState(s => ({ ...s, status: 'thinking', seconds: 0, liveEntries: [], activeTool: null, tokens: null }))
        liveRef.current = []
        return
      }

      // ── промежуточный текст (мысли в процессе) ────────────────────────────────
      if (event.type === 'assistant_streaming_text') {
        const text = (event as unknown as { text: string }).text
        if (!text) return
        setState(s => ({ ...s, status: 'streaming' }))
        const entry: JsonlEntry = {
          type: 'assistant' as const,
          message: { role: 'assistant' as const, content: [{ type: 'text', text }] as JsonlEntry['message']['content'] },
        }
        const cur = liveRef.current
        const last = cur[cur.length - 1]
        const lastIsText = last?.type === 'assistant' &&
          Array.isArray(last.message?.content) &&
          (last.message.content as Array<{ type: string }>)[0]?.type === 'text'

        if (lastIsText && !streamingTextCommittedRef.current) {
          liveRef.current = [...cur.slice(0, -1), entry]
        } else {
          liveRef.current = [...cur, entry]
          streamingTextCommittedRef.current = false
        }
        setState(s => ({ ...s, liveEntries: [...liveRef.current] }))
        return
      }

      if (event.type === 'commit_streaming_text') {
        streamingTextCommittedRef.current = true
        return
      }

      // ── tool call ─────────────────────────────────────────────────────────────
      if (event.type === 'assistant') {
        const blocks = (event.message?.content ?? []) as Array<{ type: string; name?: string; input?: Record<string, unknown> }>
        const toolBlocks = blocks.filter(b => b.type === 'tool_use' && b.name)
        const textBlocks = blocks.filter(b => b.type === 'text')

        if (textBlocks.length > 0) {
          const entry: JsonlEntry = {
            type: 'assistant' as const,
            message: { role: 'assistant' as const, content: textBlocks as JsonlEntry['message']['content'] },
          }
          liveRef.current = [...liveRef.current, entry]
        }

        if (toolBlocks.length > 0) {
          const t = toolBlocks[0]
          setState(s => ({
            ...s,
            status: 'tool',
            activeTool: { name: t.name!, label: toolLabel(t.name!, t.input ?? {}) },
            liveEntries: [...liveRef.current],
          }))
          pendingToolsRef.current = toolBlocks.map(t => ({
            type: 'assistant' as const,
            message: { role: 'assistant' as const, content: [t] as JsonlEntry['message']['content'] },
          }))
        } else {
          setState(s => ({ ...s, status: 'streaming', liveEntries: [...liveRef.current] }))
        }
        return
      }

      // ── tool result — коммитим тулколл в live ─────────────────────────────────
      if (event.type === 'user') {
        const blocks = (event.message?.content ?? []) as Array<{ type: string }>
        if (blocks.some(b => b.type === 'tool_result') && pendingToolsRef.current.length > 0) {
          liveRef.current = [...liveRef.current, ...pendingToolsRef.current]
          pendingToolsRef.current = []
          setState(s => ({ ...s, status: 'streaming', activeTool: null, liveEntries: [...liveRef.current] }))
        }
        return
      }

      // ── diff patch для tool ───────────────────────────────────────────────────
      if (event.type === 'pty_tool_update') {
        const { tool_use_id, patch } = event as unknown as { tool_use_id: string; patch: Record<string, string> }
        liveRef.current = liveRef.current.map(e => {
          if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) return e
          const blocks = e.message.content as Array<{ type: string; id?: string; input?: Record<string, unknown> }>
          if (!blocks.some(b => b.type === 'tool_use' && b.id === tool_use_id)) return e
          return {
            ...e,
            message: {
              ...e.message,
              content: blocks.map(b =>
                b.type === 'tool_use' && b.id === tool_use_id ? { ...b, input: { ...b.input, ...patch } } : b
              ),
            },
          }
        })
        setState(s => ({ ...s, liveEntries: [...liveRef.current] }))
        return
      }

      // ── токены ────────────────────────────────────────────────────────────────
      if (event.type === 'pty_tokens') {
        const count = (event as unknown as { count: number }).count
        setState(s => ({ ...s, tokens: count }))
        return
      }

      // ── финальный ответ из jsonl ──────────────────────────────────────────────
      if ((event as unknown as { type: string }).type === 'pty_final_message') {
        const { entry } = event as unknown as { entry: JsonlEntry }
        // убираем последний text entry из live — он дубликат, финальный идёт из jsonl
        const live = liveRef.current
        const last = live[live.length - 1]
        const lastIsText = last?.type === 'assistant' &&
          Array.isArray(last.message?.content) &&
          (last.message.content as Array<{ type: string }>)[0]?.type === 'text'
        const toCommit = lastIsText ? [...live.slice(0, -1), entry] : [...live, entry]
        onCommit(toCommit)
        reset()
        return
      }

      // ── result ────────────────────────────────────────────────────────────────
      if (event.type === 'result') {
        const r = event as unknown as { usage?: { output_tokens?: number; input_tokens?: number }; isTui?: boolean }
        pendingToolsRef.current = []
        setState(s => ({ ...s, activeTool: null }))

        if (r.isTui) {
          reset()
          return
        }

        const isPty = !r.usage?.output_tokens
        if (isPty) return // ждём pty_final_message

        // SDK mode — коммитим сразу
        onCommit([...liveRef.current])
        reset()
        return
      }

      // ── error ─────────────────────────────────────────────────────────────────
      if (event.type === 'error') {
        const msg = (event as unknown as { error: string }).error
        onCommit([...liveRef.current, { type: 'error_bubble', message: msg, known: false }])
        reset()
        return
      }
    })

    const unsubDone = api.onStreamDone((_code, doneId) => {
      if (doneId && currentSessionIdRef.current && doneId !== currentSessionIdRef.current) return
      setState(s => ({ ...s, status: 'idle' }))
      stopTimer()
    })

    return () => { unsub(); unsubDone() }
  }, [startTimer, stopTimer, reset, onCommit])

  return state
}

function errorMessage(error: string, status: number | null): string {
  if (error === 'authentication_failed' || status === 401) return 'Ошибка авторизации. Проверь аккаунт Claude.'
  if (error === 'rate_limit' || status === 429) return 'Превышен лимит запросов. Подожди немного.'
  if (error === 'overloaded_error' || status === 529) return 'Серверы Claude перегружены. Попробуй чуть позже.'
  if (error === 'billing_error') return 'Проблема с оплатой аккаунта Claude.'
  if (error === 'invalid_request') return 'Некорректный запрос к API. Возможно неверный ID модели.'
  if (error === 'max_output_tokens') return 'Достигнут лимит токенов в ответе.'
  return 'Нет соединения с сервером. Проверь интернет или VPN.'
}
