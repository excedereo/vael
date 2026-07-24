import { useCallback, useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, StopCircle } from 'lucide-react'
import { useAppState } from './hooks/useAppState.js'
import { useNavHistory } from './hooks/useNavHistory.js'
import { useUpdateManager } from './hooks/useUpdateManager.js'
import { useDependencies } from './hooks/useDependencies.js'
import { useConsoleCapture } from './hooks/useConsoleCapture.js'
import { useSettings } from './hooks/useSettings.js'
import { SessionProvider, useSessionContext } from './context/SessionContext.js'
import { panels } from './panels/index.js'
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
import { ErrorToast } from './components/ErrorToast.js'
import { DevPanel } from './components/DevPanel.js'
import { NavControls } from './components/NavControls.js'
import { PtyTerminalView } from './components/PtyTerminalView.js'
import { SessionToolbar } from './components/SessionToolbar.js'
import { SessionWelcome } from './components/SessionWelcome.js'
import { ConfettiCanvas } from './components/ConfettiCanvas.js'
import { WindowControls } from './components/WindowControls.js'
import { UpdateBanner } from './components/UpdateBanner.js'
import { api } from './lib/api.js'
import { Session } from './types/index'
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
  } = useAppState()

  const { uiSettings } = useSettings()
  const contentPadding = uiSettings.contentPadding

  const DEFAULT_CONFIG = { ...loadDefaultSessionConfig(), prompt: '' }

  const SESSION_MODEL_MIGRATION: Record<string, string> = {
    'sonnet': 'claude-sonnet-4-6',
    'opus':   'claude-opus-4-8',
    'haiku':  'claude-haiku-4-5-20251001',
    'fable':  'claude-fable-5',
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

  const { spawnedSessions, setSpawnedSessions, termToSession, setTermToSession, watchSession, unwatchSession } = useSessionContext()

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
  const [showMemory, setShowMemory] = useState(() => localStorage.getItem('vaeli:showMemory') === '1')
  useEffect(() => {
    const h = () => setShowMemory(localStorage.getItem('vaeli:showMemory') === '1')
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
      if (list.length > 0) setActiveModuleId(list[0].id)
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

  const handleDeleteSession = useCallback(async (session: import('./types/index').Session) => {
    const sessionPath = `${session.projectPath}\\${session.id}.jsonl`
    await api.deleteSession(sessionPath)
    if (activeSessionId === session.id) setActiveSessionId(null)
    refreshSessions()
  }, [activeSessionId, setActiveSessionId, refreshSessions])

  // Phase: no accounts
  if (accountsLoaded && accounts.length === 0) {
    return <FirstLaunch onCreated={refreshAccounts} />
  }

  // Phase: no deps
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
              <button onClick={handleInstallClaude} className="w-full py-2.5 rounded-xl bg-accent text-white text-[14px] font-medium hover:bg-accent/90 transition-colors">
                Установить автоматически
              </button>
              <button onClick={() => api.openExternal('https://docs.anthropic.com/en/docs/claude-code/setup')} className="w-full py-2.5 rounded-xl border border-border-default text-[14px] text-text-muted hover:text-text-primary hover:border-border-strong transition-colors">
                Открыть документацию
              </button>
              <button onClick={() => api.checkDeps().then(setDeps)} className="text-[13px] text-text-ghost hover:text-text-faint transition-colors">
                Проверить снова
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Phase: ready — main UI
  return (
    <div className="flex h-screen bg-bg-base text-white overflow-hidden">
      <ErrorToast message={null} onClose={() => {}} />
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
        <NavControls
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onBack={handleGoBack}
          onForward={handleGoForward}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(v => !v)}
        />
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
        className={cn('shrink-0 border-r border-border-subtle flex flex-col bg-bg-sidebar transition-[width] duration-200 ease-out overflow-hidden', sidebarCollapsed ? 'w-0' : 'w-[214px]')}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation() }}
      >
        <div className="h-10 shrink-0" />
        <div className="flex-1 min-h-0">
          <Sidebar
            section={section}
            sessions={sessions}
            activeSessionId={activeSessionId}
            newSessionId={newSessionId}
            runningSessionIds={Object.keys(spawnedSessions).map(tid => termToSession[tid] ?? (tid === '__new__' ? null : tid)).filter(Boolean) as string[]}
            onSelect={handleSelectSession}
            onNew={handleNewSession}
            onDelete={handleDeleteSession}
            isLocked={isLocked}
            memoryTokens={memoryTokens}
            modules={modules}
            activeModuleId={activeModuleId}
            onSelectModule={setActiveModuleId}
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

        <div className="h-10 shrink-0 border-b border-border-subtle flex items-center">
          <div
            className="app-drag-region flex items-center flex-1 min-w-0 h-full px-5 gap-2"
            style={{ marginLeft: sidebarCollapsed ? '9rem' : 0 }}
          >
            {section === 'sessions' && (() => {
              const isSpawned = Object.keys(spawnedSessions).some(tid => {
                const resolved = termToSession[tid] ?? (tid === '__new__' ? null : tid)
                return activeSessionId ? resolved === activeSessionId : tid === '__new__'
              })
              return isSpawned && (
                <button
                  onClick={() => setKillSessionModal(true)}
                  className="no-drag flex items-center gap-1.5 px-2 h-6 rounded-md transition-colors text-text-ghost hover:text-[var(--color-error)] hover:bg-surface-hover shrink-0 text-[12px]"
                  title="Завершить сессию"
                >
                  <StopCircle size={12} />
                  <span>Закрыть сессию</span>
                </button>
              )
            })()}
            {section === 'sessions' && activeSession && (
              <span className="text-sm text-text-faint truncate select-none pointer-events-none">
                {activeSession.title || activeSession.id}
              </span>
            )}
            {section !== 'sessions' && (
              <span className="text-sm text-text-secondary truncate select-none pointer-events-none capitalize">
                {section}
              </span>
            )}
          </div>
          <WindowControls />
        </div>

        {killSessionModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setKillSessionModal(false)} />
            <div className="relative w-80 bg-bg-surface border border-border-default rounded-2xl p-5 shadow-2xl space-y-4">
              <h2 className="text-base font-semibold text-text-primary">Закрыть сессию?</h2>
              <p className="text-sm text-text-secondary">PTY процесс будет убит. Сама сессия никуда не денется — её можно будет открыть снова.</p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setKillSessionModal(false)} className="text-sm px-3 py-1.5 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors">
                  Отмена
                </button>
                <button
                  onClick={() => {
                    setKillSessionModal(false)
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
                const cfg = loadSessionConfig(sid)
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
            </div>

            <AnimatePresence>
              {(() => {
                const isSpawned = Object.keys(spawnedSessions).some(tid => {
                  const resolved = termToSession[tid] ?? (tid === '__new__' ? null : tid)
                  return activeSessionId ? resolved === activeSessionId : tid === '__new__'
                })
                return !isSpawned
              })() && (startPhase === 'idle' || startPhase === 'confetti' || startPhase === 'fadeout') && (
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
                      const doSpawn = () => {
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
