import { useCallback, useState, useEffect, useRef } from 'react'
import type { Account } from './types/index'
import { AnimatePresence, motion } from 'framer-motion'
import { X, StopCircle, PanelLeftOpen, PanelLeftClose, SquareTerminal, MessageSquare, Ellipsis, Copy } from 'lucide-react'
import { useAppState } from './hooks/useAppState.js'
import { useNavHistory } from './hooks/useNavHistory.js'
import { useUpdateManager } from './hooks/useUpdateManager.js'
import { useDependencies } from './hooks/useDependencies.js'
import { useConsoleCapture } from './hooks/useConsoleCapture.js'
import { useSettings } from './hooks/useSettings.js'
import { SessionProvider, useSessionContext } from './context/SessionContext.js'
import { panels } from './panels/index.js'
import { setActiveModule } from './lib/activeModule.js'
import { PanelErrorBoundary } from './components/PanelErrorBoundary.js'
import { Sidebar } from './components/Sidebar.js'
import { NavRail } from './components/NavRail.js'
import type { Section } from './components/NavRail.js'

import { StatusBar } from './components/StatusBar.js'
import { AccountBar } from './components/AccountBar.js'
import { AccountsPage } from './components/AccountsPage.js'
import { SettingsPage } from './components/SettingsPage.js'
import { AccountSwitchModal } from './components/AccountSwitchModal.js'
import { FirstLaunch } from './components/FirstLaunch.js'
import { DepsScreen } from './components/DepsScreen.js'
import { SummariesModal } from './components/SummariesModal.js'
import { ErrorToast } from './components/ErrorToast.js'
import { DevPanel } from './components/DevPanel.js'
import { NavControls } from './components/NavControls.js'
import { PtyTerminalView } from './components/PtyTerminalView.js'
import { ChatView } from './components/ChatView.js'
import { useViewMode, setViewMode, type ViewMode } from './lib/viewMode.js'
import { SessionToolbar } from './components/SessionToolbar.js'
import { SessionWelcome } from './components/SessionWelcome.js'
import { ConfettiCanvas } from './components/ConfettiCanvas.js'
import { WindowControls } from './components/WindowControls.js'
import { UpdateBanner } from './components/UpdateBanner.js'
import { NetworkBanner } from './components/NetworkBanner.js'
import { api } from './lib/api.js'
import type { Session } from './types/index'
import { restoreSavedTheme } from './lib/theme.js'
import { statusLog } from './lib/statusLog.js'
import { loadNotificationSettings } from './hooks/useSettings.js'
import { loadDefaultSessionConfig } from './components/SettingsPage.js'
import { cn } from './lib/utils.js'

export default function App() {
  return (
    <SessionProvider>
      <AppInner />
    </SessionProvider>
  )
}

function AppInner() {
  const {
    accounts,
    activeAccountId,
    sessions,
    activeSessionId,
    setActiveSessionId,
    syncStatus,
    syncMessage,
    isLocked,
    isRunning,
    runningSessions,
    accountsLoaded,
    switchAccount,
    refreshSessions,
    refreshAccounts,
    dropSession,
  } = useAppState()

  const { uiSettings } = useSettings()
  const contentPadding = uiSettings.contentPadding

  const DEFAULT_CONFIG = { ...loadDefaultSessionConfig(), prompt: '' }

  const SESSION_MODEL_MIGRATION: Record<string, string> = {
    'claude-sonnet-4-6': 'sonnet',
    'claude-opus-4-8':   'opus',
  }

  function loadSessionConfig(sessionId: string | null) {
    if (!sessionId) return DEFAULT_CONFIG
    try {
      const raw = localStorage.getItem(`vaeli:session-config:${sessionId}`)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<typeof DEFAULT_CONFIG>
        if (parsed.model && SESSION_MODEL_MIGRATION[parsed.model]) {
          parsed.model = SESSION_MODEL_MIGRATION[parsed.model]
          localStorage.setItem(`vaeli:session-config:${sessionId}`, JSON.stringify({ ...DEFAULT_CONFIG, ...parsed }))
        }
        return { ...DEFAULT_CONFIG, ...parsed }
      }
    } catch {}
    return DEFAULT_CONFIG
  }

  function saveSessionConfig(sessionId: string, config: typeof DEFAULT_CONFIG) {
    try {
      localStorage.setItem(`vaeli:session-config:${sessionId}`, JSON.stringify(config))
    } catch {}
  }

  const { spawnedSessions, setSpawnedSessions, termToSession, setTermToSession, watchSession, unwatchSession, chatSessions, startChat, stopChat, killPty, kill } = useSessionContext()
  const [deleteTarget, setDeleteTarget] = useState<import('./types/index').Session | null>(null)
  const [summariesFor, setSummariesFor] = useState<import('./types/index').Session | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [sessionConfig, setSessionConfig] = useState(DEFAULT_CONFIG)
  const [spawnTrigger, setSpawnTrigger] = useState(0)
  const [newSessionId, setNewSessionId] = useState<string | null>(null)
  type StartPhase = 'idle' | 'confetti' | 'fadeout'
  const [startPhase, setStartPhase] = useState<StartPhase>('idle')
  const [pendingStart, setPendingStart] = useState<(() => void) | null>(null)
  const [confettiOrigin, setConfettiOrigin] = useState<DOMRect | undefined>(undefined)

  // Единая навигация: раздел определяет, что показано в главной области.
  // Раньше было два стейта — page ('chat'|'accounts'|'settings'|'memory') и
  // sidebarTab ('sessions'|'pyre'|'dev'|'memory'). Settings/Accounts больше не оверлеи.
  const [section, setSection] = useState<Section>('sessions')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  // Memory скрыта по умолчанию, включается флагом в настройках
  // Раздел памяти включён по умолчанию: скрывали временно, пока он был пустым
  const [showMemory, setShowMemory] = useState(() => localStorage.getItem('vaeli:showMemory') !== '0')
  useEffect(() => {
    const h = () => setShowMemory(localStorage.getItem('vaeli:showMemory') !== '0')
    window.addEventListener('vaeli:showMemoryChanged', h)
    return () => window.removeEventListener('vaeli:showMemoryChanged', h)
  }, [])
  // Если Memory скрыта, а раздел на ней — увести на Sessions
  useEffect(() => {
    if (!showMemory && section === 'memory') setSection('sessions')
  }, [showMemory, section])
  const [modules, setModules] = useState<{ id: string; name: string; icon?: string; running: boolean }[]>([])
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null)
  const { push: navPush, goBack, goForward, canGoBack, canGoForward } = useNavHistory()

  const { updateState, handleUpdateClick, tempCleanupBanner, tempCleanupCountdown } = useUpdateManager()
  const { deps, setDeps, installing, installLog, handleInstallClaude } = useDependencies()
  const { consoleLogs, setConsoleLogs, devConsole } = useConsoleCapture()


  useEffect(() => {
    api.modulesList().then(list => {
      setModules(list)
      if (list.length > 0) {
        setActiveModuleId(list[0].id)
        setActiveModule(list[0].id)
      }
    })
  }, [])

  useEffect(() => { restoreSavedTheme() }, [])

  // Копим историю переходов статуса с самого старта — Dev-панель рендерится
  // условно и может открыться сильно позже первых событий.
  useEffect(() => { statusLog.start() }, [])



  const [memoryTokens, setMemoryTokens] = useState<{ auto: number; total: number } | undefined>()
  useEffect(() => {
    const fetchTokens = async () => {
      const r = await api.memoryGetTokens()
      if (r) setMemoryTokens(r)
    }
    fetchTokens()
    const interval = setInterval(fetchTokens, 5000)
    return () => clearInterval(interval)
  }, [])

  const mainAreaRef = useRef<HTMLDivElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [killSessionModal, setKillSessionModal] = useState(false)

  // Native drag-drop listeners
  useEffect(() => {
    const mainEl = mainAreaRef.current
    const onDragOver = (e: DragEvent) => { e.preventDefault() }
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault()
      if (!mainEl) return
      const into = e.target as Node
      const from = e.relatedTarget as Node | null
      if (mainEl.contains(into) && !mainEl.contains(from)) {
        if (e.dataTransfer?.types.includes('Files')) setDragOver(true)
      }
    }
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault()
      if (!mainEl) return
      const from = e.target as Node
      const to = e.relatedTarget as Node | null
      if (mainEl.contains(from) && !mainEl.contains(to)) setDragOver(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      if (mainEl?.contains(e.target as Node) && e.dataTransfer?.files.length) {
        const files = Array.from(e.dataTransfer.files)
        const paths = files.map(f => (f as File & { path?: string }).path).filter(Boolean) as string[]
        if (paths.length > 0) {
          document.dispatchEvent(new CustomEvent('vaeli:dropPaths', { detail: paths }))
        } else {
          document.dispatchEvent(new CustomEvent('vaeli:dropFiles', { detail: e.dataTransfer.files }))
        }
      }
    }
    document.addEventListener('dragenter', onDragEnter, { capture: true })
    document.addEventListener('dragover', onDragOver, { capture: true })
    document.addEventListener('dragleave', onDragLeave, { capture: true })
    document.addEventListener('drop', onDrop, { capture: true })
    return () => {
      document.removeEventListener('dragenter', onDragEnter, true)
      document.removeEventListener('dragover', onDragOver, true)
      document.removeEventListener('dragleave', onDragLeave, true)
      document.removeEventListener('drop', onDrop, true)
    }
  }, [])

  const [switchTarget, setSwitchTarget] = useState<string | null>(null)

  const activeSession = sessions.find(s => s.id === activeSessionId) || null
  const activeConfigDir = accounts.find(a => a.id === activeAccountId)?.configDir ?? null

  // ── Терминал или чат ───────────────────────────────────────────────────────
  // Одна сессия — один процесс: при переключении старый гасится, новый
  // поднимается на той же сессии, история общая (один jsonl)
  const viewMode = useViewMode(activeSessionId)
  const isPtySpawned = Object.keys(spawnedSessions).some(tid => {
    const resolved = termToSession[tid] ?? (tid === '__new__' ? null : tid)
    return activeSessionId ? resolved === activeSessionId : tid === '__new__'
  })
  const isChatActive = activeSessionId
    ? Object.values(chatSessions).includes(activeSessionId)
    : '__new__' in chatSessions

  const handleViewModeChange = useCallback(async (mode: ViewMode) => {
    if (mode === viewMode) return
    setViewMode(activeSessionId, mode)
    // У новой PTY-сессии id может уже быть известен, хотя activeSessionId ещё null
    const sid = activeSessionId ?? termToSession['__new__'] ?? null
    const cfg = loadSessionConfig(sid)
    if (mode === 'chat' && isPtySpawned) {
      killPty(sid ?? '__new__')
      // pty:kill не ждёт смерти процесса — даём CLI отпустить сессию
      await new Promise(r => setTimeout(r, 400))
      await startChat(sid ?? '__new__', sid, activeConfigDir, cfg)
      if (sid && !activeSessionId) setActiveSessionId(sid)
    } else if (mode === 'terminal' && isChatActive) {
      const chatId = activeSessionId ?? chatSessions['__new__']
      await stopChat(chatId)
      // Новый чат без единого сообщения — сессии ещё нет, поднимать терминал не на чем
      if (!activeSessionId) return
      setSpawnedSessions(prev => ({ ...prev, [activeSessionId]: (prev[activeSessionId] ?? 0) + 1 }))
      setTermToSession(prev => ({ ...prev, [activeSessionId]: activeSessionId }))
    }
  }, [viewMode, activeSessionId, termToSession, isPtySpawned, isChatActive, chatSessions, killPty, startChat, stopChat, activeConfigDir, setActiveSessionId])

  // Новый чат получил jsonl — показываем его в списке и делаем активным
  useEffect(() => {
    if (!api.onChatCreated) return
    return api.onChatCreated((sessionId) => {
      setViewMode(sessionId, 'chat')
      setNewSessionId(sessionId)
      setActiveSessionId(prev => prev ?? sessionId)
      setTimeout(() => refreshSessions(), 300)
      setTimeout(() => refreshSessions(), 1500)
      setTimeout(() => setNewSessionId(null), 4000)
    })
  }, [refreshSessions, setActiveSessionId])

  useEffect(() => {
    if (!activeSession) return
    const jsonlPath = `${activeSession.projectPath}\\${activeSession.id}.jsonl`
    watchSession(activeSession.id, jsonlPath)
    return () => { unwatchSession(activeSession.id) }
  }, [activeSession?.id])

  // ── Уведомления ────────────────────────────────────────────────────────────
  // Настройки живут в localStorage renderer'а — при старте отдаём их в main,
  // иначе окно уведомлений работало бы на дефолтах до первого захода в настройки
  useEffect(() => { api.applyNotificationSettings(loadNotificationSettings()) }, [])

  // Открытая сессия: про неё не уведомляем, пока окно на виду.
  useEffect(() => { api.setActiveSessionForNotify(activeSessionId) }, [activeSessionId])

  // Названия сессий — чтобы в уведомлении был заголовок, а не голый uuid
  useEffect(() => {
    for (const s of sessions) {
      if (s.title) api.setSessionTitleForNotify(s.id, s.title)
    }
  }, [sessions])

  // Клик по уведомлению открывает нужную сессию
  useEffect(() => {
    return api.onNotificationOpenSession((sessionId) => {
      setActiveSessionId(sessionId)
      setSection('sessions')
    })
  }, [setActiveSessionId])

  useEffect(() => {
    const unsub = api.onSessionCreated((sessionId) => {
      // Батчим: маппинг + activeSession в одном рендере
      setTermToSession(prev => ({ ...prev, ['__new__']: sessionId }))
      setNewSessionId(sessionId)
      setTimeout(() => {
        setActiveSessionId(sessionId)
        api.selectSession(sessionId)
      }, 600)
      setTimeout(() => refreshSessions(), 500)
      setTimeout(() => refreshSessions(), 1500)
      setTimeout(() => refreshSessions(), 3000)
      // Сбрасываем highlight через 4с (после последнего refresh slug уже должен быть)
      setTimeout(() => setNewSessionId(null), 4000)
    })
    return unsub
  }, [refreshSessions, setActiveSessionId])

  const handleSelectSession = useCallback((session: Session) => {
    setActiveSessionId(session.id)
    setSessionConfig(loadSessionConfig(session.id))
    if (!spawnedSessions[session.id]) setSpawnTrigger(0)
    api.selectSession(session.id)
    navPush({ sessionId: session.id, tab: 'sessions' })
  }, [setActiveSessionId, navPush, spawnedSessions])

  const handleSectionChange = useCallback((next: Section) => {
    setSection(next)
    navPush({ sessionId: activeSessionId, tab: next })
  }, [activeSessionId, navPush])

  const handleGoBack = useCallback(() => {
    goBack(({ sessionId, tab }) => {
      setSection(tab)
      setActiveSessionId(sessionId)
      if (sessionId) api.selectSession(sessionId)
    })
  }, [goBack, setActiveSessionId])

  const handleGoForward = useCallback(() => {
    goForward(({ sessionId, tab }) => {
      setSection(tab)
      setActiveSessionId(sessionId)
      if (sessionId) api.selectSession(sessionId)
    })
  }, [goForward, setActiveSessionId])

  const handleNewSession = useCallback(() => {
    setTermToSession(prev => {
      const resolvedId = prev['__new__']
      if (!resolvedId) {
        // __new__ ещё не получил реальный id — просто сбрасываем
        setSpawnedSessions(sp => { const next = { ...sp }; delete next['__new__']; return next })
        return prev
      }
      // __new__ уже имеет реальный id — перекладываем терминал под реальный id чтобы он остался живым
      setSpawnedSessions(sp => {
        const next = { ...sp }
        if (next['__new__'] !== undefined) {
          next[resolvedId] = next['__new__']
          delete next['__new__']
        }
        return next
      })
      // Переименовываем ключ в termToSession тоже (новый __new__ будет чистым)
      const next = { ...prev }
      delete next['__new__']
      return next
    })
    setActiveSessionId(null)
    setSessionConfig({ ...loadDefaultSessionConfig(), prompt: '' })
    setSpawnTrigger(0)
  }, [setActiveSessionId])

  // Из меню — только спросить; удаляет confirmDelete после «Удалить» в окне
  const handleDeleteSession = useCallback((session: import('./types/index').Session) => {
    setDeleteError(null)
    setDeleteTarget(session)
  }, [])

  const confirmDelete = useCallback(async () => {
    const session = deleteTarget
    if (!session || deleting) return
    setDeleting(true)
    setDeleteError(null)
    const live = Object.values(chatSessions).includes(session.id)
      || Object.keys(spawnedSessions).some(tid => (termToSession[tid] ?? tid) === session.id)
    if (live) {
      // Живой процесс сначала гасим, иначе он допишет в файл уже из корзины
      kill(session.id)
      await new Promise(r => setTimeout(r, 500))
    }
    const r = await api.deleteSession(`${session.projectPath}\\${session.id}.jsonl`)
    setDeleting(false)
    if (r && r.ok === false) { setDeleteError(r.error ?? 'не получилось'); return }
    setDeleteTarget(null)
    if (activeSessionId === session.id) setActiveSessionId(null)
    dropSession(session.id)
  }, [deleteTarget, deleting, chatSessions, spawnedSessions, termToSession, kill, activeSessionId, setActiveSessionId, dropSession])

  // Есть ли вход хоть в одном аккаунте. Перепроверяется при каждом обновлении списка:
  // AccountsPage после выхода зовёт refreshAccounts
  const [anyLoggedIn, setAnyLoggedIn] = useState<boolean | null>(null)
  useEffect(() => {
    if (!accountsLoaded || accounts.length === 0) return
    let dead = false
    Promise.all(accounts.map(a => api.checkCredentials(a.configDir)))
      .then(r => { if (!dead) setAnyLoggedIn(r.some(Boolean)) })
      .catch(() => {})
    return () => { dead = true }
  }, [accounts, accountsLoaded])
  const onRelogin = useCallback(async (acc: Account) => {
    setAnyLoggedIn(true)
    if (acc.id !== activeAccountId) await switchAccount(acc.id)
    refreshAccounts()
  }, [activeAccountId, switchAccount, refreshAccounts])

  // Phase: зависимости — первыми: без claude не работает и вход в аккаунт
  if (deps === null) return <div className="fixed inset-0 bg-bg-base" />
  if (!deps.ready) {
    return <DepsScreen deps={deps} installing={installing} installLog={installLog} onInstall={handleInstallClaude} onRecheck={() => api.checkDeps().then(setDeps)} />
  }

  // Phase: no accounts
  if (accountsLoaded && accounts.length === 0) {
    return <FirstLaunch onCreated={refreshAccounts} />
  }
  // Phase: аккаунты есть, но из всех вышли — тот же экран, только «войти снова»
  if (accountsLoaded && anyLoggedIn === false) {
    return <FirstLaunch relogin={accounts} onCreated={onRelogin} />
  }

  // Phase: ready — main UI
  return (
    <div className="flex h-screen bg-bg-base text-white overflow-hidden">
      <ErrorToast message={null} onClose={() => {}} />

      {/* Предупреждение о выходе без VPN — плавающее, чтобы не двигать терминал */}
      <div className="fixed top-12 right-4 z-[250] w-[380px] max-w-[calc(100vw-2rem)] no-drag">
        <NetworkBanner />
      </div>

      {/* Temp cleanup banner */}
      {tempCleanupBanner && (
        <div className="fixed top-10 left-1/2 -translate-x-1/2 z-[300] animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-bg-elevated border border-border-default shadow-2xl shadow-black/60 text-[14px]">
            <span className="text-text-secondary">Очистка temp папки…</span>
            <span className="text-text-faint">{tempCleanupCountdown}с</span>
            <button onClick={() => api.tempCancelCleanup()} className="text-text-muted hover:text-text-primary transition-colors border border-border-default rounded-lg px-2.5 py-1 text-[13px]">
              Отмена
            </button>
          </div>
        </div>
      )}

      <StatusBar syncStatus={syncStatus} syncMessage={syncMessage} />

      <div className="fixed top-0 left-0 z-50 h-10 flex items-center px-2 gap-0.5 no-drag">
        {/* Стрелки назад/вперёд убраны из UI до решения, где им жить.
            Сам хук навигации остался: боковые кнопки мыши работают. */}
        <NavControls onBack={handleGoBack} onForward={handleGoForward} />
      </div>

      {/* Иконочный столбец разделов */}
      <NavRail
        active={section}
        onSelect={handleSectionChange}
        showDev={devConsole}
        showMemory={showMemory}
        busySections={runningSessions.size > 0 ? ['sessions'] : []}
      />

      {/* Sidebar — список под текущий раздел */}
      <div
        className={cn('shrink-0 border-r border-border-subtle flex flex-col bg-bg-sidebar transition-[width] duration-200 ease-out overflow-hidden', sidebarCollapsed ? 'w-0' : 'w-[248px]')}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation() }}
      >
        <div className="flex-1 min-h-0">
          <Sidebar
            section={section}
            sessions={sessions}
            activeSessionId={activeSessionId}
            newSessionId={newSessionId}
            runningSessionIds={[
              ...Object.keys(spawnedSessions).map(tid => termToSession[tid] ?? (tid === '__new__' ? null : tid)),
              ...Object.values(chatSessions),
            ].filter(Boolean) as string[]}
            chatSessionIds={Object.values(chatSessions)}
            onSelect={handleSelectSession}
            onNew={handleNewSession}
            onDelete={handleDeleteSession}
            onSummaries={setSummariesFor}
            isLocked={isLocked}
            memoryTokens={memoryTokens}
            modules={modules}
            activeModuleId={activeModuleId}
            onSelectModule={id => { setActiveModuleId(id); setActiveModule(id) }}
            accounts={accounts}
            activeAccountId={activeAccountId || ''}
            isRunning={isRunning}
            onSwitchAccount={(id) => setSwitchTarget(id)}
            onMetaChange={refreshSessions}
          />
        </div>
        {updateState && <UpdateBanner state={updateState} onClick={handleUpdateClick} onDismiss={() => {}} />}
        <AccountBar
          accounts={accounts}
          activeAccountId={activeAccountId || ''}
          isRunning={isRunning}
          onSwitch={(id) => setSwitchTarget(id)}
          onManage={() => setSection('accounts')}
          onSettings={() => setSection('settings')}
        />
      </div>

      {/* Main area */}
      <div ref={mainAreaRef} className="flex-1 flex flex-col min-w-0 relative">
        <AnimatePresence>
          {dragOver && section === 'sessions' && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-bg-base/80 backdrop-blur-sm border-2 border-dashed border-accent/40 rounded-none pointer-events-none"
            >
              <span className="text-[15px] text-text-secondary">Перетащите файлы сюда</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="h-11 shrink-0 border-b border-border-subtle flex items-center">
          <div className="app-drag-region flex items-center flex-1 min-w-0 h-full pl-2 pr-3 gap-2.5">
            <button
              onClick={() => setSidebarCollapsed(v => !v)}
              title={sidebarCollapsed ? 'Развернуть панель' : 'Свернуть панель'}
              aria-label={sidebarCollapsed ? 'Развернуть панель' : 'Свернуть панель'}
              className="no-drag w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-text-faint hover:text-text-secondary hover:bg-surface-hover transition-colors"
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            {section === 'sessions' ? (
              <>
                <span className={cn('session-dot', isPtySpawned || isChatActive ? 'is-live' : 'is-off')} />
                <span className="text-[14px] font-medium text-text-primary truncate select-none pointer-events-none" title={activeSession?.title}>
                  {activeSession ? (activeSession.title || 'Без названия') : 'Новая сессия'}
                </span>
              </>
            ) : (
              <span className="text-[13.5px] font-medium text-text-primary truncate select-none pointer-events-none capitalize">
                {section}
              </span>
            )}
          </div>
          {section === 'sessions' && (
            <div className="view-toggle no-drag shrink-0" role="tablist" aria-label="Вид сессии">
              <button className={cn(viewMode === 'terminal' && 'is-active')} onClick={() => handleViewModeChange('terminal')} title="Живой TUI claude в терминале">
                <SquareTerminal size={13} />Терминал
              </button>
              <button className={cn(viewMode === 'chat' && 'is-active')} onClick={() => handleViewModeChange('chat')} title="Чат поверх stream-json">
                <MessageSquare size={13} />Чат
              </button>
            </div>
          )}
          {section === 'sessions' && (
            <SessionMenu
              sessionId={activeSessionId}
              canKill={isPtySpawned || isChatActive}
              onKill={() => setKillSessionModal(true)}
            />
          )}
          <WindowControls />
        </div>

        {summariesFor && <SummariesModal session={summariesFor} onClose={() => setSummariesFor(null)} />}

        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { if (!deleting) setDeleteTarget(null) }} />
            <div className="relative w-[360px] bg-bg-elevated border border-border-default rounded-2xl p-5 shadow-2xl space-y-3 animate-in fade-in zoom-in-95 duration-150">
              <h2 className="text-base font-medium text-text-primary">Удалить сессию?</h2>
              <p className="text-[13.5px] text-text-primary truncate" title={deleteTarget.title}>«{deleteTarget.title || 'Без названия'}»</p>
              <p className="text-[13px] text-text-muted leading-relaxed">
                Переписка уедет в корзину Windows — оттуда её можно вернуть.
                {(Object.values(chatSessions).includes(deleteTarget.id) || Object.keys(spawnedSessions).some(tid => (termToSession[tid] ?? tid) === deleteTarget.id)) && ' Запущенный процесс будет остановлен.'}
              </p>
              {deleteError && <p className="text-[13px] text-[var(--color-error)]">Не удалось: {deleteError}</p>}
              <div className="flex gap-2 justify-end pt-1">
                <button autoFocus disabled={deleting} onClick={() => setDeleteTarget(null)} className="text-sm px-3 py-1.5 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-40">
                  Отмена
                </button>
                <button onClick={confirmDelete} disabled={deleting} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg text-red-400 bg-red-400/10 hover:bg-red-400/20 transition-colors">
                  {deleting && <span className="w-3.5 h-3.5 rounded-full border-2 border-red-400/30 border-t-red-400 animate-spin" />}
                  {deleting ? 'Удаляю…' : 'Удалить'}
                </button>
              </div>
            </div>
          </div>
        )}

        {killSessionModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setKillSessionModal(false)} />
            <div className="relative w-80 bg-bg-surface border border-border-default rounded-2xl p-5 shadow-2xl space-y-4">
              <h2 className="text-base font-semibold text-text-primary">Закрыть сессию?</h2>
              <p className="text-sm text-text-secondary">Процесс claude будет убит. Сама сессия никуда не денется — её можно будет открыть снова.</p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setKillSessionModal(false)} className="text-sm px-3 py-1.5 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors">
                  Отмена
                </button>
                <button
                  onClick={() => {
                    setKillSessionModal(false)
                    if (isChatActive) {
                      stopChat(activeSessionId ?? chatSessions['__new__'])
                      return
                    }
                    const termId = Object.keys(spawnedSessions).find(tid => {
                      const resolved = termToSession[tid] ?? (tid === '__new__' ? null : tid)
                      return activeSessionId ? resolved === activeSessionId : tid === '__new__'
                    }) ?? (activeSessionId ?? '__new__')
                    api.ptyKill(termId)
                    setSpawnedSessions(prev => { const next = { ...prev }; delete next[termId]; return next })
                    setTermToSession(prev => { const next = { ...prev }; delete next[termId]; return next })
                    setSpawnTrigger(0)
                  }}
                  className="text-sm px-3 py-1.5 rounded-lg text-red-400 bg-red-400/10 hover:bg-red-400/20 transition-colors"
                >
                  Завершить
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PTY terminal — main session UI, всегда в DOM чтобы не убивать процессы при смене вкладок */}
        <div
          className="flex-1 min-h-0 flex flex-col overflow-hidden relative"
          style={{ background: 'var(--bg-base)', display: section === 'sessions' ? 'flex' : 'none' }}
        >
            <div className="flex-1 min-h-0 pt-[4px] relative" style={{ background: '#0a0a0a' }}>
              {/* Render all spawned sessions, show only active */}
              {Object.keys(spawnedSessions).map(termId => {
                const resolvedId = termToSession[termId] ?? (termId === '__new__' ? null : termId)
                const sid = resolvedId
                const sess = sessions.find(s => s.id === resolvedId)
                // termId активен если его resolvedId совпадает с activeSessionId,
                // ИЛИ если activeSessionId=null и это __new__
                const isActive = activeSessionId
                  ? resolvedId === activeSessionId
                  : termId === '__new__'
                // Для терминала, который стартует прямо сейчас, источник правды —
                // sessionConfig (то, что выбрано в селекторах на экране Start).
                // localStorage отстаёт: saveSessionConfig и setSpawnedSessions
                // происходят в одном тике, а у новой сессии (sid === null) записи
                // там нет вовсе — раньше в спавн уходили голые дефолты.
                const cfg = isActive ? sessionConfig : loadSessionConfig(sid)
                return (
                  <PtyTerminalView
                    key={termId}
                    termId={termId}
                    sessionId={sid}
                    projectPath={sess?.projectPath ?? null}
                    configDir={accounts.find(a => a.id === activeAccountId)?.configDir ?? null}
                    visible={isActive}
                    spawnTrigger={spawnedSessions[termId] ?? 0}
                    model={cfg.model}
                    effort={cfg.effort}
                    permissionMode={cfg.permissionMode}
                  />
                )
              })}
              {/* Чат-сессии: как и терминалы, живут в DOM все — поток не теряется
                  при переключении. Ключ — реальный id, а не '__new__': иначе
                  при переезде нового чата под свой id лента пересоздастся */}
              {Object.entries(chatSessions).map(([key, sid]) => {
                const sess = sessions.find(s => s.id === sid)
                const visible = activeSessionId ? sid === activeSessionId : key === '__new__'
                return (
                  <div key={sid} className="absolute inset-0" style={{ display: visible ? 'flex' : 'none' }}>
                    <ChatView
                      sessionId={sid}
                      jsonlPath={sess ? `${sess.projectPath}\\${sess.id}.jsonl` : null}
                      alive
                      visible={visible && section === 'sessions'}
                      effort={key === '__new__' ? sessionConfig.effort : loadSessionConfig(sid).effort}
                    />
                  </div>
                )
              })}
            </div>

            <AnimatePresence>
              {!isPtySpawned && !isChatActive && (startPhase === 'idle' || startPhase === 'confetti' || startPhase === 'fadeout') && (
                <motion.div
                  key="welcome"
                  className="absolute inset-0"
                  initial={{ opacity: 1 }}
                  animate={{ opacity: startPhase === 'fadeout' ? 0 : 1 }}
                  transition={{ duration: 0.5 }}
                >
                  <SessionWelcome
                    sessionTitle={activeSession?.title}
                    isNew={!activeSessionId}
                    jsonlPath={activeSession ? `${activeSession.projectPath}\\${activeSession.id}.jsonl` : null}
                    messageCount={activeSession?.messageCount}
                    lastModified={activeSession?.lastModified}
                    config={sessionConfig}
                    onChange={setSessionConfig}
                    onSettings={() => setSection('settings')}
                    onImport={async () => {
                      const configDir = accounts.find(a => a.id === activeAccountId)?.configDir
                      if (!configDir) return
                      const result = await api.importSessions(configDir)
                      if (!result.ok || result.imported.length === 0) return
                      // Обновляем список — импортированные сессии появятся с анимацией
                      await refreshSessions()
                      // Помечаем последнюю импортированную как новую для анимации
                      const lastId = result.imported[result.imported.length - 1]
                      setNewSessionId(lastId)
                      setActiveSessionId(lastId)
                      setTimeout(() => setNewSessionId(null), 4000)
                    }}
                    onStart={(btnRect) => {
                      if (activeSessionId) saveSessionConfig(activeSessionId, sessionConfig)
                      const key = activeSessionId ?? '__new__'
                      const doSpawn = viewMode === 'chat'
                        ? () => { startChat(key, activeSessionId, activeConfigDir, sessionConfig) }
                        : () => {
                          setSpawnedSessions(prev => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }))
                          if (activeSessionId) setTermToSession(prev => ({ ...prev, [key]: activeSessionId }))
                          setSpawnTrigger(t => t + 1)
                        }
                      if (!activeSessionId) {
                        setConfettiOrigin(btnRect)
                        setPendingStart(() => doSpawn)
                        setStartPhase('confetti')
                      } else {
                        setStartPhase('fadeout')
                        setTimeout(() => { doSpawn(); setStartPhase('idle') }, 500)
                      }
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {(startPhase === 'confetti' || startPhase === 'fadeout') && (
              <ConfettiCanvas
                active={startPhase === 'confetti'}
                originRect={confettiOrigin}
                onDone={() => {
                  setStartPhase('fadeout')
                  setTimeout(() => {
                    pendingStart?.()
                    setPendingStart(null)
                    setStartPhase('idle')
                  }, 500)
                }}
              />
            )}

            {startPhase === 'fadeout' && (
              <motion.div
                className="absolute inset-0"
                style={{ background: '#0a0a0a' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5 }}
              />
            )}
        </div>

        {/* Dev Panel */}
        {section === 'dev' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <DevPanel />
          </div>
        )}
        {/* Registered panels (Pyre, Memory) */}
        {panels.map(panel => (
          <div
            key={panel.id}
            className="no-drag"
            style={{
              flex: 1,
              overflow: 'hidden',
              display: section === panel.id ? 'flex' : 'none',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <PanelErrorBoundary id={panel.id}>
              {panel.render()}
            </PanelErrorBoundary>
          </div>
        ))}

        {/* Accounts — раздел, а не оверлей */}
        {section === 'accounts' && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <AccountsPage
              accounts={accounts}
              activeAccountId={activeAccountId || ''}
              isRunning={isRunning}
              onBack={() => setSection('sessions')}
              onAccountsChange={refreshAccounts}
              onSwitchAccount={async id => { await switchAccount(id); setSection('sessions') }}
            />
          </div>
        )}

        {/* Settings — раздел, а не оверлей */}
        {section === 'settings' && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <SettingsPage onBack={() => setSection('sessions')} />
          </div>
        )}
      </div>

      {/* Account switch modal */}
      {switchTarget && (() => {
        const from = accounts.find(a => a.id === activeAccountId)
        const to = accounts.find(a => a.id === switchTarget)
        if (!from || !to) return null
        return (
          <AccountSwitchModal
            from={from}
            to={to}
            onConfirm={async () => { await switchAccount(switchTarget) }}
            onCancel={() => setSwitchTarget(null)}
          />
        )
      })()}

    </div>
  )
}

/** «⋯» в шапке сессии: редкие действия, чтобы не висели текстом рядом с названием */
function SessionMenu({ sessionId, canKill, onKill }: { sessionId: string | null; canKill: boolean; onKill: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  if (!sessionId && !canKill) return null
  return (
    <div ref={ref} className="relative no-drag shrink-0 ml-1">
      <button
        onClick={() => setOpen(v => !v)}
        title="Действия с сессией"
        className={cn('w-7 h-7 rounded-md flex items-center justify-center transition-colors', open ? 'text-text-primary bg-surface-hover' : 'text-text-faint hover:text-text-secondary hover:bg-surface-hover')}
      >
        <Ellipsis size={16} />
      </button>
      {open && (
        <div className="header-menu">
          {sessionId && (
            <button onClick={() => { navigator.clipboard.writeText(sessionId).catch(() => {}); setOpen(false) }}>
              <Copy size={14} />Скопировать ID сессии
            </button>
          )}
          {canKill && (
            <button className="is-danger" onClick={() => { setOpen(false); onKill() }}>
              <StopCircle size={14} />Завершить процесс
            </button>
          )}
        </div>
      )}
    </div>
  )
}
