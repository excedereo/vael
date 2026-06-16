import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, ChevronDown, Check } from 'lucide-react'
import { cn } from '../lib/utils.js'

interface Option {
  value: string
  label: string
  sub?: string
}

interface DropdownProps {
  label: string
  value: string
  options: Option[]
  onChange: (v: string) => void
}

function Dropdown({ label, value, options, onChange }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find(o => o.value === value)

  useEffect(() => {
    if (!open) return
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'group flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs transition-all duration-150',
          'border border-transparent',
          open
            ? 'bg-[#1c1c1c] border-[#333] text-[#e0e0e0]'
            : 'text-[#888] hover:text-[#c0c0c0] hover:bg-[#181818]'
        )}
      >
        <span className="text-[10px] text-[#555] font-mono uppercase tracking-widest">{label}</span>
        <span className="font-medium">{selected?.label ?? value}</span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
        >
          <ChevronDown size={10} className="text-[#555]" />
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            className="absolute bottom-full mb-2 left-0 z-50 min-w-[160px] rounded-lg overflow-hidden"
            style={{
              background: '#111',
              border: '1px solid #252525',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)',
            }}
          >
            {options.map((opt, i) => (
              <motion.button
                key={opt.value}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03, duration: 0.1 }}
                onClick={() => { onChange(opt.value); setOpen(false) }}
                className={cn(
                  'w-full text-left px-3 py-2 flex items-center justify-between gap-3 transition-colors duration-100',
                  'hover:bg-[#1a1a1a]',
                  opt.value === value ? 'text-[#e0e0e0]' : 'text-[#777]'
                )}
              >
                <div>
                  <div className={cn('text-xs font-medium', opt.value === value && 'text-[#e07040]')}>
                    {opt.label}
                  </div>
                  {opt.sub && <div className="text-[10px] text-[#444] mt-0.5">{opt.sub}</div>}
                </div>
                {opt.value === value && (
                  <Check size={10} className="text-[#e07040] flex-shrink-0" />
                )}
              </motion.button>
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
}

interface Props {
  config: SessionConfig
  onChange: (c: SessionConfig) => void
  onResume: () => void
  isActive: boolean
}

const MODELS: Option[] = [
  { value: 'sonnet',  label: 'Sonnet',  sub: 'claude-sonnet-4-6' },
  { value: 'opus',    label: 'Opus',    sub: 'claude-opus-4-8' },
  { value: 'fable',   label: 'Fable',   sub: 'claude-fable-5' },
  { value: 'haiku',   label: 'Haiku',   sub: 'claude-haiku-4-5' },
]

const EFFORTS: Option[] = [
  { value: 'low',    label: 'Low',    sub: 'быстро' },
  { value: 'medium', label: 'Medium', sub: 'баланс' },
  { value: 'high',   label: 'High',   sub: 'глубже' },
  { value: 'xhigh',  label: 'X-High', sub: 'очень глубоко' },
  { value: 'max',    label: 'Max',    sub: 'максимум' },
]

const PERMISSIONS: Option[] = [
  { value: 'bypassPermissions', label: 'Bypass',        sub: 'пропустить всё' },
  { value: 'auto',              label: 'Auto',          sub: 'автоматически' },
  { value: 'acceptEdits',       label: 'Accept Edits',  sub: 'принимать правки' },
  { value: 'default',           label: 'Default',       sub: 'стандартный' },
  { value: 'plan',              label: 'Plan',          sub: 'только план' },
]

export function SessionToolbar({ config, onChange, onResume, isActive }: Props) {
  return (
    <div
      className="h-[40px] flex-shrink-0 flex items-center px-2 gap-1"
      style={{
        background: '#0c0c0c',
        borderTop: '1px solid #1a1a1a',
      }}
    >
      <Dropdown
        label="model"
        value={config.model}
        options={MODELS}
        onChange={v => onChange({ ...config, model: v })}
      />

      <div className="w-px h-3.5 bg-[#222] mx-0.5" />

      <Dropdown
        label="effort"
        value={config.effort}
        options={EFFORTS}
        onChange={v => onChange({ ...config, effort: v })}
      />

      <div className="w-px h-3.5 bg-[#222] mx-0.5" />

      <Dropdown
        label="permissions"
        value={config.permissionMode}
        options={PERMISSIONS}
        onChange={v => onChange({ ...config, permissionMode: v })}
      />

      <div className="flex-1" />

      <AnimatePresence>
        {!isActive && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9, x: 8 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.9, x: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={onResume}
            className="flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium text-white transition-colors"
            style={{
              background: '#e07040',
              boxShadow: '0 0 12px rgba(224,112,64,0.25)',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = '#d06030'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = '#e07040'
            }}
          >
            <Play size={9} fill="currentColor" />
            Продолжить
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
