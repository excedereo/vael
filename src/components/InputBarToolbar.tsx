import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { ModelId, EffortLevel, PermissionMode } from './InputBar.js'

const PERMISSION_LABELS: Record<PermissionMode, string> = {
  bypassPermissions: 'Bypass',
  plan: 'Plan',
}

const ALL_EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

export const MODELS: { id: ModelId; label: string; efforts: EffortLevel[] }[] = [
  { id: 'claude-opus-4-8',   label: 'Opus 4.8',   efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', efforts: ['low', 'medium', 'high'] },
  { id: 'claude-haiku-4-5',  label: 'Haiku 4.5',  efforts: [] },
]

interface Props {
  activeModel: ModelId
  onModelChange: (m: ModelId) => void
  activeEffort: EffortLevel
  onEffortChange: (e: EffortLevel) => void
  activePermission: PermissionMode
  onPermissionChange: (p: PermissionMode) => void
  ptyAlive?: boolean
  ptyStarting?: boolean
  onKillPtyRequest?: () => void
}

export function InputBarToolbar({
  activeModel, onModelChange,
  activeEffort, onEffortChange,
  activePermission, onPermissionChange,
  ptyAlive, ptyStarting, onKillPtyRequest,
}: Props) {
  const [popupOpen, setPopupOpen] = useState(false)
  const [permPopupOpen, setPermPopupOpen] = useState(false)
  const [effortPopupOpen, setEffortPopupOpen] = useState(false)
  const [customSuccess, setCustomSuccess] = useState(false)
  const [ptyConfirm, setPtyConfirm] = useState(false)

  const activeModelDef = MODELS.find(m => m.id === activeModel)
  const availableEfforts = activeModelDef?.efforts ?? ALL_EFFORTS
  const showEffort = availableEfforts.length > 0
  const statusLabel = activeModelDef?.label ?? activeModel

  return (
    <div className="flex items-center justify-between mt-1.5 px-0.5">
      {/* Left: Permission */}
      <div className="relative">
        <button
          onClick={() => setPermPopupOpen(v => !v)}
          className={cn(
            'text-sm px-2.5 py-1.5 rounded-lg transition-all duration-150',
            'hover:bg-surface-hover active:bg-surface-active active:scale-95',
            permPopupOpen ? 'text-text-secondary bg-surface-hover' : 'text-text-faint hover:text-text-secondary',
          )}
        >
          {PERMISSION_LABELS[activePermission]}
        </button>
        <AnimatePresence>
          {permPopupOpen && (
            <motion.div
              initial={{ opacity: 0, y: 4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.97 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
              className="absolute bottom-full left-0 mb-2 bg-bg-elevated border border-border-default rounded-xl shadow-2xl z-50 w-40 overflow-hidden py-1"
            >
              {(['bypassPermissions', 'plan'] as PermissionMode[]).map(p => (
                <button
                  key={p}
                  onClick={() => { onPermissionChange(p); setPermPopupOpen(false) }}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2 text-[13px] transition-colors',
                    activePermission === p
                      ? 'text-text-primary'
                      : 'text-text-muted hover:text-text-primary hover:bg-surface-hover',
                  )}
                >
                  <span>{PERMISSION_LABELS[p]}</span>
                  {activePermission === p && <Check size={12} className="text-text-secondary" />}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Right: PTY status + Model + Effort */}
      <div className="flex items-center gap-1.5">
        {(ptyAlive || ptyStarting) && (
          <button
            onClick={() => {
              if (ptyStarting) return
              if (!ptyConfirm) { setPtyConfirm(true); return }
              setPtyConfirm(false)
              onKillPtyRequest?.()
            }}
            onBlur={() => setPtyConfirm(false)}
            className={cn(
              'text-sm px-2.5 py-1.5 rounded-lg transition-all duration-150',
              ptyStarting
                ? 'text-text-ghost cursor-default'
                : ptyConfirm
                  ? 'text-red-400/80 bg-red-400/10 hover:bg-red-400/15'
                  : 'text-text-faint hover:text-text-secondary hover:bg-surface-hover active:bg-surface-active active:scale-95',
            )}
          >
            {ptyStarting ? 'запуск сессии…' : ptyConfirm ? 'завершить сессию?' : 'сессия активна'}
          </button>
        )}

        {/* Model picker */}
        <div className="relative">
          <button
            onClick={() => setPopupOpen(v => !v)}
            className={cn(
              'text-sm px-2.5 py-1.5 rounded-lg transition-all duration-150',
              'hover:bg-surface-hover active:bg-surface-active active:scale-95',
              popupOpen ? 'text-text-secondary bg-surface-hover' : 'text-text-faint hover:text-text-secondary',
            )}
          >
            {statusLabel}
          </button>
          <AnimatePresence>
            {popupOpen && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.97 }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
                className="absolute bottom-full right-0 mb-2 bg-bg-elevated border border-border-default rounded-xl shadow-2xl z-50 w-56 overflow-hidden"
              >
                <div className="px-3 pt-2.5 pb-1">
                  <span className="text-[11px] text-text-faint font-medium uppercase tracking-wider">Models</span>
                </div>
                {MODELS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      onModelChange(m.id)
                      if (m.efforts.length > 0 && !m.efforts.includes(activeEffort)) {
                        onEffortChange(m.efforts[m.efforts.length - 1])
                      }
                      setPopupOpen(false)
                    }}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2 text-[13px] transition-colors',
                      activeModel === m.id
                        ? 'text-text-primary'
                        : 'text-text-muted hover:text-text-primary hover:bg-surface-hover',
                    )}
                  >
                    <span>{m.label}</span>
                    {activeModel === m.id && <Check size={12} className="text-text-secondary" />}
                  </button>
                ))}

                <div className="px-3 pb-1">
                  <span className="text-[11px] text-text-faint font-medium uppercase tracking-wider">Custom</span>
                </div>
                <div className="px-3 pb-2.5">
                  <input
                    type="text"
                    placeholder="model-id..."
                    defaultValue={!MODELS.find(m => m.id === activeModel) ? activeModel : ''}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value.trim()
                        if (val) {
                          onModelChange(val)
                          setCustomSuccess(true)
                          setTimeout(() => setCustomSuccess(false), 1000)
                        }
                      }
                    }}
                    className={cn(
                      'w-full bg-surface-hover border rounded-lg px-2.5 py-1.5 text-[12px] text-text-primary placeholder:text-text-ghost outline-none transition-all duration-300',
                      customSuccess
                        ? 'border-[var(--color-success)] bg-[rgba(52,211,153,0.08)]'
                        : 'border-border-default focus:border-border-strong',
                    )}
                  />
                  <p className={cn('text-[10px] mt-1 transition-colors duration-300', customSuccess ? 'text-[var(--color-success)]' : 'text-text-faint')}>
                    {customSuccess ? 'Applied!' : 'Press Enter to apply'}
                  </p>
                </div>
                <div className="pb-1.5" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Effort picker */}
        {showEffort && (
          <>
            <span className="text-text-ghost text-sm select-none">·</span>
            <div className="relative">
              <button
                onClick={() => setEffortPopupOpen(v => !v)}
                className={cn(
                  'text-sm px-2.5 py-1.5 rounded-lg transition-all duration-150',
                  'hover:bg-surface-hover active:bg-surface-active active:scale-95',
                  effortPopupOpen ? 'text-text-secondary bg-surface-hover' : 'text-text-faint hover:text-text-secondary',
                )}
              >
                {activeEffort.charAt(0).toUpperCase() + activeEffort.slice(1)}
              </button>
              <AnimatePresence>
                {effortPopupOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 4, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.97 }}
                    transition={{ duration: 0.12, ease: 'easeOut' }}
                    className="absolute bottom-full right-0 mb-2 bg-bg-elevated border border-border-default rounded-xl shadow-2xl z-50 w-36 overflow-hidden py-1"
                  >
                    {availableEfforts.map(e => (
                      <button
                        key={e}
                        onClick={() => { onEffortChange(e); setEffortPopupOpen(false) }}
                        className={cn(
                          'w-full flex items-center justify-between px-3 py-2 text-[13px] capitalize transition-colors',
                          activeEffort === e
                            ? 'text-text-primary'
                            : 'text-text-muted hover:text-text-primary hover:bg-surface-hover',
                        )}
                      >
                        <span>{e}</span>
                        {activeEffort === e && <Check size={12} className="text-text-secondary" />}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
