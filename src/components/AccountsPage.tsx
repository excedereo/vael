import { useState, useEffect, useRef, useMemo } from 'react'
import { Plus, Trash2, LogOut, LogIn, RotateCcw, ArrowRight, CircleAlert, MessageSquare, MessagesSquare, Flame, Wrench } from 'lucide-react'
import type { Account } from '../types/index'
import { api, type StatsCache, type StatsModelUsage, type AuthInfo } from '../lib/api.js'
import { cleanAccountName } from '../lib/accountName.js'
import { cn } from '../lib/utils.js'
import { useAccountsTab } from '../lib/sectionTabs.js'
import { useAccountLimits, type LimitWindowView } from '../hooks/useAccountLimits.js'
import { t, LOCALE } from '../lib/i18n.js'

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
  if (left <= 0) return t("истёк", "expired")
  const days = Math.floor(left / 86400000)
  if (days >= 1) return t(`ещё ${days} ${plural(days, t("день", "day"), t("дня", "days"), t("дней", "days"))}`, `${days} more ${days === 1 ? 'day' : 'days'}`)
  const hours = Math.floor(left / 3600000)
  if (hours >= 1) return t(`ещё ${hours} ${plural(hours, 'час', 'часа', 'часов')}`, `${hours} more ${hours === 1 ? 'hour' : 'hours'}`)
  return t("меньше часа", "less than an hour")
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
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '') + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

/**
 * Версия модели из её id.
 *
 * Поколение 5 именуется одним числом (`claude-opus-5`), 4.x — двумя через
 * дефис (`claude-opus-4-8`). Суффикс даты (`claude-haiku-4-5-20251001`)
 * в версию не входит.
 */
function modelVersionOf(key: string): string {
  const m = key.match(/(?:opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/)
  if (!m) return ''
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

// Модели красим оттенками акцента по месту в списке, а не по семейству
const MODEL_COLORS = ['var(--accent)', 'var(--accent-hi)', 'var(--accent-deep)', 'rgba(255,255,255,0.35)', 'rgba(255,255,255,0.2)']

// Три слоя расхода — в главной полосе, столбиках по дням и подсказках
const C_CACHE = 'color-mix(in srgb, var(--accent) 35%, transparent)'
const C_INPUT = 'var(--accent)'
const C_OUTPUT = 'var(--accent-hi)'

const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const MONTHS = [t("янв", "Jan"), t("фев", "Feb"), t("мар", "Mar"), t("апр", "Apr"), t("май", "May"), t("июн", "Jun"), t("июл", "Jul"), t("авг", "Aug"), t("сен", "Sep"), t("окт", "Oct"), t("ноя", "Nov"), t("дек", "Dec")]
const fmtDay = (key: string) => { const [, m, d] = key.split('-').map(Number); return `${d} ${MONTHS[m - 1]}` }

/** Последние n дней, от старого к сегодняшнему */
function lastDays(n: number): string[] {
  const out: string[] = []
  const d = new Date(); d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - n + 1)
  for (let i = 0; i < n; i++) { out.push(dayKey(d)); d.setDate(d.getDate() + 1) }
  return out
}

type DayUsage = { cache: number; input: number; output: number }

function dayUsage(stats: StatsCache, day: string): DayUsage {
  const r = { cache: 0, input: 0, output: 0 }
  for (const u of Object.values(stats.dailyModelUsage?.[day] ?? {})) {
    r.cache += u.cacheReadInputTokens
    r.input += u.inputTokens + u.cacheCreationInputTokens
    r.output += u.outputTokens
  }
  return r
}

/** Текущая серия (сегодня ещё пусто — считаем со вчера) и рекорд */
function streaks(active: Set<string>): { current: number; best: number } {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  if (!active.has(dayKey(d))) d.setDate(d.getDate() - 1)
  let current = 0
  while (active.has(dayKey(d))) { current++; d.setDate(d.getDate() - 1) }
  const sorted = [...active].sort()
  let best = 0, run = 0, prev: number | null = null
  for (const k of sorted) {
    const t = new Date(k + 'T00:00:00').getTime()
    run = prev !== null && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1
    best = Math.max(best, run)
    prev = t
  }
  return { current, best }
}

// ── По дням: столбики кэш / вход / выход ───────────────────────
function DailyChart({ stats, days }: { stats: StatsCache; days: string[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const data = days.map(d => dayUsage(stats, d))
  const max = Math.max(1, ...data.map(u => u.cache + u.input + u.output))
  const msgs = new Map(stats.dailyActivity.map(a => [a.date, a]))
  const ticks = [0, Math.floor(days.length / 4), Math.floor(days.length / 2), Math.floor(days.length * 3 / 4), days.length - 1]
  const h = hover != null ? data[hover] : null
  const ha = hover != null ? msgs.get(days[hover]) : null
  return (
    <div>
      <div className="st-chart" onMouseLeave={() => setHover(null)}>
        {data.map((u, i) => {
          const total = u.cache + u.input + u.output
          return (
            <div key={i} className={cn('st-col', hover === i && 'is-hover')} onMouseEnter={() => setHover(i)}>
              <div className="st-bar" style={{ height: `${(total / max) * 100}%` }}>
                {total > 0 && <>
                  <i style={{ flex: u.output, background: C_OUTPUT }} />
                  <i style={{ flex: u.input, background: C_INPUT }} />
                  <i style={{ flex: u.cache, background: C_CACHE }} />
                </>}
              </div>
            </div>
          )
        })}
        {h && hover != null && (
          <div className="st-tip" style={{ left: `${((hover + 0.5) / days.length) * 100}%` }}>
            <b>{fmtDay(days[hover])}</b>
            {h.cache + h.input + h.output > 0
              ? <div>{t("кэш", "cache")}{' '}{fmtNumber(h.cache)} {t("· вход", "· input")}{' '}{fmtNumber(h.input)} {t("· выход", "· output")}{' '}{fmtNumber(h.output)}</div>
              : <div>{t("без активности", "no activity")}</div>}
            {ha && <div>{ha.messageCount} {plural(ha.messageCount, t("сообщение", "message"), t("сообщения", "messages"), t("сообщений", "messages"))} · {ha.sessionCount} {plural(ha.sessionCount, t("сессия", "session"), t("сессии", "sessions"), t("сессий", "sessions"))}</div>}
          </div>
        )}
      </div>
      <div className="st-axis">{ticks.map((t, i) => <span key={i}>{fmtDay(days[t])}</span>)}</div>
    </div>
  )
}

// ── По часам суток: наводиться можно на всю колонку, не только на столбик ──
function HoursChart({ hours, max }: { hours: number[]; max: number }) {
  const [hover, setHover] = useState<number | null>(null)
  return (
    <div className="st-chart st-hours" onMouseLeave={() => setHover(null)}>
      {hours.map((v, i) => (
        <div key={i} className={cn('st-col', hover === i && 'is-hover')} onMouseEnter={() => setHover(i)}>
          <div className="st-bar" style={{ height: `${Math.max(3, (v / max) * 100)}%`, background: 'var(--accent)', opacity: 0.3 + (v / max) * 0.7 }} />
        </div>
      ))}
      {hover != null && (
        <div className="st-tip" style={{ left: `${((hover + 0.5) / 24) * 100}%` }}>
          <b>{pad(hover)}:00 — {pad((hover + 1) % 24)}:00</b>
          <div>{hours[hover]} {plural(hours[hover], t("сообщение", "message"), t("сообщения", "messages"), t("сообщений", "messages"))}</div>
        </div>
      )}
    </div>
  )
}

// ── Тепловая карта за полгода, на всю ширину ──────────────────
function Heatmap({ activity }: { activity: { date: string; messageCount: number }[] }) {
  const byDate = new Map(activity.map(d => [d.date, d.messageCount]))
  const weeks = 26
  const today = new Date(); today.setHours(0, 0, 0, 0)
  // Начинаем с понедельника, чтобы строки совпадали с днями недели
  const start = new Date(today)
  start.setDate(start.getDate() - (weeks - 1) * 7 - ((today.getDay() + 6) % 7))
  const cells: { key: string; count: number; future: boolean }[] = []
  const monthAt: (string | null)[] = []
  const cur = new Date(start)
  for (let w = 0; w < weeks; w++) {
    monthAt.push(w === 0 || cur.getDate() <= 7 ? MONTHS[cur.getMonth()] : null)
    for (let d = 0; d < 7; d++) {
      const key = dayKey(cur)
      cells.push({ key, count: byDate.get(key) ?? 0, future: cur > today })
      cur.setDate(cur.getDate() + 1)
    }
  }
  const max = Math.max(1, ...cells.map(c => c.count))
  return (
    <div>
      <div className="st-months" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }}>
        {monthAt.map((m, i) => <span key={i}>{m ?? ''}</span>)}
      </div>
      <div className="st-heat" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }}>
        {cells.map(c => (
          <i
            key={c.key}
            title={c.future ? undefined : t(`${fmtDay(c.key)}: ${c.count} ${plural(c.count, t("сообщение", "message"), t("сообщения", "messages"), t("сообщений", "messages"))}`, `${fmtDay(c.key)}: ${c.count} ${c.count === 1 ? 'message' : 'messages'}`)}
            style={c.future ? { background: 'transparent' } : c.count ? { background: `color-mix(in srgb, var(--accent) ${Math.round((0.18 + (c.count / max) * 0.82) * 100)}%, transparent)` } : undefined}
          />
        ))}
      </div>
    </div>
  )
}

// ── Stats tab ─────────────────────────────────────────────────
function StatsTab({ configDir }: { configDir?: string }) {
  const [stats, setStats] = useState<StatsCache | null>(null)
  const [filter, setFilter] = useState<'all' | '30d' | '7d'>('30d')
  const [refreshing, setRefreshing] = useState(false)

  const loadStats = async () => {
    setRefreshing(true)
    // Статистика считается по логам активного аккаунта — без configDir
    // main возьмёт дефолтный ~/.claude, где давно ничего не пишется
    const r = await api.getStats(configDir)
    if (r.ok && r.data) setStats(r.data)
    setRefreshing(false)
  }

  useEffect(() => { loadStats() }, [configDir])

  const view = useMemo(() => {
    if (!stats) return null
    const periodDays = filter === '7d' ? 7 : filter === '30d' ? 30 : null
    const inPeriod = periodDays ? new Set(lastDays(periodDays)) : null
    const activity = stats.dailyActivity.filter(d => !inPeriod || inPeriod.has(d.date))

    const totalMessages = activity.reduce((s, d) => s + d.messageCount, 0)
    const toolCalls = activity.reduce((s, d) => s + d.toolCallCount, 0)
    // Сессии — по уникальным id: сессия, шедшая несколько дней, попадает в каждый из них
    const uniq = new Set<string>()
    for (const d of activity) for (const id of d.sessionIds ?? []) uniq.add(id)
    const totalSessions = uniq.size || activity.reduce((s, d) => s + d.sessionCount, 0)

    // Расход по моделям за период — из подневной разбивки, за всё время — из суммарной
    const usageByModel: Record<string, StatsModelUsage> = {}
    const add = (model: string, u: StatsModelUsage) => {
      const acc = usageByModel[model] ?? (usageByModel[model] = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 })
      acc.inputTokens += u.inputTokens
      acc.outputTokens += u.outputTokens
      acc.cacheReadInputTokens += u.cacheReadInputTokens
      acc.cacheCreationInputTokens += u.cacheCreationInputTokens
    }
    if (!inPeriod) for (const [m, u] of Object.entries(stats.modelUsage)) add(m, u)
    else for (const [date, byModel] of Object.entries(stats.dailyModelUsage ?? {})) {
      if (inPeriod.has(date)) for (const [m, u] of Object.entries(byModel)) add(m, u)
    }

    let cache = 0, input = 0, output = 0
    for (const u of Object.values(usageByModel)) {
      cache += u.cacheReadInputTokens
      input += u.inputTokens + u.cacheCreationInputTokens
      output += u.outputTokens
    }

    // Варианты одной модели (с датой сборки и без) — одной строкой
    const groups = new Map<string, number>()
    for (const [key, u] of Object.entries(usageByModel)) {
      const label = modelLabel(key)
      groups.set(label, (groups.get(label) ?? 0) + u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens + u.outputTokens)
    }
    const models = [...groups.entries()].map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total)
    const modelsTotal = models.reduce((s, m) => s + m.total, 0)

    // Самые затратные сессии за период
    const bySession = new Map<string, number>()
    for (const [date, m] of Object.entries(stats.dailySessionTokens ?? {})) {
      if (inPeriod && !inPeriod.has(date)) continue
      for (const [id, t] of Object.entries(m)) bySession.set(id, (bySession.get(id) ?? 0) + t)
    }
    const topSessions = [...bySession.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

    const activeSet = new Set(stats.dailyActivity.filter(d => d.messageCount > 0).map(d => d.date))
    const streak = streaks(activeSet)

    // Пик по часам — окно из четырёх часов с наибольшим числом сообщений
    const hours = stats.hourCounts ?? new Array(24).fill(0)
    let peakStart = 0, peakSum = -1
    for (let i = 0; i < 24; i++) {
      const s = hours[i] + hours[(i + 1) % 24] + hours[(i + 2) % 24] + hours[(i + 3) % 24]
      if (s > peakSum) { peakSum = s; peakStart = i }
    }

    const chartDays = lastDays(periodDays ?? 90)
    const daysCount = periodDays ?? Math.max(1, activity.length)
    return { totalMessages, toolCalls, totalSessions, cache, input, output, models, modelsTotal, topSessions, streak, hours, peakStart, chartDays, daysCount, activeDays: activeSet.size }
  }, [stats, filter])

  if (!stats || !view) return (
    <div className="flex items-center justify-center h-48 text-text-faint text-[13px]">
      {t("Загрузка...", "Loading...")}
    </div>
  )

  const total = view.cache + view.input + view.output
  const maxHour = Math.max(1, ...view.hours)
  const periodLabel = filter === 'all' ? t("за всё время", "all time") : filter === '30d' ? t("за 30 дней", "last 30 days") : t("за 7 дней", "last 7 days")

  return (
    <div className="st-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="st-h2">{t("Статистика", "Statistics")}</h2>
          <p className="st-desc">{t("По логам сессий активного аккаунта", "From the active account's session logs")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="st-seg">
            {([['all', t("Всё время", "All time")], ['30d', t("30 дней", "30 days")], ['7d', t("7 дней", "7 days")]] as const).map(([id, label]) => (
              <button key={id} onClick={() => setFilter(id)} className={cn(filter === id && 'is-on')}>{label}</button>
            ))}
          </div>
          <button onClick={loadStats} disabled={refreshing} className="st-icon-btn" title={t("Пересчитать", "Recount")}>
            <RotateCcw size={15} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Главная цифра и из чего она сложилась */}
      <div className="st-card st-hero">
        <div>
          <div className="st-lbl mb-2">{t("Токенов", "Tokens")}{' '}{periodLabel}</div>
          <div className="st-big" title={t(`${total.toLocaleString(LOCALE)} токенов`, `${total.toLocaleString('en-US')} tokens`)}>{fmtNumber(total)}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="st-split">
            <i style={{ flex: view.cache, background: C_CACHE }} />
            <i style={{ flex: view.input, background: C_INPUT }} />
            <i style={{ flex: view.output, background: C_OUTPUT }} />
          </div>
          <div className="st-legend">
            <span title={t("Каждый запрос заново читает весь контекст из кэша. Стоит 10% обычного входа, но на длинных сессиях это основная часть расхода", "Every request reads the whole context from cache again. It costs 10% of normal input, but on long sessions it is most of the usage")}><i style={{ background: C_CACHE }} />{t("Чтение кэша", "Cache reads")}{' '}<b>{fmtNumber(view.cache)}</b></span>
            <span title={t("Сообщения, результаты инструментов и запись в кэш", "Messages, tool results and cache writes")}><i style={{ background: C_INPUT }} />{t("Новый вход", "New input")}{' '}<b>{fmtNumber(view.input)}</b></span>
            <span title={t("Что сгенерировала модель, включая размышления", "What the model generated, including thinking")}><i style={{ background: C_OUTPUT }} />{t("Выход", "Output")}{' '}<b>{fmtNumber(view.output)}</b></span>
          </div>
        </div>
      </div>

      <div className="st-kpis">
        <div className="st-kpi">
          <div className="k"><MessageSquare size={13} />{t("Сообщения", "Messages")}</div>
          <div className="v">{fmtNumber(view.totalMessages)}</div>
          <div className="s">≈ {fmtNumber(Math.round(view.totalMessages / view.daysCount))} {t("в день", "per day")}</div>
        </div>
        <div className="st-kpi">
          <div className="k"><MessagesSquare size={13} />{t("Сессии", "Sessions")}</div>
          <div className="v">{view.totalSessions}</div>
          <div className="s">{periodLabel}</div>
        </div>
        <div className="st-kpi">
          <div className="k"><Flame size={13} />{t("Серия", "Streak")}</div>
          <div className="v">{view.streak.current} {plural(view.streak.current, t("день", "day"), t("дня", "days"), t("дней", "days"))}</div>
          <div className="s">{t("рекорд —", "record —")}{' '}{view.streak.best}</div>
        </div>
        <div className="st-kpi">
          <div className="k"><Wrench size={13} />{t("Вызовы инструментов", "Tool calls")}</div>
          <div className="v">{fmtNumber(view.toolCalls)}</div>
          <div className="s">{view.totalMessages ? t(`${(view.toolCalls / view.totalMessages * 100).toFixed(0)}% от сообщений`, `${(view.toolCalls / view.totalMessages * 100).toFixed(0)}% of messages`) : '—'}</div>
        </div>
      </div>

      <div className="st-card">
        <div className="flex items-baseline justify-between mb-1">
          <span className="st-title">{t("По дням", "By day")}</span>
          <span className="st-lbl">{filter === 'all' ? t("последние 90 дней · ", "last 90 days · ") : ''}{t("наведи на столбик", "hover a bar")}</span>
        </div>
        <DailyChart stats={stats} days={view.chartDays} />
      </div>

      <div className="st-two">
        <div className="st-card flex flex-col">
          <div className="st-title mb-3">{t("Когда ты работаешь", "When you work")}</div>
          <HoursChart hours={view.hours} max={maxHour} />
          <div className="st-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
          <div className="st-lbl mt-2.5">{t("Пик — с", "Peak — from")}{' '}{pad(view.peakStart)} {t("до", "to")}{' '}{pad((view.peakStart + 4) % 24)}{t(", за всё время", ", all time")}</div>
        </div>
        <div className="st-card">
          <div className="st-title mb-1">{t("Модели", "Models")}</div>
          {view.models.length === 0 && <div className="st-lbl py-4 text-center">{t("Нет данных за период", "No data for this period")}</div>}
          {view.models.map((m, i) => {
            const pct = view.modelsTotal ? (m.total / view.modelsTotal) * 100 : 0
            return (
              <div key={m.label} className="st-model">
                <div className="flex justify-between text-[13.5px]"><span>{m.label}</span><span className="text-text-muted tabular-nums">{pct.toFixed(pct < 10 ? 1 : 0)}%</span></div>
                <div className="st-track"><i style={{ width: `${pct}%`, background: MODEL_COLORS[Math.min(i, MODEL_COLORS.length - 1)] }} /></div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="st-two">
        <div className="st-card">
          <div className="st-title mb-1">{t("Самые затратные сессии", "Most expensive sessions")}</div>
          {view.topSessions.length === 0 && <div className="st-lbl py-4 text-center">{t("Нет данных за период", "No data for this period")}</div>}
          {view.topSessions.map(([id, t], i) => (
            <div key={id} className="st-top">
              <span className="rk">{i + 1}</span>
              <span className="n" title={stats.sessionTitles?.[id] ?? id}>{stats.sessionTitles?.[id] ?? id.slice(0, 8)}</span>
              <span className="v">{fmtNumber(t)}</span>
            </div>
          ))}
        </div>
        <div className="st-card">
          <div className="st-title mb-2.5">{t("Активность за полгода", "Activity over half a year")}</div>
          <Heatmap activity={stats.dailyActivity} />
          <div className="st-streak">
            <span>{t("Активных дней", "Active days")}{' '}<b>{view.activeDays}</b></span>
            <span>{t("Серия", "Streak")}{' '}<b>{view.streak.current}</b></span>
            <span>{t("Рекорд", "Record")}{' '}<b>{view.streak.best}</b></span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Карточка аккаунта ─────────────────────────────────────────
function LimitTile({ label, w }: { label: string; w: LimitWindowView | null | undefined }) {
  const resetText = w && !w.passed
    ? t("сброс ", "resets ") + new Date(w.resetsAt).toLocaleString(LOCALE, new Date(w.resetsAt).toDateString() === new Date().toDateString() ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : w ? t("окно сброшено", "window reset") : t("нет данных", "no data")
  const pct = w ? (w.passed ? 0 : w.pct) : 0
  const color = pct >= 90 ? 'var(--color-error, #e0705c)' : pct >= 75 ? 'var(--color-warning, #d9a441)' : 'var(--accent)'
  return (
    <div className="acc-tile">
      <div className="k"><span>{label}</span><span>{resetText}</span></div>
      <div className="v">{w ? `${pct}%` : '—'}</div>
      <div className="b"><i style={{ width: `${pct}%`, background: color }} /></div>
    </div>
  )
}

function AccountCard({ acc, isActive, info, isLoggedIn, expired, isRunning, canDelete, onSwitch, onLogin, onLogout, onDelete }: {
  acc: Account
  isActive: boolean
  info?: AuthInfo
  isLoggedIn: boolean
  expired: boolean
  isRunning?: boolean
  canDelete: boolean
  onSwitch: () => void
  onLogin: () => void
  onLogout: () => void
  onDelete: () => void
}) {
  const limits = useAccountLimits(isLoggedIn && !expired ? acc.configDir : null)
  const ok = isLoggedIn && !expired
  const sub = ok
    ? [acc.email, info?.refreshExpiresAt ? t(`вход действует ${relExpiry(info.refreshExpiresAt)}`, `login valid ${relExpiry(info.refreshExpiresAt)}`) : null].filter(Boolean).join(' · ')
    : null
  const busy = isRunning ? t("Дождись завершения всех сессий", "Wait until all sessions finish") : undefined
  return (
    <div className={cn('acc-card', isActive && 'is-active')}>
      <div className="acc-head">
        <div className={cn('acc-av', !ok && 'is-off')}>
          {acc.name[0].toUpperCase()}
          <span className="st" style={{ background: ok ? '#5fb98a' : 'var(--color-error, #e0705c)' }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="acc-name">
            <span className="truncate">{acc.name}</span>
            {isActive && <span className="acc-badge is-acc">{t("активный", "active")}</span>}
            {info?.subscriptionType && <span className="acc-badge">{info.subscriptionType[0].toUpperCase() + info.subscriptionType.slice(1)}</span>}
          </div>
          <div className="acc-sub">{sub || (expired ? t("Вход истёк", "Login expired") : t("Не авторизован", "Not logged in"))}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isActive && ok && (
            <button onClick={() => !isRunning && onSwitch()} disabled={isRunning} title={busy ?? t("Переключиться", "Switch")} className="acc-btn">
              {t("Переключиться", "Switch")}<ArrowRight size={14} />
            </button>
          )}
          {!ok ? (
            <button onClick={onLogin} className="acc-btn is-primary"><LogIn size={14} />{t("Войти", "Log in")}</button>
          ) : (
            <button onClick={() => !isRunning && onLogout()} disabled={isRunning} title={busy ?? t("Выйти", "Log out")} className="acc-icon hover:!text-amber-400">
              <LogOut size={15} />
            </button>
          )}
          <button
            onClick={() => !isRunning && canDelete && onDelete()}
            disabled={!canDelete || isRunning}
            title={busy ?? t("Удалить аккаунт (сессии останутся)", "Delete account (sessions stay)")}
            className="acc-icon hover:!text-[var(--color-error)]"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {ok ? (
        <div className="acc-tiles">
          <LimitTile label={t("5 часов", "5 hours")} w={limits?.fiveHour} />
          <LimitTile label={t("Неделя", "Week")} w={limits?.weekly} />
        </div>
      ) : (
        <div className="acc-warn">
          <CircleAlert size={14} className="shrink-0" />
          {expired ? t("Вход истёк — сессии этого аккаунта видны, но запустить их нельзя, пока не войдёшь заново", "Login expired — this account's sessions are visible but can't be started until you log in again") : t("Не авторизован — сессии этого аккаунта видны, но запустить их нельзя", "Not logged in — this account's sessions are visible but can't be started")}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────
export function AccountsPage({ accounts, activeAccountId, isRunning, onAccountsChange, onSwitchAccount }: Props) {
  const tab = useAccountsTab()
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [creating, setCreating] = useState(false)
  const [pendingAuth, setPendingAuth] = useState<Account | null>(null)
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
      setAdding(false)
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
          <div className="bg-bg-elevated border border-border-default rounded-2xl shadow-2xl p-5 w-80 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-[15px] font-medium text-text-primary">
                {confirm.type === 'delete' ? t("Удалить аккаунт?", "Delete account?") : t("Выйти из аккаунта?", "Log out of account?")}
              </span>
              <span className="text-[13.5px] text-text-muted">
                {confirm.type === 'delete'
                  ? <>{t("Аккаунт", "Account")}{' '}<span className="text-text-secondary font-medium">{confirmAcc.name}</span> {t("и его авторизация будут удалены.", "and its login will be deleted.")}{' '}<span className="text-text-secondary font-medium">{t("Сессии останутся", "Sessions stay")}</span> {t("— они хранятся отдельно.", "— they are stored separately.")}{accounts.length === 1 && <><br /><br /><span className="text-text-secondary font-medium">{t("Это последний аккаунт", "This is the last account")}</span> {t("— Vael вернётся на стартовый экран, где можно добавить новый.", "— Vael will return to the start screen, where you can add a new one.")}</>}</>
                  : <>{t("Авторизация", "The login of")}{' '}<span className="text-text-secondary font-medium">{confirmAcc.name}</span> {t("будет сброшена. Сессии сохранятся.", "will be reset. Sessions are kept.")}</>
                }
              </span>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirm(null)}
                className="px-3 py-1.5 rounded-lg text-[14px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              >
                {t("Отмена", "Cancel")}
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
                {confirm.type === 'delete' ? t("Удалить", "Delete") : t("Выйти", "Log out")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto thin-scroll">
        <div className="py-8 px-10 max-w-[860px]">
          {tab === 'accounts' && (
            <div className="st-page">
              <div>
                <h2 className="st-h2">{t("Аккаунты", "Accounts")}</h2>
                <p className="st-desc">{t("Несколько логинов Claude — переключение без потери сессий", "Several Claude logins — switch without losing sessions")}</p>
              </div>

              {pendingAuth && (
                <div className="acc-pending">
                  <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse shrink-0 bg-accent" />
                  {t("Жду вход в", "Waiting for login to")}{' '}<span className="text-text-primary font-medium">{pendingAuth.name}</span> {t("— заверши авторизацию в открывшемся окне", "— finish logging in in the window that opened")}
                </div>
              )}

              {accounts.length === 0 && <p className="st-lbl py-4 text-center">{t("Аккаунтов пока нет", "No accounts yet")}</p>}
              {accounts.map(acc => {
                const info = authInfo[acc.id]
                // Пока authInfo не загрузился — опираемся на старую проверку,
                // иначе карточка на миг показывала бы «не авторизован»
                const isLoggedIn = info ? info.loggedIn : (credStatus[acc.id] ?? true)
                return (
                  <AccountCard
                    key={acc.id}
                    acc={acc}
                    isActive={acc.id === activeAccountId}
                    info={info}
                    isLoggedIn={isLoggedIn}
                    expired={info?.expired ?? false}
                    isRunning={isRunning}
                    canDelete
                    onSwitch={() => onSwitchAccount(acc.id)}
                    onLogin={() => handleLogin(acc)}
                    onLogout={() => setConfirm({ type: 'logout', id: acc.id })}
                    onDelete={() => setConfirm({ type: 'delete', id: acc.id })}
                  />
                )
              })}

              {adding ? (
                <div className="acc-add is-open">
                  <input
                    autoFocus
                    value={newName}
                    onChange={e => setNewName(cleanAccountName(e.target.value))}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setAdding(false); setNewName('') } }}
                    placeholder={t("Название аккаунта, например work", "Account name, e.g. work")}
                  />
                  <button onClick={() => { setAdding(false); setNewName('') }} className="acc-btn">{t("Отмена", "Cancel")}</button>
                  <button onClick={handleCreate} disabled={!newName.trim() || creating} className="acc-btn is-primary disabled:opacity-40">
                    {creating ? t("Создаю…", "Creating…") : t("Создать и войти", "Create and log in")}
                  </button>
                </div>
              ) : (
                <button className="acc-add" onClick={() => setAdding(true)}>
                  <Plus size={15} />{t("Добавить аккаунт", "Add account")}
                </button>
              )}
            </div>
          )}

          {tab === 'stats' && (
            <StatsTab configDir={accounts.find(a => a.id === activeAccountId)?.configDir} />
          )}
        </div>
      </div>
    </div>
  )
}
