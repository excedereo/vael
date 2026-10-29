import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import type { Session, Account } from '../types/index'
import { cn } from '../lib/utils.js'
import { Zap, Trash2, Pencil, ArrowDownUp, Archive, ArchiveRestore, ChevronRight, Search, SquarePen, X, ScrollText } from 'lucide-react'
import type { Section } from './NavRail.js'
import { SECTION_LABEL } from '../lib/sectionLabels.js'
import { Brush, Message, Notification, Monitor, Profile, Chart2 } from 'iconsax-reactjs'
import type { Icon as IconType } from 'iconsax-reactjs'
import { api } from '../lib/api.js'
import { ModuleIcon } from './ModuleIcon.js'
import { useSettingsTab, setSettingsTab, useAccountsTab, setAccountsTab } from '../lib/sectionTabs.js'
import type { SettingsTab, AccountsTab } from '../lib/sectionTabs.js'
import { t as tr } from '../lib/i18n.js'

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
  /** из живых — какие открыты в чат-режиме (остальные — TUI) */
  chatSessionIds?: string[]
  onSelect: (session: Session) => void
  onNew: () => void
  onDelete: (session: Session) => void
  /** Окно со всеми пересказами сессии */
  onSummaries?: (session: Session) => void
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


const SETTINGS_TAB_LABEL: Record<SettingsTab, string> = {
  interface: tr("Интерфейс", "Interface"),
  sessions: tr("Сессии", "Sessions"),
  notifications: tr("Уведомления", "Notifications"),
  system: tr("Система", "System"),
}
const ACCOUNTS_TAB_LABEL: Record<AccountsTab, string> = {
  accounts: tr("Аккаунты", "Accounts"),
  stats: tr("Статистика", "Statistics"),
}

// Иконки под-вкладок — те же, что в шапках соответствующих страниц
const SETTINGS_TAB_ICON: Record<SettingsTab, IconType> = {
  interface: Brush,
  sessions: Message,
  notifications: Notification,
  system: Monitor,
}
const ACCOUNTS_TAB_ICON: Record<AccountsTab, IconType> = {
  accounts: Profile,
  stats: Chart2,
}

function TabRow({ label, active, onClick, icon: Icon }: {
  label: string
  active: boolean
  onClick: () => void
  icon?: IconType
}) {
  return (
    <button
      onClick={onClick}
      className={cn('session-row w-full text-left gap-2.5', active && 'is-active')}
    >
      {Icon && (
        <Icon
          size={16}
          variant="Linear"
          color={active ? 'var(--accent)' : 'currentColor'}
          className="shrink-0"
        />
      )}
      {label}
    </button>
  )
}

type SortMode = 'recent' | 'created' | 'name' | 'custom'

// Группы по дате последнего ответа — как в истории claude.ai
function dateGroup(ts: number): string {
  const day = new Date(); day.setHours(0, 0, 0, 0)
  const t = day.getTime()
  if (ts >= t) return tr("Сегодня", "Today")
  if (ts >= t - 86_400_000) return tr("Вчера", "Yesterday")
  if (ts >= t - 6 * 86_400_000) return tr("На этой неделе", "This week")
  if (ts >= t - 30 * 86_400_000) return tr("В этом месяце", "This month")
  return tr("Раньше", "Earlier")
}
const SORT_LABEL: Record<SortMode, string> = {
  recent:  tr("Последний ответ", "Last answer"),
  created: tr("Дате создания", "Date created"),
  name:    tr("Названию", "Name"),
  custom:  tr("Своему порядку", "Custom order"),
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

function SessionItem({ session, active, onClick, onContextMenu, isRenaming, renameValue, onRenameChange, onRenameCommit, displayTitle, isRunning, mode }: {
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
  mode?: 'chat' | 'tui'
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
      className={cn('session-row relative overflow-hidden', active && 'is-active')}
      title={session.title || undefined}
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

      <span className={cn('session-dot', isRunning ? 'is-live' : 'is-off')} title={isRunning ? tr("Процесс запущен", "Process running") : undefined} />

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
            className="leading-snug whitespace-nowrap overflow-hidden text-ellipsis"
          >
            {displayTitle}
          </p>
        )}
      </div>
      {isRunning && mode && <span className="session-mode">{mode === 'chat' ? tr("чат", "chat") : 'tui'}</span>}
    </div>
  )
}


export function Sidebar({ section, sessions, activeSessionId, newSessionId, runningSessionIds = [], chatSessionIds = [], onSelect, onNew, onDelete, onSummaries, isLocked, memoryTokens, modules = [], activeModuleId, onSelectModule, onMetaChange }: Props) {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // Ctrl+K — к поиску сессий
  useEffect(() => {
    if (section !== 'sessions') return
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [section])

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
    const q = query.trim().toLowerCase()
    for (const s of sessions) {
      if (q && !(s.title || '').toLowerCase().includes(q)) continue
      ;(s.archived ? arch : live).push(s)
    }
    return { liveSessions: sortSessions(live, sortMode), archivedSessions: sortSessions(arch, 'recent') }
  }, [sessions, sortMode, query])

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
          mode={chatSessionIds.includes(session.id) ? 'chat' : 'tui'}
        />
      </motion.div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Верхняя линия окна: та же высота и граница, что у шапки справа */}
      <div ref={sortRef} className="relative h-11 shrink-0 flex items-center gap-1.5 px-2 border-b border-border-subtle app-drag-region">
        {section === 'sessions' ? (
          <>
            <label className="sidebar-search no-drag">
              <Search size={14} className="shrink-0" />
              <input
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur() } }}
                placeholder={tr("Поиск", "Search")}
                spellCheck={false}
              />
              {query ? (
                <button onClick={() => setQuery('')} className="text-text-faint hover:text-text-secondary" title={tr("Очистить", "Clear")}><X size={13} /></button>
              ) : <kbd>Ctrl K</kbd>}
            </label>
            <button
              onClick={() => setSortOpen(v => !v)}
              className={cn('no-drag w-7 h-7 shrink-0 rounded-md flex items-center justify-center transition-colors', sortOpen ? 'text-accent bg-accent-wash' : 'text-text-faint hover:text-text-secondary hover:bg-surface-hover')}
              title={tr("Сортировка: ", "Sort: ") + SORT_LABEL[sortMode].toLowerCase()}
            >
              <ArrowDownUp size={14} />
            </button>
            <button
              onClick={onNew}
              disabled={isLocked}
              className="no-drag w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-text-faint hover:text-text-primary hover:bg-surface-hover transition-colors disabled:opacity-30"
              title={tr("Новая сессия", "New session")}
            >
              <SquarePen size={15} />
            </button>
          </>
        ) : (
          <span className="px-1.5 text-[13.5px] font-medium text-text-primary select-none">{SECTION_LABEL[section]}</span>
        )}

            {/* Поповер сортировки */}
            {section === 'sessions' && sortOpen && (
              <div className="absolute top-9 right-2 z-30 no-drag w-[204px] rounded-[11px] border border-border-strong bg-bg-elevated p-1.5 shadow-[0_20px_44px_-14px_rgba(0,0,0,0.9)]">
                <div className="px-2.5 pt-1.5 pb-1 text-[9.5px] uppercase tracking-[0.15em] text-text-faint">{tr("Сортировать по", "Sort by")}</div>
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
                    {tr("Показывать архив", "Show archive")}
                    <span className={cn('ml-auto w-7 h-4 rounded-full relative flex-none transition-colors', showArchived ? 'bg-accent-deep' : 'bg-surface-active')}>
                      <span className={cn('absolute top-0.5 w-3 h-3 rounded-full transition-all', showArchived ? 'right-0.5 bg-white' : 'left-0.5 bg-text-muted')} />
                    </span>
                  </button>
                </>}
              </div>
            )}
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
          <div className="flex-1 overflow-y-auto px-1.5 pt-1 thin-scroll">
            {liveSessions.length === 0 && (
              <p className="px-2 py-6 text-center text-[13px] text-text-ghost">
                {query ? tr("Ничего не нашлось", "Nothing found") : tr("Сессий пока нет", "No sessions yet")}
              </p>
            )}
            {sortMode === 'recent' && !query
              ? liveSessions.map((session, i) => {
                  const g = dateGroup(session.lastModified)
                  const head = i === 0 || dateGroup(liveSessions[i - 1].lastModified) !== g
                  return [head && <div key={'g:' + g} className="session-group">{g}</div>, renderSessionRow(session)]
                })
              : liveSessions.map(session => renderSessionRow(session))}

            {/* Архив — свёрнут по умолчанию */}
            {showArchived && archivedSessions.length > 0 && (
              <div className="pt-2">
                <button
                  onClick={() => setArchiveExpanded(v => !v)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] text-text-faint hover:text-text-secondary transition-colors"
                >
                  <ChevronRight size={12} className={cn('flex-none transition-transform', archiveExpanded && 'rotate-90')} />
                  <Archive size={13} className="flex-none" />
                  {tr("Архив", "Archive")}
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
            <span className="text-[11px] text-text-faint uppercase tracking-widest">{tr("Модули", "Modules")}</span>
          </div>
          <div className="flex flex-col gap-0.5 px-2">
            {modules.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-8 text-text-ghost">
                <Zap size={16} strokeWidth={1.5} />
                <span className="text-[13px]">{tr("Модулей нет", "No modules")}</span>
              </div>
            )}
            {modules.map(m => {
              const active = activeModuleId === m.id
              return (
                <button
                  key={m.id}
                  onClick={() => onSelectModule?.(m.id)}
                  className={cn(
                    'flex items-center gap-3 px-2.5 py-2.5 rounded-xl transition-all duration-150 text-left w-full',
                    'border active:scale-[0.99]',
                    active
                      ? 'bg-surface-active border-border-default'
                      : 'border-transparent hover:bg-surface-hover',
                  )}
                >
                  <div className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors',
                    active ? 'bg-surface-hover' : 'bg-surface-hover/60',
                  )}>
                    <ModuleIcon icon={m.icon} size={19} dimmed={!active && !m.running} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className={cn(
                      'text-[13.5px] transition-colors',
                      active ? 'text-text-primary' : 'text-text-secondary',
                    )}>
                      {m.name}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={cn(
                        'w-1.5 h-1.5 rounded-full transition-colors',
                        m.running ? 'bg-[var(--color-success)] animate-pulse' : 'bg-text-ghost',
                      )} />
                      <span className="text-[11px] text-text-faint">
                        {m.running ? tr("работает", "running") : tr("остановлен", "stopped")}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Settings — под-вкладки раздела */}
      {section === 'settings' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-1.5 pt-2 gap-px">
          {(['interface', 'sessions', 'notifications', 'system'] as SettingsTab[]).map(t => (
            <TabRow key={t} label={SETTINGS_TAB_LABEL[t]} icon={SETTINGS_TAB_ICON[t]} active={settingsTab === t} onClick={() => setSettingsTab(t)} />
          ))}
        </div>
      )}

      {/* Accounts — под-вкладки раздела */}
      {section === 'accounts' && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-1.5 pt-2 gap-px">
          {(['accounts', 'stats'] as AccountsTab[]).map(t => (
            <TabRow key={t} label={ACCOUNTS_TAB_LABEL[t]} icon={ACCOUNTS_TAB_ICON[t]} active={accountsTab === t} onClick={() => setAccountsTab(t)} />
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
              {tr("Копировать ID", "Copy ID")}
            </button>
            {onSummaries && (
              <button
                onClick={() => { onSummaries(ctxMenu.session); setCtxMenu(null) }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[14px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              >
                <ScrollText size={13} />
                {tr("Пересказы", "Summaries")}
              </button>
            )}
            <button
              onClick={() => startRename(ctxMenu.session)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[14px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            >
              <Pencil size={13} />
              {tr("Переименовать", "Rename")}
            </button>
            <button
              onClick={() => toggleArchive(ctxMenu.session)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[14px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            >
              {ctxMenu.session.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
              {ctxMenu.session.archived ? tr("Разархивировать", "Unarchive") : tr("Заархивировать", "Archive")}
            </button>
            <div className="h-px bg-border-subtle mx-1 my-1" />
            <button
              onClick={() => { onDelete(ctxMenu.session); setCtxMenu(null) }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[14px] text-[var(--color-error)]/80 hover:text-[var(--color-error)] hover:bg-[var(--error-bg)] transition-colors"
            >
              <Trash2 size={13} />
              {tr("Удалить", "Delete")}
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
