import { useEffect, useRef, useState } from 'react'
import { Settings, Users, ChevronDown, Check } from 'lucide-react'
import { Account } from '../types/index'
import { cn } from '../lib/utils.js'

interface Props {
  accounts: Account[]
  activeAccountId: string
  onSwitch: (id: string) => void
  onManage: () => void
  onSettings: () => void
}

export function AccountBar({ accounts, activeAccountId, onSwitch, onManage, onSettings }: Props) {
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
    <div ref={ref} className="relative px-2 py-2 border-t border-border-subtle">
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-2 rounded-lg transition-colors',
          'hover:bg-surface-hover',
          open && 'bg-surface-hover',
        )}
      >
        {/* Avatar */}
        <div className="w-8 h-8 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 60%, transparent)' }}>
          <span className="text-[13px] font-semibold text-text-primary">
            {(active?.name || '?')[0].toUpperCase()}
          </span>
        </div>

        <div className="flex-1 min-w-0 text-left">
          <div className="text-[14px] text-text-secondary truncate">{active?.name || 'No account'}</div>
          {active?.email && <div className="text-[12px] text-text-faint truncate">{active.email}</div>}
        </div>

        <ChevronDown size={14} className={cn('text-text-faint transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute bottom-full left-2 right-2 mb-1 bg-bg-elevated border border-border-default rounded-xl shadow-2xl overflow-hidden z-50">
          {/* Account list */}
          {accounts.length > 0 && (
            <div className="p-1">
              {accounts.map(acc => (
                <button
                  key={acc.id}
                  onClick={() => { if (acc.id !== activeAccountId) { onSwitch(acc.id) } setOpen(false) }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-surface-hover transition-colors"
                >
                  <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 50%, transparent)' }}>
                    <span className="text-[12px] font-semibold text-text-primary">
                      {acc.name[0].toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-[13px] text-text-secondary truncate">{acc.name}</div>
                    {acc.email && <div className="text-[11px] text-text-faint truncate">{acc.email}</div>}
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
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-surface-hover transition-colors text-[13px] text-text-muted hover:text-text-secondary"
            >
              <Users size={14} />
              Manage accounts
            </button>
            <button
              onClick={() => { onSettings(); setOpen(false) }}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-surface-hover transition-colors text-[13px] text-text-muted hover:text-text-secondary"
            >
              <Settings size={14} />
              Settings
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
