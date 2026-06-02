import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api.js'
import { cn } from '../lib/utils.js'
import { Session } from '../types/index.js'

interface Props {
  sessions: Session[]
}

const MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
]

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

export function TgPanel({ sessions }: Props) {
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [model, setModel] = useState('claude-sonnet-4-6')
  const [effort, setEffort] = useState('medium')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.tgGetSettings().then(s => {
      setBotToken(s.botToken)
      setChatId(s.chatId)
      setEnabled(s.enabled)
      setSessionId(s.sessionId ?? '')
      setModel(s.model ?? 'claude-sonnet-4-6')
      setEffort(s.effort ?? 'medium')
      setLoading(false)
    })
  }, [])

  const save = useCallback(async () => {
    await api.tgSetSettings({ botToken, chatId, enabled, sessionId, model, effort })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }, [botToken, chatId, enabled, sessionId, model, effort])

  const handleToggle = useCallback(async () => {
    const next = !enabled
    setEnabled(next)
    await api.tgSetSettings({ botToken, chatId, enabled: next, sessionId, model, effort })
  }, [enabled, botToken, chatId, sessionId, model, effort])

  if (loading) return (
    <div className="flex-1 flex items-center justify-center text-text-ghost text-sm">
      Загрузка...
    </div>
  )

  const getLabel = (s: Session) => s.title || s.id.slice(0, 8)

  return (
    <div className="flex-1 flex flex-col gap-3 p-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-text-secondary font-medium">Telegram</span>
        <button
          onClick={handleToggle}
          className={cn(
            'relative w-9 h-5 rounded-full transition-colors duration-200',
            enabled ? 'bg-accent' : 'bg-surface-active',
          )}
        >
          <span className={cn(
            'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200',
            enabled ? 'translate-x-4' : 'translate-x-0.5',
          )} />
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] text-text-faint uppercase tracking-wider">Сессия</label>
        <select
          value={sessionId}
          onChange={e => setSessionId(e.target.value)}
          className="bg-surface-hover border border-border-default rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-border-strong transition-colors appearance-none cursor-pointer"
        >
          <option value="">— последняя активная —</option>
          {sessions.map(s => (
            <option key={s.id} value={s.id}>{getLabel(s)}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <div className="flex flex-col gap-1.5 flex-1">
          <label className="text-[11px] text-text-faint uppercase tracking-wider">Модель</label>
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="bg-surface-hover border border-border-default rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-border-strong transition-colors appearance-none cursor-pointer"
          >
            {MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5 w-24">
          <label className="text-[11px] text-text-faint uppercase tracking-wider">Effort</label>
          <select
            value={effort}
            onChange={e => setEffort(e.target.value)}
            className="bg-surface-hover border border-border-default rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-border-strong transition-colors appearance-none cursor-pointer"
          >
            {EFFORTS.map(e => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </div>
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

      {enabled && (
        <div className="flex items-center gap-2 mt-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[12px] text-text-faint">
            {sessionId ? getLabel(sessions.find(s => s.id === sessionId) ?? { id: sessionId, title: sessionId.slice(0, 8) } as Session) : 'последняя активная'}
            {' · '}{MODELS.find(m => m.id === model)?.label ?? model}
            {' · '}{effort}
          </span>
        </div>
      )}
    </div>
  )
}
