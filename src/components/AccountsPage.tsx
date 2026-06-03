import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Plus, Trash2, LogOut, LogIn, RotateCcw } from 'lucide-react'
import { Account } from '../types/index'
import { api, StatsCache } from '../lib/api.js'
import { cn } from '../lib/utils.js'
import { WindowControls } from './WindowControls.js'

interface Props {
  accounts: Account[]
  activeAccountId: string
  onBack: () => void
  onAccountsChange: () => void
  onSwitchAccount: (id: string) => void
}

type ConfirmAction = { type: 'delete' | 'logout'; id: string }
type Tab = 'accounts' | 'stats'

// ── Stats helpers ──────────────────────────────────────────────
function fmtNumber(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function modelLabel(key: string) {
  const base = key.includes('opus') ? 'Opus' : key.includes('sonnet') ? 'Sonnet' : key.includes('haiku') ? 'Haiku' : key
  const m = key.match(/(\d+)[._-](\d+)/)
  return m ? `${base} ${m[1]}.${m[2]}` : base
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
function StatsTab() {
  const [stats, setStats] = useState<StatsCache | null>(null)
  const [filter, setFilter] = useState<'all' | '30d' | '7d'>('all')
  const [refreshing, setRefreshing] = useState(false)
  const [flashClass, setFlashClass] = useState<string>('')
  const prevTokens = useRef<number | null>(null)

  const loadStats = async (isRefresh = false) => {
    setRefreshing(true)
    const r = await api.getStats()
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

  useEffect(() => { loadStats(false) }, [])

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
  const totalSessions = activity.reduce((s, d) => s + d.sessionCount, 0)
  const activeDays = activity.length

  const totalInput = Object.values(stats.modelUsage).reduce((s, m) => s + m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens, 0)
  const totalOutput = Object.values(stats.modelUsage).reduce((s, m) => s + m.outputTokens, 0)
  const totalTokens = totalInput + totalOutput

  // Group models by base+version (e.g. "sonnet-4-6" → "Sonnet 4.6")
  function modelVersion(key: string): string {
    const m = key.match(/(\d+)[_-](\d+)/)
    if (m) return `${m[1]}.${m[2]}`
    return ''
  }
  function modelGroupKey(key: string): string {
    const base = key.includes('opus') ? 'opus' : key.includes('sonnet') ? 'sonnet' : key.includes('haiku') ? 'haiku' : key
    const ver = modelVersion(key)
    return ver ? `${base}-${ver}` : base
  }
  const modelGroups = new Map<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }>()
  for (const [key, u] of Object.entries(stats.modelUsage)) {
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

  return (
    <div className="space-y-6">
      {/* Filter + refresh */}
      <div className="flex items-center gap-1">
        {(['all', '30d', '7d'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-2.5 py-1 rounded-md text-[13px] transition-colors',
              filter === f
                ? 'text-text-primary bg-surface-active'
                : 'text-text-faint hover:text-text-secondary hover:bg-surface-hover'
            )}
          >
            {f === 'all' ? 'All' : f}
          </button>
        ))}
        <button
          onClick={() => loadStats(true)}
          disabled={refreshing}
          className="ml-auto p-1.5 rounded-md text-text-faint hover:text-text-secondary hover:bg-surface-hover transition-colors"
          title="Обновить"
        >
          <RotateCcw size={13} className={refreshing ? 'animate-spin' : 'transition-transform hover:rotate-180 duration-300'} />
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-3">
        {/* Tokens card with diagonal split */}
        <div className={cn("bg-bg-surface border border-border-default rounded-xl overflow-hidden relative col-span-1", flashClass)}>
          {/* diagonal line */}
          {/* diagonal line through center */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
            <line x1="40%" y1="100%" x2="60%" y2="0" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
          </svg>
          <div className="flex h-full">
            <div className="flex-1 px-3 py-3 flex flex-col gap-0.5">
              <span className="text-[11px] text-text-muted">In</span>
              <span className="text-[16px] font-semibold text-text-primary leading-tight">{fmtNumber(totalInput)}</span>
            </div>
            <div className="flex-1 px-3 py-3 flex flex-col gap-0.5 items-end">
              <span className="text-[11px] text-text-muted">Out</span>
              <span className="text-[16px] font-semibold text-text-primary leading-tight">{fmtNumber(totalOutput)}</span>
            </div>
          </div>
        </div>
        {[
          { label: 'Сообщения', value: fmtNumber(totalMessages) },
          { label: 'Сессии', value: fmtNumber(totalSessions) },
          { label: 'Активных дней', value: String(activeDays) },
        ].map(c => (
          <div key={c.label} className={cn("bg-bg-surface border border-border-default rounded-xl px-4 py-3 flex flex-col gap-1", flashClass)}>
            <span className="text-[12px] text-text-muted">{c.label}</span>
            <span className="text-[20px] font-semibold text-text-primary leading-tight">{c.value}</span>
          </div>
        ))}
      </div>

      {/* Activity grid */}
      <div>
        <p className="text-[11px] text-text-muted uppercase tracking-widest mb-3">Активность</p>
        <ActivityGrid activity={stats.dailyActivity} filter={filter} />
      </div>

      {/* Models */}
      <div>
        <p className="text-[11px] text-text-muted uppercase tracking-widest mb-3">Модели</p>
        <div className="space-y-3">
          {models.map(m => {
            const pct = totalModelTokens > 0 ? (m.total / totalModelTokens) * 100 : 0
            return (
              <div key={m.key} className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: modelColor(m.key) }} />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between mb-1">
                    <span className="text-[13px] text-text-secondary">{modelLabel(m.key)}</span>
                    <span className="text-[12px] text-text-faint">{fmtNumber(m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens)} in · {fmtNumber(m.outputTokens)} out</span>
                  </div>
                  <div className="h-1 rounded-full bg-bg-elevated overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: modelColor(m.key) }} />
                  </div>
                </div>
                <span className="text-[12px] text-text-faint w-10 text-right shrink-0">{pct.toFixed(1)}%</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────
export function AccountsPage({ accounts, activeAccountId, onBack, onAccountsChange, onSwitchAccount }: Props) {
  const [tab, setTab] = useState<Tab>('accounts')
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

  const TABS: { id: Tab; label: string }[] = [
    { id: 'accounts', label: 'Аккаунты' },
    { id: 'stats', label: 'Статистика' },
  ]

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
                  ? <><span className="text-text-secondary font-medium">{confirmAcc.name}</span> и все его сессии будут удалены безвозвратно.</>
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

      {/* Header */}
      <div className="flex items-center gap-2 px-4 border-b border-border-subtle shrink-0 app-drag-region h-10">
        <button
          onClick={onBack}
          className="p-1 rounded-md text-text-faint hover:text-text-secondary hover:bg-surface-hover transition-colors no-drag"
        >
          <ArrowLeft size={15} />
        </button>
        <span className="text-sm font-medium text-text-secondary flex-1">Manage accounts</span>
        <div className="no-drag">
          <WindowControls />
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-y-auto">
        <div className="flex w-full mx-auto max-w-6xl">
        {/* Sidebar */}
        <div className="w-44 shrink-0 py-4 px-3 flex flex-col gap-0.5">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'w-full text-left px-3 py-2 rounded-lg text-[14px] transition-all duration-150',
                'hover:bg-surface-hover active:scale-[0.98]',
                tab === t.id
                  ? 'text-text-primary bg-surface-selected font-medium'
                  : 'text-text-muted hover:text-text-secondary'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 py-5 px-8 space-y-5 border-l border-border-subtle overflow-y-auto">
          {tab === 'accounts' && (
            <div className="space-y-6">
              {pendingAuth && (
                <div className="rounded-xl border px-3 py-3 flex items-center gap-2.5" style={{ borderColor: 'color-mix(in srgb, var(--accent) 20%, transparent)', backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 60%, transparent)' }} />
                  <p className="text-[13px] text-text-muted">
                    Waiting for login to <span className="text-text-secondary font-medium">{pendingAuth.name}</span>...
                  </p>
                </div>
              )}

              <div className="space-y-1">
                <p className="text-[11px] text-text-faint uppercase tracking-widest px-1 mb-2">Accounts</p>
                {accounts.length === 0 && (
                  <p className="text-[13px] text-text-ghost px-1 py-4 text-center">No accounts yet</p>
                )}
                {accounts.map(acc => {
                  const isActive = acc.id === activeAccountId
                  const isLoggedIn = credStatus[acc.id] ?? true
                  return (
                    <div
                      key={acc.id}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors',
                        !isActive && 'border-border-subtle bg-surface-hover',
                        !isLoggedIn && 'opacity-60',
                      )}
                      style={isActive ? {
                        borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)',
                        backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)',
                      } : undefined}
                    >
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 50%, transparent)' }}>
                        <span className="text-[13px] font-semibold text-text-primary">
                          {acc.name[0].toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] text-text-secondary truncate">{acc.name}</p>
                        <p className="text-[11px] text-text-faint truncate">
                          {isLoggedIn ? acc.email || acc.configDir : 'Не авторизован'}
                        </p>
                      </div>
                      {isActive && isLoggedIn && (
                        <span className="text-[11px] shrink-0" style={{ color: 'color-mix(in srgb, var(--accent) 70%, transparent)' }}>active</span>
                      )}
                      <div className="flex items-center gap-1 shrink-0">
                        {!isLoggedIn ? (
                          <button
                            onClick={() => handleLogin(acc)}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[13px] text-text-muted hover:text-text-primary hover:bg-surface-active transition-colors"
                            title="Войти"
                          >
                            <LogIn size={12} />
                            Войти
                          </button>
                        ) : (
                          <button
                            onClick={() => setConfirm({ type: 'logout', id: acc.id })}
                            className="p-1 rounded transition-colors text-text-ghost hover:text-amber-400 hover:bg-amber-400/10"
                            title="Выйти (сохранить сессии)"
                          >
                            <LogOut size={13} />
                          </button>
                        )}
                        <button
                          onClick={() => accounts.length > 1 ? setConfirm({ type: 'delete', id: acc.id }) : undefined}
                          disabled={accounts.length <= 1}
                          className={cn(
                            'p-1 rounded transition-colors',
                            accounts.length > 1
                              ? 'text-text-ghost hover:text-red-400 hover:bg-red-400/10'
                              : 'text-text-ghost opacity-30 cursor-not-allowed',
                          )}
                          title={accounts.length <= 1 ? 'Нельзя удалить единственный аккаунт' : 'Удалить аккаунт'}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="space-y-2">
                <p className="text-[11px] text-text-faint uppercase tracking-widest px-1">Add account</p>
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

          {tab === 'stats' && <StatsTab />}
        </div>
        </div>
      </div>
    </div>
  )
}
