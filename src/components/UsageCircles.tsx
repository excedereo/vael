import { useState, useEffect, useRef } from 'react'
import { RefreshCw, ChevronDown, ChevronRight, Check, X } from 'lucide-react'
import { UsageData, ContextData } from '../types/index'
import { api } from '../lib/api.js'
import { cn } from '../lib/utils.js'

interface Props {
  hasSession?: boolean
}

const R = 5
const CIRC = 2 * Math.PI * R // ≈ 31.4

function ringColor(pct: number) {
  if (pct >= 85) return '#f87171' // red-400
  if (pct >= 70) return '#fbbf24' // amber-400
  return 'rgba(255,255,255,0.55)'
}

function Ring({ pct, color }: { pct: number; color: string }) {
  const dash = (pct / 100) * CIRC
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="rotate-[-90deg]">
      <circle cx="7" cy="7" r={R} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" />
      <circle
        cx="7" cy="7" r={R} fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeDasharray={`${dash} ${CIRC}`}
        strokeLinecap="butt"
      />
    </svg>
  )
}

function BarLine({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1 w-full rounded-full overflow-hidden" style={{ background: 'var(--border-default)' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  )
}

function UsagePopup({ usage, onRefresh, loading }: { usage: UsageData; onRefresh: () => void; loading: boolean }) {
  return (
    <div className="w-80 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-text-muted font-medium uppercase tracking-wider">Plan usage</span>
        <button onClick={onRefresh} className="text-text-faint hover:text-text-secondary transition-colors">
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-text-secondary">5-hour limit</span>
          <span style={{ color: ringColor(usage.sessionPct) }}>
            {usage.sessionPct}% · {formatResetTime(usage.sessionResets)}
          </span>
        </div>
        <BarLine pct={usage.sessionPct} color={ringColor(usage.sessionPct)} />
      </div>

      {usage.weeklyPct > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-text-secondary">Weekly · all models</span>
            <span style={{ color: ringColor(usage.weeklyPct) }}>
              {usage.weeklyPct}% · {formatResetTime(usage.weeklyResets, true)}
            </span>
          </div>
          <BarLine pct={usage.weeklyPct} color={ringColor(usage.weeklyPct)} />
        </div>
      )}
    </div>
  )
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Parse "4:10am" or "4am" → { hours, minutes }
function parseTime(raw: string): { hours: number; minutes: number } | null {
  const m = raw.match(/(\d{1,2})(?::(\d{2}))?(am|pm)/i)
  if (!m) return null
  let h = parseInt(m[1])
  const min = m[2] ? parseInt(m[2]) : 0
  const mer = m[3].toLowerCase()
  if (mer === 'pm' && h !== 12) h += 12
  if (mer === 'am' && h === 12) h = 0
  return { hours: h, minutes: min }
}

// "4:10am (Europe/Moscow)" → "in 1h 10m (04:10)"
// "Jun 3, 1am" → "in 4d 1h (Jun 3, 01:00)"
function formatResetTime(raw: string, weekly = false): string {
  const clean = raw.replace(/\s*\([^)]+\)/, '').trim()

  if (weekly) {
    // Format: "Jun 3, 1am" or "Jun 3, 1:30am"
    const dateMatch = clean.match(/([A-Za-z]+)\s+(\d+),?\s+(.+)/)
    if (!dateMatch) return clean
    const [, mon, day, timeStr] = dateMatch
    const t = parseTime(timeStr)
    if (!t) return clean

    const now = new Date()
    const monIdx = MONTHS.findIndex(m => m.toLowerCase() === mon.toLowerCase().slice(0, 3))
    if (monIdx === -1) return clean

    const reset = new Date(now.getFullYear(), monIdx, parseInt(day), t.hours, t.minutes, 0, 0)
    if (reset <= now) reset.setFullYear(reset.getFullYear() + 1)

    const diffMs = reset.getTime() - now.getTime()
    const diffD = Math.floor(diffMs / 86400000)
    const diffH = Math.floor((diffMs % 86400000) / 3600000)

    const hh = String(t.hours).padStart(2, '0')
    const mm = String(t.minutes).padStart(2, '0')
    const label = `${MONTHS[monIdx]} ${parseInt(day)}, ${hh}:${mm}`

    if (diffD > 0) return `in ${diffD}d ${diffH}h (${label})`
    if (diffH > 0) return `in ${diffH}h (${label})`
    return label
  }

  // Session: "4:10am"
  const t = parseTime(clean)
  if (!t) return clean

  const now = new Date()
  const reset = new Date(now)
  reset.setHours(t.hours, t.minutes, 0, 0)
  if (reset <= now) reset.setDate(reset.getDate() + 1)

  const diffMs = reset.getTime() - now.getTime()
  const diffH = Math.floor(diffMs / 3600000)
  const diffM = Math.floor((diffMs % 3600000) / 60000)

  const hh = String(t.hours).padStart(2, '0')
  const mm = String(t.minutes).padStart(2, '0')
  const time24 = `${hh}:${mm}`

  if (diffH > 0) return `in ${diffH}h ${diffM}m (${time24})`
  if (diffM > 0) return `in ${diffM}m (${time24})`
  return time24
}

// Memory files excluded — user directly controls them
const SYSTEM_CAT_NAMES = ['system prompt', 'system tools', 'system tools (deferred)', 'skills', 'autocompact buffer', 'auto-compact buffer', 'autocompact']

function ContextPopup({ ctx, onRefresh, loading }: { ctx: ContextData; onRefresh: () => void; loading: boolean }) {
  const [sysOpen, setSysOpen] = useState(false)
  const [otherOpen, setOtherOpen] = useState(false)

  const sysCats = ctx.categories.filter(c => SYSTEM_CAT_NAMES.some(n => c.name.toLowerCase().includes(n.split(' ')[0])))
  const rawUserCats = ctx.categories.filter(c => !sysCats.includes(c))
  const USER_ORDER = ['messages', 'free space', 'memory files']
  const userCats = [
    ...USER_ORDER.map(k => rawUserCats.find(c => c.name.toLowerCase() === k)).filter(Boolean),
    ...rawUserCats.filter(c => !USER_ORDER.includes(c.name.toLowerCase())),
  ] as typeof rawUserCats

  return (
    <div className="w-64 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-text-muted font-medium uppercase tracking-wider">Context window</span>
        <button onClick={onRefresh} className="text-text-faint hover:text-text-secondary transition-colors">
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-text-secondary">{ctx.used} / {ctx.total}</span>
          <span style={{ color: ringColor(ctx.pct) }}>{ctx.pct}%</span>
        </div>
        <BarLine pct={ctx.pct} color={ringColor(ctx.pct)} />
      </div>

      {ctx.categories.length > 0 && (
        <div className="space-y-1 pt-0.5">
          {/* User-facing categories */}
          {userCats.map((cat, i) => (
            <div key={i} className="flex items-center justify-between text-[10px]">
              <span className="text-text-muted truncate max-w-[65%]">{cat.name}</span>
              <span className="text-text-faint font-mono">{cat.tokens} · {cat.pct.toFixed(1)}%</span>
            </div>
          ))}

          {/* System context collapsible */}
          {sysCats.length > 0 && (
            <div className="pt-0.5">
              <button
                onClick={() => setSysOpen(v => !v)}
                className="flex items-center gap-1 text-[10px] text-text-faint hover:text-text-muted transition-colors w-full"
              >
                {sysOpen ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                <span>System context</span>
                <span className="ml-auto font-mono">{sysCats.reduce((a, c) => a + c.pct, 0).toFixed(1)}%</span>
              </button>
              {sysOpen && (
                <div className="mt-1 space-y-1 pl-3">
                  {sysCats.map((cat, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px]">
                      <span className="text-text-faint truncate max-w-[65%]">{cat.name}</span>
                      <span className="text-text-faint font-mono">{cat.tokens} · {cat.pct.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Other: collapsible */}
          {ctx.cacheHit !== undefined && (
            <div className="pt-0.5">
              <button
                onClick={() => setOtherOpen(v => !v)}
                className="flex items-center gap-1 text-[10px] text-text-faint hover:text-text-muted transition-colors w-full"
              >
                {otherOpen ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                <span>Other</span>
              </button>
              {otherOpen && (
                <div className="mt-1 space-y-1 pl-3">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-text-faint">Cache</span>
                    {ctx.cacheHit === null ? (
                      <span className="text-text-faint font-mono">—</span>
                    ) : ctx.cacheHit ? (
                      <span className="flex items-center gap-1 text-emerald-400/70 font-mono">
                        <Check size={9} />hit
                        {ctx.cacheReadTokens != null && ctx.cacheReadTokens > 0 ? <span className="text-text-faint ml-1">{(ctx.cacheReadTokens / 1000).toFixed(1)}k</span> : null}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-red-400/60 font-mono">
                        <X size={9} />miss
                        {ctx.cacheCreatedTokens != null && ctx.cacheCreatedTokens > 0 ? <span className="text-text-faint ml-1">{(ctx.cacheCreatedTokens / 1000).toFixed(1)}k</span> : null}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function UsageCircles({ hasSession }: Props) {
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [context, setContext] = useState<ContextData | null>(null)

  // Clear context when no session is active
  useEffect(() => {
    if (!hasSession) setContext(null)
  }, [hasSession])
  const [openPopup, setOpenPopup] = useState<'usage' | 'context' | null>(null)
  const [loadingUsage, setLoadingUsage] = useState(false)
  const [loadingContext, setLoadingContext] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsub = api.onUsageData((data) => {
      if (data.usage) setUsage(data.usage as UsageData)
      if (data.context && hasSession) setContext(data.context as ContextData)
    })
    // Pull cached data immediately so usage shows without waiting for an event
    api.getCachedUsage()
    return unsub
  }, [hasSession])

  // Close on outside click
  useEffect(() => {
    if (!openPopup) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenPopup(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openPopup])

  const handleRefreshUsage = async () => {
    setLoadingUsage(true)
    await api.fetchUsage()
    setTimeout(() => setLoadingUsage(false), 1500)
  }

  const handleRefreshContext = async () => {
    setLoadingContext(true)
    await api.fetchContext()
    // Context arrives async via onUsageData — listen for it
    const unsub = api.onUsageData((data) => {
      if (data.context) {
        setLoadingContext(false)
        unsub()
      }
    })
    // Fallback: stop spinner after 16s max
    setTimeout(() => { setLoadingContext(false); unsub() }, 16000)
  }

  const usagePct = usage?.sessionPct ?? 0
  const ctxPct = context?.pct ?? 0

  return (
    <div ref={ref} className="relative flex items-center gap-1.5">
      {/* Usage ring */}
      <button
        onClick={() => setOpenPopup(v => v === 'usage' ? null : 'usage')}
        title="Plan usage"
        className={cn(
          'flex items-center justify-center w-5 h-5 rounded-md transition-colors',
          'hover:bg-surface-selected active:bg-surface-active',
          openPopup === 'usage' && 'bg-surface-selected',
          loadingUsage && 'animate-pulse',
        )}
      >
        <Ring pct={usagePct} color={usagePct ? ringColor(usagePct) : 'rgba(255,255,255,0.2)'} />
      </button>

      {/* Context ring */}
      <button
        onClick={() => setOpenPopup(v => v === 'context' ? null : 'context')}
        title="Context window"
        className={cn(
          'flex items-center justify-center w-5 h-5 rounded-md transition-colors',
          'hover:bg-surface-selected active:bg-surface-active',
          openPopup === 'context' && 'bg-surface-selected',
          loadingContext && 'animate-pulse',
        )}
      >
        <Ring pct={ctxPct} color={ctxPct ? ringColor(ctxPct) : 'rgba(255,255,255,0.2)'} />
      </button>

      {/* Popups */}
      {openPopup === 'usage' && usage && (
        <div className="absolute bottom-full right-0 mb-2 bg-bg-elevated border border-border-default rounded-xl shadow-2xl z-50 overflow-hidden">
          <UsagePopup usage={usage} onRefresh={handleRefreshUsage} loading={loadingUsage} />
        </div>
      )}
      {openPopup === 'context' && context && (
        <div className="absolute bottom-full right-0 mb-2 bg-bg-elevated border border-border-default rounded-xl shadow-2xl z-50 overflow-hidden">
          <ContextPopup ctx={context} onRefresh={handleRefreshContext} loading={loadingContext} />
        </div>
      )}

      {/* Empty states */}
      {openPopup === 'usage' && !usage && (
        <div className="absolute bottom-full right-0 mb-2 bg-bg-elevated border border-border-default rounded-xl shadow-2xl z-50 p-3">
          <button onClick={handleRefreshUsage} className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-secondary transition-colors">
            <RefreshCw size={11} className={loadingUsage ? 'animate-spin' : ''} />
            Load usage
          </button>
        </div>
      )}
      {openPopup === 'context' && !context && (
        <div className="absolute bottom-full right-0 mb-2 bg-bg-elevated border border-border-default rounded-xl shadow-2xl z-50 p-3">
          <button onClick={handleRefreshContext} className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-secondary transition-colors">
            <RefreshCw size={11} className={loadingContext ? 'animate-spin' : ''} />
            Load context
          </button>
        </div>
      )}
    </div>
  )
}
