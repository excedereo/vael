import React, { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { Session, JsonlEntry } from '../types/index'
import { MessageBubble } from './MessageBubble.js'
import { LiveTool } from '../hooks/useSession.js'
import { cn } from '../lib/utils.js'
import { loadSlotOverrides, resolveSlotSrc, SlotOverrides } from '../lib/avatarSlots.js'

interface Props {
  session: Session | null
  entries: JsonlEntry[]
  liveEntries: JsonlEntry[]
  isStreaming: boolean
  isThinking: boolean
  liveTool: LiveTool | null
  streamStats?: { seconds: number; tokens: number | null; exact: boolean } | null
  onScrollStateChange?: (atBottom: boolean) => void
  scrollTrigger?: number
}

type AvatarState = 'default' | 'punching' | 'thinking'

const ICON_W = 80
const ICON_LEFT = 8

function LastWrapper({ children, live, animate, extraClass, src }: {
  children: React.ReactNode
  live: boolean
  animate: boolean
  extraClass?: string
  src: string | null
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
      ) : children}
    </div>
  )
}

export function ChatView({ session, entries, liveEntries, isStreaming, isThinking, liveTool, streamStats, onScrollStateChange, scrollTrigger }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

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
  }, [isThinking, isStreaming])

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
  const src = resolveSlotSrc(avatarState, slotOverrides)

  if (!session && !isActive && entries.length === 0) {
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
    }
    return false
  }

  const visibleEntries = entries.filter(e => {
    if (e.type === 'result') return false
    if (isHiddenEntry(e)) return false
    if (e.type === 'assistant') {
      const blocks = Array.isArray(e.message?.content) ? e.message.content as { type: string; text?: string; name?: string }[] : []
      if (!blocks.some(b => (b.type === 'text' && b.text) || (b.type === 'tool_use' && b.name))) return false
    }
    return true
  })

  const errorSrc = resolveSlotSrc('error', slotOverrides) ?? src

  const lastAssistantIdx = (() => {
    for (let i = visibleEntries.length - 1; i >= 0; i--) {
      if (visibleEntries[i].type === 'assistant' || visibleEntries[i].type === 'error_bubble') return i
    }
    return -1
  })()
  const isLastCommitted = (i: number) => !hasLive && !hasThinking && !hasLiveTool && i === lastAssistantIdx

  const gapBefore = (i: number, arr: { type: string }[]) => {
    if (i === 0) return ''
    return 'mt-1'
  }

  const wrap = (node: React.ReactNode, isLast: boolean, extraClass?: string, animate = false, live = false, srcOverride?: string | null) => {
    if (isLast) return (
      <LastWrapper key="last" live={live} animate={animate} extraClass={extraClass} src={srcOverride !== undefined ? srcOverride : src}>
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
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <div className="py-6 pr-8" style={{ paddingLeft: ICON_W + 24 }}>

          {visibleEntries.map((entry, i) => wrap(
            <MessageBubble entry={entry} />,
            isLastCommitted(i),
            gapBefore(i, visibleEntries),
            i === visibleEntries.length - 1 && entry.type === 'user',
            false,
            entry.type === 'error_bubble' ? errorSrc : undefined,
          ))}

          {liveEntries.filter(e => !isHiddenEntry(e)).map((entry, i, arr) => {
            const prevType = i === 0 ? (visibleEntries.at(-1)?.type ?? '') : arr[i - 1].type
            const gap = i === 0 && visibleEntries.length === 0 ? '' : prevType !== entry.type ? 'mt-6' : 'mt-1'
            return wrap(
              <MessageBubble entry={entry} />,
              i === arr.length - 1,
              gap,
              true,
              true, // live
            )
          })}

          {hasLiveTool && wrap(
            <div style={{ minHeight: 20 }}>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 70%, transparent)' }} />
                <span className="text-[13px] text-text-muted font-mono truncate">{liveTool!.label}</span>
              </div>
            </div>,
            true, 'mt-6', true, true,
          )}

          {hasThinking && wrap(
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
              </div>
            </div>,
            true, 'mt-6', true, true,
          )}

          {/* Stream stats: timer + token count */}
          {streamStats && (
            <div className="flex items-center gap-1.5 mt-2 px-0.5">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 40%, transparent)' }} />
              <span className="text-[12px] text-text-faint font-mono">
                {streamStats.seconds}s
                {streamStats.tokens !== null && (
                  <> · {streamStats.exact ? '' : '~'}{streamStats.tokens} tokens</>
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

