import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, ChevronDown, Check, Plus } from 'lucide-react'
import logo from '../assets/logo.svg'
import { loadCustomOptions } from '../lib/customOptions.js'
import { api, type SessionInfo } from '../lib/api.js'
import { loadCliModels, modelDisplayName } from '../lib/cliModels.js'
import { MdBlock } from './ChatView.js'
import { cn } from '../lib/utils.js'
import { t, LOCALE } from '../lib/i18n.js'

const PERM_LABEL: Record<string, string> = {
  bypassPermissions: 'Bypass',
  acceptEdits: 'Accept Edits',
  default: 'Default',
  plan: 'Plan',
  auto: 'Auto',
}
const EFFORT_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'X-High', max: 'Max' }

interface Option {
  value: string
  label: string
  sub?: string
}

function Dropdown({ label, value, options, onChange, display }: {
  label: string
  value: string
  options: Option[]
  onChange: (v: string) => void
  /** подпись, если значения нет в списке (старый id модели и т.п.) */
  display?: string
}) {
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const btnRef = useRef<HTMLButtonElement>(null)
  const selected = options.find(o => o.value === value)

  const openMenu = () => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const above = window.innerHeight - rect.bottom < Math.min(options.length, 5) * 46 + 8
    setMenuStyle({
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      ...(above ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
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
    <div className="flex flex-col gap-1.5 min-w-0">
      <div className="text-[12px] text-text-muted px-0.5">{label}</div>
      <button ref={btnRef} onClick={() => open ? setOpen(false) : openMenu()} className={cn('welcome-field', open && 'is-open')}>
        <span className="truncate">{selected?.label ?? display ?? value}</span>
        <ChevronDown size={14} className={cn('shrink-0 text-text-muted transition-transform', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            style={menuStyle}
            className="welcome-menu"
          >
            {options.map(opt => (
              <button key={opt.value} onClick={() => { onChange(opt.value); setOpen(false) }} className={cn('welcome-menu-item', opt.value === value && 'is-on')}>
                <span className="min-w-0">
                  <span className="block truncate">{opt.label}</span>
                  {opt.sub && <span className="block truncate text-[11.5px] text-text-muted">{opt.sub}</span>}
                </span>
                {opt.value === value && <Check size={13} className="shrink-0 text-accent" />}
              </button>
            ))}
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
  if (m < 1) return t("только что", "just now")
  if (m < 60) return t(`${m} мин назад`, `${m} min ago`)
  const h = Math.floor(m / 60)
  if (h < 24) return t(`${h} ч назад`, `${h} h ago`)
  const d = Math.floor(h / 24)
  if (d === 1) return t("вчера", "yesterday")
  if (d < 7) return t(`${d} дн назад`, `${d} d ago`)
  return new Date(ms).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })
}

// Пока CLI ни разу не прислал список — только алиасы, они всегда указывают на свежие версии
const FALLBACK_MODELS: Option[] = [
  { value: 'opus',   label: 'Opus',   sub: t("последняя Opus", "latest Opus") },
  { value: 'sonnet', label: 'Sonnet', sub: t("последняя Sonnet", "latest Sonnet") },
  { value: 'haiku',  label: 'Haiku',  sub: t("последняя Haiku", "latest Haiku") },
]

const EFFORTS: Option[] = [
  { value: 'low',    label: 'Low',    sub: t("быстро, экономно", "fast, economical") },
  { value: 'medium', label: 'Medium', sub: t("баланс", "balanced") },
  { value: 'high',   label: 'High',   sub: t("глубже", "deeper") },
  { value: 'xhigh',  label: 'X-High', sub: t("очень глубоко", "very deep") },
  { value: 'max',    label: 'Max',    sub: t("максимум", "maximum") },
]

const PERMISSIONS: Option[] = [
  { value: 'bypassPermissions', label: 'Bypass',       sub: t("пропустить все проверки", "skip all checks") },
  { value: 'auto',              label: 'Auto',         sub: t("автоматически", "automatic") },
  { value: 'acceptEdits',       label: 'Accept Edits', sub: t("принимать правки", "accept edits") },
  { value: 'default',           label: 'Default',      sub: t("стандартный", "default") },
  { value: 'plan',              label: 'Plan',         sub: t("только планировать", "plan only") },
]

const PROMPTS: Option[] = [
  { value: '', label: t("Нет", "None"), sub: t("без промпта", "no prompt") },
]

function cliModelOptions(): Option[] {
  const list = loadCliModels().filter(m => m.value !== 'default')
  if (!list.length) return FALLBACK_MODELS
  return list.map(m => ({ value: m.value, label: m.displayName, sub: m.description }))
}

export function SessionWelcome({ sessionTitle, isNew = false, jsonlPath, messageCount, lastModified, config, onChange, onStart, onSettings, onImport }: Props) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [clicked, setClicked] = useState(false)

  const [cliModels, setCliModels]            = useState(cliModelOptions)
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
    const refreshCli = () => setCliModels(cliModelOptions())
    window.addEventListener('vaeli:customOptionsChanged', refresh)
    window.addEventListener('vaeli:cliModelsChanged', refreshCli)
    return () => {
      window.removeEventListener('vaeli:customOptionsChanged', refresh)
      window.removeEventListener('vaeli:cliModelsChanged', refreshCli)
    }
  }, [])

  const start = () => { setClicked(true); onStart(btnRef.current?.getBoundingClientRect()) }

  // Enter — то же, что кнопка: экран всё равно ждёт только одного действия
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey) return
      // Экран остаётся смонтированным и в других разделах — там Enter не наш
      if (!btnRef.current || btnRef.current.offsetParent === null) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return
      e.preventDefault()
      start()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const allModels      = [...cliModels,   ...customModels]
  const allEfforts     = [...EFFORTS,     ...customEfforts]
  const allPermissions = [...PERMISSIONS, ...customPerms]

  const params = [
    modelDisplayName(info?.model),
    info?.effort ? (EFFORT_LABEL[info.effort] ?? info.effort) : null,
    info?.permissionMode ? (PERM_LABEL[info.permissionMode] ?? info.permissionMode) : null,
  ].filter(Boolean) as string[]

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
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[560px] px-6 flex flex-col gap-5"
      >
        {isNew ? (
          <div className="flex flex-col items-center text-center gap-2">
            <img src={logo} alt="" className="w-14 h-14 select-none" draggable={false} />
            <div className="text-[22px] font-medium tracking-tight text-text-primary mt-2">{t("Что делаем?", "What are we doing?")}</div>
            <div className="text-[13.5px] text-text-muted">{t("Настрой сессию и запусти — или просто начни пустую", "Set up the session and start — or just start an empty one")}</div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="text-[22px] font-medium tracking-tight leading-snug text-text-primary line-clamp-2">
              {sessionTitle || t("Без названия", "Untitled")}
            </div>
            <div className="text-[13px] text-text-muted">
              {[relTime(lastModified), messageCount ? t(`${messageCount} сообщений`, `${messageCount} messages`) : null, ...params].filter(Boolean).join(' · ')}
            </div>
          </div>
        )}

        {isNew ? (
          <div className="grid grid-cols-2 gap-3">
            <Dropdown label={t("Модель", "Model")}     value={config.model}          options={allModels}      onChange={v => onChange({ ...config, model: v })} display={modelDisplayName(config.model) ?? undefined} />
            <Dropdown label={t("Мышление", "Thinking")}   value={config.effort}         options={allEfforts}     onChange={v => onChange({ ...config, effort: v })} />
            <Dropdown label={t("Разрешения", "Permissions")} value={config.permissionMode} options={allPermissions} onChange={v => onChange({ ...config, permissionMode: v })} />
            <Dropdown label={t("Промпт", "Prompt")}     value={config.prompt}         options={PROMPTS}        onChange={v => onChange({ ...config, prompt: v })} />
          </div>
        ) : info?.lastText ? (
          // Последний ответ — как в самой ленте, только приглушённо и с фейдом
          <div className="welcome-last">
            <div className="text-[12px] text-text-muted mb-2">{t("Последний ответ", "Last answer")}</div>
            <div className="chat-md welcome-last-text"><MdBlock text={info.lastText.slice(0, 1500)} /></div>
          </div>
        ) : null}

        <button ref={btnRef} onClick={start} className="welcome-start">
          <Play size={12} fill="currentColor" />
          {isNew ? (clicked ? t("Запуск…", "Starting…") : t("Начать", "Start")) : t("Продолжить", "Continue")}
          <kbd>Enter</kbd>
        </button>

        {isNew && (onImport || onSettings) && (
          <div className="flex justify-center gap-4 -mt-1 text-[12.5px]">
            {onImport && <button onClick={onImport} className="text-text-muted hover:text-text-secondary transition-colors">{t("Импортировать сессию", "Import session")}</button>}
            {onSettings && <button onClick={onSettings} className="flex items-center gap-1 text-text-muted hover:text-text-secondary transition-colors"><Plus size={12} />{t("Свои варианты", "Custom options")}</button>}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
