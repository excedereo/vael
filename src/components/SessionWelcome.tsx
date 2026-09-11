import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, ChevronDown, Check, Plus, Zap } from 'lucide-react'
import { loadCustomOptions } from '../lib/customOptions.js'
import { api, type SessionInfo } from '../lib/api.js'

// Красивые ярлыки для чипов Resume-экрана
const MODEL_LABEL: Record<string, string> = {
  'claude-sonnet-5': 'Sonnet 5',
  'claude-opus-5': 'Opus 5',
  'claude-fable-5': 'Fable 5',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
}
const PERM_LABEL: Record<string, string> = {
  bypassPermissions: 'Bypass',
  acceptEdits: 'Accept Edits',
  default: 'Default',
  plan: 'Plan',
  auto: 'Auto',
}
function prettyModel(m: string | null): string | null {
  if (!m) return null
  return MODEL_LABEL[m] ?? m
}

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
      <div className="text-[10.5px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-faint)' }}>
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
  /** путь к jsonl существующей сессии — чтобы прочитать реальные параметры */
  jsonlPath?: string | null
  messageCount?: number
  lastModified?: number
  config: SessionConfig
  onChange: (c: SessionConfig) => void
  onStart: (btnRect?: DOMRect) => void
  onSettings?: () => void
  onImport?: () => void
}

// «5 минут назад», «вчера», дата
function relTime(ms?: number): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'только что'
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч назад`
  const d = Math.floor(h / 24)
  if (d === 1) return 'вчера'
  if (d < 7) return `${d} дн назад`
  return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

const MODELS: Option[] = [
  { value: 'claude-sonnet-5',          label: 'Sonnet 5', sub: 'claude-sonnet-5' },
  { value: 'claude-opus-5',            label: 'Opus 5',   sub: 'claude-opus-5' },
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

export function SessionWelcome({ sessionTitle, isNew = false, jsonlPath, messageCount, lastModified, config, onChange, onStart, onSettings, onImport }: Props) {
  const color = isNew ? 'var(--accent, #d97757)' : 'var(--accent, #d97757)'
  const glow  = 'var(--accent-glow, rgba(217,119,87,0.14))'
  const btnRef = useRef<HTMLButtonElement>(null)
  const [clicked, setClicked] = useState(false)

  const [customModels, setCustomModels]      = useState(() => loadCustomOptions('model'))
  const [customEfforts, setCustomEfforts]    = useState(() => loadCustomOptions('effort'))
  const [customPerms, setCustomPerms]        = useState(() => loadCustomOptions('permission'))

  // Фактические параметры существующей сессии из jsonl (не из локального конфига —
  // модель могли поменять командой /model внутри сессии)
  const [info, setInfo] = useState<SessionInfo | null>(null)
  // Свежий config для асинхронного колбэка — замыкание эффекта держит тот,
  // что был на момент запроса, и затёрло бы более поздние правки
  const configRef = useRef(config)
  configRef.current = config
  useEffect(() => {
    if (isNew || !jsonlPath) { setInfo(null); return }
    let alive = true
    api.getSessionInfo(jsonlPath).then(r => {
      if (!alive) return
      setInfo(r)
      // Параметры сессии — это и есть то, с чем её надо возобновлять. Без этого
      // в spawn уходили дефолты, и resume поднимался не на той модели/эффорте.
      if (r) {
        const patch: Partial<SessionConfig> = {}
        if (r.model) patch.model = r.model
        if (r.effort) patch.effort = r.effort
        if (r.permissionMode) patch.permissionMode = r.permissionMode
        if (Object.keys(patch).length > 0) onChange({ ...configRef.current, ...patch })
      }
    })
    return () => { alive = false }
  }, [isNew, jsonlPath])

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
  const btnText = isNew
    ? (clicked ? 'Запуск' : 'Начать')
    : 'Продолжить'

  const chips = [prettyModel(info?.model ?? null), info?.effort ?? null, info?.permissionMode ? (PERM_LABEL[info.permissionMode] ?? info.permissionMode) : null].filter(Boolean) as string[]

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
        {isNew ? (
          <div className="flex flex-col items-center text-center gap-1.5 mb-1">
            <div className="w-[52px] h-[52px] rounded-[16px] flex items-center justify-center mb-2 relative overflow-hidden"
              style={{ background: 'var(--accent-crystal, var(--accent))', boxShadow: '0 8px 24px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.25)' }}>
              <Plus size={23} style={{ color: 'white' }} strokeWidth={2} />
            </div>
            <div className="text-[20px] font-medium tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Что делаем?
            </div>
            <div className="text-[13.5px]" style={{ color: 'var(--text-muted)' }}>
              Настрой сессию и запусти — или просто начни пустую.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {sessionTitle && (
              <div className="flex items-center gap-2.5">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color, boxShadow: `0 0 8px ${glow}` }} />
                <div className="text-lg font-medium leading-snug overflow-hidden" style={{ color: 'var(--text-primary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, textOverflow: 'ellipsis' }}>
                  {sessionTitle}
                </div>
              </div>
            )}
            <div className="text-[12.5px] pl-[22px]" style={{ color: 'var(--text-faint)' }}>
              {[relTime(lastModified), messageCount ? `${messageCount} сообщений` : null].filter(Boolean).join(' · ')}
            </div>
          </div>
        )}

        {isNew ? (
          <>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
              {onSettings && (
                <button
                  onClick={onSettings}
                  title="Добавить кастомные опции"
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] uppercase tracking-wider transition-colors"
                  style={{ color: 'var(--text-faint)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}
                >
                  <Plus size={10} />
                  настроить
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Dropdown label="модель"     value={config.model}          options={allModels}      onChange={v => onChange({ ...config, model: v })} />
              <Dropdown label="мышление"   value={config.effort}         options={allEfforts}     onChange={v => onChange({ ...config, effort: v })} />
              <Dropdown label="разрешения" value={config.permissionMode} options={allPermissions} onChange={v => onChange({ ...config, permissionMode: v })} />
              <Dropdown label="промпт"     value={config.prompt}         options={PROMPTS}        onChange={v => onChange({ ...config, prompt: v })} />
            </div>
          </>
        ) : (
          <>
            {/* «На чём остановились» — кусок последнего ответа из jsonl */}
            {info?.lastText && (
              <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}>
                <div className="px-3.5 py-2 text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-faint)', borderBottom: '1px solid var(--border-subtle)' }}>
                  На чём остановились
                </div>
                <div className="px-3.5 py-3 text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  <span style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }}>
                    {info.lastText}
                  </span>
                </div>
              </div>
            )}

            {/* Реальные параметры сессии — факт из jsonl, не контрол */}
            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {chips.map((c, i) => (
                  <span key={i} className="text-[11.5px] px-2.5 py-1 rounded-full"
                    style={{ color: 'var(--text-muted)', border: '1px solid var(--border-strong)' }}>
                    {c}
                  </span>
                ))}
                <span className="ml-auto text-[11px]" style={{ color: 'var(--text-ghost)' }}>
                  параметры из сессии — менять только командой внутри
                </span>
              </div>
            )}
          </>
        )}

        <motion.button
          ref={btnRef}
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => { setClicked(true); onStart(btnRef.current?.getBoundingClientRect()) }}
          className="welcome-start-btn w-full flex items-center justify-center gap-2 py-3 rounded-xl text-base font-semibold mt-1 overflow-hidden relative"
          style={{
            background: 'var(--accent-crystal, var(--accent))',
            boxShadow: `0 0 22px ${glow}, inset 0 1px 0 rgba(255,255,255,0.18)`,
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

        {isNew && onImport && (
          <button
            onClick={onImport}
            className="w-full text-center text-[13px] transition-colors -mt-2"
            style={{ color: 'var(--text-ghost)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-faint)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-ghost)')}
          >
            импортировать сессию
          </button>
        )}

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
