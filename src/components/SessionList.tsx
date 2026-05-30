import { Session } from '../types/index'
import { cn, formatTime } from '../lib/utils.js'
import { MessageSquare, Plus } from 'lucide-react'

interface Props {
  sessions: Session[]
  activeSessionId: string | null
  onSelect: (session: Session) => void
  onNew: () => void
  isLocked: boolean
}

export function SessionList({ sessions, activeSessionId, onSelect, onNew, isLocked }: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">Sessions</span>
        <button
          onClick={onNew}
          disabled={isLocked}
          className="p-1 rounded hover:bg-surface-selected text-text-muted hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="New session"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-text-ghost">
            No sessions yet
          </div>
        )}
        {sessions.map(session => (
          <button
            key={session.id}
            onClick={() => !isLocked && onSelect(session)}
            disabled={isLocked}
            className={cn(
              'w-full text-left px-3 py-2.5 border-b border-border-subtle transition-colors',
              'hover:bg-surface-hover disabled:cursor-not-allowed',
              activeSessionId === session.id
                ? 'bg-surface-selected border-l-2'
                : 'border-l-2 border-l-transparent',
            )}
            style={activeSessionId === session.id ? { borderLeftColor: 'var(--accent)' } : undefined}
          >
            <div className="flex items-start gap-2">
              <MessageSquare size={12} className="mt-0.5 shrink-0 text-text-ghost" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-text-primary truncate leading-tight">
                  {session.title || session.id.slice(0, 8) + '...'}
                </p>
                <p className="text-[10px] text-text-ghost mt-0.5 truncate">
                  {session.projectName}
                </p>
                <p className="text-[10px] text-text-ghost mt-0.5">
                  {formatTime(session.lastModified)} · {session.messageCount} msgs
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
