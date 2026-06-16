import React, { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Session, JsonlEntry } from '../types/index'
import { MessageBubble } from './MessageBubble.js'
import { StreamStatus } from '../hooks/useSessionStream.js'
import { cn } from '../lib/utils.js'
import { loadSlotOverrides, resolveSlotSrc, SlotOverrides } from '../lib/avatarSlots.js'

interface Props {
  session: Session | null
  entries: JsonlEntry[]
  liveEntries: JsonlEntry[]
  status: StreamStatus
  activeTool: { name: string; label: string } | null
  tokens: number | null
  seconds: number
  contentPadding?: number
  onScrollStateChange?: (atBottom: boolean) => void
  scrollTrigger?: number
}

const PAGE_SIZE = 100

// ── Usage bars ────────────────────────────────────────────────────────────────

function usageBarColor(pct: number): string {
  if (pct <= 20) return '#9dc4df'
  if (pct <= 40) return '#6ead44'
  if (pct <= 60) return '#e9cb2f'
  if (pct <= 80) return '#c8662a'
  return '#cf0f0f'
}

function UsageBars({ entry }: { entry: JsonlEntry & { type: 'tui_usage' } }) {
  const { sessionPct, sessionResets, weeklyPct, weeklyResets } = entry.data
  const bar = (pct: number): React.CSSProperties => ({
    width: `${Math.min(100, Math.max(0, pct))}%`,
    background: usageBarColor(pct),
    ...(pct > 90 ? { animation: 'usage-pulse 1s ease-in-out infinite' } : {}),
  })
  return (
    <div className="my-3 mx-1 rounded-xl border border-border-subtle bg-surface-hover px-4 py-3 flex flex-col gap-3">
      <style>{`@keyframes usage-pulse { 0%,100% { background:#9e0f0f } 50% { background:#cf0f0f } }`}</style>
      {[
        { label: 'Current session', pct: sessionPct, resets: sessionResets },
        { label: 'Current week', pct: weeklyPct, resets: weeklyResets },
      ].map(({ label, pct, resets }) => (
        <div key={label} className="flex flex-col gap-1">
          <div className="text-[11px] text-text-muted uppercase tracking-wide font-medium">{label}</div>
          <div className="h-1.5 w-full rounded-full bg-surface-active overflow-hidden">
            <div className="h-full rounded-full transition-all" style={bar(pct)} />
          </div>
          <div className="flex justify-between text-[11px] text-text-ghost">
            <span>{pct}% used</span>
            <span>Resets {resets}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Avatar wrapper ────────────────────────────────────────────────────────────

type AvatarState = 'default' | 'punching' | 'thinking' | 'compacting'

const ICON_W = 80

function AvatarWrapper({ children, live, src, className }: {
  children: React.ReactNode
  live: boolean
  src: string | null
  className?: string
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
    <div ref={ref} className={cn('relative', className)}>
      {src && (
        <motion.img
          layoutId={live ? 'vaeli-icon' : undefined}
          key={live ? undefined : 'committed'}
          src={src}
          className="absolute pointer-events-none object-contain"
          style={{
            width: ICON_W, height: ICON_W,
            right: '100%', marginRight: 8,
            ...(tall ? { bottom: 0 } : { top: '50%', transform: 'translateY(-50%)' }),
          }}
          transition={live ? { type: 'spring', stiffness: 500, damping: 40 } : { duration: 0 }}
        />
      )}
      {children}
    </div>
  )
}

// ── Live indicators ───────────────────────────────────────────────────────────

function ThinkingDots({ seconds }: { seconds: number }) {
  return (
    <div className="flex gap-[6px] items-center" style={{ minHeight: 20 }}>
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
      {seconds > 0 && (
        <span className="text-[12px] text-text-faint font-mono ml-1">{seconds}s</span>
      )}
    </div>
  )
}

function ToolIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5" style={{ minHeight: 20 }}>
      <span
        className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
        style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 70%, transparent)' }}
      />
      <span className="text-[13px] text-text-muted font-mono truncate italic">{label}</span>
      <span className="text-[13px] text-text-faint font-mono" aria-hidden>
        {[0, 0.2, 0.4].map((d, i) => (
          <span key={i} style={{ animation: `pulse 1s ease-in-out ${d}s infinite` }}>.</span>
        ))}
      </span>
    </div>
  )
}

function CompactingIndicator() {
  return (
    <div className="flex items-center gap-2" style={{ minHeight: 20 }}>
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse"
        style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 60%, transparent)' }}
      />
      <span className="text-[13px] text-text-muted font-mono">Compacting conversation...</span>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const HIDDEN_USER_TEXTS = new Set([
  'No response requested.',
  'Continue from where you left off.',
])

function isHidden(entry: JsonlEntry): boolean {
  if (entry.type !== 'user' && entry.type !== 'assistant') return false
  const c = (entry as { message?: { content?: unknown } }).message?.content
  const text = typeof c === 'string'
    ? c.trim()
    : Array.isArray(c)
      ? (c as { type: string; text?: string }[]).filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim()
      : ''
  if (HIDDEN_USER_TEXTS.has(text)) return true
  if (entry.type === 'user') {
    if (text === '') return true
    if (Array.isArray(c) && (c as { type: string }[]).some(b => b.type === 'tool_result')) return true
    if (text.includes('<local-command-caveat>')) return true
    if (text.includes('<command-name>/compact</command-name>')) return true
    if (text.includes('<local-command-stdout>') && text.includes('Compacted')) return true
  }
  return false
}

function isVisibleEntry(e: JsonlEntry): boolean {
  const ALLOWED = new Set(['user', 'assistant', 'compact_boundary', 'error_bubble', 'tui_usage'])
  if (!ALLOWED.has(e.type)) return false
  if (e.type === 'compact_boundary' || e.type === 'tui_usage' || e.type === 'error_bubble') return true
  if (isHidden(e)) return false
  if (e.type === 'assistant') {
    const blocks = Array.isArray((e as { message?: { content?: unknown } }).message?.content)
      ? (e as { message: { content: { type: string; text?: string; name?: string }[] } }).message.content
      : []
    return blocks.some(b => (b.type === 'text' && b.text) || (b.type === 'tool_use' && b.name))
  }
  return true
}

// ── Main component ────────────────────────────────────────────────────────────

export function ChatViewNew({
  session,
  entries,
  liveEntries,
  status,
  activeTool,
  tokens,
  seconds,
  contentPadding = 104,
  onScrollStateChange,
  scrollTrigger,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE)
  const scrollAnimRef = useRef<number | null>(null)
  const scrollVelRef = useRef(0)

  // avatar
  const [avatarState, setAvatarState] = useState<AvatarState>('default')
  const [slotOverrides, setSlotOverrides] = useState<SlotOverrides>(() => loadSlotOverrides())
  const thinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wasActiveRef = useRef(false)

  useEffect(() => {
    const h = () => setSlotOverrides(loadSlotOverrides())
    window.addEventListener('vaeli:avatarSlotsChanged', h)
    return () => window.removeEventListener('vaeli:avatarSlotsChanged', h)
  }, [])

  useEffect(() => {
    if (status === 'compacting') {
      if (thinkTimerRef.current) clearTimeout(thinkTimerRef.current)
      wasActiveRef.current = false
      setAvatarState('compacting')
      return
    }
    const active = status !== 'idle'
    if (active && !wasActiveRef.current) {
      wasActiveRef.current = true
      setAvatarState('punching')
      thinkTimerRef.current = setTimeout(() => setAvatarState('thinking'), 5000)
    } else if (!active && wasActiveRef.current) {
      wasActiveRef.current = false
      if (thinkTimerRef.current) clearTimeout(thinkTimerRef.current)
      setAvatarState('default')
    }
  }, [status])

  // сброс лимита при смене сессии
  useEffect(() => { setVisibleLimit(PAGE_SIZE) }, [session?.id])

  // автоскролл — spring
  const startScrollAnim = useCallback(() => {
    if (scrollAnimRef.current) return
    const el = scrollRef.current
    if (!el) return
    const tick = () => {
      const rem = el.scrollHeight - el.scrollTop - el.clientHeight
      if (rem < 0.5 && Math.abs(scrollVelRef.current) < 0.5) {
        scrollAnimRef.current = null; scrollVelRef.current = 0; return
      }
      scrollVelRef.current = scrollVelRef.current * 0.85 + rem * 0.07
      el.scrollTop += scrollVelRef.current
      scrollAnimRef.current = requestAnimationFrame(tick)
    }
    scrollAnimRef.current = requestAnimationFrame(tick)
  }, [])

  // мгновенный скролл при загрузке сессии
  const pendingScrollRef = useRef(false)
  useEffect(() => { pendingScrollRef.current = true }, [session?.id])
  useEffect(() => {
    if (!pendingScrollRef.current || entries.length === 0) return
    pendingScrollRef.current = false
    setTimeout(() => { scrollRef.current && (scrollRef.current.scrollTop = scrollRef.current.scrollHeight) }, 0)
  }, [entries.length])

  // скролл при отправке
  useEffect(() => {
    const last = entries[entries.length - 1]
    if (!last || last.type !== 'user') return
    setTimeout(() => { scrollRef.current && (scrollRef.current.scrollTop = scrollRef.current.scrollHeight) }, 0)
  }, [entries.length])

  // автоскролл при стриминге
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 600) return
    startScrollAnim()
  }, [liveEntries.length, status, startScrollAnim])

  // notify parent
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const h = () => onScrollStateChange?.(el.scrollHeight - el.scrollTop - el.clientHeight <= 200)
    el.addEventListener('scroll', h, { passive: true })
    h()
    return () => el.removeEventListener('scroll', h)
  }, [entries.length, liveEntries.length, onScrollStateChange])

  useEffect(() => {
    if (scrollTrigger === undefined) return
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [scrollTrigger])

  // avatar src
  const avatarSrc = avatarState === 'compacting'
    ? (resolveSlotSrc('compacting', slotOverrides) ?? resolveSlotSrc('thinking', slotOverrides))
    : resolveSlotSrc(avatarState, slotOverrides)

  const isActive = status !== 'idle'
  const visibleEntries = entries.filter(isVisibleEntry)
  const hiddenCount = Math.max(0, visibleEntries.length - visibleLimit)
  const pagedEntries = visibleEntries.slice(-visibleLimit)

  const lastAssistantIdx = (() => {
    for (let i = pagedEntries.length - 1; i >= 0; i--) {
      if (pagedEntries[i].type === 'assistant' || pagedEntries[i].type === 'error_bubble') return i
    }
    return -1
  })()

  const isLastCommitted = (i: number) => !isActive && i === lastAssistantIdx
  const visibleLive = liveEntries.filter(e => !isHidden(e))
  const showThinking = status === 'thinking' && visibleLive.length === 0
  const showTool = status === 'tool' && activeTool && visibleLive.length === 0
  const showCompacting = status === 'compacting'

  if (!session && !isActive && entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-ghost text-base">
        Select a session or start a new one
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
                  const el = scrollRef.current
                  const prevH = el?.scrollHeight ?? 0
                  setVisibleLimit(l => l + PAGE_SIZE)
                  requestAnimationFrame(() => {
                    if (el) el.scrollTop += el.scrollHeight - prevH
                  })
                }}
                className="text-[12px] text-text-muted hover:text-text-primary bg-surface-hover hover:bg-surface-active border border-border-default rounded-xl px-4 py-1.5 transition-colors"
              >
                Загрузить ещё ({hiddenCount})
              </button>
            </div>
          )}

          {/* История */}
          {pagedEntries.map((entry, i) => {
            if (entry.type === 'tui_usage') {
              return <UsageBars key={`tui-${i}`} entry={entry as JsonlEntry & { type: 'tui_usage' }} />
            }
            if (entry.type === 'compact_boundary') {
              const saved = entry.pre_tokens > 0
                ? Math.round((1 - entry.post_tokens / entry.pre_tokens) * 100) : 0
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
            const prevType = i > 0 ? pagedEntries[i - 1].type : null
            const gap = prevType && prevType !== entry.type ? 'mt-6' : i > 0 ? 'mt-1' : ''
            const isLast = isLastCommitted(i)
            const showMeta = entry.type === 'user' || (entry.type === 'assistant' && isLast)
            const node = <MessageBubble entry={entry} showMeta={showMeta} />
            if (isLast) {
              return (
                <AvatarWrapper key={`e-${i}`} live={false} src={avatarSrc} className={gap}>
                  {node}
                </AvatarWrapper>
              )
            }
            return <div key={`e-${i}`} className={gap}>{node}</div>
          })}

          {/* Live entries */}
          {visibleLive.map((entry, i, arr) => {
            if (entry.type === 'tui_usage') {
              return (
                <motion.div key={`live-tui-${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <UsageBars entry={entry as JsonlEntry & { type: 'tui_usage' }} />
                </motion.div>
              )
            }
            const prevType = i === 0 ? (pagedEntries.at(-1)?.type ?? null) : arr[i - 1].type
            const gap = prevType && prevType !== entry.type ? 'mt-6' : i === 0 && pagedEntries.length > 0 ? 'mt-1' : ''
            const isLast = i === arr.length - 1
            const node = (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
                <MessageBubble entry={entry} />
              </motion.div>
            )
            if (isLast) {
              return (
                <AvatarWrapper key={`live-${i}`} live src={avatarSrc} className={gap}>
                  {node}
                </AvatarWrapper>
              )
            }
            return <div key={`live-${i}`} className={gap}>{node}</div>
          })}

          {/* Live indicators (когда live entries ещё нет) */}
          {(showThinking || showTool || showCompacting) && (
            <AvatarWrapper live src={avatarSrc} className={pagedEntries.length > 0 ? 'mt-6' : ''}>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
                {showThinking && <ThinkingDots seconds={seconds} />}
                {showTool && <ToolIndicator label={activeTool!.label} />}
                {showCompacting && <CompactingIndicator />}
              </motion.div>
            </AvatarWrapper>
          )}

          {/* Токены после завершения */}
          {!isActive && tokens !== null && seconds > 0 && (
            <div className="flex items-center gap-1.5 mt-2 px-0.5">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 40%, transparent)' }} />
              <span className="text-[12px] text-text-faint font-mono">
                {seconds}s · {tokens.toLocaleString()} tokens
              </span>
            </div>
          )}

          <div className="h-6" />
        </div>
      </div>
    </div>
  )
}
