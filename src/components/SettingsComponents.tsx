// UI-примитивы для SettingsPage — Section, ToggleRow, Dropdown, SelectRow, и т.д.
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Lock, ShieldCheck, ChevronDown, Check, FolderOpen } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { api } from '../lib/api.js'
import { applyTheme, saveActiveTheme } from '../lib/theme.js'

// PTY-recommended values — displayed in PtyOptSection
const PTY_ITEMS = [
  { label: 'Prompt suggestions',   value: 'off', locked: true,  desc: undefined },
  { label: 'Spinner tips',         value: 'off', locked: true,  desc: undefined },
  { label: 'Skip copy picker',     value: 'on',  locked: true,  desc: undefined },
  { label: 'Auto updates channel', value: 'rc',  locked: false, desc: 'Задержка обновлений до RC-версии' },
]

export function PtyOptSection({ applyPty, onToggle }: { applyPty: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-text-faint uppercase tracking-wider mb-2 px-1">PTY-оптимизации</div>
      <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden divide-y divide-white/5 mb-2">
        <div className="flex items-center justify-between px-4 py-3 gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[14px] text-text-secondary">
              <ShieldCheck size={13} className="text-orange-400/70 shrink-0" />
              Применять рекомендованные настройки
            </div>
            <div className="text-[12px] text-text-faint mt-0.5">Vael выставит оптимальные значения при каждом сохранении</div>
          </div>
          <button
            onClick={() => onToggle(!applyPty)}
            className={cn(
              'relative shrink-0 transition-colors duration-200 w-[42px] h-[26px] rounded-full',
              applyPty ? 'bg-[#34c759]' : 'bg-surface-active',
            )}
          >
            <span className={cn('absolute top-[3px] w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200', applyPty ? 'left-[19px]' : 'left-[3px]')} />
          </button>
        </div>
      </div>
      <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden divide-y divide-white/5">
        {PTY_ITEMS.map(item => (
          <div key={item.label} className="flex items-center justify-between px-4 py-3 gap-4 opacity-50">
            <div className="min-w-0">
              <div className="text-[14px] text-text-secondary flex items-center gap-1.5">
                {item.label}
                {item.locked && <Lock size={10} className="text-text-faint" />}
              </div>
              {item.desc && <div className="text-[12px] text-text-faint mt-0.5">{item.desc}</div>}
            </div>
            <span className="text-[13px] text-text-faint shrink-0">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg-surface border border-border-subtle rounded-xl px-4 py-3 flex items-center gap-3">
      <span className="text-[14px] text-text-secondary shrink-0">{label}</span>
      {children}
    </div>
  )
}

export function ThemePicker({ themes, activeThemeFile, setActiveThemeFile }: {
  themes: Array<{ file: string; name: string; vars: Record<string, string> }>
  activeThemeFile: string | null
  setActiveThemeFile: (f: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = themes.find(t => t.file === activeThemeFile)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors min-w-[140px] justify-between',
          'bg-surface-hover border border-border-default text-text-secondary hover:bg-surface-selected hover:border-border-strong',
          open && 'bg-surface-selected border-border-strong',
        )}
      >
        <span>{active?.name ?? 'Выбрать тему'}</span>
        <ChevronDown size={11} className={cn('text-text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-bg-elevated border border-border-default rounded-xl shadow-2xl shadow-black/60 z-50 overflow-hidden min-w-[180px] animate-in fade-in zoom-in-95 duration-100 origin-top-left">
          {themes.length === 0 && <div className="px-3 py-2 text-[13px] text-text-ghost">Темы не найдены</div>}
          {themes.map(t => {
            const isActive = activeThemeFile === t.file
            return (
              <button
                key={t.file}
                onClick={() => { applyTheme(t.vars); saveActiveTheme(t.file, t.vars); setActiveThemeFile(t.file); setOpen(false) }}
                className={cn('w-full flex items-center justify-between px-3 py-2 text-left text-[13px] transition-colors', isActive ? 'text-text-primary bg-surface-selected' : 'text-text-secondary hover:bg-surface-hover')}
              >
                {t.name}
                {isActive && <Check size={11} className="shrink-0 ml-3" style={{ color: 'var(--accent)' }} />}
              </button>
            )
          })}
          <div className="border-t border-border-subtle">
            <button
              onClick={() => { api.openThemesFolder(); setOpen(false) }}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-[12px] text-text-faint hover:text-text-muted transition-colors"
            >
              <FolderOpen size={10} />Открыть папку
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-text-faint uppercase tracking-wider mb-2 px-1">{label}</div>
      <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden divide-y divide-white/5">
        {children}
      </div>
    </div>
  )
}

export function ToggleRow({ label, desc, value, onChange, claude: isClaude }: {
  label: string; desc?: string; value: boolean; onChange: (v: boolean) => void; claude?: boolean
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[14px] text-text-secondary">
          {isClaude && <span className="w-1.5 h-1.5 rounded-full bg-orange-400/70 shrink-0" />}
          {label}
        </div>
        {desc && <div className="text-[12px] text-text-faint mt-0.5">{desc}</div>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={cn('relative w-9 h-5 rounded-full transition-colors shrink-0', !value && 'bg-surface-active')}
        style={value ? { backgroundColor: 'var(--accent)' } : undefined}
      >
        <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', value ? 'left-[18px]' : 'left-0.5')} />
      </button>
    </div>
  )
}

export function Dropdown({ value, options, onChange }: {
  value: string; options: (string | { value: string; label: string })[]; onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node) && panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
    }
    setOpen(v => !v)
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={handleOpen}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors min-w-[90px] justify-between',
          'bg-surface-hover border border-border-default text-text-secondary hover:bg-surface-selected hover:border-border-strong',
          open && 'bg-surface-selected border-border-strong',
        )}
      >
        <span className="capitalize">
          {(() => {
            const opt = options.find(o => typeof o === 'string' ? o === value : o.value === value)
            return opt ? (typeof opt === 'string' ? opt : opt.label) : value
          })()}
        </span>
        <ChevronDown size={11} className={cn('text-text-faint transition-transform duration-150', open && 'rotate-180')} />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 9999 }}
          className="min-w-[120px] bg-bg-elevated border border-border-default rounded-xl shadow-2xl shadow-black/60 overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-right"
        >
          <div className="p-1">
            {options.map(o => {
              const val = typeof o === 'string' ? o : o.value
              const lbl = typeof o === 'string' ? o : o.label
              return (
                <button
                  key={val}
                  onClick={() => { onChange(val); setOpen(false) }}
                  className={cn('w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[13px] capitalize transition-colors', val === value ? 'text-text-primary bg-surface-selected' : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover')}
                >
                  {lbl}
                  {val === value && <Check size={11} style={{ color: 'var(--accent)' }} />}
                </button>
              )
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export function SelectRow({ label, value, options, onChange, claude: isClaude }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void; claude?: boolean
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-1.5 text-[14px] text-text-secondary">
        {isClaude && <span className="w-1.5 h-1.5 rounded-full bg-orange-400/70 shrink-0" />}
        {label}
      </div>
      <Dropdown value={value} options={options} onChange={onChange} />
    </div>
  )
}

export function LockedRow({ label, desc, value }: { label: string; desc?: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 gap-4 opacity-50">
      <div className="min-w-0">
        <div className="text-[14px] text-text-secondary flex items-center gap-1.5">
          {label}
          <Lock size={10} className="text-text-faint" />
        </div>
        {desc && <div className="text-[12px] text-text-faint mt-0.5">{desc}</div>}
      </div>
      <span className="text-[13px] text-text-faint shrink-0">{value}</span>
    </div>
  )
}

export function PendingSection({ label, reason, children }: { label: string; reason: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2 px-1">
        <div className="text-[11px] font-medium text-text-ghost uppercase tracking-wider">{label}</div>
        <div className="text-[11px] text-text-ghost normal-case">— {reason}</div>
      </div>
      <div className="bg-bg-surface border border-white/4 rounded-xl overflow-hidden divide-y divide-white/4 opacity-45">
        {children}
      </div>
    </div>
  )
}

export function PendingRow({ label, desc }: { label: string; desc?: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2">
      <div className="min-w-0">
        <div className="text-[13px] text-text-muted">{label}</div>
        {desc && <div className="text-[11px] text-text-faint">{desc}</div>}
      </div>
      <span className="text-[11px] text-text-ghost shrink-0">—</span>
    </div>
  )
}

export function TextRow({ label, desc, value, placeholder, onChange, claude: isClaude }: {
  label: string; desc?: string; value: string; placeholder?: string; onChange: (v: string) => void; claude?: boolean
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[14px] text-text-secondary">
          {isClaude && <span className="w-1.5 h-1.5 rounded-full bg-orange-400/70 shrink-0" />}
          {label}
        </div>
        {desc && <div className="text-[12px] text-text-faint mt-0.5">{desc}</div>}
      </div>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onBlur={e => onChange(e.target.value)}
        className="w-28 bg-surface-selected border border-border-default rounded-lg px-2 py-1 text-[13px] text-text-secondary placeholder:text-text-ghost focus:outline-none focus:border-border-strong"
      />
    </div>
  )
}
