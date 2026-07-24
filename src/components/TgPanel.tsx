import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api.js'
import { cn } from '../lib/utils.js'
import { Session } from '../types/index.js'

interface Props {
  sessions: Session[]
  onStatusChange?: () => void
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cn(
        'relative w-10 h-5 rounded-full transition-colors duration-200 flex-shrink-0',
        value ? 'bg-accent' : 'bg-surface-active',
      )}
    >
      <span className={cn(
        'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200',
        value ? 'translate-x-5' : 'translate-x-0',
      )} />
    </button>
  )
}

export function TgPanel({ sessions, onStatusChange }: Props) {
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [autostart, setAutostart] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [running, setRunning] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.tgGetSettings().then(s => {
      setBotToken(s.botToken)
      setChatId(s.chatId)
      setAutostart((s as typeof s & { autostart?: boolean }).autostart ?? false)
      setSessionId(s.sessionId ?? '')
      setLoading(false)
    })
    api.modulesList().then(list => {
      const tg = list.find(m => m.id === 'telegram')
      if (tg) setRunning(tg.running)
    })
  }, [])

  const save = useCallback(async () => {
    await api.tgSetSettings({ botToken, chatId, enabled: true, sessionId, autostart } as Parameters<typeof api.tgSetSettings>[0])
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }, [botToken, chatId, sessionId, autostart])

  const handleStartStop = useCallback(async () => {
    if (running) {
      await api.tgStop()
      setRunning(false)
    } else {
      await api.tgStart()
      setRunning(true)
    }
    onStatusChange?.()
  }, [running, onStatusChange])

  if (loading) return (
    <div className="flex-1 flex items-center justify-center text-text-ghost text-sm">
      Загрузка...
    </div>
  )

  const getLabel = (s: Session) => s.title || s.id.slice(0, 8)

  return (
    <div className="flex-1 flex flex-col gap-3 p-4 overflow-y-auto">

      {/* Статус + кнопка запуска */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleStartStop}
          className={cn(
            'flex-1 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 border',
            running
              ? 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20'
              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20',
          )}
        >
          {running ? 'Остановить' : 'Запустить'}
        </button>
        {running && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />}
      </div>

      {/* Автостарт */}
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-text-secondary">Автостарт при запуске</span>
        <Toggle value={autostart} onChange={setAutostart} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-text-faint uppercase tracking-wider">Сессия</label>
        <input
          type="text"
          value={sessionId}
          onChange={e => setSessionId(e.target.value)}
          placeholder="uuid сессии (пусто — последняя активная)"
          className="bg-surface-hover border border-border-default rounded-lg px-3 py-2 text-[13px] text-text-primary placeholder:text-text-ghost outline-none focus:border-border-strong transition-colors font-mono"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-text-faint uppercase tracking-wider">Bot Token</label>
        <input
          type="password"
          value={botToken}
          onChange={e => setBotToken(e.target.value)}
          placeholder="1234567890:AAE..."
          className="bg-surface-hover border border-border-default rounded-lg px-3 py-2 text-[13px] text-text-primary placeholder:text-text-ghost outline-none focus:border-border-strong transition-colors"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-text-faint uppercase tracking-wider">Chat ID</label>
        <input
          type="text"
          value={chatId}
          onChange={e => setChatId(e.target.value)}
          placeholder="646605229"
          className="bg-surface-hover border border-border-default rounded-lg px-3 py-2 text-[13px] text-text-primary placeholder:text-text-ghost outline-none focus:border-border-strong transition-colors"
        />
        <span className="text-[11px] text-text-faint">Оставь пустым — принимать от всех</span>
      </div>

      <button
        onClick={save}
        className={cn(
          'mt-1 py-2 rounded-lg text-[13px] font-medium transition-all duration-200',
          saved
            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
            : 'bg-surface-hover border border-border-default text-text-secondary hover:text-text-primary hover:border-border-strong',
        )}
      >
        {saved ? 'Сохранено' : 'Сохранить'}
      </button>

      {running && sessionId && (
        <span className="text-[12px] text-text-faint">
          {getLabel(sessions.find(s => s.id === sessionId) ?? { id: sessionId, title: sessionId.slice(0, 8) } as Session)}
        </span>
      )}
    </div>
  )
}
