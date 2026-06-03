import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import { Session } from '../types/index'
import { cn } from '../lib/utils.js'
import { Plus, Zap, Settings, Trash2, Pencil } from 'lucide-react'

type SidebarTab = 'sessions' | 'pyre' | 'console' | 'memory'

interface ContextMenu {
  x: number
  y: number
  session: Session
}

interface ModuleInfo {
  id: string
  name: string
  icon?: string
  running: boolean
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
  memoryTokens?: { auto: number; total: number }
  modules?: ModuleInfo[]
  activeModuleId?: string | null
  onSelectModule?: (id: string) => void
}

function SessionItem({ session, active, onClick, onContextMenu, isRenaming, renameValue, onRenameChange, onRenameCommit, displayTitle }: {
  session: Session
  active: boolean
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  isRenaming?: boolean
  renameValue?: string
  onRenameChange?: (v: string) => void
  onRenameCommit?: () => void
  displayTitle: string
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
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={e => onRenameChange?.(e.target.value)}
            onBlur={onRenameCommit}
            onKeyDown={e => {
              if (e.key === 'Enter') onRenameCommit?.()
              if (e.key === 'Escape') onRenameCommit?.()
            }}
            onClick={e => e.stopPropagation()}
            className="w-full bg-transparent text-[14px] text-text-primary outline-none border-b border-border-strong leading-snug"
          />
        ) : (
          <p
            className={cn(
              'text-[14px] leading-snug whitespace-nowrap',
              active ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary transition-colors',
            )}
            style={{ maskImage: 'linear-gradient(to right, black 70%, transparent 100%)' }}
          >
            {displayTitle}
          </p>
        )}
      </div>

    </div>
  )
}


export function Sidebar({ sessions, activeSessionId, onSelect, onNew, onDelete, isLocked, activeTab: tab, onTabChange: setTab, devConsole, memoryTokens, modules = [], activeModuleId, onSelectModule }: Props) {
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [sessionNames, setSessionNames] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('vaeliSessionNames') || '{}') } catch { return {} }
  })

  const saveSessionName = (id: string, name: string) => {
    const updated = { ...sessionNames, [id]: name }
    setSessionNames(updated)
    localStorage.setItem('vaeliSessionNames', JSON.stringify(updated))
  }

  const startRename = (session: Session) => {
    setRenamingId(session.id)
    setRenameValue(sessionNames[session.id] || session.title || '')
    setCtxMenu(null)
  }

  const commitRename = () => {
    if (renamingId) {
      const trimmed = renameValue.trim()
      if (trimmed) saveSessionName(renamingId, trimmed)
      else {
        const updated = { ...sessionNames }
        delete updated[renamingId]
        setSessionNames(updated)
        localStorage.setItem('vaeliSessionNames', JSON.stringify(updated))
      }
    }
    setRenamingId(null)
  }

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
          const tabs = ['sessions', 'memory', 'pyre', ...(devConsole ? ['console'] : [])] as SidebarTab[]
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
                  {t === 'sessions' ? 'Sessions' : t === 'pyre' ? 'Pyre' : t === 'memory' ? 'Memory' : 'Console'}
                </button>
              ))}
            </div>
          )
        })()}
      </div>

      {/* Memory token stats */}
      {tab === 'memory' && memoryTokens && (
        <div style={{ padding: '0 12px 8px', textAlign: 'center' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>
            {memoryTokens.auto >= 1000 ? (Math.round(memoryTokens.auto / 100) / 10) + 'k' : memoryTokens.auto} auto / {memoryTokens.total >= 1000 ? (Math.round(memoryTokens.total / 100) / 10) + 'k' : memoryTokens.total} total tok
          </span>
        </div>
      )}

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
                onClick={() => !renamingId && onSelect(session)}
                onContextMenu={e => handleContextMenu(e, session)}
                isRenaming={renamingId === session.id}
                renameValue={renameValue}
                onRenameChange={setRenameValue}
                onRenameCommit={commitRename}
                displayTitle={sessionNames[session.id] || session.title || 'New conversation'}
              />
            ))}
          </div>
        </div>
      )}

      {/* Pyre tab — modules */}
      {tab === 'pyre' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
          <div className="flex items-center justify-between px-3 pb-1.5">
            <span className="text-[11px] text-text-faint uppercase tracking-widest">Modules</span>
          </div>
          <div className="flex flex-col gap-0.5 px-2">
            {modules.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-8 text-text-ghost">
                <Zap size={16} strokeWidth={1.5} />
                <span className="text-[13px]">No modules</span>
              </div>
            )}
            {modules.map(m => (
              <button
                key={m.id}
                onClick={() => onSelectModule?.(m.id)}
                className={cn(
                  'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors text-left w-full',
                  activeModuleId === m.id
                    ? 'bg-surface-active text-text-primary'
                    : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
                )}
              >
                <span className={cn(
                  'w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors',
                  m.running ? 'bg-emerald-400' : 'bg-text-ghost',
                )} />
                {m.name}
              </button>
            ))}
          </div>
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
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[14px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            >
              <span className="text-[11px] font-mono text-text-faint">ID</span>
              Копировать ID
            </button>
            <button
              onClick={() => startRename(ctxMenu.session)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[14px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            >
              <Pencil size={13} />
              Переименовать
            </button>
            <button
              onClick={() => { onDelete(ctxMenu.session); setCtxMenu(null) }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[14px] text-red-400/80 hover:text-red-400 hover:bg-red-400/8 transition-colors"
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
