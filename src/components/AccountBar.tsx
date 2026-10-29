import { useEffect, useRef, useState } from 'react'
import { Settings, Users, ChevronDown, ChevronsUpDown, Check } from 'lucide-react'
import type { Account } from '../types/index'
import { cn } from '../lib/utils.js'
import { useAccountLimits, type LimitWindowView } from '../hooks/useAccountLimits.js'
import { t, LOCALE } from '../lib/i18n.js'

function agoText(ms: number): string {
  const m = Math.floor(ms / 60000)
  if (m < 1) return t("только что", "just now")
  if (m < 60) return t(`${m} мин назад`, `${m} min ago`)
  const h = Math.floor(m / 60)
  return h < 24 ? t(`${h} ч назад`, `${h} h ago`) : t(`${Math.floor(h / 24)} дн назад`, `${Math.floor(h / 24)} d ago`)
}

// Сколько до сброса: «35м», «4ч 30м», «3д 5ч»
function leftText(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60000))
  if (m < 60) return t(`${m}м`, `${m}m`)
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? t(`${h}ч ${m % 60}м`, `${h}h ${m % 60}m`) : t(`${h}ч`, `${h}h`)
  return h % 24 ? t(`${Math.floor(h / 24)}д ${h % 24}ч`, `${Math.floor(h / 24)}d ${h % 24}h`) : t(`${Math.floor(h / 24)}д`, `${Math.floor(h / 24)}d`)
}

function LimitBar({ label, w }: { label: string; w: LimitWindowView }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const color = w.pct >= 90 ? 'var(--color-error, #e0705c)' : w.pct >= 75 ? 'var(--color-warning, #d9a441)' : 'var(--accent)'
  const left = w.resetsAt - now
  return (
    <div className="limit-col">
      {label} · {w.pct}%{!w.passed && left > 0 && <span className="opacity-60"> ({leftText(left)})</span>}
      <div className="b"><i style={{ width: `${w.pct}%`, background: color }} /></div>
    </div>
  )
}

/** Лимиты плана под карточкой аккаунта: общие для всех сессий, видны в любом разделе */
function AccountLimitsStrip({ configDir }: { configDir: string | null | undefined }) {
  const limits = useAccountLimits(configDir)
  if (!limits) return null
  const when = (w: LimitWindowView) => w.passed ? t("окно уже сброшено", "window already reset")
    : t("сброс ", "resets ") + new Date(w.resetsAt).toLocaleString(LOCALE, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  const title = [
    limits.fiveHour && t(`5 часов: ${limits.fiveHour.pct}%, ${when(limits.fiveHour)}`, `5 hours: ${limits.fiveHour.pct}%, ${when(limits.fiveHour)}`),
    limits.weekly && t(`Неделя: ${limits.weekly.pct}%, ${when(limits.weekly)}`, `Week: ${limits.weekly.pct}%, ${when(limits.weekly)}`),
    t(`Обновлено ${agoText(limits.age)} — цифры приходят вместе с ответами модели`, `Updated ${agoText(limits.age)} — numbers arrive with model answers`),
  ].filter(Boolean).join('\n')
  return (
    <div className="flex gap-3 px-1 pb-2.5" title={title}>
      {limits.fiveHour && <LimitBar label={t("5ч", "5h")} w={limits.fiveHour} />}
      {limits.weekly && <LimitBar label={t("7д", "7d")} w={limits.weekly} />}
    </div>
  )
}

interface Props {
  accounts: Account[]
  activeAccountId: string
  isRunning?: boolean
  onSwitch: (id: string) => void
  onManage: () => void
  onSettings: () => void
}

export function AccountBar({ accounts, activeAccountId, isRunning, onSwitch, onManage, onSettings }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const active = accounts.find(a => a.id === activeAccountId)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative px-2.5 pt-2.5 pb-2 border-t border-border-subtle">
      <AccountLimitsStrip configDir={active?.configDir} />
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'w-full flex items-center gap-2.5 px-1 py-1 rounded-lg transition-colors hover:bg-surface-hover',
          open && 'bg-surface-hover',
        )}
      >
        {/* Avatar */}
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--accent)' }}>
          <span className="text-[13px] font-semibold text-white">
            {(active?.name || '?')[0].toUpperCase()}
          </span>
        </div>

        <div className="flex-1 min-w-0 text-left">
          <div className="text-[14px] text-text-primary truncate leading-tight">{active?.name || 'No account'}</div>
          {active?.email && <div className="text-[11.5px] text-text-muted truncate leading-tight">{active.email}</div>}
        </div>

        <ChevronsUpDown size={15} className="text-text-muted shrink-0" />
      </button>

      {open && (
        <div className="absolute bottom-full left-2 right-2 mb-1 bg-bg-elevated border border-border-default rounded-xl shadow-2xl overflow-hidden z-50">
          {/* Account list */}
          {accounts.length > 0 && (
            <div className="p-1">
              {accounts.map(acc => (
                <button
                  key={acc.id}
                  onClick={() => { if (acc.id !== activeAccountId && !isRunning) { onSwitch(acc.id) } setOpen(false) }}
                  disabled={acc.id !== activeAccountId && isRunning}
                  className={cn(
                    'w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-colors',
                    acc.id !== activeAccountId && isRunning ? 'opacity-40 cursor-not-allowed' : 'hover:bg-surface-hover',
                  )}
                >
                  <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 50%, transparent)' }}>
                    <span className="text-[13px] font-semibold text-text-primary">
                      {acc.name[0].toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-[14px] text-text-secondary truncate">{acc.name}</div>
                    {acc.email && <div className="text-[12px] text-text-faint truncate">{acc.email}</div>}
                  </div>
                  {acc.id === activeAccountId && <Check size={13} style={{ color: 'var(--accent)' }} />}
                </button>
              ))}
            </div>
          )}

          {accounts.length > 0 && <div className="border-t border-border-subtle mx-1" />}

          {/* Actions */}
          <div className="p-1">
            <button
              onClick={() => { onManage(); setOpen(false) }}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-surface-hover transition-colors text-[14px] text-text-muted hover:text-text-secondary"
            >
              <Users size={14} />
              {t("Управление аккаунтами", "Manage accounts")}
            </button>
            <button
              onClick={() => { onSettings(); setOpen(false) }}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-surface-hover transition-colors text-[14px] text-text-muted hover:text-text-secondary"
            >
              <Settings size={14} />
              {t("Настройки", "Settings")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
