import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/utils.js'
import { Trash2, SlidersHorizontal, Check } from 'lucide-react'

interface LogEntry {
  level: string
  text: string
  ts: number
  id: number
}

interface Props {
  logs: LogEntry[]
  onClear: () => void
}

const FILTER_GROUPS = [
  { id: 'usage',   label: 'PTY Usage',    patterns: ['[usagePty]', '[PtyManager] queryUsage', '[usage]'] },
  { id: 'context', label: 'PTY Context',  patterns: ['[context]', '[PtyManager] waitForPrompt'] },
  { id: 'runner',  label: 'ClaudeRunner', patterns: ['[ClaudeRunner]'] },
  { id: 'cache',   label: 'Cache',        patterns: ['[cache]'] },
  { id: 'pty',     label: 'PTY misc',     patterns: ['[PtyManager]'] },
]

function loadFilters(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem('vael:consoleFilters')
    if (raw) return JSON.parse(raw)
  } catch {}
  return Object.fromEntries(FILTER_GROUPS.map(g => [g.id, true]))
}

export function ConsoleView({ logs, onClear }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<Record<string, boolean>>(loadFilters)

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !atBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [logs])

  useEffect(() => {
    if (!showFilters) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowFilters(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showFilters])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const toggleFilter = (id: string) => {
    setFilters(prev => {
      const next = { ...prev, [id]: !prev[id] }
      try { localStorage.setItem('vael:consoleFilters', JSON.stringify(next)) } catch {}
      return next
    })
  }

  const visibleLogs = logs.filter(log => {
    for (const group of FILTER_GROUPS) {
      if (filters[group.id]) continue
      if (group.patterns.some(p => log.text.includes(p))) return false
    }
    return true
  })

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-subtle">
        <span className="text-[10px] text-text-faint uppercase tracking-widest">Console</span>
        <div className="flex items-center gap-1">
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowFilters(v => !v)}
              className={cn(
                'p-0.5 transition-colors',
                showFilters ? 'text-text-muted' : 'text-text-ghost hover:text-text-muted'
              )}
              title="Filters"
            >
              <SlidersHorizontal size={11} />
            </button>
            {showFilters && (
              <div className="absolute top-full right-0 z-50 mt-1 bg-bg-elevated border border-border-default rounded-xl shadow-xl p-2 min-w-[180px]">
                {FILTER_GROUPS.map(group => (
                  <div
                    key={group.id}
                    className="flex items-center gap-2 px-1 py-1 rounded-lg hover:bg-surface-hover cursor-pointer select-none"
                    onClick={() => toggleFilter(group.id)}
                  >
                    <div
                      className={cn(
                        'w-3 h-3 rounded-sm border shrink-0 flex items-center justify-center transition-colors',
                        filters[group.id]
                          ? 'border-transparent'
                          : 'border-border-strong bg-transparent'
                      )}
                      style={filters[group.id] ? { backgroundColor: 'color-mix(in srgb, var(--accent) 70%, transparent)' } : undefined}
                    >
                      {filters[group.id] && <Check size={8} className="text-white" />}
                    </div>
                    <span className="text-[10px] text-text-muted">{group.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={onClear}
            className="p-0.5 text-text-ghost hover:text-text-muted transition-colors"
            title="Clear"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-2 py-1.5"
      >
        {visibleLogs.length === 0 && (
          <p className="text-center text-[10px] text-text-ghost mt-6">Нет логов</p>
        )}
        {visibleLogs.map(log => (
          <div key={log.id} className="flex gap-1.5 py-[1px] group">
            <span className="text-[9px] text-text-ghost shrink-0 mt-[1px] font-mono">
              {new Date(log.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span className={cn(
              'text-[10px] font-mono leading-relaxed break-all',
              log.level === 'error' ? 'text-red-400/80' :
              log.level === 'warn'  ? 'text-yellow-400/70' :
              'text-text-muted',
            )}>
              {log.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
