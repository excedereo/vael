import { useState, useEffect, useCallback } from 'react'
import {
  Play, Pause, Warning2, Code1, Key, Profile, Setting4, Eye, EyeSlash, Link21,
} from 'iconsax-reactjs'
import { api } from '../lib/api.js'
import { PageHeader, Section, ToggleRow } from './SettingsComponents.js'
import { ModuleIcon } from './ModuleIcon.js'
import { cn } from '../lib/utils.js'
import type { Session } from '../types/index.js'

interface Props {
  sessions: Session[]
  onStatusChange?: () => void
}

export function TgPanel({ sessions, onStatusChange }: Props) {
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [autostart, setAutostart] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [running, setRunning] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showToken, setShowToken] = useState(false)
  const [snapshot, setSnapshot] = useState('')
  const [alive, setAlive] = useState<string[]>([])
  const [detecting, setDetecting] = useState(false)
  // Результат поиска chatId; «!» в начале — это ошибка, красим иначе
  const [detectResult, setDetectResult] = useState<string | null>(null)

  useEffect(() => {
    api.tgGetSettings().then(s => {
      const tok = s.botToken ?? ''
      const cid = s.chatId ?? ''
      const au = (s as typeof s & { autostart?: boolean }).autostart ?? false
      const sid = s.sessionId ?? ''
      setBotToken(tok)
      setChatId(cid)
      setAutostart(au)
      setSessionId(sid)
      setSnapshot(JSON.stringify([tok, cid, au, sid]))
      setLoading(false)
    })
    api.modulesList().then(list => {
      const tg = list.find(m => m.id === 'telegram')
      if (tg) setRunning(tg.running)
    })
  }, [])

  // Живые сессии берём из heartbeat-health: там уже есть список PTY, и он
  // общий для всех модулей — заводить второй источник незачем
  useEffect(() => {
    const check = () => api.heartbeatHealth().then(h => setAlive(h.alive)).catch(() => {})
    check()
    const t = setInterval(check, 3000)
    return () => clearInterval(t)
  }, [])

  const save = useCallback(async () => {
    await api.tgSetSettings({ botToken, chatId, enabled: true, sessionId, autostart } as Parameters<typeof api.tgSetSettings>[0])
    setSnapshot(JSON.stringify([botToken, chatId, autostart, sessionId]))
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
    onStatusChange?.()
  }, [botToken, chatId, sessionId, autostart, onStatusChange])

  const detectChatId = useCallback(async () => {
    setDetecting(true)
    setDetectResult(null)
    const r = await api.tgDetectChatId(botToken)
    setDetecting(false)

    if (!r.ok || !r.chats?.length) {
      setDetectResult(`!${r.error ?? 'не нашлось'}`)
      return
    }
    // Чаще всего чат один — подставляем сразу; если несколько, показываем все
    setChatId(r.chats[0].id)
    setDetectResult(
      r.chats.length === 1
        ? `нашла: ${r.chats[0].name}`
        : `нашла ${r.chats.length}, взяла первый: ${r.chats.map(c => c.name).join(', ')}`,
    )
  }, [botToken])

  const handleStartStop = useCallback(async () => {
    if (running) { await api.tgStop(); setRunning(false) }
    else {
      await api.tgStart()
      const list = await api.modulesList()
      setRunning(list.find(m => m.id === 'telegram')?.running ?? false)
    }
    onStatusChange?.()
  }, [running, onStatusChange])

  if (loading) return (
    <div className="flex-1 flex items-center justify-center text-text-ghost text-sm">
      Загрузка...
    </div>
  )

  const dirty = snapshot !== JSON.stringify([botToken, chatId, autostart, sessionId])
  const sessionAlive = sessionId ? alive.includes(sessionId) : alive.length > 0
  const sessionLabel = sessionId
    ? sessions.find(s => s.id === sessionId)?.title || sessionId.slice(0, 8)
    : 'последняя активная'

  // Токен без chatId — бот отвечает, но написать первым не может
  const noChatId = !!botToken && !chatId

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[680px] mx-auto px-5 py-5 space-y-6">

        <PageHeader
          icon={Profile}
          title="Telegram"
          desc="Мост между чатом в телеграме и живой сессией — сообщения идут прямо в неё"
        />

        {/* Сохранение закреплено сверху: настройки длинные, кнопка внизу терялась */}
        <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-bg-base/85 backdrop-blur-sm">
          <button
            onClick={save}
            disabled={!dirty && !saved}
            className={cn(
              'w-full py-2.5 rounded-xl text-[13.5px] font-medium border',
              'transition-all duration-200 active:scale-[0.99]',
              saved
                ? 'bg-accent-wash border-accent/30 text-accent'
                : dirty
                  ? 'bg-accent text-white border-accent hover:bg-accent-hi'
                  : 'bg-surface-hover border-border-subtle text-text-ghost cursor-default active:scale-100',
            )}
          >
            {saved ? 'Сохранено' : dirty ? 'Сохранить изменения' : 'Всё сохранено'}
          </button>
        </div>

        {/* Статус */}
        <div className={cn(
          'rounded-2xl border p-4 flex items-center gap-4 transition-colors duration-300',
          running ? 'bg-accent-wash border-accent/25' : 'bg-surface-hover border-border-default',
        )}>
          <div className={cn(
            'w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-300',
            running ? 'bg-accent/15' : 'bg-surface-active',
          )}>
            <ModuleIcon icon="tg" size={23} dimmed={!running} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium text-text-primary">
              {running ? 'Бот на связи' : 'Остановлен'}
            </div>
            <div className="text-[12px] text-text-faint mt-0.5 truncate">
              {running
                ? 'слушает сообщения и передаёт их в сессию'
                : botToken ? 'сообщения не принимаются' : 'нужен токен бота'}
            </div>
          </div>

          <button
            onClick={handleStartStop}
            disabled={!running && !botToken}
            title={!running && !botToken ? 'Сначала укажи токен бота' : undefined}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium shrink-0',
              'transition-all duration-200 border active:scale-[0.97]',
              running
                ? 'bg-surface-hover border-border-default text-text-secondary hover:text-text-primary hover:border-border-strong'
                : botToken
                  ? 'bg-accent text-white border-accent hover:bg-accent-hi'
                  : 'bg-surface-hover border-border-subtle text-text-ghost cursor-not-allowed active:scale-100',
            )}
          >
            {running
              ? <><Pause size={15} variant="Bold" color="currentColor" /> Стоп</>
              : <><Play size={15} variant="Bold" color="currentColor" /> Запустить</>}
          </button>
        </div>

        {noChatId && (
          <div className="rounded-xl bg-amber-500/8 border border-amber-500/25 px-4 py-3 flex items-start gap-3">
            <Warning2 size={17} variant="Bold" color="rgb(245 158 11)" className="shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[13px] text-amber-200/90">Chat ID не указан</div>
              <div className="text-[11.5px] text-amber-200/50 mt-1 leading-relaxed">
                Бот отвечает на входящие, но написать первым не может — фришки и
                уведомления не дойдут. Напиши боту что-нибудь и нажми «Определить».
              </div>
            </div>
          </div>
        )}

        {/* Сессия */}
        <Section label="Сессия" icon={Code1} desc="куда идут сообщения из чата">
          <div className="px-4 py-3.5 space-y-2.5">
            <div className="relative">
              <input
                type="text"
                value={sessionId}
                onChange={e => setSessionId(e.target.value)}
                placeholder="uuid сессии — пусто: последняя активная"
                spellCheck={false}
                className={cn(
                  'w-full bg-surface-selected border rounded-xl px-3.5 py-2.5 pr-24',
                  'text-[12.5px] font-mono text-text-secondary placeholder:text-text-ghost',
                  'focus:outline-none transition-colors',
                  sessionId && !sessionAlive
                    ? 'border-amber-500/40 focus:border-amber-500/60'
                    : 'border-border-default focus:border-border-strong',
                )}
              />
              {sessionId && (
                <span className={cn(
                  'absolute right-3 top-1/2 -translate-y-1/2 text-[11px] px-2 py-0.5 rounded-md',
                  'flex items-center gap-1.5 pointer-events-none',
                  sessionAlive ? 'bg-accent-wash text-accent' : 'bg-amber-500/12 text-amber-300/80',
                )}>
                  <span className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    sessionAlive ? 'bg-accent animate-pulse' : 'bg-amber-400/70',
                  )} />
                  {sessionAlive ? 'живая' : 'не запущена'}
                </span>
              )}
            </div>

            <div className="text-[11.5px] text-text-ghost">
              {sessionId ? sessionLabel : 'Будет использована последняя активная сессия'}
            </div>

            {alive.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                <span className="text-[11px] text-text-ghost self-center mr-0.5">Запущены:</span>
                {alive.map(id => (
                  <button
                    key={id}
                    onClick={() => setSessionId(id)}
                    title={sessions.find(s => s.id === id)?.title || id}
                    className={cn(
                      'px-2 py-0.5 rounded-md text-[11px] font-mono transition-all duration-150',
                      'border active:scale-[0.96]',
                      id === sessionId
                        ? 'bg-accent-wash border-accent/35 text-accent'
                        : 'bg-surface-hover border-border-subtle text-text-faint hover:text-accent hover:border-accent/35',
                    )}
                  >
                    {sessions.find(s => s.id === id)?.title || id.slice(0, 8)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Section>

        {/* Подключение */}
        <Section label="Подключение" icon={Link21} desc="бот и адресат">
          <div className="px-4 py-3.5 space-y-3.5">
            <div className="space-y-1.5">
              <label className="text-[11px] text-text-faint uppercase tracking-wider flex items-center gap-1.5">
                <Key size={12} variant="Linear" color="var(--text-faint)" />
                Bot Token
              </label>
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={botToken}
                  onChange={e => setBotToken(e.target.value)}
                  placeholder="1234567890:AAE..."
                  spellCheck={false}
                  className={cn(
                    'w-full bg-surface-selected border border-border-default rounded-xl',
                    'px-3.5 py-2.5 pr-10 text-[12.5px] font-mono text-text-secondary',
                    'placeholder:text-text-ghost focus:outline-none focus:border-border-strong transition-colors',
                  )}
                />
                <button
                  onClick={() => setShowToken(v => !v)}
                  title={showToken ? 'Скрыть' : 'Показать'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-ghost hover:text-text-secondary transition-colors"
                >
                  {showToken
                    ? <EyeSlash size={15} variant="Linear" color="currentColor" />
                    : <Eye size={15} variant="Linear" color="currentColor" />}
                </button>
              </div>
              <div className="text-[11px] text-text-ghost">Выдаёт @BotFather при создании бота</div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] text-text-faint uppercase tracking-wider flex items-center gap-1.5">
                <Profile size={12} variant="Linear" color="var(--text-faint)" />
                Chat ID
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatId}
                  onChange={e => setChatId(e.target.value)}
                  placeholder="646605229"
                  spellCheck={false}
                  className={cn(
                    'flex-1 min-w-0 bg-surface-selected border rounded-xl px-3.5 py-2.5',
                    'text-[12.5px] font-mono text-text-secondary placeholder:text-text-ghost',
                    'focus:outline-none transition-colors',
                    noChatId
                      ? 'border-amber-500/40 focus:border-amber-500/60'
                      : 'border-border-default focus:border-border-strong',
                  )}
                />
                <button
                  onClick={detectChatId}
                  disabled={!botToken || detecting}
                  className={cn(
                    'px-3 rounded-xl text-[12.5px] border shrink-0 transition-all duration-150',
                    'active:scale-[0.97]',
                    botToken && !detecting
                      ? 'bg-surface-hover border-border-default text-text-secondary hover:text-accent hover:border-accent/40'
                      : 'bg-surface-hover border-border-subtle text-text-ghost cursor-not-allowed active:scale-100',
                  )}
                >
                  {detecting ? 'Ищу...' : 'Определить'}
                </button>
              </div>

              {detectResult && (
                <div className={cn(
                  'text-[11.5px] px-1',
                  detectResult.startsWith('!') ? 'text-amber-300/80' : 'text-accent',
                )}>
                  {detectResult.replace(/^!/, '')}
                </div>
              )}

              <div className="text-[11px] text-text-ghost">
                Пусто — бот принимает от кого угодно, но сам написать не может.
                «Определить» возьмёт ID из последних сообщений боту.
              </div>
            </div>
          </div>
        </Section>

        <Section label="Настройки" icon={Setting4}>
          <ToggleRow
            icon={Play}
            label="Автостарт"
            desc="Запускаться вместе с Vael"
            value={autostart}
            onChange={setAutostart}
          />
        </Section>

        <div className="h-2" />
      </div>
    </div>
  )
}
