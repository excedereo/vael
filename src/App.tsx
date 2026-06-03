import { useCallback, useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { useAppState } from './hooks/useAppState.js'
import { useSession } from './hooks/useSession.js'
import { useNavHistory } from './hooks/useNavHistory.js'
import { Sidebar } from './components/Sidebar.js'
import { ChatView } from './components/ChatView.js'
import { InputBar, InputBarHandle, ModelId, EffortLevel, PermissionMode, CommandName, getMaxEffort } from './components/InputBar.js'
import { StatusBar } from './components/StatusBar.js'
import { AccountBar } from './components/AccountBar.js'
import { AccountsPage } from './components/AccountsPage.js'
import { SettingsPage, DEFAULT_CONTENT_PADDING } from './components/SettingsPage.js'
import { AccountSwitchModal } from './components/AccountSwitchModal.js'
import { FirstLaunch } from './components/FirstLaunch.js'
import { ErrorToast } from './components/ErrorToast.js'
import { ConsoleView } from './components/ConsoleView.js'
import { MemoryPage } from './components/MemoryPage.js'
import { NavControls } from './components/NavControls.js'
import { WindowControls } from './components/WindowControls.js'
import { UpdateBanner, UpdateState } from './components/UpdateBanner.js'
import { PyrePage } from './components/PyrePage.js'
import { api } from './lib/api.js'
import { Session } from './types/index'
import { restoreSavedTheme } from './lib/theme.js'
import { cn } from './lib/utils.js'

export default function App() {
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
    setIsRunning,
    accountsLoaded,
    switchAccount,
    refreshSessions,
    refreshAccounts,
  } = useAppState()

  const [activeModel, setActiveModel] = useState<ModelId>('claude-sonnet-4-6')
  const [activeEffort, setActiveEffort] = useState<EffortLevel>('medium')
  const [activePermission, setActivePermission] = useState<PermissionMode>('bypassPermissions')
  const [page, setPage] = useState<'chat' | 'accounts' | 'settings' | 'memory'>('chat')
  const [sidebarTab, setSidebarTab] = useState<'sessions' | 'pyre' | 'console' | 'memory'>('sessions')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [modules, setModules] = useState<{ id: string; name: string; icon?: string; running: boolean }[]>([])
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null)
  const { push: navPush, goBack, goForward, canGoBack, canGoForward } = useNavHistory()
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)
  const handleUpdateClick = useCallback(() => {
    if (!updateState) return
    if (updateState.status === 'available' || updateState.status === 'error') {
      setUpdateState({ status: 'downloading', progress: 0 })
      api.updateDownload().catch((e) => setUpdateState({ status: 'error', message: e.message }))
    } else if (updateState.status === 'ready') {
      api.updateInstall()
    }
  }, [updateState])

  useEffect(() => {
    api.modulesList().then(list => {
      setModules(list)
      if (list.length > 0) setActiveModuleId(list[0].id)
    })
  }, [])

  useEffect(() => {
    const u1 = api.onUpdateAvailable(v => setUpdateState({ status: 'available', version: v }))
    const u2 = api.onUpdateProgress(p => setUpdateState({ status: 'downloading', progress: p }))
    const u3 = api.onUpdateReady(() => setUpdateState({ status: 'ready' }))
    const u4 = api.onUpdateError(msg => setUpdateState({ status: 'error', message: msg }))
    return () => { u1(); u2(); u3(); u4() }
  }, [])

  const [devConsole, setDevConsole] = useState(() => {
    try { return JSON.parse(localStorage.getItem('vaeliDevConsole') ?? 'false') } catch { return false }
  })

  // Global console log buffer — always collecting regardless of active tab
  const [consoleLogs, setConsoleLogs] = useState<{ level: string; text: string; ts: number; id: number }[]>([])
  const consoleIdRef = useRef(0)
  useEffect(() => {
    api.consoleFlush()
    const unsub = api.onConsoleLog((entry) => {
      setConsoleLogs(prev => [...prev.slice(-500), { ...entry, id: consoleIdRef.current++ }])
    })
    return unsub
  }, [])

  // Capture renderer-side errors into ConsoleView
  useEffect(() => {
    const addLog = (level: string, text: string) =>
      setConsoleLogs(prev => [...prev.slice(-500), { level, text, ts: Date.now(), id: consoleIdRef.current++ }])

    const onError = (e: ErrorEvent) => {
      addLog('error', `${e.message}${e.filename ? ` (${e.filename}:${e.lineno})` : ''}`)
    }
    const onUnhandled = (e: PromiseRejectionEvent) => {
      const msg = e.reason instanceof Error ? e.reason.stack || e.reason.message : String(e.reason)
      addLog('error', `Unhandled rejection: ${msg}`)
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandled)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandled)
    }
  }, [])

  useEffect(() => {
    const h = () => {
      try { setDevConsole(JSON.parse(localStorage.getItem('vaeliDevConsole') ?? 'false')) } catch { setDevConsole(false) }
    }
    window.addEventListener('vaeli:devConsoleChanged', h)
    return () => window.removeEventListener('vaeli:devConsoleChanged', h)
  }, [])

  // Apply saved theme on startup — reads vars directly from localStorage, no IPC
  useEffect(() => { restoreSavedTheme() }, [])

  // Temp cleanup banner state
  const [tempCleanupBanner, setTempCleanupBanner] = useState<{ autoDelete: string; cancelled: boolean } | null>(null)
  const [tempCleanupCountdown, setTempCleanupCountdown] = useState(0)

  useEffect(() => {
    const unsubStart = api.onTempCleanupStart((autoDelete) => {
      setTempCleanupBanner({ autoDelete, cancelled: false })
      setTempCleanupCountdown(4)
      const iv = setInterval(() => setTempCleanupCountdown(c => {
        if (c <= 1) { clearInterval(iv); return 0 }
        return c - 1
      }), 1000)
    })
    const unsubDone = api.onTempCleanupDone((_count) => {
      setTempCleanupBanner(null)
      setTempCleanupCountdown(0)
    })
    const unsubCancelled = api.onTempCleanupCancelled(() => {
      setTempCleanupBanner(null)
      setTempCleanupCountdown(0)
    })
    return () => { unsubStart(); unsubDone(); unsubCancelled() }
  }, [])

  // Load defaults from claude settings on startup
  useEffect(() => {
    api.getSettings().then(s => {
      const settings = s as { effortLevel?: string; defaultPermissionMode?: string }
      if (settings.effortLevel) setActiveEffort(settings.effortLevel as EffortLevel)
      const pm = settings.defaultPermissionMode
      if (pm === 'plan' || pm === 'bypassPermissions') setActivePermission(pm)
    })
  }, [])
  const [deps, setDeps] = useState<{ npm: string | null; claude: string | null; ready: boolean } | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installLog, setInstallLog] = useState<string | null>(null)

  useEffect(() => {
    api.checkDeps().then(setDeps)
  }, [])

  const handleInstallClaude = useCallback(async () => {
    setInstalling(true)
    setInstallLog(null)
    const result = await api.installClaude()
    setInstalling(false)
    if (result.ok) {
      // Re-check after install
      const newDeps = await api.checkDeps()
      setDeps(newDeps)
    } else {
      setInstallLog(result.log || 'Неизвестная ошибка')
    }
  }, [])

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

  const [chatAtBottom, setChatAtBottom] = useState(true)
  const [scrollTrigger, setScrollTrigger] = useState(0)
  const [contentPadding, setContentPadding] = useState<number>(() => {
    try { const s = localStorage.getItem('vaeliUISettings'); return s ? (JSON.parse(s).contentPadding ?? DEFAULT_CONTENT_PADDING) : DEFAULT_CONTENT_PADDING } catch { return DEFAULT_CONTENT_PADDING }
  })
  useEffect(() => {
    const h = () => {
      try { const s = localStorage.getItem('vaeliUISettings'); setContentPadding(s ? (JSON.parse(s).contentPadding ?? DEFAULT_CONTENT_PADDING) : DEFAULT_CONTENT_PADDING) } catch {}
    }
    window.addEventListener('vaeli:uiSettingsChanged', h)
    return () => window.removeEventListener('vaeli:uiSettingsChanged', h)
  }, [])
  const inputBarRef = useRef<InputBarHandle>(null)
  const mainAreaRef = useRef<HTMLDivElement>(null)
  const [dragOver, setDragOver] = useState(false)

  // Native drag listeners on document with capture — fires before Electron's internal handler
  useEffect(() => {
    const mainEl = mainAreaRef.current

    const onDragOver = (e: DragEvent) => { e.preventDefault() }

    const onDragEnter = (e: DragEvent) => {
      e.preventDefault()
      // Show overlay when entering mainEl itself or any child, from outside mainEl
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
      // Hide overlay only when leaving mainEl entirely
      if (mainEl.contains(from) && !mainEl.contains(to)) {
        setDragOver(false)
      }
    }

    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      if (mainEl?.contains(e.target as Node) && e.dataTransfer?.files.length) {
        inputBarRef.current?.addFiles(e.dataTransfer.files)
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

  // After first account created — make sure we're on chat page
  useEffect(() => {
    if (accountsLoaded && accounts.length > 0 && page === 'accounts') {
      // Don't auto-redirect if user intentionally opened accounts page
    }
  }, [accountsLoaded, accounts.length])
  const activeSession = sessions.find(s => s.id === activeSessionId) || null
  const { entries, liveEntries, isStreaming, isThinking, isCompacting, liveTool, appendUserMessage, error, clearError, streamStats, ptyTokens, ptyTokensDelta, reloadEntries } = useSession(activeSession)

  useEffect(() => {
    const unsub = api.onSessionReload((sessionId) => {
      refreshSessions()
      if (sessionId === activeSessionId) reloadEntries()
    })
    return unsub
  }, [activeSessionId, reloadEntries, refreshSessions])

  useEffect(() => {
    const unsub = api.onSessionCreated((sessionId) => {
      refreshSessions()
      setActiveSessionId(sessionId)
      api.selectSession(sessionId)
    })
    return unsub
  }, [refreshSessions, setActiveSessionId])

  const handleSelectSession = useCallback((session: Session) => {
    setActiveSessionId(session.id)
    api.selectSession(session.id)
    navPush({ sessionId: session.id, tab: sidebarTab })
  }, [setActiveSessionId, sidebarTab, navPush])

  const handleTabChange = useCallback((tab: 'sessions' | 'pyre' | 'console' | 'memory') => {
    setSidebarTab(tab)
    navPush({ sessionId: activeSessionId, tab })
  }, [activeSessionId, navPush])

  const handleGoBack = useCallback(() => {
    goBack(({ sessionId, tab }) => {
      setSidebarTab(tab)
      setActiveSessionId(sessionId)
      if (sessionId) api.selectSession(sessionId)
    })
  }, [goBack, setSidebarTab, setActiveSessionId])

  const handleGoForward = useCallback(() => {
    goForward(({ sessionId, tab }) => {
      setSidebarTab(tab)
      setActiveSessionId(sessionId)
      if (sessionId) api.selectSession(sessionId)
    })
  }, [goForward, setSidebarTab, setActiveSessionId])

  const handleNewSession = useCallback(() => {
    setActiveSessionId(null)
  }, [setActiveSessionId])

  const handleSend = useCallback(async (text: string) => {
    if (!activeAccountId) return

    appendUserMessage(text)
    setIsRunning(true)

    const effort = getMaxEffort(activeModel) ? activeEffort : null

    if (activeSessionId) {
      await api.sendMessage(activeSessionId, text, activeAccountId, activeModel, effort, activePermission)
    } else {
      await api.newSession(text, activeAccountId, activeModel, effort, activePermission)

      // capture session_id from system init event
      const unsubInit = api.onStreamEvent((event) => {
        if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
          setActiveSessionId(event.session_id)
          refreshSessions()
          unsubInit()
        }
      })
    }

    const unsubDone = api.onStreamDone(async () => {
      setIsRunning(false)
      refreshSessions()
      unsubDone()
    })
  }, [activeAccountId, activeSessionId, activeModel, activeEffort, activePermission, appendUserMessage, refreshSessions, setActiveSessionId, setIsRunning])

  const handleAbort = useCallback(() => {
    api.abortRun()
    setIsRunning(false)
  }, [setIsRunning])

  const handleCommand = useCallback((name: CommandName, fullText: string) => {
    if (!activeSessionId && (name === 'compact' || name === 'context')) return
    api.sessionCommand(fullText)
  }, [activeSessionId])


  const handleDeleteSession = useCallback(async (session: import('./types/index').Session) => {
    const sessionPath = `${session.projectPath}\\${session.id}.jsonl`
    await api.deleteSession(sessionPath)
    if (activeSessionId === session.id) setActiveSessionId(null)
    refreshSessions()
  }, [activeSessionId, setActiveSessionId, refreshSessions])

  if (accountsLoaded && accounts.length === 0) {
    return <FirstLaunch onCreated={refreshAccounts} />
  }

  if (deps !== null && !deps.ready) {
    return (
      <div className="flex h-screen bg-bg-base text-white items-center justify-center">
        <div className="flex flex-col items-center gap-5 max-w-sm text-center px-6">
          <div className="w-12 h-12 rounded-2xl bg-bg-elevated border border-border-default flex items-center justify-center text-2xl">
            ⚡
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[15px] text-text-primary font-medium">Нужен Claude Code</span>
            <span className="text-[14px] text-text-muted leading-relaxed">
              {installing
                ? 'Устанавливаем Claude Code, подожди немного…'
                : 'Vael не может работать без Claude Code. Можем установить автоматически.'}
            </span>
          </div>

          {/* Dependency status */}
          {!installing && (
            <div className="w-full flex flex-col gap-1.5">
              {[
                { label: 'npm', value: deps.npm },
                { label: 'claude', value: deps.claude },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between px-3 py-2 bg-bg-elevated rounded-xl border border-border-default">
                  <span className="text-[13px] text-text-muted font-mono">{label}</span>
                  <span className={cn('text-[13px] font-mono', value ? 'text-emerald-400' : 'text-red-400')}>
                    {value ?? 'не найден'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Install log on error */}
          {installLog && (
            <div className="w-full px-3 py-2 bg-bg-elevated rounded-xl border border-border-default text-left">
              <span className="text-[12px] text-red-400 font-mono whitespace-pre-wrap break-all">{installLog}</span>
            </div>
          )}

          {installing ? (
            <div className="flex items-center gap-2 text-[14px] text-text-muted">
              <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Установка…
            </div>
          ) : (
            <div className="flex flex-col gap-2 w-full">
              <button
                onClick={handleInstallClaude}
                className="w-full py-2.5 rounded-xl bg-accent text-white text-[14px] font-medium hover:bg-accent/90 transition-colors"
              >
                Установить автоматически
              </button>
              <button
                onClick={() => api.openExternal('https://docs.anthropic.com/en/docs/claude-code/setup')}
                className="w-full py-2.5 rounded-xl border border-border-default text-[14px] text-text-muted hover:text-text-primary hover:border-border-strong transition-colors"
              >
                Открыть документацию
              </button>
              <button
                onClick={() => api.checkDeps().then(setDeps)}
                className="text-[13px] text-text-ghost hover:text-text-faint transition-colors"
              >
                Проверить снова
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-bg-base text-white overflow-hidden">
      <ErrorToast message={error} onClose={clearError} />
      {/* Temp cleanup banner */}
      {tempCleanupBanner && (
        <div className="fixed top-10 left-1/2 -translate-x-1/2 z-[300] animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-bg-elevated border border-border-default shadow-2xl shadow-black/60 text-[14px]">
            <span className="text-text-secondary">Очистка temp папки…</span>
            <span className="text-text-faint">{tempCleanupCountdown}с</span>
            <button
              onClick={() => api.tempCancelCleanup()}
              className="text-text-muted hover:text-text-primary transition-colors border border-border-default rounded-lg px-2.5 py-1 text-[13px]"
            >
              Отмена
            </button>
          </div>
        </div>
      )}
      <StatusBar syncStatus={syncStatus} syncMessage={syncMessage} />

      {/* NavControls overlay — hidden when overlay pages are open */}
      <div className={cn("fixed top-0 left-0 z-50 h-10 flex items-center px-2 gap-0.5 no-drag", page !== 'chat' && "hidden")}>
        <NavControls
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onBack={handleGoBack}
          onForward={handleGoForward}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(v => !v)}
        />
      </div>

      {/* Sidebar */}
      <div
        className={cn(
          'shrink-0 border-r border-border-subtle flex flex-col bg-bg-sidebar transition-[width] duration-200 ease-out overflow-hidden',
          sidebarCollapsed ? 'w-0' : 'w-72',
        )}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation() }}
      >
        <div className="h-10 shrink-0" />
        <div className="flex-1 min-h-0">
          <Sidebar
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelect={handleSelectSession}
            onNew={handleNewSession}
            onDelete={handleDeleteSession}
            isLocked={isLocked}
            activeTab={sidebarTab}
            onTabChange={handleTabChange}
            devConsole={devConsole}
            memoryTokens={memoryTokens}
            modules={modules}
            activeModuleId={activeModuleId}
            onSelectModule={setActiveModuleId}
          />
        </div>
        {updateState && <UpdateBanner state={updateState} onClick={handleUpdateClick} onDismiss={() => setUpdateState(null)} />}
        <AccountBar
          accounts={accounts}
          activeAccountId={activeAccountId || ''}
          onSwitch={(id) => setSwitchTarget(id)}
          onManage={() => setPage('accounts')}
          onSettings={() => setPage('settings')}
        />
      </div>

      {/* Main */}
      <div ref={mainAreaRef} className="flex-1 flex flex-col min-w-0 relative">
        <AnimatePresence>
          {dragOver && sidebarTab === 'sessions' && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-bg-base/80 backdrop-blur-sm border-2 border-dashed border-accent/40 rounded-none pointer-events-none"
            >
              <span className="text-[15px] text-text-secondary">Перетащите файлы сюда</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="h-10 shrink-0 border-b border-border-subtle flex items-center">
          {/* Drag region fills the header, starts after NavControls width */}
          <div
            className="app-drag-region flex items-center flex-1 min-w-0 h-full px-5"
            style={{ marginLeft: sidebarCollapsed ? '9rem' : 0 }}
          >
            {activeSession && (
              <span className="text-sm text-text-faint truncate">{activeSession.title || activeSession.id}</span>
            )}
          </div>
          <WindowControls />
        </div>

        {/* ChatView always mounted to preserve stream state */}
        <div className={cn('flex-1 flex flex-col min-h-0 overflow-hidden relative', sidebarTab !== 'sessions' && 'hidden')}>
          <ChatView
            session={activeSession}
            entries={entries}
            liveEntries={liveEntries}
            isStreaming={isStreaming}
            isThinking={isThinking}
            isCompacting={isCompacting}
            contentPadding={contentPadding}
            liveTool={liveTool}
            streamStats={streamStats}
            onScrollStateChange={atBottom => setChatAtBottom(atBottom)}
            scrollTrigger={scrollTrigger}
          />
          <AnimatePresence>
            {!chatAtBottom && (
              <motion.button
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.15 }}
                onClick={() => setScrollTrigger(v => v + 1)}
                className="absolute bottom-3 left-1/2 -translate-x-1/2 w-7 h-7 rounded-lg bg-bg-elevated border border-border-default flex items-center justify-center text-text-muted hover:text-text-primary hover:border-border-strong transition-colors shadow-lg z-10"
              >
                <ChevronDown size={14} strokeWidth={2} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Console */}
        {sidebarTab === 'console' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <ConsoleView logs={consoleLogs} onClear={() => setConsoleLogs([])} />
          </div>
        )}
        {/* Pyre */}
        {sidebarTab === 'pyre' && (
          <PyrePage sessions={sessions} activeModuleId={activeModuleId} onModulesChange={setModules} />
        )}
        {/* Memory — always mounted to preserve state */}
        <div className="no-drag" style={{ flex: 1, overflow: 'hidden', display: sidebarTab === 'memory' ? 'flex' : 'none', flexDirection: 'column', minHeight: 0 }}>
          <MemoryPage onBack={() => setSidebarTab('sessions')} />
        </div>

        {sidebarTab === 'sessions' && (
          <div>
          <div style={{ height: 24, background: 'linear-gradient(to bottom, transparent, var(--bg-base))', marginTop: -24, pointerEvents: 'none', position: 'relative', zIndex: 1 }} />
          <div style={{ paddingLeft: contentPadding, paddingRight: contentPadding }}>
          {ptyTokens !== null && (
            <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
              <span className="text-[11px] font-mono text-text-faint tabular-nums">
                {ptyTokens.toLocaleString()} ctx
              </span>
              {ptyTokensDelta !== null && ptyTokensDelta > 0 && (
                <span className="text-[11px] font-mono text-emerald-400/70 tabular-nums">
                  +{ptyTokensDelta.toLocaleString()}
                </span>
              )}
            </div>
          )}
          <InputBar
            ref={inputBarRef}
            activeModel={activeModel}
            onModelChange={setActiveModel}
            activeEffort={activeEffort}
            onEffortChange={setActiveEffort}
            activePermission={activePermission}
            onPermissionChange={setActivePermission}
            onSend={handleSend}
            onAbort={handleAbort}
            onKillPty={() => api.ptySessionKill(activeSessionId ?? undefined)}
            onCommand={handleCommand}
            isLocked={isLocked}
            isRunning={isRunning}
            hasSession={!!activeSessionId}
            sessionId={activeSessionId}
          />
          </div>
          </div>
        )}
      </div>

      {/* Full-screen overlays */}
      {page === 'accounts' && (
        <div className="fixed inset-0 z-40 bg-bg-base">
          <AccountsPage
            accounts={accounts}
            activeAccountId={activeAccountId || ''}
            onBack={() => setPage('chat')}
            onAccountsChange={refreshAccounts}
            onSwitchAccount={async id => { await switchAccount(id); setPage('chat') }}
          />
        </div>
      )}
      {page === 'settings' && (
        <div className="fixed inset-0 z-40 bg-bg-base">
          <SettingsPage onBack={() => setPage('chat')} />
        </div>
      )}
      {page === 'memory' && (
        <div className="fixed inset-0 z-40 bg-bg-base">
          <MemoryPage onBack={() => setPage('chat')} />
        </div>
      )}
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
