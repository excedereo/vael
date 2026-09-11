import { useState, useEffect, useCallback } from 'react'
import {
  Heart, Timer1, Clock, Repeat, Send2, Play, Pause,
  Trash, CloseCircle, MessageText1, Flash, Setting4, Add,
  Warning2, Code1,
} from 'iconsax-reactjs'
import { api, type WakeEntry } from '../lib/api.js'
import { PageHeader, Section, ToggleRow } from './SettingsComponents.js'
import { cn } from '../lib/utils.js'
import type { Session } from '../types/index.js'

interface Props {
  sessions: Session[]
  onStatusChange?: () => void
}

interface HbSettings {
  enabled: boolean
  autostart?: boolean
  sessionId?: string
  template: string
  mirrorToTelegram?: boolean
}

const DEFAULT_TEMPLATE = '[FREE] прошло <timefromlastmessage> с последнего ответа<text?, >'

/** Готовые интервалы для кнопок быстрой постановки — то, чем пользуешься чаще всего */
const QUICK: { label: string; ms: number }[] = [
  { label: '5 мин', ms: 5 * 60_000 },
  { label: '15 мин', ms: 15 * 60_000 },
  { label: '30 мин', ms: 30 * 60_000 },
  { label: '1 ч', ms: 60 * 60_000 },
  { label: '3 ч', ms: 3 * 60 * 60_000 },
]

const PLACEHOLDERS: { tag: string; desc: string }[] = [
  { tag: '<timefromlastmessage>', desc: 'сколько прошло' },
  { tag: '<time>', desc: 'время' },
  { tag: '<date>', desc: 'дата' },
  { tag: '<text>', desc: 'текст побудки' },
  { tag: '<text?, >', desc: 'текст с префиксом, если есть' },
]

function fmtWhen(ms: number | undefined): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toTimeString().slice(0, 5)
  return sameDay ? time : `${d.toLocaleDateString('ru-RU')} ${time}`
}

/**
 * «через 40 мин» / «вот-вот» / «просрочено» — обратный отсчёт для карточки.
 *
 * Просрочку показываем отдельно: если побудка висит в прошлом дольше минуты,
 * значит её никто не забрал (модуль стоит), и это надо видеть сразу, а не
 * гадать, почему «вот-вот» не проходит.
 */
function fmtLeft(ms: number | undefined): string {
  if (!ms) return ''
  const left = ms - Date.now()
  if (left < -60_000) return `просрочено на ${Math.round(-left / 60_000)} мин`
  if (left <= 0) return 'вот-вот'
  const min = Math.round(left / 60_000)
  if (min < 1) return 'меньше минуты'
  if (min < 60) return `через ${min} мин`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `через ${h} ч ${m} мин` : `через ${h} ч`
}

export function HeartbeatPanel({ sessions, onStatusChange }: Props) {
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE)
  const [sessionId, setSessionId] = useState('')
  const [autostart, setAutostart] = useState(false)
  const [mirror, setMirror] = useState(false)
  const [running, setRunning] = useState(false)
  const [queue, setQueue] = useState<WakeEntry[]>([])
  const [lastFired, setLastFired] = useState<{ message: string; at: number } | null>(null)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [customText, setCustomText] = useState('')
  // Почему модуль не может работать (нет сессии / PTY не запущен) + живые сессии
  const [health, setHealth] = useState<{ blocked: string | null; alive: string[] }>({ blocked: null, alive: [] })
  // Снимок сохранённого состояния — по нему понимаем, есть ли что сохранять
  const [snapshot, setSnapshot] = useState('')
  // Тик раз в секунду — чтобы обратный отсчёт в карточках шёл живьём
  const [, setNow] = useState(Date.now())

  useEffect(() => {
    api.modulesGetSettings('heartbeat').then(raw => {
      const s = (raw ?? {}) as unknown as HbSettings
      const tpl = s.template || DEFAULT_TEMPLATE
      const sid = s.sessionId ?? ''
      const au = s.autostart ?? false
      const mir = s.mirrorToTelegram ?? false
      setTemplate(tpl)
      setSessionId(sid)
      setAutostart(au)
      setMirror(mir)
      setSnapshot(JSON.stringify([tpl, sid, au, mir]))
      setLoading(false)
    })
    api.modulesList().then(list => {
      const hb = list.find(m => m.id === 'heartbeat')
      if (hb) setRunning(hb.running)
    })
    api.heartbeatQueue().then(setQueue)

    const offQueue = api.onHeartbeatQueue(setQueue)
    const offFired = api.onHeartbeatFired(setLastFired)
    // Настройки могли поменяться снаружи — командой `vael hb ...` из сессии
    const offSettings = api.onHeartbeatSettingsChanged(raw => {
      const s = raw as unknown as HbSettings
      const tpl = s.template || DEFAULT_TEMPLATE
      const sid = s.sessionId ?? ''
      const au = s.autostart ?? false
      const mir = s.mirrorToTelegram ?? false
      setTemplate(tpl)
      setSessionId(sid)
      setAutostart(au)
      setMirror(mir)
      setSnapshot(JSON.stringify([tpl, sid, au, mir]))
      api.modulesList().then(list => {
        setRunning(list.find(m => m.id === 'heartbeat')?.running ?? false)
      })
    })
    return () => { offQueue(); offFired(); offSettings() }
  }, [])

  // Очередь меняется и снаружи (`vael wake` из сессии Ваели) — fs.watch ловит
  // не каждое событие, поэтому пока панель открыта, подстраховываемся опросом.
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now())
      api.heartbeatQueue().then(setQueue)
    }, 1000)
    return () => clearInterval(t)
  }, [])

  // Живость PTY может измениться в любой момент (сессию закрыли/открыли),
  // поэтому спрашиваем регулярно, а не только на монтировании.
  useEffect(() => {
    const check = () => api.heartbeatHealth().then(setHealth).catch(() => {})
    check()
    const t = setInterval(check, 2000)
    return () => clearInterval(t)
  }, [sessionId])

  const save = useCallback(async () => {
    await api.modulesSetSettings('heartbeat', {
      enabled: true, template, sessionId, autostart, mirrorToTelegram: mirror,
    })
    setSnapshot(JSON.stringify([template, sessionId, autostart, mirror]))
    setSaved(true)
    setRunning(true)
    setTimeout(() => setSaved(false), 1600)
    onStatusChange?.()
  }, [template, sessionId, autostart, mirror, onStatusChange])

  const dirty = !loading && snapshot !== JSON.stringify([template, sessionId, autostart, mirror])

  const handleStartStop = useCallback(async () => {
    if (running) {
      await api.modulesStop('heartbeat')
      setRunning(false)
    } else {
      await api.modulesStart('heartbeat')
      // Модуль мог отказаться стартовать (нет живого PTY) — спрашиваем, что
      // получилось на самом деле, а не предполагаем успех
      const list = await api.modulesList()
      setRunning(list.find(m => m.id === 'heartbeat')?.running ?? false)
      api.heartbeatHealth().then(setHealth).catch(() => {})
    }
    onStatusChange?.()
  }, [running, onStatusChange])

  const addWake = useCallback(async (ms: number) => {
    await api.heartbeatAdd({
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      kind: 'one',
      at: Date.now() + ms,
      text: customText.trim() || undefined,
      source: 'user',
      createdAt: Date.now(),
    })
    setCustomText('')
    setQueue(await api.heartbeatQueue())
  }, [customText])

  const cancel = useCallback(async (id: string) => {
    await api.heartbeatCancel(id)
    setQueue(await api.heartbeatQueue())
  }, [])

  if (loading) return (
    <div className="flex-1 flex items-center justify-center text-text-ghost text-sm">
      Загрузка...
    </div>
  )

  const sessionLabel = sessionId
    ? sessions.find(s => s.id === sessionId)?.title || sessionId.slice(0, 8)
    : 'последняя активная'

  // Живость именно этой сессии: у неё должен быть запущен PTY, иначе писать некуда
  const sessionAlive = sessionId ? health.alive.includes(sessionId) : health.alive.length > 0

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[680px] mx-auto px-5 py-5 space-y-6">

        <PageHeader
          icon={Heart}
          title="Heartbeat"
          desc="Будит Ваели, когда её никто не зовёт — фришка приходит в сессию как обычное сообщение"
        />

        {/* Сохранение закреплено сверху: настройки разбросаны по всей странице,
            и кнопка внизу прокрутки терялась — правишь шаблон и не видишь её. */}
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

        {/* Живой статус — самое важное, наверх и крупно */}
        <div className={cn(
          'rounded-2xl border p-4 flex items-center gap-4 transition-colors duration-300',
          running
            ? 'bg-accent-wash border-accent/25'
            : 'bg-surface-hover border-border-default',
        )}>
          <div className={cn(
            'w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-300',
            running ? 'bg-accent/15' : 'bg-surface-active',
          )}>
            <Heart
              size={22}
              variant={running ? 'Bold' : 'Linear'}
              color={running ? 'var(--accent)' : 'var(--text-faint)'}
              className={running ? 'animate-pulse' : undefined}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium text-text-primary">
              {running ? 'Сердце бьётся' : 'Остановлено'}
            </div>
            <div className="text-[12px] text-text-faint mt-0.5 truncate">
              {running
                ? queue.length > 0
                  ? `${queue.length} ${queue.length === 1 ? 'побудка' : queue.length < 5 ? 'побудки' : 'побудок'} в очереди`
                  : 'очередь пуста — тишина'
                : 'фришки не приходят'}
            </div>
          </div>

          <button
            onClick={handleStartStop}
            disabled={!running && !!health.blocked}
            title={!running && health.blocked ? health.blocked : undefined}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium shrink-0',
              'transition-all duration-200 border active:scale-[0.97]',
              running
                ? 'bg-surface-hover border-border-default text-text-secondary hover:text-text-primary hover:border-border-strong'
                : health.blocked
                  ? 'bg-surface-hover border-border-subtle text-text-ghost cursor-not-allowed active:scale-100'
                  : 'bg-accent text-white border-accent hover:bg-accent-hi',
            )}
          >
            {running
              ? <><Pause size={15} variant="Bold" color="currentColor" /> Стоп</>
              : <><Play size={15} variant="Bold" color="currentColor" /> Запустить</>}
          </button>
        </div>

        {/* Почему не может работать — видно раньше, чем ткнёшь в заблокированную кнопку */}
        {health.blocked && (
          <div className="rounded-xl bg-amber-500/8 border border-amber-500/25 px-4 py-3 flex items-start gap-3">
            <Warning2 size={17} variant="Bold" color="rgb(245 158 11)" className="shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[13px] text-amber-200/90">{health.blocked}</div>
              <div className="text-[11.5px] text-amber-200/50 mt-1 leading-relaxed">
                Фришки не уйдут в закрытую сессию — они копятся в очереди и отправятся,
                когда сессия снова заработает
              </div>
            </div>
          </div>
        )}

        {/* Сессия — первое, что нужно выбрать, поэтому наверху */}
        <Section label="Сессия" icon={Code1} desc="куда приходят фришки">
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
                  sessionAlive
                    ? 'bg-accent-wash text-accent'
                    : 'bg-amber-500/12 text-amber-300/80',
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

            {health.alive.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                <span className="text-[11px] text-text-ghost self-center mr-0.5">Запущены:</span>
                {health.alive.map(id => (
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

        {/* Быстрая постановка */}
        <Section label="Разбудить" icon={Flash} desc="разово, от текущего момента">
          <div className="px-4 py-3.5 space-y-3">
            <div className="flex flex-wrap gap-2">
              {QUICK.map(q => (
                <button
                  key={q.label}
                  onClick={() => addWake(q.ms)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-[13px] border transition-all duration-150 active:scale-[0.96]',
                    'bg-surface-hover border-border-default text-text-secondary',
                    'hover:border-accent/40 hover:text-accent hover:bg-accent-wash',
                  )}
                >
                  {q.label}
                </button>
              ))}
              <button
                onClick={() => addWake(0)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-[13px] border transition-all duration-150 active:scale-[0.96]',
                  'bg-accent-wash border-accent/30 text-accent hover:bg-accent-dim',
                  'flex items-center gap-1.5',
                )}
              >
                <Flash size={13} variant="Bold" color="currentColor" />
                сейчас
              </button>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <MessageText1
                  size={15}
                  variant="Linear"
                  color="var(--text-ghost)"
                  className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                />
                <input
                  type="text"
                  value={customText}
                  onChange={e => setCustomText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && customText.trim()) addWake(5 * 60_000) }}
                  placeholder="с текстом — что сделать, когда проснётся"
                  className={cn(
                    'w-full bg-surface-selected border border-border-default rounded-xl',
                    'pl-9 pr-3 py-2 text-[13px] text-text-secondary placeholder:text-text-ghost',
                    'focus:outline-none focus:border-border-strong transition-colors',
                  )}
                />
              </div>
            </div>
            <div className="text-[11px] text-text-ghost">
              Текст подставится в шаблон вместо {'<text>'} — кнопки выше поставят побудку вместе с ним
            </div>
          </div>
        </Section>

        {/* Очередь */}
        <Section
          label="Очередь"
          icon={Timer1}
          desc={queue.length > 0 ? `${queue.length} шт` : 'пусто'}
        >
          {queue.length === 0 ? (
            <div className="px-4 py-8 flex flex-col items-center gap-2 text-center">
              <Timer1 size={26} variant="Linear" color="var(--text-ghost)" />
              <div className="text-[13px] text-text-faint">Ничего не запланировано</div>
              <div className="text-[11px] text-text-ghost max-w-[300px]">
                Ваели ставит себе побудки сама командой <code className="text-accent">vael wake 5min</code> —
                они появятся здесь
              </div>
            </div>
          ) : (
            <>
              <div className="divide-y divide-border-subtle">
                {queue.map(e => {
                  const when = e.kind === 'every' ? e.nextAt : e.at
                  const overdue = !!when && when - Date.now() < -60_000
                  const soon = !!when && !overdue && when - Date.now() < 60_000
                  return (
                    <div
                      key={e.id}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover/40 group"
                    >
                      <div className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors',
                        overdue ? 'bg-amber-500/12' : soon ? 'bg-accent-wash' : 'bg-surface-hover',
                      )}>
                        {(() => {
                          const color = overdue ? 'rgb(251 191 36)' : soon ? 'var(--accent)' : 'var(--text-muted)'
                          return e.kind === 'every'
                            ? <Repeat size={15} variant="Linear" color={color} />
                            : <Clock size={15} variant="Linear" color={color} />
                        })()}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13.5px] text-text-secondary tabular-nums">
                            {fmtWhen(when)}
                          </span>
                          <span className={cn(
                            'text-[11.5px] tabular-nums',
                            overdue ? 'text-amber-300/80' : soon ? 'text-accent' : 'text-text-faint',
                          )}>
                            {fmtLeft(when)}
                          </span>
                          {e.kind === 'every' && (
                            <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-surface-active text-text-faint">
                              каждые {Math.round((e.intervalMs ?? 0) / 60000)} мин
                            </span>
                          )}
                        </div>
                        {e.text && (
                          <div className="text-[12px] text-text-faint truncate mt-0.5">{e.text}</div>
                        )}
                      </div>

                      <span className={cn(
                        'text-[10.5px] px-1.5 py-0.5 rounded shrink-0',
                        e.source === 'vaeli'
                          ? 'bg-accent-wash text-accent'
                          : 'bg-surface-active text-text-faint',
                      )}>
                        {e.source === 'vaeli' ? 'Ваели' : 'ты'}
                      </span>

                      <button
                        onClick={() => cancel(e.id)}
                        title="Отменить"
                        className={cn(
                          'shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-150',
                          'text-text-ghost hover:text-red-400 active:scale-90',
                        )}
                      >
                        <CloseCircle size={17} variant="Linear" color="currentColor" />
                      </button>
                    </div>
                  )
                })}
              </div>

              <div className="px-4 py-2.5 border-t border-border-subtle">
                <button
                  onClick={async () => { await api.heartbeatClear(); setQueue([]) }}
                  className="flex items-center gap-1.5 text-[12px] text-text-ghost hover:text-red-400 transition-colors"
                >
                  <Trash size={13} variant="Linear" color="currentColor" />
                  Очистить очередь
                </button>
              </div>
            </>
          )}
        </Section>

        {/* Последняя фришка */}
        {lastFired && (
          <Section label="Последняя фришка" icon={Send2}>
            <div className="px-4 py-3.5">
              <div className="rounded-xl bg-accent-wash border border-accent/20 px-3.5 py-3">
                <div className="text-[13px] text-text-secondary break-words leading-relaxed">
                  {lastFired.message}
                </div>
              </div>
              <div className="text-[11px] text-text-ghost mt-2 tabular-nums">
                отправлена в {new Date(lastFired.at).toTimeString().slice(0, 5)}
              </div>
            </div>
          </Section>
        )}

        {/* Шаблон */}
        <Section label="Шаблон фришки" icon={MessageText1} desc="что именно придёт в сессию">
          <div className="px-4 py-3.5 space-y-3">
            <textarea
              value={template}
              onChange={e => setTemplate(e.target.value)}
              rows={2}
              spellCheck={false}
              className={cn(
                'w-full bg-surface-selected border border-border-default rounded-xl px-3.5 py-2.5',
                'text-[13px] text-text-secondary leading-relaxed resize-none',
                'focus:outline-none focus:border-border-strong transition-colors',
              )}
            />

            <div className="flex flex-wrap gap-1.5">
              {PLACEHOLDERS.map(p => (
                <button
                  key={p.tag}
                  onClick={() => setTemplate(t => `${t}${p.tag}`)}
                  title={`Добавить — ${p.desc}`}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono',
                    'bg-surface-hover border border-border-subtle text-text-faint',
                    'hover:border-accent/40 hover:text-accent transition-all duration-150 active:scale-[0.96]',
                  )}
                >
                  <Add size={11} variant="Linear" color="currentColor" />
                  {p.tag}
                </button>
              ))}
            </div>

            {template !== DEFAULT_TEMPLATE && (
              <button
                onClick={() => setTemplate(DEFAULT_TEMPLATE)}
                className="text-[11.5px] text-text-ghost hover:text-text-secondary transition-colors"
              >
                Вернуть стандартный
              </button>
            )}
          </div>
        </Section>

        {/* Настройки */}
        <Section label="Настройки" icon={Setting4}>
          <ToggleRow
            icon={Play}
            label="Автостарт"
            desc="Запускаться вместе с Vael"
            value={autostart}
            onChange={setAutostart}
          />
          <ToggleRow
            icon={Send2}
            label="Дублировать в телеграм"
            desc="Копия каждой фришки уходит в чат"
            value={mirror}
            onChange={setMirror}
          />
        </Section>

        <div className="h-2" />
      </div>
    </div>
  )
}
