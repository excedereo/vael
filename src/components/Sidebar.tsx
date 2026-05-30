import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import { Session } from '../types/index'
import { cn } from '../lib/utils.js'
import { Plus, Zap, Settings, Trash2 } from 'lucide-react'

type SidebarTab = 'sessions' | 'pyre' | 'console'

interface ContextMenu {
  x: number
  y: number
  session: Session
}

interface Props {
  sessions: Session[]
  activeSessionId: string | null
  onSelect: (session: Session) => void
  onNew: () => void
  onDelete: (session: Session) => void
  isLocked: boolean
  activeTab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  devConsole: boolean
}

function SessionItem({ session, active, onClick, onContextMenu }: {
  session: Session
  active: boolean
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  return (
    <div
      onContextMenu={onContextMenu}
      className={cn(
        'relative flex items-center gap-1 px-2.5 py-2 rounded-lg transition-colors group cursor-pointer',
        active ? 'bg-surface-selected' : 'hover:bg-surface-hover',
      )}
      onClick={onClick}
    >

      {/* Title with fade-out mask */}
      <div className="flex-1 min-w-0 relative overflow-hidden">
        <p
          className={cn(
            'text-[13px] leading-snug whitespace-nowrap',
            active ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary transition-colors',
          )}
          style={{ maskImage: 'linear-gradient(to right, black 70%, transparent 100%)' }}
        >
          {session.title || 'New conversation'}
        </p>
      </div>

    </div>
  )
}


export function Sidebar({ sessions, activeSessionId, onSelect, onNew, onDelete, isLocked, activeTab: tab, onTabChange: setTab, devConsole }: Props) {
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside click or Escape
  useEffect(() => {
    if (!ctxMenu) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setCtxMenu(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [ctxMenu])

  const handleContextMenu = useCallback((e: React.MouseEvent, session: Session) => {
    e.preventDefault()
    // Adjust so menu doesn't go off screen
    const x = Math.min(e.clientX, window.innerWidth - 160)
    const y = Math.min(e.clientY, window.innerHeight - 80)
    setCtxMenu({ x, y, session })
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Tab switcher */}
      <div className="px-2.5 pt-2.5 pb-2.5">
        {(() => {
          const tabs = ['sessions', 'pyre', ...(devConsole ? ['console'] : [])] as SidebarTab[]
          const activeIdx = tabs.indexOf(tab)
          const pct = 100 / tabs.length
          return (
            <div className="relative flex bg-surface-hover rounded-lg p-0.5">
              {/* Sliding indicator */}
              <motion.div
                className="absolute top-0.5 bottom-0.5 rounded-md pointer-events-none"
                style={{
                  width: `calc(${pct}% - 2px)`,
                  backgroundColor: 'var(--accent)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                }}
                animate={{ x: `calc(${activeIdx * 100}% + ${activeIdx * 2}px)` }}
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
              {tabs.map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    'relative flex-1 text-[13px] py-1.5 rounded-md font-medium capitalize transition-colors duration-150 z-10',
                    tab === t ? 'text-text-primary' : 'text-text-faint hover:text-text-muted',
                  )}
                >
                  {t === 'sessions' ? 'Sessions' : t === 'pyre' ? 'Pyre' : 'Console'}
                </button>
              ))}
            </div>
          )
        })()}
      </div>

      {/* Sessions tab */}
      {tab === 'sessions' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between px-3 pb-1.5">
            <span className="text-[11px] text-text-faint uppercase tracking-widest">Recents</span>
            <div className="flex items-center gap-0.5">
              <button
                className="p-1 rounded text-text-faint hover:text-text-secondary transition-colors"
                title="Display settings"
              >
                <Settings size={14} />
              </button>
              <button
                onClick={onNew}
                disabled={isLocked}
                className="p-1 rounded text-text-faint hover:text-text-secondary transition-colors disabled:opacity-30"
                title="New session"
              >
                <Plus size={15} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 space-y-1">
            {sessions.length === 0 && (
              <p className="px-2 py-6 text-center text-[13px] text-text-ghost">
                No sessions yet
              </p>
            )}
            {sessions.map(session => (
              <SessionItem
                key={session.id}
                session={session}
                active={activeSessionId === session.id}
                onClick={() => !isLocked && onSelect(session)}
                onContextMenu={e => handleContextMenu(e, session)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Pyre tab — placeholder */}
      {tab === 'pyre' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-text-ghost">
          <Zap size={20} strokeWidth={1.5} />
          <span className="text-[13px]">Coming soon</span>
        </div>
      )}

      {/* Context menu portal */}
      {ctxMenu && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 9999 }}
          className="bg-bg-elevated border border-border-default rounded-xl shadow-2xl shadow-black/60 overflow-hidden w-40 animate-in fade-in zoom-in-95 duration-100 origin-top-left"
        >
          <div className="p-1">
            <button
              onClick={() => { navigator.clipboard.writeText(ctxMenu.session.id); setCtxMenu(null) }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            >
              <span className="text-[11px] font-mono text-text-faint">ID</span>
              Копировать ID
            </button>
            <button
              onClick={() => { onDelete(ctxMenu.session); setCtxMenu(null) }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-red-400/80 hover:text-red-400 hover:bg-red-400/8 transition-colors"
            >
              <Trash2 size={13} />
              Удалить
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
