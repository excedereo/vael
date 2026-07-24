import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import { Session, Account } from '../types/index'
import { cn } from '../lib/utils.js'
import { Plus, Zap, Trash2, Pencil, ArrowDownUp, Archive, ArchiveRestore, ChevronRight } from 'lucide-react'
import type { Section } from './NavRail.js'
import { api } from '../lib/api.js'
import { useSettingsTab, setSettingsTab, useAccountsTab, setAccountsTab } from '../lib/sectionTabs.js'
import type { SettingsTab, AccountsTab } from '../lib/sectionTabs.js'

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
  section: Section
  sessions: Session[]
  activeSessionId: string | null
  newSessionId?: string | null
  runningSessionIds?: string[]
  onSelect: (session: Session) => void
  onNew: () => void
  onDelete: (session: Session) => void
  isLocked: boolean
  memoryTokens?: { auto: number; total: number }
  modules?: ModuleInfo[]
  activeModuleId?: string | null
  onSelectModule?: (id: string) => void
  accounts?: Account[]
  activeAccountId?: string
  isRunning?: boolean
  onSwitchAccount?: (id: string) => void
  /** вызвать после записи .meta.json — App перечитает список сессий */
  onMetaChange?: () => void
}

// Человеко-читаемый заголовок раздела для шапки сайдбара
const SECTION_LABEL: Record<Section, string> = {
  sessions: 'Sessions',
  memory:   'Memory',
  pyre:     'Pyre',
  dev:      'Dev',
  accounts: 'Accounts',
  settings: 'Settings',
}

const SETTINGS_TAB_LABEL: Record<SettingsTab, string> = {
  interface: 'Interface',
  sessions: 'Sessions',
  notifications: 'Notifications',
  system: 'System',
}
const ACCOUNTS_TAB_LABEL: Record<AccountsTab, string> = {
  accounts: 'Accounts',
  stats: 'Statistics',
}

function TabRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex items-center px-3 py-2 rounded-lg text-[13.5px] transition-colors text-left w-full',
        active ? 'bg-accent-wash text-text-primary' : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
      )}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-accent" />}
      {label}
    </button>
  )
}

type SortMode = 'recent' | 'created' | 'name' | 'custom'
const SORT_LABEL: Record<SortMode, string> = {
  recent:  'Последний ответ',
  created: 'Дате создания',
  name:    'Названию',
  custom:  'Своему порядку',
}

function sortSessions(list: Session[], mode: SortMode): Session[] {
  const arr = [...list]
  switch (mode) {
    case 'recent':  return arr.sort((a, b) => b.lastModified - a.lastModified)
    case 'created': return arr.sort((a, b) => b.createdAt - a.createdAt)
    case 'name':    return arr.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'))
    case 'custom':
      // с order — по возрастанию; без order (новые) — наверх, между собой по свежести
      return arr.sort((a, b) => {
        const ao = a.order, bo = b.order
        if (ao === undefined && bo === undefined) return b.lastModified - a.lastModified
        if (ao === undefined) return -1
        if (bo === undefined) return 1
        return ao - bo
      })
  }
}

function SessionItem({ session, active, onClick, onContextMenu, isRenaming, renameValue, onRenameChange, onRenameCommit, displayTitle, isRunning }: {
  session: Session
  active: boolean
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  isRenaming?: boolean
  renameValue?: string
  onRenameChange?: (v: string) => void
  onRenameCommit?: () => void
  displayTitle: string
  isRunning?: boolean
}) {
  const [glinting, setGlinting] = useState(false)

  const [flashing, setFlashing] = useState(false)

  const handleClick = () => {
    onClick()
    setGlinting(true)
    setTimeout(() => setGlinting(false), 500)
    setFlashing(true)
    setTimeout(() => setFlashing(false), 150)
  }

  return (
    <div
      onContextMenu={onContextMenu}
      className={cn(
        'relative flex items-center gap-1 px-2.5 py-2 rounded-lg transition-colors group cursor-pointer overflow-hidden',
        active ? 'bg-surface-selected' : 'hover:bg-surface-hover',
        isRunning && 'border-l-2 border-[var(--color-success)] pl-[8px]',
      )}
      onClick={handleClick}
    >

      {/* Мерцание при клике */}
      {flashing && (
        <motion.div
          className="absolute inset-0 rounded-lg pointer-events-none"
          initial={{ opacity: 0.12 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          style={{ background: 'white' }}
        />
      )}

      {/* Glint при клике */}
      {glinting && (
        <motion.div
          className="absolute inset-0 pointer-events-none overflow-hidden rounded-lg"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="absolute top-0 bottom-0 w-12"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)', skewX: '-15deg' }}
            initial={{ left: '-3rem' }}
            animate={{ left: '110%' }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          />
        </motion.div>
      )}

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


export function Sidebar({ section, sessions, activeSessionId, newSessionId, runningSessionIds = [], onSelect, onNew, onDelete, isLocked, memoryTokens, modules = [], activeModuleId, onSelectModule, onMetaChange }: Props) {
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const settingsTab = useSettingsTab()
  const accountsTab = useAccountsTab()

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const jsonlPathFor = (s: Session) => `${s.projectPath}\\${s.id}.jsonl`

  // Сортировка + архив
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const saved = localStorage.getItem('vaeli:sortMode')
    return (saved === 'recent' || saved === 'created' || saved === 'name' || saved === 'custom') ? saved : 'recent'
  })
  const [sortOpen, setSortOpen] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [archiveExpanded, setArchiveExpanded] = useState(false)
  const sortRef = useRef<HTMLDivElement>(null)

  const changeSort = (m: SortMode) => {
    setSortMode(m)
    localStorage.setItem('vaeli:sortMode', m)
    setSortOpen(false)
  }

  useEffect(() => {
    if (!sortOpen) return
    const onDown = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [sortOpen])

  // Живые (не архив) и архив — раздельно; сортировка применяется к обеим группам
  const { liveSessions, archivedSessions } = useMemo(() => {
    const live: Session[] = []
    const arch: Session[] = []
    for (const s of sessions) (s.archived ? arch : live).push(s)
    return { liveSessions: sortSessions(live, sortMode), archivedSessions: sortSessions(arch, 'recent') }
  }, [sessions, sortMode])

  const toggleArchive = async (s: Session) => {
    await api.writeSessionMeta(jsonlPathFor(s), { archived: !s.archived })
    onMetaChange?.()
    setCtxMenu(null)
  }

  // Разовая миграция старых имён из localStorage (vaeliSessionNames) в .meta.json.
  // После — ключ удаляется, чтобы не мигрировать повторно.
  useEffect(() => {
    let legacy: Record<string, string> = {}
    try { legacy = JSON.parse(localStorage.getItem('vaeliSessionNames') || '{}') } catch { return }
    const ids = Object.keys(legacy)
    if (ids.length === 0) return
    ;(async () => {
      for (const id of ids) {
        const s = sessions.find(x => x.id === id)
        if (s && legacy[id]?.trim()) {
          await api.writeSessionMeta(jsonlPathFor(s), { customTitle: legacy[id].trim() })
        }
      }
      localStorage.removeItem('vaeliSessionNames')
      onMetaChange?.()
    })()
    // один раз, когда список сессий уже загружен
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.length > 0])

  const startRename = (session: Session) => {
    setRenamingId(session.id)
    setRenameValue(session.title || '')
    setCtxMenu(null)
  }

  const commitRename = async () => {
    if (renamingId) {
      const s = sessions.find(x => x.id === renamingId)
      if (s) {
        const trimmed = renameValue.trim()
        // пустое имя → сбрасываем customTitle (writeMeta сам удалит поле)
        await api.writeSessionMeta(jsonlPathFor(s), { customTitle: trimmed })
        onMetaChange?.()
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

  const renderSessionRow = (session: Session) => {
    const isNew = session.id === newSessionId
    const title = session.title || (isNew ? '...' : 'New conversation')
    return (
      <motion.div
        key={session.id}
        initial={isNew ? { opacity: 0, y: -8 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="relative"
        whileHover={{ scale: 1.025 }}
        style={{ originX: 0.5, originY: 0.5 }}
      >
        {/* Пульс акцента — только для новой сессии */}
        {isNew && (
          <motion.div
            className="absolute inset-0 rounded-lg pointer-events-none"
            style={{ background: 'var(--accent-wash)', border: '1px solid var(--accent-dim)' }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: 'easeOut', delay: 0.1 }}
          />
        )}
        {/* Глинт */}
        {isNew && (
          <motion.div
            className="absolute inset-0 rounded-lg pointer-events-none overflow-hidden"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.8, delay: 0.05 }}
          >
            <motion.div
              className="absolute top-0 bottom-0 w-16"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)', skewX: '-15deg' }}
              initial={{ left: '-4rem' }}
              animate={{ left: '110%' }}
              transition={{ duration: 0.5, ease: 'easeOut', delay: 0.05 }}
            />
          </motion.div>
        )}
        <SessionItem
          session={session}
          active={activeSessionId === session.id}
          onClick={() => !renamingId && onSelect(session)}
          onContextMenu={e => handleContextMenu(e, session)}
          isRenaming={renamingId === session.id}
          renameValue={renameValue}
          onRenameChange={setRenameValue}
          onRenameCommit={commitRename}
          displayTitle={title}
          isRunning={runningSessionIds.includes(session.id)}
        />
      </motion.div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Заголовок раздела */}
      <div className="px-3.5 pt-3 pb-2.5">
        <span className="text-[13.5px] font-medium text-text-primary">{SECTION_LABEL[section]}</span>
      </div>

      {/* Memory token stats */}
      {section === 'memory' && memoryTokens && (
        <div style={{ padding: '0 12px 8px', textAlign: 'center' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>
            {memoryTokens.auto >= 1000 ? (Math.round(memoryTokens.auto / 100) / 10) + 'k' : memoryTokens.auto} auto / {memoryTokens.total >= 1000 ? (Math.round(memoryTokens.total / 100) / 10) + 'k' : memoryTokens.total} total tok
          </span>
        </div>
      )}

      {/* Sessions */}
      {section === 'sessions' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div ref={sortRef} className="relative flex items-center justify-between px-3 pb-1.5">
            <span className="text-[11px] text-text-faint uppercase tracking-widest">
              Recents{sortMode !== 'recent' && <span className="normal-case tracking-normal text-text-ghost"> · {SORT_LABEL[sortMode].toLowerCase()}</span>}
            </span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setSortOpen(v => !v)}
                className={cn('p-1 rounded transition-colors', sortOpen ? 'text-accent bg-accent-wash' : 'text-text-faint hover:text-text-secondary')}
                title="Sort"
              >
                <ArrowDownUp size={14} />
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

            {/* Поповер сортировки */}
            {sortOpen && (
              <div className="absolute top-7 right-2 z-30 w-[204px] rounded-[11px] border border-border-strong bg-bg-elevated p-1.5 shadow-[0_20px_44px_-14px_rgba(0,0,0,0.9)]">
                <div className="px-2.5 pt-1.5 pb-1 text-[9.5px] uppercase tracking-[0.15em] text-text-faint">Сортировать по</div>
                {(['recent', 'created', 'name', 'custom'] as SortMode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => changeSort(m)}
                    className={cn('w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors',
                      sortMode === m ? 'text-text-primary' : 'text-text-secondary hover:bg-surface-hover')}
                  >
                    <span className={cn('w-[13px] h-[13px] rounded-full border flex-none relative', sortMode === m ? 'border-accent' : 'border-text-faint')}>
                      {sortMode === m && <span className="absolute inset-[2.5px] rounded-full bg-accent" />}
                    </span>
                    {SORT_LABEL[m]}
                  </button>
                ))}
                {archivedSessions.length > 0 && <>
                  <div className="h-px bg-border-subtle mx-1.5 my-1" />
                  <button
                    onClick={() => { setShowArchived(v => !v); setSortOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12.5px] text-text-secondary hover:bg-surface-hover transition-colors"
                  >
                    <Archive size={14} className="text-text-faint flex-none" />
                    Показывать архив
                    <span className={cn('ml-auto w-7 h-4 rounded-full relative flex-none transition-colors', showArchived ? 'bg-accent-deep' : 'bg-surface-active')}>
                      <span className={cn('absolute top-0.5 w-3 h-3 rounded-full transition-all', showArchived ? 'right-0.5 bg-white' : 'left-0.5 bg-text-muted')} />
                    </span>
                  </button>
                </>}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-2 space-y-1">
            {liveSessions.length === 0 && (
              <p className="px-2 py-6 text-center text-[13px] text-text-ghost">
                No sessions yet
              </p>
            )}
            {liveSessions.map(session => renderSessionRow(session))}

            {/* Архив — свёрнут по умолчанию */}
            {showArchived && archivedSessions.length > 0 && (
              <div className="pt-2">
                <button
                  onClick={() => setArchiveExpanded(v => !v)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] text-text-faint hover:text-text-secondary transition-colors"
                >
                  <ChevronRight size={12} className={cn('flex-none transition-transform', archiveExpanded && 'rotate-90')} />
                  <Archive size={13} className="flex-none" />
                  Архив
                  <span className="ml-auto text-[11px] text-text-faint bg-surface-hover rounded-full px-2 py-px">{archivedSessions.length}</span>
                </button>
                {archiveExpanded && (
                  <div className="mt-0.5 space-y-1 opacity-70">
                    {archivedSessions.map(session => renderSessionRow(session))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pyre — modules */}
      {section === 'pyre' && (
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
                  m.running ? 'bg-[var(--color-success)]' : 'bg-text-ghost',
                )} />
                {m.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Settings — под-вкладки раздела */}
      {section === 'settings' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-2">
          {(['interface', 'sessions', 'notifications', 'system'] as SettingsTab[]).map(t => (
            <TabRow key={t} label={SETTINGS_TAB_LABEL[t]} active={settingsTab === t} onClick={() => setSettingsTab(t)} />
          ))}
        </div>
      )}

      {/* Accounts — под-вкладки раздела */}
      {section === 'accounts' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-2">
          {(['accounts', 'stats'] as AccountsTab[]).map(t => (
            <TabRow key={t} label={ACCOUNTS_TAB_LABEL[t]} active={accountsTab === t} onClick={() => setAccountsTab(t)} />
          ))}
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
              onClick={() => toggleArchive(ctxMenu.session)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[14px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            >
              {ctxMenu.session.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
              {ctxMenu.session.archived ? 'Разархивировать' : 'Заархивировать'}
            </button>
            <div className="h-px bg-border-subtle mx-1 my-1" />
            <button
              onClick={() => { onDelete(ctxMenu.session); setCtxMenu(null) }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[14px] text-[var(--color-error)]/80 hover:text-[var(--color-error)] hover:bg-[var(--error-bg)] transition-colors"
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
