import { useCallback, useRef, useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { useSessionNew } from '../hooks/useSessionNew.js'
import { ChatViewNew } from './ChatViewNew.js'
import { InputBar, InputBarHandle, ModelId, EffortLevel, PermissionMode, CommandName, getMaxEffort } from './InputBar.js'
import { Session } from '../types/index'
import { api } from '../lib/api.js'

interface Props {
  session: Session | null
  visible: boolean
  contentPadding: number
  isLocked: boolean
  isRunning: boolean
  activeAccountId: string | null
  addRunning: (key: string) => void
  removeRunning: (key: string) => void
  replaceRunning: (oldKey: string, newKey: string) => void
  refreshSessions: () => void
  setActiveSessionId: (id: string | null) => void
  onScrollStateChange: (atBottom: boolean) => void
  scrollTrigger: number
  onSessionState: (state: SessionPaneState) => void
}

export interface SessionPaneState {
  ptyTokens: number | null
  ptyTokensDelta: number | null
  isStreaming: boolean
  isThinking: boolean
  ptyAlive: boolean
  ptyStarting: boolean
}

export function SessionPane({
  session,
  visible,
  contentPadding,
  isLocked,
  isRunning,
  activeAccountId,
  addRunning,
  removeRunning,
  replaceRunning,
  refreshSessions,
  setActiveSessionId,
  onScrollStateChange,
  scrollTrigger,
  onSessionState,
}: Props) {
  const {
    entries, liveEntries, status, activeTool, tokens, seconds,
    appendOptimistic: appendUserMessage, reload: reloadEntries,
  } = useSessionNew(session)

  const ptyTokens = tokens
  const ptyTokensDelta = null

  const [activeModel, setActiveModel] = useState<ModelId>('claude-sonnet-4-6')
  const [activeEffort, setActiveEffort] = useState<EffortLevel>('medium')
  const [activePermission, setActivePermission] = useState<PermissionMode>('bypassPermissions')
  const [ptyAlive, setPtyAlive] = useState(false)
  const [ptyStarting, setPtyStarting] = useState(false)
  const [killModal, setKillModal] = useState(false)
  const [chatAtBottom, setChatAtBottom] = useState(true)
  const [localScrollTrigger, setLocalScrollTrigger] = useState(0)
  const inputBarRef = useRef<InputBarHandle>(null)

  // Load defaults from claude settings once
  useEffect(() => {
    api.getSettings().then(s => {
      const settings = s as { effortLevel?: string; defaultPermissionMode?: string }
      if (settings.effortLevel) setActiveEffort(settings.effortLevel as EffortLevel)
      const pm = settings.defaultPermissionMode
      if (pm === 'plan' || pm === 'bypassPermissions') setActivePermission(pm)
    })
  }, [])

  // Poll PTY alive
  useEffect(() => {
    if (!session?.id) { setPtyAlive(false); setPtyStarting(false); return }
    let cancelled = false
    const poll = async () => {
      if (cancelled) return
      try {
        const { alive } = await api.ptySessionAlive(session.id)
        if (!cancelled) {
          setPtyAlive(alive)
          setPtyStarting(isRunning && !alive)
        }
      } catch {}
      if (!cancelled) setTimeout(poll, 1500)
    }
    poll()
    return () => { cancelled = true }
  }, [session?.id, isRunning])

  // Reload on session:reload
  useEffect(() => {
    const unsub = api.onSessionReload((sessionId) => {
      if (sessionId === session?.id) { refreshSessions(); reloadEntries() }
    })
    return unsub
  }, [session?.id, reloadEntries, refreshSessions])

  const isStreaming = status !== 'idle'
  const isThinking = status === 'thinking'

  // Expose state to parent
  useEffect(() => {
    onSessionState({ ptyTokens, ptyTokensDelta, isStreaming, isThinking, ptyAlive, ptyStarting })
  }, [ptyTokens, ptyTokensDelta, isStreaming, isThinking, ptyAlive, ptyStarting])

  const handleSend = useCallback(async (text: string) => {
    const sessionIdAtSend = session?.id ?? null
    const accountId = activeAccountId
    if (!accountId) return

    appendUserMessage(text)

    const effort = getMaxEffort(activeModel) ? activeEffort : null
    const sessionKey = sessionIdAtSend ?? '__pending__'
    addRunning(sessionKey)

    if (sessionIdAtSend) {
      await api.sendMessage(sessionIdAtSend, text, accountId, activeModel, effort, activePermission)
    } else {
      await api.newSession(text, accountId, activeModel, effort, activePermission)
      const unsubInit = api.onStreamEvent((event) => {
        if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
          replaceRunning('__pending__', event.session_id)
          setActiveSessionId(event.session_id)
          refreshSessions()
          unsubInit()
        }
      })
    }

    const doneKey = sessionIdAtSend ?? '__pending__'
    const unsubDone = api.onStreamDone(async (_code, doneSessionId) => {
      console.log('[SessionPane] onStreamDone', { doneSessionId, doneKey, sessionIdAtSend, sessionId: session?.id })
      // Фильтруем чужие сессии: done должен совпадать с нашим ключом
      if (doneSessionId && doneSessionId !== doneKey && doneSessionId !== '__pending__') {
        console.log('[SessionPane] skipping done for foreign session')
        return
      }
      removeRunning(sessionIdAtSend ?? doneKey)
      refreshSessions()
      unsubDone()
    })
  }, [session?.id, activeModel, activeEffort, activePermission, appendUserMessage, addRunning, removeRunning, replaceRunning, refreshSessions, setActiveSessionId])

  const handleAbort = useCallback(() => {
    api.abortRun()
    if (session?.id) removeRunning(session.id)
    else removeRunning('__pending__')
  }, [session?.id, removeRunning])

  const handleCommand = useCallback((name: CommandName, fullText: string) => {
    if (!session?.id && (name === 'compact' || name === 'context')) return
    handleSend(fullText)
  }, [session?.id, handleSend])

  const combinedScrollTrigger = scrollTrigger + localScrollTrigger

  return (
    <div style={{ display: visible ? 'flex' : 'none', flexDirection: 'column', position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <ChatViewNew
        session={session}
        entries={entries}
        liveEntries={liveEntries}
        status={status}
        activeTool={activeTool}
        tokens={tokens}
        seconds={seconds}
        contentPadding={contentPadding}
        onScrollStateChange={atBottom => { setChatAtBottom(atBottom); onScrollStateChange(atBottom) }}
        scrollTrigger={combinedScrollTrigger}
      />
      <AnimatePresence>
        {!chatAtBottom && (
          <motion.button
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            onClick={() => setLocalScrollTrigger(v => v + 1)}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 w-7 h-7 rounded-lg bg-bg-elevated border border-border-default flex items-center justify-center text-text-muted hover:text-text-primary hover:border-border-strong transition-colors shadow-lg z-10"
          >
            <ChevronDown size={14} strokeWidth={2} />
          </motion.button>
        )}
      </AnimatePresence>

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
            ptyAlive={ptyAlive}
            ptyStarting={ptyStarting}
            onKillPtyRequest={() => setKillModal(true)}
            onCommand={handleCommand}
            isLocked={isLocked}
            isRunning={isRunning}
            hasSession={!!session?.id}
            sessionId={session?.id ?? null}
          />
        </div>
      </div>

      {killModal && visible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setKillModal(false)} />
          <div className="relative w-80 bg-bg-surface border border-border-default rounded-2xl p-5 shadow-2xl space-y-4">
            <h2 className="text-base font-semibold text-text-primary">Завершить сессию?</h2>
            <p className="text-sm text-text-secondary">PTY процесс будет остановлен. История сессии сохранится.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setKillModal(false)} className="text-sm px-3 py-1.5 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors">
                Отмена
              </button>
              <button
                onClick={async () => {
                  setKillModal(false)
                  await api.ptySessionKill(session?.id ?? undefined)
                  setPtyAlive(false)
                  setPtyStarting(false)
                }}
                className="text-sm px-3 py-1.5 rounded-lg text-red-400 bg-red-400/10 hover:bg-red-400/20 transition-colors"
              >
                Завершить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
