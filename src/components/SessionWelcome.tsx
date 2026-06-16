import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, ChevronDown, Check, Plus, Zap } from 'lucide-react'
import { loadCustomOptions } from '../lib/customOptions.js'

interface Option {
  value: string
  label: string
  sub?: string
}

function Dropdown({ label, value, options, onChange }: {
  label: string
  value: string
  options: Option[]
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const btnRef = useRef<HTMLButtonElement>(null)
  const selected = options.find(o => o.value === value)

  const openMenu = () => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const menuH = options.length * 48
    const above = spaceBelow < menuH + 8

    setMenuStyle({
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      ...(above
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
      zIndex: 9999,
    })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const fn = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-mono uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
      <button
        ref={btnRef}
        onClick={() => open ? setOpen(false) : openMenu()}
        className="flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm transition-colors duration-150"
        style={{
          background: open ? 'var(--surface-hover)' : 'var(--welcome-card)',
          border: '1.5px solid var(--border-default)',
          color: 'var(--text-primary)',
        }}
      >
        <div className="flex flex-col items-start">
          <span className="font-medium">{selected?.label ?? value}</span>
          {selected?.sub && (
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{selected.sub}</span>
          )}
        </div>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.15 }}
          style={{ color: 'var(--text-muted)' }}
        >
          <ChevronDown size={13} />
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            style={{
              ...menuStyle,
              background: 'var(--bg-elevated)',
              border: '1.5px solid var(--border-strong)',
              borderRadius: 10,
              overflow: 'hidden',
              boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ maxHeight: 48 * 4, overflowY: 'auto' }}>
            {options.map((opt, i) => (
              <motion.button
                key={opt.value}
                initial={{ opacity: 0, x: -3 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.02 }}
                onClick={() => { onChange(opt.value); setOpen(false) }}
                className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 transition-colors duration-100"
                style={{ color: opt.value === value ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div>
                  <div className="text-sm font-medium" style={{ color: opt.value === value ? 'var(--accent)' : 'inherit' }}>
                    {opt.label}
                  </div>
                  {opt.sub && (
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{opt.sub}</div>
                  )}
                </div>
                {opt.value === value && <Check size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
              </motion.button>
            ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

interface SessionConfig {
  model: string
  effort: string
  permissionMode: string
  prompt: string
}

interface Props {
  sessionTitle?: string
  isNew?: boolean
  config: SessionConfig
  onChange: (c: SessionConfig) => void
  onStart: (btnRect?: DOMRect) => void
  onSettings?: () => void
}

const MODELS: Option[] = [
  { value: 'claude-sonnet-4-6',          label: 'Sonnet 4.6', sub: 'claude-sonnet-4-6' },
  { value: 'claude-opus-4-8',            label: 'Opus 4.8',   sub: 'claude-opus-4-8' },
  { value: 'claude-fable-5',             label: 'Fable 5',    sub: 'claude-fable-5' },
  { value: 'claude-haiku-4-5-20251001',  label: 'Haiku 4.5',  sub: 'claude-haiku-4-5' },
]

const EFFORTS: Option[] = [
  { value: 'low',    label: 'Low',    sub: 'быстро, экономно' },
  { value: 'medium', label: 'Medium', sub: 'баланс' },
  { value: 'high',   label: 'High',   sub: 'глубже' },
  { value: 'xhigh',  label: 'X-High', sub: 'очень глубоко' },
  { value: 'max',    label: 'Max',    sub: 'максимум' },
]

const PERMISSIONS: Option[] = [
  { value: 'bypassPermissions', label: 'Bypass',       sub: 'пропустить все проверки' },
  { value: 'auto',              label: 'Auto',         sub: 'автоматически' },
  { value: 'acceptEdits',       label: 'Accept Edits', sub: 'принимать правки' },
  { value: 'default',           label: 'Default',      sub: 'стандартный' },
  { value: 'plan',              label: 'Plan',         sub: 'только планировать' },
]

const PROMPTS: Option[] = [
  { value: '', label: 'Нет', sub: 'без промпта' },
]

export function SessionWelcome({ sessionTitle, isNew = false, config, onChange, onStart, onSettings }: Props) {
  const color = isNew ? 'var(--success, #22c55e)' : 'var(--accent, #d97757)'
  const glow  = isNew ? 'var(--success-glow, rgba(34,197,94,0.18))' : 'var(--accent-glow, rgba(217,119,87,0.10))'
  const btnRef = useRef<HTMLButtonElement>(null)
  const [clicked, setClicked] = useState(false)

  const [customModels, setCustomModels]      = useState(() => loadCustomOptions('model'))
  const [customEfforts, setCustomEfforts]    = useState(() => loadCustomOptions('effort'))
  const [customPerms, setCustomPerms]        = useState(() => loadCustomOptions('permission'))

  useEffect(() => {
    const refresh = () => {
      setCustomModels(loadCustomOptions('model'))
      setCustomEfforts(loadCustomOptions('effort'))
      setCustomPerms(loadCustomOptions('permission'))
    }
    window.addEventListener('vaeli:customOptionsChanged', refresh)
    return () => window.removeEventListener('vaeli:customOptionsChanged', refresh)
  }, [])

  const allModels      = [...MODELS,      ...customModels]
  const allEfforts     = [...EFFORTS,     ...customEfforts]
  const allPermissions = [...PERMISSIONS, ...customPerms]
  const label = isNew ? 'новая сессия' : 'продолжить сессию'
  const btnText = isNew
    ? (clicked ? 'Запуск' : 'Начать')
    : 'Продолжить'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="absolute inset-0 flex items-center justify-center"
      style={{ background: 'var(--bg-base)' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[520px] px-4 flex flex-col gap-5"
      >
        <div className="flex flex-col gap-2">
          <div className="text-xs font-mono uppercase tracking-widest" style={{ color }}>
            {label}
          </div>
          {!isNew && sessionTitle && (
            <div className="flex items-center gap-2.5">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color, boxShadow: `0 0 8px ${glow}` }} />
              <div className="text-lg font-medium leading-snug overflow-hidden" style={{ color: 'var(--text-primary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, textOverflow: 'ellipsis' }}>
                {sessionTitle}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
          {onSettings && (
            <button
              onClick={onSettings}
              title="Добавить кастомные опции"
              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono uppercase tracking-wider transition-colors"
              style={{ color: 'var(--text-faint)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-muted)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}
            >
              <Plus size={10} />
              настроить
            </button>
          )}
        </div>

        {isNew ? (
          <div className="grid grid-cols-2 gap-3">
            <Dropdown label="модель"     value={config.model}          options={allModels}      onChange={v => onChange({ ...config, model: v })} />
            <Dropdown label="мышление"   value={config.effort}         options={allEfforts}     onChange={v => onChange({ ...config, effort: v })} />
            <Dropdown label="разрешения" value={config.permissionMode} options={allPermissions} onChange={v => onChange({ ...config, permissionMode: v })} />
            <Dropdown label="промпт"     value={config.prompt}         options={PROMPTS}        onChange={v => onChange({ ...config, prompt: v })} />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Dropdown label="модель"     value={config.model}          options={allModels}  onChange={v => onChange({ ...config, model: v })} />
              <Dropdown label="мышление"   value={config.effort}         options={allEfforts} onChange={v => onChange({ ...config, effort: v })} />
            </div>
            <div className="flex justify-center">
              <div className="w-[calc(50%-6px)]">
                <Dropdown label="разрешения" value={config.permissionMode} options={allPermissions} onChange={v => onChange({ ...config, permissionMode: v })} />
              </div>
            </div>
          </div>
        )}

        <motion.button
          ref={btnRef}
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => { setClicked(true); onStart(btnRef.current?.getBoundingClientRect()) }}
          className="welcome-start-btn w-full flex items-center justify-center gap-2 py-3 rounded-xl text-base font-semibold mt-1 overflow-hidden relative"
          style={{
            background: color,
            boxShadow: `0 0 20px ${glow}`,
            color: 'white',
            willChange: 'transform',
          }}
        >
          <span className="welcome-btn-glint" />
          {isNew
            ? (clicked ? <Zap size={13} fill="currentColor" /> : <Play size={11} fill="currentColor" />)
            : <Play size={11} fill="currentColor" />}
          {btnText}
        </motion.button>

        <style>{`
          .welcome-btn-glint {
            position: absolute;
            top: 0; left: -75%;
            width: 50%; height: 100%;
            background: linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.28) 50%, transparent 70%);
            transform: skewX(-20deg);
            pointer-events: none;
          }
          .welcome-start-btn:hover .welcome-btn-glint {
            animation: btn-glint 0.55s ease forwards;
          }
          @keyframes btn-glint {
            to { left: 130%; }
          }
        `}</style>
      </motion.div>
    </motion.div>
  )
}
