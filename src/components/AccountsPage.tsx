import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, LogOut, LogIn, RotateCcw, ArrowUp, ArrowDown, ArrowRight } from 'lucide-react'
import { Chart2, Profile, Message, Folder2, Calendar } from 'iconsax-reactjs'
import { Account } from '../types/index'
import { api, type StatsCache, type StatsModelUsage, type AuthInfo } from '../lib/api.js'
import { cn } from '../lib/utils.js'
import { useAccountsTab } from '../lib/sectionTabs.js'
import { PageHeader } from './SettingsComponents.js'

interface Props {
  accounts: Account[]
  activeAccountId: string
  isRunning?: boolean
  onBack: () => void
  onAccountsChange: () => void
  onSwitchAccount: (id: string) => void
}

type ConfirmAction = { type: 'delete' | 'logout'; id: string }

/** «ещё 27 дней» / «меньше часа» — срок жизни авторизации */
function relExpiry(ts: number): string {
  const left = ts - Date.now()
  if (left <= 0) return 'истёк'
  const days = Math.floor(left / 86400000)
  if (days >= 1) return `ещё ${days} ${plural(days, 'день', 'дня', 'дней')}`
  const hours = Math.floor(left / 3600000)
  if (hours >= 1) return `ещё ${hours} ${plural(hours, 'час', 'часа', 'часов')}`
  return 'меньше часа'
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

// ── Stats helpers ──────────────────────────────────────────────
function fmtNumber(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

/**
 * Версия модели из её id.
 *
 * Поколение 5 именуется одним числом (`claude-opus-5`), 4.x — двумя через
 * дефис (`claude-opus-4-8`). Старая регулярка требовала обе группы, поэтому
 * у пятёрок версия терялась и в списке оставалось голое «Opus».
 * Суффикс даты (`claude-haiku-4-5-20251001`) в версию не входит.
 */
function modelVersionOf(key: string): string {
  const m = key.match(/(?:opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/)
  if (!m) return ''
  // Третья группа из 6+ цифр — это дата сборки, а не минорная версия
  const minor = m[2] && m[2].length <= 2 ? m[2] : null
  return minor ? `${m[1]}.${minor}` : m[1]
}

function modelBaseOf(key: string): string {
  if (key.includes('opus')) return 'Opus'
  if (key.includes('sonnet')) return 'Sonnet'
  if (key.includes('haiku')) return 'Haiku'
  if (key.includes('fable')) return 'Fable'
  return key
}

function modelLabel(key: string) {
  const base = modelBaseOf(key)
  if (base === key) return key
  const ver = modelVersionOf(key)
  return ver ? `${base} ${ver}` : base
}

function modelColor(key: string) {
  if (key.includes('opus')) return '#a78bfa'
  if (key.includes('sonnet')) return '#60a5fa'
  if (key.includes('haiku')) return '#34d399'
  return '#94a3b8'
}

// ── Activity grid (GitHub-style) ──────────────────────────────
function ActivityGrid({ activity, filter }: { activity: { date: string; messageCount: number }[]; filter: 'all' | '30d' | '7d' }) {
  // Build a map date → messageCount
  const byDate = new Map(activity.map(d => [d.date, d.messageCount]))
  const maxVal = Math.max(...activity.map(d => d.messageCount), 1)

  // Build grid: last 52 weeks (364 days), columns = weeks, rows = days (Mon–Sun)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const weeks = filter === '7d' ? 2 : filter === '30d' ? 6 : 26
  const totalDays = weeks * 7

  // Find start: go back totalDays from today, align to Monday
  const start = new Date(today)
  start.setDate(start.getDate() - totalDays + 1)

  const cols: { date: string; count: number }[][] = []
  let col: { date: string; count: number }[] = []
  const cur = new Date(start)
  while (cur <= today) {
    const iso = cur.toISOString().slice(0, 10)
    col.push({ date: iso, count: byDate.get(iso) ?? 0 })
    if (col.length === 7) { cols.push(col); col = [] }
    cur.setDate(cur.getDate() + 1)
  }
  if (col.length > 0) cols.push(col)

  function cellColor(count: number) {
    if (count === 0) return 'rgba(255,255,255,0.06)'
    const ratio = Math.min(count / maxVal, 1)
    const opacity = 0.2 + ratio * 0.8
    return `color-mix(in srgb, var(--accent) ${Math.round(opacity * 100)}%, transparent)`
  }

  const DAYS = ['Пн', '', 'Ср', '', 'Пт', '', '']

  return (
    <div className="flex gap-1">
      {/* Day labels */}
      <div className="flex flex-col gap-0.5 pt-0.5 mr-1">
        {DAYS.map((d, i) => (
          <div key={i} className="h-3 text-[9px] text-text-ghost flex items-center">{d}</div>
        ))}
      </div>
      {/* Columns */}
      <div className="flex gap-0.5">
        {cols.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-0.5">
            {week.map((day, di) => (
              <div
                key={di}
                title={`${day.date}: ${day.count} сообщений`}
                className="w-3 h-3 rounded-[2px]"
                style={{ backgroundColor: cellColor(day.count) }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Stats tab ─────────────────────────────────────────────────
function StatsTab({ configDir }: { configDir?: string }) {
  const [stats, setStats] = useState<StatsCache | null>(null)
  const [filter, setFilter] = useState<'all' | '30d' | '7d'>('all')
  const [refreshing, setRefreshing] = useState(false)
  const [flashClass, setFlashClass] = useState<string>('')
  const prevTokens = useRef<number | null>(null)

  const loadStats = async (isRefresh = false) => {
    setRefreshing(true)
    // Статистика считается по логам активного аккаунта — без configDir
    // main возьмёт дефолтный ~/.claude, где давно ничего не пишется
    const r = await api.getStats(configDir)
    if (r.ok && r.data) {
      const newTotal = Object.values(r.data.modelUsage).reduce(
        (s, m) => s + m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens + m.outputTokens, 0
      )
      if (isRefresh && prevTokens.current !== null) {
        setFlashClass('')
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setFlashClass(newTotal !== prevTokens.current ? 'flash-green' : 'flash-white')
          })
        })
      }
      prevTokens.current = newTotal
      setStats(r.data)
    }
    setRefreshing(false)
  }

  useEffect(() => { loadStats(false) }, [configDir])

  if (!stats) return (
    <div className="flex items-center justify-center h-48 text-text-faint text-[13px]">
      Загрузка...
    </div>
  )

  const now = new Date()
  const activity = stats.dailyActivity.filter(d => {
    if (filter === 'all') return true
    const days = filter === '30d' ? 30 : 7
    return (now.getTime() - new Date(d.date).getTime()) / 86400000 <= days
  })

  const totalMessages = activity.reduce((s, d) => s + d.messageCount, 0)
  const activeDays = activity.length

  // Сессии считаем по уникальным id: суммирование sessionCount по дням
  // завышало результат втрое — сессия, шедшая несколько дней, попадала
  // в каждый из них (30 вместо 11 реальных)
  const uniqueSessions = new Set<string>()
  for (const d of activity) {
    if (d.sessionIds) for (const id of d.sessionIds) uniqueSessions.add(id)
  }
  const totalSessions = uniqueSessions.size || activity.reduce((s, d) => s + d.sessionCount, 0)

  // Расход по моделям за выбранный период. modelUsage — всегда суммарный,
  // поэтому за период собираем из подневной разбивки: она содержит те же
  // типы токенов, так что in/out показываются на любом фильтре
  const inPeriod = new Set(activity.map(d => d.date))
  const usageByModel: Record<string, StatsModelUsage> = {}

  if (filter === 'all') {
    Object.assign(usageByModel, stats.modelUsage)
  } else {
    for (const [date, byModel] of Object.entries(stats.dailyModelUsage ?? {})) {
      if (!inPeriod.has(date)) continue
      for (const [model, u] of Object.entries(byModel)) {
        const acc = usageByModel[model] ?? (usageByModel[model] = {
          inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
        })
        acc.inputTokens += u.inputTokens
        acc.outputTokens += u.outputTokens
        acc.cacheReadInputTokens += u.cacheReadInputTokens
        acc.cacheCreationInputTokens += u.cacheCreationInputTokens
      }
    }
  }

  const totalInput = Object.values(usageByModel).reduce((s, m) => s + m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens, 0)
  const totalOutput = Object.values(usageByModel).reduce((s, m) => s + m.outputTokens, 0)
  const totalTokens = totalInput + totalOutput

  // Схлопываем варианты одной модели (с датой сборки и без) в одну строку.
  // Ключ группы должен оставаться распознаваемым для modelLabel — поэтому
  // это по-прежнему id-подобная строка, а не готовая подпись
  function modelGroupKey(key: string): string {
    const base = key.includes('opus') ? 'opus' : key.includes('sonnet') ? 'sonnet' : key.includes('haiku') ? 'haiku' : key.includes('fable') ? 'fable' : key
    const ver = modelVersionOf(key)
    return ver ? `${base}-${ver.replace('.', '-')}` : base
  }
  const modelGroups = new Map<string, StatsModelUsage>()
  for (const [key, u] of Object.entries(usageByModel)) {
    const gk = modelGroupKey(key)
    const existing = modelGroups.get(gk) ?? { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }
    modelGroups.set(gk, {
      inputTokens: existing.inputTokens + u.inputTokens,
      outputTokens: existing.outputTokens + u.outputTokens,
      cacheReadInputTokens: existing.cacheReadInputTokens + u.cacheReadInputTokens,
      cacheCreationInputTokens: existing.cacheCreationInputTokens + u.cacheCreationInputTokens,
    })
  }
  const models = [...modelGroups.entries()]
    .map(([key, u]) => ({ key, total: u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens + u.outputTokens, ...u }))
    .sort((a, b) => b.total - a.total)
  const totalModelTokens = models.reduce((s, m) => s + m.total, 0)

  const lastDay = stats.dailyActivity[stats.dailyActivity.length - 1]?.date

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          icon={Chart2}
          title="Статистика"
          desc="Считается по логам сессий активного аккаунта"
        />
        <button
          onClick={() => loadStats(true)}
          disabled={refreshing}
          className="shrink-0 mt-1 w-9 h-9 rounded-xl grid place-items-center text-text-faint hover:text-text-primary hover:bg-surface-hover transition-colors"
          title="Пересчитать"
        >
          <RotateCcw size={16} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Период */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-bg-surface border border-border-default w-fit">
        {([
          { id: 'all', label: 'Всё время' },
          { id: '30d', label: '30 дней' },
          { id: '7d',  label: '7 дней' },
        ] as const).map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors',
              filter === f.id
                ? 'bg-surface-selected text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Токены — главная цифра */}
      <div className={cn('rounded-2xl border border-border-default bg-bg-surface p-5', flashClass)}>
        {/* Период обязателен в подписи: без него «949.6M токенов» на фильтре
            «7 дней» читается как суммарный расход и не сходится с ожиданиями */}
        <div className="flex items-baseline gap-2 mb-4 flex-wrap">
          <span
            className="text-[38px] font-semibold text-text-primary tabular-nums leading-none"
            title={`${totalTokens.toLocaleString('ru-RU')} токенов`}
          >
            {fmtNumber(totalTokens)}
          </span>
          <span className="text-[14px] text-text-muted">
            {filter === 'all' ? 'токенов за всё время' : `токенов за ${filter === '30d' ? '30 дней' : '7 дней'}`}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Входящие',  value: totalInput,  icon: ArrowDown },
            { label: 'Исходящие', value: totalOutput, icon: ArrowUp },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-xl bg-bg-base border border-border-subtle px-3.5 py-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon size={13} className="text-text-faint shrink-0" />
                <span className="text-[12px] text-text-muted">{label}</span>
              </div>
              <span
                className="text-[18px] font-semibold text-text-primary tabular-nums"
                title={`${value.toLocaleString('ru-RU')} токенов`}
              >
                {fmtNumber(value)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Остальные метрики */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Сообщения',     value: fmtNumber(totalMessages), icon: Message },
          { label: 'Сессии',        value: fmtNumber(totalSessions), icon: Folder2 },
          { label: 'Активных дней', value: String(activeDays),       icon: Calendar },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className={cn('rounded-2xl border border-border-default bg-bg-surface px-4 py-4', flashClass)}>
            <div className="flex items-center gap-2 mb-2">
              <Icon size={15} variant="Linear" color="var(--text-faint)" className="shrink-0" />
              <span className="text-[12px] text-text-muted">{label}</span>
            </div>
            <span className="text-[24px] font-semibold text-text-primary tabular-nums leading-none">{value}</span>
          </div>
        ))}
      </div>

      {/* Активность */}
      <div>
        <div className="flex items-baseline justify-between mb-3 px-0.5">
          <span className="text-[12px] font-semibold text-text-muted uppercase tracking-[0.08em]">Активность</span>
          {lastDay && (
            <span className="text-[11px] text-text-ghost">последняя — {lastDay}</span>
          )}
        </div>
        <div className="rounded-2xl border border-border-default bg-bg-surface p-4 overflow-x-auto">
          <ActivityGrid activity={stats.dailyActivity} filter={filter} />
        </div>
      </div>

      {/* Модели */}
      <div>
        <div className="text-[12px] font-semibold text-text-muted uppercase tracking-[0.08em] mb-3 px-0.5">
          Модели
        </div>
        <div className="rounded-2xl border border-border-default bg-bg-surface overflow-hidden divide-y divide-white/[0.07]">
          {models.length === 0 && (
            <div className="px-4 py-6 text-center text-[13px] text-text-ghost">Нет данных за период</div>
          )}
          {models.map(m => {
            const pct = totalModelTokens > 0 ? (m.total / totalModelTokens) * 100 : 0
            const color = modelColor(m.key)
            return (
              <div key={m.key} className="px-4 py-3.5">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-[13.5px] font-medium text-text-primary truncate">{modelLabel(m.key)}</span>
                  </div>
                  <span className="text-[13px] font-semibold text-text-primary tabular-nums shrink-0">
                    {pct.toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-surface-active overflow-hidden mb-2">
                  <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, backgroundColor: color }} />
                </div>
                <div className="text-[11.5px] text-text-muted tabular-nums">
                  {fmtNumber(m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens)} in · {fmtNumber(m.outputTokens)} out
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}


// ── Main component ────────────────────────────────────────────
export function AccountsPage({ accounts, activeAccountId, isRunning, onAccountsChange, onSwitchAccount }: Props) {
  const tab = useAccountsTab()
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [pendingAuth, setPendingAuth] = useState<Account | null>(null)
  const [addHov, setAddHov] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)
  const [credStatus, setCredStatus] = useState<Record<string, boolean>>({})
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    accounts.forEach(async acc => {
      const ok = await api.checkCredentials(acc.configDir)
      setCredStatus(prev => ({ ...prev, [acc.id]: ok }))
    })
  }, [accounts])

  // Срок авторизации — читается из .credentials.json, без запуска CLI.
  // Перечитываем раз в минуту, чтобы «истекает через N» не устаревало
  const [authInfo, setAuthInfo] = useState<Record<string, AuthInfo>>({})

  useEffect(() => {
    let alive = true
    const load = () => {
      accounts.forEach(async acc => {
        const info = await api.getAuthInfo(acc.configDir)
        if (alive) setAuthInfo(prev => ({ ...prev, [acc.id]: info }))
      })
    }
    load()
    const t = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(t) }
  }, [accounts])

  useEffect(() => {
    if (!pendingAuth) return
    pollRef.current = setInterval(async () => {
      const ok = await api.checkCredentials(pendingAuth.configDir)
      if (ok) {
        clearInterval(pollRef.current!)
        setPendingAuth(null)
        setCredStatus(prev => ({ ...prev, [pendingAuth.id]: true }))
        onAccountsChange()
      }
    }, 1500)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [pendingAuth])

  const handleCreate = async () => {
    const id = newName.trim()
    if (!id) return
    setCreating(true)
    try {
      const acc: Account = await api.createAccount(id)
      setNewName('')
      setPendingAuth(acc)
      api.openAuth(acc.configDir)
    } catch (e) {
      console.error('create account failed', e)
    } finally {
      setCreating(false)
    }
  }

  const handleLogin = (acc: Account) => {
    setPendingAuth(acc)
    api.openAuth(acc.configDir)
  }

  const handleConfirm = async () => {
    if (!confirm) return
    if (confirm.type === 'delete') {
      await api.deleteAccount(confirm.id)
      if (confirm.id === activeAccountId) {
        const other = accounts.find(a => a.id !== confirm.id)
        if (other) onSwitchAccount(other.id)
      }
    } else {
      await api.logoutAccount(confirm.id)
      setCredStatus(prev => ({ ...prev, [confirm.id]: false }))
      if (confirm.id === activeAccountId) {
        const other = accounts.find(a => a.id !== confirm.id && credStatus[a.id])
        if (other) onSwitchAccount(other.id)
      }
    }
    setConfirm(null)
    onAccountsChange()
  }

  const confirmAcc = confirm ? accounts.find(a => a.id === confirm.id) : null

  return (
    <div className="flex flex-col h-full">

      {/* Confirm modal */}
      {confirm && confirmAcc && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-bg-surface border border-border-default rounded-2xl shadow-2xl p-5 w-72 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-text-primary">
                {confirm.type === 'delete' ? 'Удалить аккаунт?' : 'Выйти из аккаунта?'}
              </span>
              <span className="text-[14px] text-text-muted">
                {confirm.type === 'delete'
                  ? <>Аккаунт <span className="text-text-secondary font-medium">{confirmAcc.name}</span> и его авторизация будут удалены. <span className="text-text-secondary font-medium">Сессии останутся</span> — они хранятся отдельно.</>
                  : <>Авторизация <span className="text-text-secondary font-medium">{confirmAcc.name}</span> будет сброшена. Сессии сохранятся.</>
                }
              </span>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirm(null)}
                className="px-3 py-1.5 rounded-lg text-[14px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleConfirm}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-[14px] transition-colors',
                  confirm.type === 'delete'
                    ? 'text-red-400 hover:text-red-300 bg-red-400/10 hover:bg-red-400/20'
                    : 'text-amber-400 hover:text-amber-300 bg-amber-400/10 hover:bg-amber-400/20',
                )}
              >
                {confirm.type === 'delete' ? 'Удалить' : 'Выйти'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-y-auto">
        <div className="flex w-full">
        {/* Content */}
        {/* Колонка прижата влево — как в настройках, иначе в широком окне
            контент уезжает в центр и слева остаётся пустота */}
        <div className="flex-1 py-8 px-10 space-y-6 max-w-[680px]">
          {tab === 'accounts' && (
            <div className="space-y-6">
              <PageHeader
                icon={Profile}
                title="Аккаунты"
                desc="Несколько логинов Claude — переключение без потери сессий"
              />

              {pendingAuth && (
                <div className="rounded-xl border px-3 py-3 flex items-center gap-2.5" style={{ borderColor: 'color-mix(in srgb, var(--accent) 20%, transparent)', backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 60%, transparent)' }} />
                  <p className="text-[13px] text-text-muted">
                    Waiting for login to <span className="text-text-secondary font-medium">{pendingAuth.name}</span>...
                  </p>
                </div>
              )}

              <div className="space-y-1">
                <p className="text-[12px] font-semibold text-text-muted uppercase tracking-[0.08em] px-0.5 mb-2">Аккаунты</p>
                {accounts.length === 0 && (
                  <p className="text-[13px] text-text-ghost px-1 py-4 text-center">No accounts yet</p>
                )}
                {accounts.map(acc => {
                  const isActive = acc.id === activeAccountId
                  const info = authInfo[acc.id]
                  // Пока authInfo не загрузился — опираемся на старую проверку,
                  // иначе карточка на миг показывала бы «не авторизован»
                  const isLoggedIn = info ? info.loggedIn : (credStatus[acc.id] ?? true)
                  const expired = info?.expired ?? false

                  return (
                    <div
                      key={acc.id}
                      className={cn(
                        'flex items-center gap-3.5 px-4 py-3.5 rounded-2xl border transition-colors',
                        !isActive && 'border-border-default bg-bg-surface hover:border-border-strong',
                      )}
                      style={isActive ? {
                        borderColor: 'color-mix(in srgb, var(--accent) 32%, transparent)',
                        backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)',
                      } : undefined}
                    >
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 relative"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 50%, transparent)' }}
                      >
                        <span className="text-[15px] font-semibold text-white">
                          {acc.name[0].toUpperCase()}
                        </span>
                        {/* Точка состояния: зелёная — живой, красная — истёк */}
                        <span
                          className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                          style={{
                            borderColor: 'var(--bg-surface)',
                            backgroundColor: !isLoggedIn || expired
                              ? 'var(--color-error)'
                              : 'var(--color-success)',
                          }}
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[14.5px] font-medium text-text-primary truncate">{acc.name}</span>
                          {isActive && (
                            <span
                              className="text-[10.5px] px-1.5 py-0.5 rounded shrink-0"
                              style={{
                                backgroundColor: 'var(--accent-wash)',
                                color: 'var(--accent)',
                              }}
                            >
                              активный
                            </span>
                          )}
                        </div>
                        <div className="text-[12px] text-text-muted truncate mt-0.5">
                          {!isLoggedIn || expired
                            ? <span style={{ color: 'var(--color-error)' }}>
                                {expired ? 'Сессия истекла — нужен повторный вход' : 'Не авторизован'}
                              </span>
                            : acc.email || 'Авторизован'}
                        </div>
                        {isLoggedIn && !expired && info?.refreshExpiresAt && (
                          <div className="text-[11.5px] text-text-faint mt-1">
                            Вход действует {relExpiry(info.refreshExpiresAt)}
                            {info.subscriptionType && ` · ${info.subscriptionType}`}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {!isActive && isLoggedIn && !expired && (
                          <button
                            onClick={() => !isRunning && onSwitchAccount(acc.id)}
                            disabled={isRunning}
                            title={isRunning ? 'Дождись завершения всех сессий' : 'Переключиться'}
                            className={cn(
                              'w-8 h-8 rounded-lg grid place-items-center transition-colors',
                              isRunning
                                ? 'text-text-ghost opacity-30 cursor-not-allowed'
                                : 'text-text-faint hover:text-accent hover:bg-surface-hover',
                            )}
                          >
                            <ArrowRight size={15} />
                          </button>
                        )}

                        {!isLoggedIn || expired ? (
                          <button
                            onClick={() => handleLogin(acc)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium bg-accent-wash text-accent border border-accent/25 hover:bg-accent/15 transition-colors"
                          >
                            <LogIn size={13} />
                            Войти
                          </button>
                        ) : (
                          <button
                            onClick={() => !isRunning && setConfirm({ type: 'logout', id: acc.id })}
                            disabled={isRunning}
                            title={isRunning ? 'Дождись завершения всех сессий' : 'Выйти'}
                            className={cn(
                              'w-8 h-8 rounded-lg grid place-items-center transition-colors',
                              isRunning ? 'text-text-ghost opacity-30 cursor-not-allowed' : 'text-text-faint hover:text-amber-400 hover:bg-amber-400/10',
                            )}
                          >
                            <LogOut size={15} />
                          </button>
                        )}

                        <button
                          onClick={() => !isRunning && accounts.length > 1 ? setConfirm({ type: 'delete', id: acc.id }) : undefined}
                          disabled={accounts.length <= 1 || isRunning}
                          title={accounts.length <= 1 ? 'Нельзя удалить единственный аккаунт' : isRunning ? 'Дождись завершения всех сессий' : 'Удалить аккаунт (сессии останутся)'}
                          className={cn(
                            'w-8 h-8 rounded-lg grid place-items-center transition-colors',
                            accounts.length <= 1 || isRunning
                              ? 'text-text-ghost opacity-30 cursor-not-allowed'
                              : 'text-text-faint hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10',
                          )}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="space-y-2">
                <p className="text-[12px] font-semibold text-text-muted uppercase tracking-[0.08em] px-0.5">Добавить аккаунт</p>
                <div className="flex gap-2">
                  <input
                    value={newName}
                    onChange={e => setNewName(e.target.value.replace(/[^a-zA-Zа-яА-ЯёЁ0-9 \-_.]/g, ''))}
                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                    placeholder="Account name (e.g. work)"
                    className="flex-1 bg-surface-hover border border-border-default rounded-xl px-3 py-2 text-[14px] text-text-primary placeholder:text-text-ghost outline-none transition-colors"
                    onFocus={e => (e.target.style.borderColor = 'color-mix(in srgb, var(--accent) 40%, transparent)')}
                    onBlur={e => (e.target.style.borderColor = '')}
                  />
                  <button
                    onClick={handleCreate}
                    disabled={!newName.trim() || creating}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium transition-colors shrink-0',
                      newName.trim() && !creating
                        ? 'text-white'
                        : 'bg-surface-hover text-text-faint cursor-not-allowed',
                    )}
                    style={newName.trim() && !creating ? {
                      backgroundColor: `color-mix(in srgb, var(--accent) ${addHov ? 90 : 70}%, transparent)`,
                    } : undefined}
                    onMouseEnter={() => setAddHov(true)}
                    onMouseLeave={() => setAddHov(false)}
                  >
                    <Plus size={13} />
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'stats' && (
            <StatsTab configDir={accounts.find(a => a.id === activeAccountId)?.configDir} />
          )}
        </div>
        </div>
      </div>
    </div>
  )
}
