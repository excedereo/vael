import { useEffect, useRef } from 'react'
import { cn } from '../lib/utils.js'
import { Trash2 } from 'lucide-react'

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

export function ConsoleView({ logs, onClear }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !atBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [logs])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-subtle">
        <span className="text-[10px] text-text-faint uppercase tracking-widest">Console</span>
        <button
          onClick={onClear}
          className="p-0.5 text-text-ghost hover:text-text-muted transition-colors"
          title="Clear"
        >
          <Trash2 size={11} />
        </button>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-2 py-1.5"
      >
        {logs.length === 0 && (
          <p className="text-center text-[10px] text-text-ghost mt-6">Нет логов</p>
        )}
        {logs.map(log => (
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
