import React, { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { Session, JsonlEntry } from '../types/index'
import { MessageBubble, AgentBlock } from './MessageBubble.js'
import { LiveTool } from '../hooks/useSession.js'
import { cn } from '../lib/utils.js'
import { loadSlotOverrides, resolveSlotSrc, SlotOverrides } from '../lib/avatarSlots.js'

interface Props {
  session: Session | null
  entries: JsonlEntry[]
  liveEntries: JsonlEntry[]
  isStreaming: boolean
  isThinking: boolean
  isCompacting?: boolean
  contentPadding?: number
  liveTool: LiveTool | null
  streamStats?: { seconds: number; tokens: number | null; exact: boolean } | null
  onScrollStateChange?: (atBottom: boolean) => void
  scrollTrigger?: number
  finalEntryKey?: string | null
}

type AvatarState = 'default' | 'punching' | 'thinking' | 'compacting'

const ICON_W = 80
const ICON_LEFT = 8

function LastWrapper({ children, live, animate, extraClass, src, shimmer }: {
  children: React.ReactNode
  live: boolean
  animate: boolean
  extraClass?: string
  src: string | null
  shimmer?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [tall, setTall] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setTall(el.offsetHeight > ICON_W))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={ref} className={cn('relative', extraClass)}>
      {src && (
        <motion.img
          layoutId={live ? 'vaeli-icon' : undefined}
          key={live ? undefined : 'committed'}
          src={src}
          className="absolute pointer-events-none object-contain"
          style={{
            width: ICON_W, height: ICON_W, right: '100%', marginRight: 8,
            ...(tall ? { bottom: 0 } : { top: '50%', y: '-50%' }),
          }}
          transition={live ? { type: 'spring', stiffness: 500, damping: 40 } : { duration: 0 }}
        />
      )}
      {animate ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease: 'easeOut' }}>
          {children}
        </motion.div>
      ) : shimmer ? (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
        >
          {children}
        </motion.div>
      ) : children}
    </div>
  )
}

const PAGE_SIZE = 100

export function ChatView({ session, entries, liveEntries, isStreaming, isThinking, isCompacting, contentPadding = 104, liveTool, streamStats, onScrollStateChange, scrollTrigger, finalEntryKey }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE)

  // Reset limit when session changes
  useEffect(() => { setVisibleLimit(PAGE_SIZE) }, [session?.id])

  const [avatarState, setAvatarState] = useState<AvatarState>('default')
  const [slotOverrides, setSlotOverrides] = useState<SlotOverrides>(() => loadSlotOverrides())
  const thinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isActiveRef   = useRef(false)

  useEffect(() => {
    const h = () => setSlotOverrides(loadSlotOverrides())
    window.addEventListener('vaeli:avatarSlotsChanged', h)
    return () => window.removeEventListener('vaeli:avatarSlotsChanged', h)
  }, [])

  useEffect(() => {
    if (isCompacting) {
      if (thinkTimerRef.current) clearTimeout(thinkTimerRef.current)
      isActiveRef.current = false
      setAvatarState('compacting')
      return
    }
    const active = isThinking || isStreaming
    if (active && !isActiveRef.current) {
      isActiveRef.current = true
      setAvatarState('punching')
      thinkTimerRef.current = setTimeout(() => setAvatarState('thinking'), 5000)
    } else if (!active && isActiveRef.current) {
      isActiveRef.current = false
      if (thinkTimerRef.current) clearTimeout(thinkTimerRef.current)
      setAvatarState('default')
    }
  }, [isThinking, isStreaming, isCompacting])

  // Автоскролл — spring с velocity, плавный разгон и торможение
  const scrollAnimRef = useRef<number | null>(null)
  const scrollVelocityRef = useRef(0)

  const startScrollAnim = useCallback(() => {
    if (scrollAnimRef.current) return
    const el = scrollRef.current
    if (!el) return
    const tick = () => {
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
      if (remaining < 0.5 && Math.abs(scrollVelocityRef.current) < 0.5) {
        scrollAnimRef.current = null
        scrollVelocityRef.current = 0
        return
      }
      scrollVelocityRef.current = scrollVelocityRef.current * 0.85 + remaining * 0.07
      el.scrollTop += scrollVelocityRef.current
      scrollAnimRef.current = requestAnimationFrame(tick)
    }
    scrollAnimRef.current = requestAnimationFrame(tick)
  }, [])

  // При загрузке сессии — мгновенно в конец
  const pendingScrollRef = useRef(false)
  useEffect(() => {
    pendingScrollRef.current = true
  }, [session?.id])
  useEffect(() => {
    if (!pendingScrollRef.current || entries.length === 0) return
    pendingScrollRef.current = false
    const el = scrollRef.current
    if (!el) return
    setTimeout(() => { el.scrollTop = el.scrollHeight }, 0)
  }, [entries.length])

  // При отправке сообщения — мгновенно в конец
  useEffect(() => {
    const last = entries[entries.length - 1]
    if (!last || last.type !== 'user') return
    const el = scrollRef.current
    if (!el) return
    setTimeout(() => { el.scrollTop = el.scrollHeight }, 0)
  }, [entries.length])

  // Автоскролл при стриминге
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    if (dist > 600) return
    startScrollAnim()
  }, [liveEntries.length, isThinking, isStreaming, startScrollAnim])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [])

  // Notify parent about scroll position
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handler = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      onScrollStateChange?.(dist <= 200)
    }
    el.addEventListener('scroll', handler, { passive: true })
    handler()
    return () => el.removeEventListener('scroll', handler)
  }, [entries.length, liveEntries.length, onScrollStateChange])

  // scrollTrigger from parent — scroll to bottom when it changes
  useEffect(() => {
    if (scrollTrigger === undefined) return
    scrollToBottom()
  }, [scrollTrigger, scrollToBottom])

  const isActive = isStreaming || isThinking
  // For compacting state: use 'compacting' slot if set, otherwise fall back to 'thinking'
  const src = avatarState === 'compacting'
    ? (resolveSlotSrc('compacting', slotOverrides) ?? resolveSlotSrc('thinking', slotOverrides))
    : resolveSlotSrc(avatarState, slotOverrides)

  if (!session && !isActive && !isCompacting && entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-ghost text-base">
        Select a session or start a new one
      </div>
    )
  }

  const hasLive     = liveEntries.length > 0
  const hasThinking = isThinking
  const hasLiveTool = isStreaming && liveTool && !hasLive && !hasThinking

  const HIDDEN_TEXTS = new Set(['No response requested.'])

  const isHiddenEntry = (e: { type: string; message?: { content?: unknown } }) => {
    if (e.type !== 'user' && e.type !== 'assistant') return false
    const c = e.message?.content
    const text = typeof c === 'string'
      ? c.trim()
      : Array.isArray(c)
        ? (c as { type: string; text?: string }[]).filter(b => b.type === 'text').map(b => b.text || '').join('').trim()
        : ''
    if (HIDDEN_TEXTS.has(text)) return true
    if (e.type === 'user') {
      if (text === '') return true
      if (Array.isArray(c) && (c as { type: string }[]).some(b => b.type === 'tool_result')) return true
      // Hide compact system messages (but NOT the "This session is being continued..." summary — let it render)
      if (text.includes('<local-command-caveat>')) return true
      if (text.includes('<command-name>/compact</command-name>')) return true
      if (text === 'Continue from where you left off.') return true
      if (text.includes('<local-command-stdout>') && text.includes('Compacted')) return true
    }
    return false
  }

  const visibleEntries = entries.filter(e => {
    if (e.type === 'result') return false
    if (e.type === 'compact_boundary') return true
    if (isHiddenEntry(e)) return false
    if (e.type === 'assistant') {
      const blocks = Array.isArray(e.message?.content) ? e.message.content as { type: string; text?: string; name?: string }[] : []
      if (!blocks.some(b => (b.type === 'text' && b.text) || (b.type === 'tool_use' && b.name))) return false
    }
    return true
  })

  const errorSrc = resolveSlotSrc('error', slotOverrides) ?? src

  const hiddenCount = Math.max(0, visibleEntries.length - visibleLimit)
  const pagedEntries = visibleEntries.slice(-visibleLimit)

  const lastAssistantIdx = (() => {
    for (let i = pagedEntries.length - 1; i >= 0; i--) {
      if (pagedEntries[i].type === 'assistant' || pagedEntries[i].type === 'error_bubble') return i
    }
    return -1
  })()
  const isLastCommitted = (i: number) => !hasLive && !hasThinking && !hasLiveTool && !isCompacting && i === lastAssistantIdx


  const gapBefore = (i: number, arr: { type: string }[]) => {
    if (i === 0) return ''
    return 'mt-1'
  }

  const wrap = (node: React.ReactNode, isLast: boolean, extraClass?: string, animate = false, live = false, srcOverride?: string | null, shimmer = false) => {
    if (isLast) return (
      <LastWrapper key="last" live={live} animate={animate} extraClass={extraClass} src={srcOverride !== undefined ? srcOverride : src} shimmer={shimmer}>
        {node}
      </LastWrapper>
    )
    return (
      <div className={cn('relative', extraClass)}>
        {animate ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          >
            {node}
          </motion.div>
        ) : node}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-hidden">
      <div ref={scrollRef} className="h-full overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        <div className="py-6" style={{ paddingLeft: contentPadding, paddingRight: contentPadding }}>

          {hiddenCount > 0 && (
            <div className="flex justify-center py-3">
              <button
                onClick={() => {
                  setVisibleLimit(l => l + PAGE_SIZE)
                  // Keep scroll position by saving current offset from top before re-render
                  const el = scrollRef.current
                  if (!el) return
                  const prevHeight = el.scrollHeight
                  requestAnimationFrame(() => {
                    el.scrollTop += el.scrollHeight - prevHeight
                  })
                }}
                className="text-[12px] text-text-muted hover:text-text-primary bg-surface-hover hover:bg-surface-active border border-border-default rounded-xl px-4 py-1.5 transition-colors"
              >
                Загрузить ещё ({hiddenCount})
              </button>
            </div>
          )}

          {pagedEntries.map((entry, i) => {
            if (entry.type === 'compact_boundary') {
              const saved = entry.pre_tokens > 0
                ? Math.round((1 - entry.post_tokens / entry.pre_tokens) * 100)
                : 0
              return (
                <div key={`compact-${i}`} className="flex flex-col items-center gap-1 py-3 px-4 mt-4">
                  <div className="flex items-center gap-3 w-full">
                    <div className="flex-1 h-px bg-border-subtle" />
                    <span className="text-[11px] text-text-faint whitespace-nowrap">Session compacted</span>
                    <div className="flex-1 h-px bg-border-subtle" />
                  </div>
                  <span className="text-[11px] text-text-ghost">
                    {entry.pre_tokens.toLocaleString()} → {entry.post_tokens.toLocaleString()} tokens · saved{' '}
                    <span style={{ color: 'color-mix(in srgb, var(--accent) 70%, transparent)' }}>{saved}%</span>
                  </span>
                </div>
              )
            }
            const isShimmer = !!(finalEntryKey && (entry as JsonlEntry & { _animKey?: string })._animKey === finalEntryKey)
            const showMeta = entry.type === 'user' || (entry.type === 'assistant' && isLastCommitted(i))
            return wrap(
              <MessageBubble entry={entry} showMeta={showMeta} />,
              isLastCommitted(i),
              gapBefore(i, visibleEntries),
              i === visibleEntries.length - 1 && entry.type === 'user',
              false,
              entry.type === 'error_bubble' ? errorSrc : undefined,
              isShimmer,
            )
          })}

          {liveEntries.filter(e => !isHiddenEntry(e)).map((entry, i, arr) => {
            const prevType = i === 0 ? (pagedEntries.at(-1)?.type ?? '') : arr[i - 1].type
            const gap = i === 0 && visibleEntries.length === 0 ? '' : prevType !== entry.type ? 'mt-6' : 'mt-1'
            return wrap(
              <MessageBubble entry={entry} />,
              i === arr.length - 1,
              gap,
              true,
              true, // live
            )
          })}

          {hasLiveTool && !isCompacting && wrap(
            <div style={{ minHeight: 20 }}>
              {liveTool!.name === 'Agent'
                ? <AgentBlock input={liveTool!.input || {}} done={false} />
                : <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 70%, transparent)' }} />
                    <span className="text-[13px] text-text-muted font-mono truncate italic">{liveTool!.label}</span>
                    <span className="text-[13px] text-text-faint font-mono" aria-hidden>
                      <span className="animate-[pulse_1s_ease-in-out_0s_infinite]">.</span>
                      <span className="animate-[pulse_1s_ease-in-out_0.2s_infinite]">.</span>
                      <span className="animate-[pulse_1s_ease-in-out_0.4s_infinite]">.</span>
                    </span>
                  </div>
              }
            </div>,
            true, 'mt-6', true, true,
          )}

          {hasThinking && !isCompacting && wrap(
            <div style={{ minHeight: 20 }}>
              <div className="flex gap-[6px] items-center">
                {[0, 1, 2].map(i => (
                  <span
                    key={i}
                    className="w-[6px] h-[6px] rounded-full"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--accent) 50%, transparent)',
                      animation: 'thinking-bounce 1.2s ease-in-out infinite',
                      animationDelay: `${i * 0.2}s`,
                    }}
                  />
                ))}
                {streamStats && (
                  <span className="text-[12px] text-text-faint font-mono ml-1">{streamStats.seconds}s</span>
                )}
              </div>
            </div>,
            true, 'mt-6', true, true,
          )}

          {isCompacting && wrap(
            <div style={{ minHeight: 20 }}>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 60%, transparent)' }} />
                <span className="text-[13px] text-text-muted font-mono">Compacting conversation...</span>
              </div>
            </div>,
            true, 'mt-6', true, true,
          )}

          {/* Stream stats: token count after done */}
          {streamStats && (streamStats.tokens !== null || streamStats.inputTokens !== null || streamStats.cacheRead != null || streamStats.usagePct != null || streamStats.contextPct != null) && (
            <div className="flex items-center gap-1.5 mt-2 px-0.5">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 40%, transparent)' }} />
              <span className="text-[12px] text-text-faint font-mono">
                {streamStats.seconds}s
                {streamStats.tokens !== null && (
                  <> · {streamStats.exact ? '' : '~'}{streamStats.tokens} out</>
                )}
                {streamStats.inputTokens !== null && streamStats.inputTokens != null && (
                  <> · {streamStats.inputTokens.toLocaleString()} in</>
                )}
                {streamStats.cacheRead != null && streamStats.cacheRead > 0 && (
                  <> · <span style={{ color: 'color-mix(in srgb, var(--accent) 80%, transparent)' }}>{streamStats.cacheRead.toLocaleString()} hit</span></>
                )}
                {streamStats.cacheCreated != null && streamStats.cacheCreated > 0 && (
                  <> · {streamStats.cacheCreated.toLocaleString()} saved</>
                )}
                {streamStats.usagePct != null && (
                  <> · usg {streamStats.prevUsagePct != null && streamStats.prevUsagePct !== streamStats.usagePct
                    ? <>{Math.round(streamStats.prevUsagePct)} → {Math.round(streamStats.usagePct)}%</>
                    : <>{Math.round(streamStats.usagePct)}%</>
                  }</>
                )}
                {streamStats.contextPct != null && (
                  <> · ctx {streamStats.prevContextPct != null && streamStats.prevContextPct !== streamStats.contextPct
                    ? <>{Math.round(streamStats.prevContextPct)} → {Math.round(streamStats.contextPct)}%</>
                    : <>{Math.round(streamStats.contextPct)}%</>
                  }</>
                )}
              </span>
            </div>
          )}

          <div className="h-6" />
        </div>
      </div>
    </div>
  )
}

