import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ShieldCheck, FilePen, Map as MapIcon, Sparkles, Zap, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { t } from '../lib/i18n.js'

// Настройки нового сеанса на экране «Что делаем?»: мышление — слайдером,
// разрешения — плитками с цветом. Свои варианты из «Свои варианты» тоже здесь:
// лишними делениями и лишними плитками.

export interface WelcomeOption { value: string; label: string; sub?: string }

const spring = { type: 'spring', stiffness: 520, damping: 34, mass: 0.6 } as const

// Искры для Max: где на полосе рождаются (%), размер, задержка и длительность подъёма,
// снос вбок (px). Фиксированные, а не случайные — чтобы при перерисовке не прыгали
const EMBERS = [
  { x: 4, size: 3, delay: 0, dur: 1.6, drift: 4 }, { x: 11, size: 2, delay: 0.9, dur: 1.9, drift: -3 },
  { x: 18, size: 3, delay: 0.4, dur: 1.4, drift: 2 }, { x: 26, size: 2, delay: 1.3, dur: 2.0, drift: -5 },
  { x: 33, size: 4, delay: 0.2, dur: 1.7, drift: 3 }, { x: 41, size: 2, delay: 1.0, dur: 1.5, drift: -2 },
  { x: 48, size: 3, delay: 0.6, dur: 1.8, drift: 5 }, { x: 56, size: 2, delay: 1.5, dur: 1.6, drift: -4 },
  { x: 63, size: 3, delay: 0.3, dur: 2.1, drift: 2 }, { x: 71, size: 4, delay: 1.1, dur: 1.5, drift: -3 },
  { x: 78, size: 2, delay: 0.7, dur: 1.9, drift: 4 }, { x: 85, size: 3, delay: 1.4, dur: 1.6, drift: -2 },
  { x: 92, size: 2, delay: 0.1, dur: 1.8, drift: 3 }, { x: 97, size: 4, delay: 0.8, dur: 1.4, drift: -4 },
]

// ── Мышление ────────────────────────────────────────────────────────────────

export function EffortSlider({ value, options, onChange }: {
  value: string
  options: WelcomeOption[]
  onChange: (v: string) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const n = options.length
  const idx = Math.max(0, options.findIndex(o => o.value === value))
  const cur = options[idx]
  const pct = n > 1 ? idx / (n - 1) : 0
  // 0…1 — насколько «горячо»: от неё свечение и полоски
  const heat = pct

  const pick = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r || n < 2) return
    const i = Math.round(Math.min(Math.max((clientX - r.left) / r.width, 0), 1) * (n - 1))
    if (options[i] && options[i].value !== value) onChange(options[i].value)
  }
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    pick(e.clientX)
  }
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const o = options[Math.min(Math.max(idx + d, 0), n - 1)]
    if (o) onChange(o.value)
  }

  return (
    <div className={cn('wc-block', value === 'xhigh' && 'is-xhigh', value === 'max' && 'is-max')} style={{ '--heat': heat } as CSSProperties}>
      <div className="wc-head">
        <span className="wc-label">{t('Мышление', 'Thinking')}</span>
        <span className="wc-bars" aria-hidden>
          {[0, 1, 2, 3, 4].map(i => (
            <motion.span key={i} className={cn(i <= Math.round(heat * 4) && 'is-on')}
              animate={{ height: 4 + i * 2.5 * (i <= Math.round(heat * 4) ? 1 : 0.55) }} transition={spring} />
          ))}
        </span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={cur?.value} className="wc-value"
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.14 }}>
            <b>{cur?.label}</b>{cur?.sub && <span> · {cur.sub}</span>}
          </motion.span>
        </AnimatePresence>
      </div>

      <div
        ref={trackRef}
        className={cn('wc-track', dragging && 'is-dragging')}
        role="slider" tabIndex={0}
        aria-label={t('Мышление', 'Thinking')} aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={idx} aria-valuetext={cur?.label}
        onPointerDown={onDown}
        onPointerMove={e => { if (dragging) pick(e.clientX) }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={onKey}
      >
        <div className="wc-rail" />
        <motion.div className="wc-fill" animate={{ width: `${pct * 100}%` }} transition={spring} />
        {options.map((o, i) => (
          <span key={o.value} className={cn('wc-stop', i <= idx && 'is-on')} style={{ left: `${n > 1 ? (i / (n - 1)) * 100 : 0}%` }} />
        ))}
        <motion.div className="wc-thumb" animate={{ left: `${pct * 100}%`, scale: dragging ? 1.18 : 1 }} transition={spring} />
        {/* Max — искры поднимаются над полосой и гаснут, каждая в своём ритме */}
        <AnimatePresence>
          {value === 'max' && (
            <motion.span key="embers" className="wc-embers" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              {EMBERS.map((s, i) => (
                <i key={i} style={{ left: `${s.x}%`, width: s.size, height: s.size, '--d': `${s.delay}s`, '--t': `${s.dur}s`, '--drift': `${s.drift}px` } as CSSProperties} />
              ))}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="wc-ticks">
        {options.map((o, i) => (
          <button key={o.value} onClick={() => onChange(o.value)} className={cn(i === idx && 'is-on')}
            style={{ left: `${n > 1 ? (i / (n - 1)) * 100 : 0}%` }}>{o.label}</button>
        ))}
      </div>
    </div>
  )
}

// ── Разрешения ──────────────────────────────────────────────────────────────

const PERM_LOOK: Record<string, { Icon: LucideIcon; color: string; label: string; sub: string }> = {
  default:           { Icon: ShieldCheck, color: '#9aa4b2', label: t('Спрашивать', 'Ask'),   sub: t('спрашивает перед каждым действием', 'asks before every action') },
  acceptEdits:       { Icon: FilePen,     color: '#3dbe6b', label: t('Правки', 'Edits'),     sub: t('правит файлы сам, команды — с вопросом', 'edits files freely, asks before commands') },
  plan:              { Icon: MapIcon,         color: '#8b7cff', label: t('План', 'Plan'),        sub: t('только план, ничего не меняет', 'plans only, changes nothing') },
  auto:              { Icon: Sparkles,    color: '#4c8dff', label: t('Авто', 'Auto'),        sub: t('сам решает, что безопасно', 'decides what is safe on its own') },
  bypassPermissions: { Icon: Zap,         color: '#ff6b4a', label: 'Bypass',                 sub: t('без вопросов: команды и правки сразу', 'no questions: runs commands and edits right away') },
}
const PERM_ORDER = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']

export function PermissionPicker({ value, options, onChange }: {
  value: string
  options: WelcomeOption[]
  onChange: (v: string) => void
}) {
  // Сначала встроенные в порядке «осторожно → смело», потом свои
  const list = [...options].sort((a, b) => {
    const ia = PERM_ORDER.indexOf(a.value), ib = PERM_ORDER.indexOf(b.value)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  const look = (o: WelcomeOption) => PERM_LOOK[o.value] ?? { Icon: SlidersHorizontal, color: '#9aa0a6', label: o.label, sub: o.sub ?? '' }
  const cur = list.find(o => o.value === value)
  const curLook = cur ? look(cur) : null

  return (
    <div className="wc-block">
      <div className="wc-head">
        <span className="wc-label">{t('Разрешения', 'Permissions')}</span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={value} className="wc-value" style={{ color: value === 'bypassPermissions' ? curLook?.color : undefined }}
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.14 }}>
            {curLook?.sub}
          </motion.span>
        </AnimatePresence>
      </div>
      <div className="wc-perms" style={{ gridTemplateColumns: `repeat(${Math.min(list.length, 5)}, 1fr)` }}>
        {list.map(o => {
          const l = look(o)
          const on = o.value === value
          return (
            <button key={o.value} onClick={() => onChange(o.value)}
              className={cn('wc-perm', on && 'is-on', o.value === 'bypassPermissions' && 'is-bypass')}
              style={{ '--perm': l.color } as CSSProperties} title={l.sub}>
              {on && <motion.span layoutId="wc-perm-glow" className="wc-perm-glow" transition={spring} />}
              <motion.span className="wc-perm-icon" animate={{ scale: on ? 1.12 : 1, rotate: on && o.value === 'bypassPermissions' ? [0, -12, 10, 0] : 0 }} transition={on ? { duration: 0.35 } : spring}>
                <l.Icon size={17} strokeWidth={1.9} />
              </motion.span>
              <span className="wc-perm-label">{l.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Вид: чат или терминал ───────────────────────────────────────────────────

export function ViewModePicker({ value, onChange }: { value: 'chat' | 'terminal'; onChange: (v: 'chat' | 'terminal') => void }) {
  const items = [
    { v: 'chat' as const, label: t('Чат', 'Chat') },
    { v: 'terminal' as const, label: t('Терминал', 'Terminal') },
  ]
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <div className="text-[12px] text-text-muted px-0.5">{t('Вид', 'View')}</div>
      <div className="wc-mode" role="tablist">
        {items.map(it => {
          const on = it.v === value
          return (
            <button key={it.v} role="tab" aria-selected={on} onClick={() => onChange(it.v)} className={cn('wc-mode-opt', on && 'is-on')}>
              {on && <motion.span layoutId="wc-mode-glow" className="wc-mode-glow" transition={spring} />}
              {it.v === 'chat' ? (
                // Пузырь, в выбранном — бегут точки набора
                <span className="wc-mode-chat" aria-hidden><i /><i /><i /></span>
              ) : (
                // >_ — в выбранном каретка мигает
                <span className="wc-mode-term" aria-hidden>&gt;<i /></span>
              )}
              <span>{it.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
