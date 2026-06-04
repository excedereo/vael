import { useState, useEffect, useCallback, useRef } from 'react'
import { JsonlEntry, StreamEvent } from '../types/index'
import { api } from '../lib/api.js'
import { Session } from '../types/index'

function getEntryText(entry: JsonlEntry): string {
  const content = entry.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.filter((b: { type: string }) => b.type === 'text').map((b: { text?: string }) => b.text || '').join('')
  }
  return ''
}

const HIDDEN_USER_MESSAGES = new Set([
  'No response requested.',
])

function filterContextEntries(entries: JsonlEntry[]): JsonlEntry[] {
  const skip = new Set<number>()
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.type === 'user') {
      const text = getEntryText(e).trim()
      if (HIDDEN_USER_MESSAGES.has(text)) {
        skip.add(i)
        continue
      }
      if (text.startsWith('/context') || text.startsWith('## Context Usage')) {
        skip.add(i)
        if (i + 1 < entries.length && entries[i + 1].type === 'assistant') {
          const next = getEntryText(entries[i + 1])
          if (next.trimStart().startsWith('## Context Usage') || next.trimStart().startsWith('**Model:**')) {
            skip.add(i + 1)
          }
        }
      }
    } else if (e.type === 'assistant') {
      const text = getEntryText(e).trimStart()
      if (text.startsWith('## Context Usage') || text.startsWith('**Model:**')) {
        skip.add(i)
        if (i > 0 && entries[i - 1].type === 'user') {
          const prev = getEntryText(entries[i - 1]).trim()
          if (prev.startsWith('/context')) skip.add(i - 1)
        }
      }
    }
  }
  return entries.filter((_, i) => !skip.has(i))
}

export interface LiveTool {
  name: string
  label: string
  input?: Record<string, unknown>
}

function toolLabel(name: string, input: Record<string, unknown>): string {
  const short = (p: unknown) => {
    const s = String(p || '')
    const parts = s.replace(/\\/g, '/').split('/')
    return parts[parts.length - 1] || s
  }
  switch (name) {
    case 'Read':       return `Reading ${short(input.file_path)}`
    case 'Edit':
    case 'Update':     return `Editing ${short(input.file_path)}`
    case 'Write':      return `Writing ${short(input.file_path)}`
    case 'Grep':       return `Searching "${String(input.pattern || '').slice(0, 30)}"`
    case 'Glob':       return `Globbing ${String(input.pattern || '')}`
    case 'Bash':       return `Running ${String(input.command || '').slice(0, 40)}`
    case 'PowerShell': return `Running ${short(input.file_path) || String(input.command || '').slice(0, 35)}`
    case 'WebSearch':  return `Searching "${String(input.query || '').slice(0, 30)}"`
    case 'WebFetch':   return `Fetching ${short(input.url)}`
    case 'Agent':      return `Spawning ${String(input.subagent_type || 'agent')}…`
    case 'Task':
    case 'TaskCreate': return `Creating task…`
    default:           return name
  }
}

export function useSession(session: Session | null) {
  const [reloadKey, setReloadKey] = useState(0)
  const [entries, setEntries] = useState<JsonlEntry[]>([])
  // liveEntries: accumulated assistant messages during streaming
  const [liveEntries, setLiveEntries] = useState<JsonlEntry[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [liveTool, setLiveTool] = useState<LiveTool | null>(null)
  // thinking = streaming started but nothing visible yet
  const [isThinking, setIsThinking] = useState(false)
  const [isCompacting, setIsCompacting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [streamSeconds, setStreamSeconds] = useState(0)
  const [streamTokens, setStreamTokens] = useState<number | null>(null)
  const [streamInputTokens, setStreamInputTokens] = useState<number | null>(null)
  const [streamCacheRead, setStreamCacheRead] = useState<number | null>(null)
  const [ptyTokens, setPtyTokens] = useState<number | null>(null)
  const [ptyTokensDelta, setPtyTokensDelta] = useState<number | null>(null)
  const prevPtyTokensRef = useRef<number | null>(null)
  const [finalEntryKey, setFinalEntryKey] = useState<string | null>(null)
  const pendingResultRef = useRef<boolean>(false)
  const currentSessionIdRef = useRef<string | null>(null)
  const streamingTextCommittedRef = useRef(false)  // был ли streaming text зафиксирован
  const [streamCacheCreated, setStreamCacheCreated] = useState<number | null>(null)
  const [contextPct, setContextPct] = useState<number | null>(null)
  const [usagePct, setUsagePct] = useState<number | null>(null)
  const prevContextPctRef = useRef<number | null>(null)
  const prevUsagePctRef = useRef<number | null>(null)
  const contextPctRef = useRef<number | null>(null)
  const usagePctRef = useRef<number | null>(null)
  const streamStartRef = useRef<number | null>(null)
  const timerRef2 = useRef<ReturnType<typeof setInterval> | null>(null)
  const compactTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const liveEntriesRef = useRef<JsonlEntry[]>([])
  const pendingToolsRef = useRef<Array<{ type: string; name?: string; input?: Record<string, unknown> }>>([])

  // Load history from file when session is selected
  useEffect(() => {
    if (!session) {
      setEntries([])
      return
    }
    currentSessionIdRef.current = session.id
    const jsonlPath = `${session.projectPath}\\${session.id}.jsonl`
    api.readSession(jsonlPath).then(raw => {
      const filtered = filterContextEntries(raw)
      setEntries(filtered)
    })
    setLiveEntries([])
    liveEntriesRef.current = []
    pendingToolsRef.current = []
    setIsStreaming(false)
    setIsThinking(false)
    // Восстанавливаем токены для этой сессии из localStorage
    const saved = localStorage.getItem(`pty_tokens_${session.id}`)
    const savedCount = saved ? parseInt(saved, 10) : null
    setPtyTokens(savedCount)
    setPtyTokensDelta(null)
    prevPtyTokensRef.current = savedCount
  }, [session?.id, reloadKey])

  useEffect(() => {
    const unsubEvent = api.onStreamEvent((event: StreamEvent) => {
      if (event.type === 'assistant_streaming_start') {
        streamingTextCommittedRef.current = false
        setIsStreaming(true)
        setIsThinking(true)
        setStreamSeconds(0)
        streamStartRef.current = Date.now()
        if (timerRef2.current) clearInterval(timerRef2.current)
        timerRef2.current = setInterval(() => {
          if (streamStartRef.current) setStreamSeconds(Math.floor((Date.now() - streamStartRef.current) / 1000))
        }, 1000)
        return
      }

      if (event.type === 'system') {
        const sub = (event as unknown as { subtype?: string }).subtype
        if (sub === 'status') {
          const se = event as unknown as { status?: string | null; compact_result?: string }
          if (se.status === 'compacting') {
            setIsCompacting(true)
            // Keep timer ticking during compact if main stream timer stopped
            if (!compactTimerRef.current) {
              if (!streamStartRef.current) streamStartRef.current = Date.now()
              compactTimerRef.current = setInterval(() => {
                if (streamStartRef.current) setStreamSeconds(Math.floor((Date.now() - streamStartRef.current) / 1000))
              }, 1000)
            }
          } else if (se.compact_result === 'success') {
            setIsCompacting(false)
            if (compactTimerRef.current) { clearInterval(compactTimerRef.current); compactTimerRef.current = null }
          }
          return
        }
        if (sub === 'api_retry') {
          const e = event as unknown as {
            attempt?: number
            max_retries?: number
            error_status?: number | null
            error?: string
          }
          const attempt = e.attempt ?? 0
          const maxRetries = e.max_retries ?? 10
          const errorStatus = e.error_status
          const errorMsg = e.error ?? 'unknown'
          const errorType = errorMsg === 'authentication_failed' || errorStatus === 401 ? 'authentication_error'
            : errorMsg === 'rate_limit' || errorStatus === 429 ? 'rate_limit_error'
            : errorMsg === 'overloaded_error' || errorStatus === 529 ? 'overloaded_error'
            : errorMsg === 'billing_error' ? 'billing_error'
            : errorMsg === 'invalid_request' ? 'invalid_request'
            : errorMsg === 'max_output_tokens' ? 'max_output_tokens'
            : errorMsg === 'server_error' || (errorStatus && errorStatus >= 500) ? 'server_error'
            : errorMsg

          if (attempt >= 3) {
            api.abortRun()
            let msg: string
            let known = true
            if (errorType === 'authentication_error') {
              msg = 'Ошибка авторизации. Проверь аккаунт Claude.'
            } else if (errorType === 'rate_limit_error') {
              msg = 'Превышен лимит запросов. Подожди немного.'
            } else if (errorType === 'overloaded_error') {
              msg = 'Серверы Claude перегружены. Попробуй чуть позже.'
            } else if (errorType === 'billing_error') {
              msg = 'Проблема с оплатой аккаунта Claude.'
            } else if (errorType === 'invalid_request') {
              msg = 'Некорректный запрос к API Claude. Возможно неверный ID модели.'
            } else if (errorType === 'max_output_tokens') {
              msg = 'Достигнут лимит токенов в ответе.'
            } else if (errorType === 'server_error') {
              msg = 'Внутренняя ошибка серверов Claude. Попробуй позже.'
            } else if (errorType === 'ECONNRESET' || errorType === 'ETIMEDOUT' || errorType === 'unknown') {
              msg = 'Нет соединения с сервером. Проверь интернет или VPN.'
            } else {
              known = false
              msg = errorMsg ?? errorType
            }
            const errEntry: JsonlEntry = { type: 'error_bubble', message: msg, known }
            setEntries(prev => [...prev, ...liveEntriesRef.current, errEntry])
            liveEntriesRef.current = []
            pendingToolsRef.current = []
            setLiveEntries([])
            setIsStreaming(false)
            setIsThinking(false)
            setLiveTool(null)
            return
          }
          setLiveTool({ name: 'retry', label: `Нет соединения, повтор ${attempt}/3...` })
          return
        }
        if (sub === 'compact_boundary') {
          const ce = event as unknown as {
            compact_metadata?: { pre_tokens?: number; post_tokens?: number; trigger?: string }
          }
          const meta = ce.compact_metadata ?? {}
          const compactEntry: JsonlEntry = {
            type: 'compact_boundary',
            pre_tokens: meta.pre_tokens ?? 0,
            post_tokens: meta.post_tokens ?? 0,
            trigger: meta.trigger ?? 'manual',
          }
          setEntries(prev => [...prev, compactEntry])
          // Poll jsonl after compact until summary bubble appears (max 10 attempts, every 2s)
          if (session) {
            const jsonlPath = `${session.projectPath}\\${session.id}.jsonl`
            let attempts = 0
            const poll = () => {
              attempts++
              api.readSession(jsonlPath).then(raw => {
                const filtered = filterContextEntries(raw)
                // Check if summary appeared (user message with "This session is being continued")
                const hasSummary = filtered.some(e =>
                  e.type === 'user' && typeof e.message?.content === 'string' &&
                  e.message.content.includes('This session is being continued')
                )
                if (hasSummary || attempts >= 10) {
                  setEntries(filtered)
                } else {
                  setTimeout(poll, 2000)
                }
              })
            }
            setTimeout(poll, 1500)
          }
          return
        }

        // Session started — begin thinking state
        setIsStreaming(true)
        setIsThinking(true)
        setStreamSeconds(0)
        setStreamTokens(null)
        setStreamInputTokens(null)
        setStreamCacheRead(null)
        setStreamCacheCreated(null)
        prevContextPctRef.current = contextPctRef.current
        prevUsagePctRef.current = usagePctRef.current
        setStreamTokens(null)
        streamStartRef.current = Date.now()
        if (timerRef2.current) clearInterval(timerRef2.current)
        timerRef2.current = setInterval(() => {
          if (streamStartRef.current) setStreamSeconds(Math.floor((Date.now() - streamStartRef.current) / 1000))
        }, 1000)
        return
      }

      if (event.type === 'pty_tool_update') {
        const { tool_use_id, patch } = event as unknown as { tool_use_id: string; patch: Record<string, string> }
        // обновляем input в liveEntries для нужного tool_use блока
        liveEntriesRef.current = liveEntriesRef.current.map(e => {
          if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) return e
          const blocks = e.message.content as Array<{type: string; id?: string; input?: Record<string, unknown>}>
          const hasTarget = blocks.some(b => b.type === 'tool_use' && b.id === tool_use_id)
          if (!hasTarget) return e
          return {
            ...e,
            message: {
              ...e.message,
              content: blocks.map(b =>
                b.type === 'tool_use' && b.id === tool_use_id
                  ? { ...b, input: { ...b.input, ...patch } }
                  : b
              ),
            },
          }
        })
        setLiveEntries([...liveEntriesRef.current])
        return
      }

      if (event.type === 'commit_streaming_text') {
        // Фиксируем streaming text entry — следующий streaming_text будет новым entry
        // Помечаем через добавление sentinel чтобы streaming_text не перезаписал предыдущий
        streamingTextCommittedRef.current = true
        return
      }

      if ((event as unknown as { type: string }).type === 'pty_final_message') {
        const e = event as unknown as { entry: JsonlEntry }
        const key = `final_${Date.now()}`
        const entry = { ...e.entry, _animKey: key } as JsonlEntry
        // Drop last text entry from liveEntries — it's a TUI-stripped duplicate, final comes from jsonl
        const live = liveEntriesRef.current
        const lastIsText = live.length > 0 &&
          live[live.length - 1].type === 'assistant' &&
          Array.isArray(live[live.length - 1].message?.content) &&
          (live[live.length - 1].message.content as Array<{type:string}>)[0]?.type === 'text'
        const toCommit = lastIsText ? live.slice(0, -1) : live
        setEntries(prev => [...prev, ...toCommit, entry])
        liveEntriesRef.current = []
        setLiveEntries([])
        pendingResultRef.current = false
        setIsStreaming(false)
        setIsThinking(false)
        if (timerRef2.current) { clearInterval(timerRef2.current); timerRef2.current = null }
        setFinalEntryKey(key)
        setTimeout(() => setFinalEntryKey(null), 1000)
        return
      }

      if (event.type === 'pty_tokens') {
        const count = (event as unknown as { count: number }).count
        console.log('[useSession] pty_tokens:', count)
        if (prevPtyTokensRef.current !== null) {
          setPtyTokensDelta(count - prevPtyTokensRef.current)
        }
        prevPtyTokensRef.current = count
        setPtyTokens(count)
        // Сохраняем токены для текущей сессии в localStorage
        if (currentSessionIdRef.current) {
          localStorage.setItem(`pty_tokens_${currentSessionIdRef.current}`, String(count))
        }
        return
      }

      // Real-time text streaming from PTY parser (xterm-headless delta)
      if (event.type === 'assistant_streaming_text') {
        setIsThinking(false)
        setIsStreaming(true)
        const text = (event as unknown as { text: string }).text
        if (text) {
          const streamEntry: JsonlEntry = {
            type: 'assistant' as const,
            message: { role: 'assistant' as const, content: [{ type: 'text', text }] as JsonlEntry['message']['content'] },
          }
          const cur = liveEntriesRef.current
          const lastIdx = cur.length - 1
          // Если текст был зафиксирован (commit_streaming_text) или последний entry не text — добавляем новый
          const lastIsText = lastIdx >= 0 && cur[lastIdx].type === 'assistant' &&
              Array.isArray(cur[lastIdx].message?.content) &&
              (cur[lastIdx].message.content as Array<{type:string}>)[0]?.type === 'text'
          if (lastIsText && !streamingTextCommittedRef.current) {
            liveEntriesRef.current = [...cur.slice(0, lastIdx), streamEntry]
          } else {
            liveEntriesRef.current = [...cur, streamEntry]
            streamingTextCommittedRef.current = false
          }
          setLiveEntries([...liveEntriesRef.current])
        }
        return
      }

      if (event.type === 'assistant') {
        const blocks: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>
          = event.message?.content || []

        const textBlocks = blocks.filter(b => b.type === 'text' && b.text)
        const toolBlocks = blocks.filter(b => b.type === 'tool_use' && b.name)

        if (textBlocks.length === 0 && toolBlocks.length === 0) return

        setIsThinking(false)
        setIsStreaming(true)

        // Tool use: show live indicator only, don't commit to liveEntries yet
        // ToolBlock will be added when tool_result arrives
        if (toolBlocks.length > 0) {
          const t = toolBlocks[0]
          setLiveTool({ name: t.name!, label: toolLabel(t.name!, t.input || {}), input: t.input || {} })
          // store pending tool blocks to commit on tool_result
          pendingToolsRef.current = [...pendingToolsRef.current, ...toolBlocks]
        }

        // Text: add to liveEntries immediately
        if (textBlocks.length > 0) {
          const entry: JsonlEntry = {
            type: 'assistant' as const,
            message: { role: 'assistant' as const, content: textBlocks as JsonlEntry['message']['content'] },
          }
          liveEntriesRef.current = [...liveEntriesRef.current, entry]
          setLiveEntries([...liveEntriesRef.current])
        }
        return
      }

      // tool_result: commit pending tool blocks as ToolBlock entries, clear live indicator
      if (event.type === 'user') {
        const blocks: Array<{ type: string }> = (event as { message?: { content?: Array<{ type: string }> } }).message?.content || []
        if (blocks.some(b => b.type === 'tool_result') && pendingToolsRef.current.length > 0) {
          const toolEntries: JsonlEntry[] = pendingToolsRef.current.map(t => ({
            type: 'assistant' as const,
            message: { role: 'assistant' as const, content: [t] as JsonlEntry['message']['content'] },
          }))
          liveEntriesRef.current = [...liveEntriesRef.current, ...toolEntries]
          setLiveEntries([...liveEntriesRef.current])
          pendingToolsRef.current = []
          setLiveTool(null)
        }
        return
      }

      if (event.type === 'error') {
        const msg = (event as unknown as { error: string }).error
        const errEntry: JsonlEntry = { type: 'error_bubble', message: msg, known: false }
        setEntries(prev => [...prev, ...liveEntriesRef.current, errEntry])
        liveEntriesRef.current = []
        pendingToolsRef.current = []
        setLiveEntries([])
        setIsStreaming(false)
        setIsThinking(false)
        setLiveTool(null)
        return
      }

      if (event.type === 'result') {
        const resultSub = (event as unknown as { subtype?: string }).subtype
        const resultErrorMsgs: Record<string, string> = {
          error_max_turns: 'Достигнут лимит ходов в сессии.',
          error_during_execution: 'Ошибка во время выполнения.',
          error_max_budget_usd: 'Достигнут лимит бюджета.',
          error_max_structured_output_retries: 'Ошибка структурированного вывода.',
        }
        if (resultSub && resultSub in resultErrorMsgs) {
          const errEntry: JsonlEntry = { type: 'error_bubble', message: resultErrorMsgs[resultSub], known: true }
          setEntries(prev => [...prev, ...liveEntriesRef.current, errEntry])
          liveEntriesRef.current = []
          pendingToolsRef.current = []
          setLiveEntries([])
          setIsStreaming(false)
          setIsThinking(false)
          setLiveTool(null)
          return
        }
        // For PTY mode: keep liveEntries visible until pty_final_message arrives
        // We detect PTY by checking if there's pending text in liveEntries (no usage in result)
        const r2 = event as unknown as { usage?: { output_tokens?: number } }
        const isPty = !r2.usage?.output_tokens
        if (isPty) {
          // Don't clear liveEntries or streaming state yet — pty_final_message will do it
          pendingToolsRef.current = []
          setLiveTool(null)
          // Mark that we're waiting for pty_final_message
          pendingResultRef.current = true
          return
        }
        // SDK mode: commit immediately
        const accumulated = liveEntriesRef.current
        setEntries(prev => [...prev, ...accumulated])
        liveEntriesRef.current = []
        pendingToolsRef.current = []
        setLiveEntries([])
        setIsStreaming(false)
        setIsThinking(false)
        setLiveTool(null)
        if (timerRef2.current) { clearInterval(timerRef2.current); timerRef2.current = null }
        // Extract token count from result
        const r = event as unknown as { usage?: { output_tokens?: number; input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }; cost_usd?: number }
        if (r.usage?.output_tokens) setStreamTokens(r.usage.output_tokens)
        if (r.usage?.input_tokens) setStreamInputTokens(r.usage.input_tokens)
        if (r.usage?.cache_read_input_tokens != null) setStreamCacheRead(r.usage.cache_read_input_tokens)
        if (r.usage?.cache_creation_input_tokens != null) setStreamCacheCreated(r.usage.cache_creation_input_tokens)
      }
    })

    const unsubDone = api.onStreamDone(() => {
      setIsStreaming(false)
      setIsThinking(false)
    })

    const unsubUsage = api.onUsageData((data) => {
      if (data.context?.pct != null) { contextPctRef.current = data.context.pct; setContextPct(data.context.pct) }
      if (data.usage?.sessionPct != null) { usagePctRef.current = data.usage.sessionPct; setUsagePct(data.usage.sessionPct) }
    })

    return () => { unsubEvent(); unsubDone(); unsubUsage() }
  }, [])

  const appendUserMessage = useCallback((text: string) => {
    setStreamTokens(null)
    setStreamSeconds(0)
    setEntries(prev => [...prev, {
      type: 'user' as const,
      message: { role: 'user' as const, content: text },
      timestamp: new Date().toISOString(),
    }])
  }, [])

  // Estimated tokens during streaming (~4 chars per token)
  const estimatedTokens = liveEntries.reduce((acc, e) => {
    const text = getEntryText(e)
    return acc + Math.round(text.length / 4)
  }, 0)

  const streamStats = (isStreaming || isThinking || isCompacting || streamTokens !== null)
    ? { seconds: streamSeconds, tokens: streamTokens ?? (estimatedTokens > 0 ? estimatedTokens : null), exact: streamTokens !== null, inputTokens: streamInputTokens, cacheRead: streamCacheRead, cacheCreated: streamCacheCreated, contextPct, prevContextPct: prevContextPctRef.current, usagePct, prevUsagePct: prevUsagePctRef.current }
    : null

  return { entries, liveEntries, isStreaming, isThinking, isCompacting, liveTool, appendUserMessage, error, clearError: () => setError(null), streamStats, ptyTokens, ptyTokensDelta, finalEntryKey, reloadEntries: () => setReloadKey(k => k + 1) }
}
