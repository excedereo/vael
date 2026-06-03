import { useEffect, useState } from 'react'
import { Account } from '../types/index'
import { cn } from '../lib/utils.js'

interface Props {
  from: Account
  to: Account
  onConfirm: () => Promise<void>
  onCancel: () => void
}

const STEPS = [
  'Syncing sessions',
  'Switching account',
  'Loading sessions',
  'Starting usage monitor',
]

export function AccountSwitchModal({ from, to, onConfirm, onCancel }: Props) {
  const [phase, setPhase] = useState<'confirm' | 'progress' | 'done'>('confirm')
  const [step, setStep] = useState(0)
  const [switchHov, setSwitchHov] = useState(false)

  const handleConfirm = async () => {
    setPhase('progress')
    setStep(0)

    // Animate through steps while actual work happens
    for (let i = 0; i < STEPS.length; i++) {
      setStep(i)
      await new Promise(r => setTimeout(r, i === 0 ? 300 : 400))
    }

    await onConfirm()
    setStep(STEPS.length)
    setPhase('done')
  }

  // Auto-close after done
  useEffect(() => {
    if (phase === 'done') {
      const t = setTimeout(onCancel, 600)
      return () => clearTimeout(t)
    }
  }, [phase])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={phase === 'confirm' ? onCancel : undefined} />

      {/* Modal */}
      <div className="relative w-80 bg-bg-surface border border-border-default rounded-2xl p-5 shadow-2xl">

        {phase === 'confirm' && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-[15px] font-semibold text-text-primary">Switch account?</h2>
              <p className="text-[12px] text-text-muted">
                From <span className="text-text-secondary">{from.name}</span> to <span className="text-text-secondary">{to.name}</span>
              </p>
            </div>

            {/* Account avatars */}
            <div className="flex items-center gap-3 py-1">
              <div className="w-9 h-9 rounded-xl bg-surface-selected flex items-center justify-center shrink-0">
                <span className="text-[14px] font-semibold text-text-muted">{from.name[0].toUpperCase()}</span>
              </div>
              <div className="flex-1 h-px bg-border-default" />
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 60%, transparent)' }}>
                <span className="text-[14px] font-semibold text-text-primary">{to.name[0].toUpperCase()}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={onCancel}
                className="flex-1 py-2 rounded-xl text-[13px] text-text-muted hover:text-text-secondary hover:bg-surface-hover transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="flex-1 py-2 rounded-xl text-[13px] font-medium text-white transition-colors"
                style={{ backgroundColor: `color-mix(in srgb, var(--accent) ${switchHov ? 90 : 70}%, transparent)` }}
                onMouseEnter={() => setSwitchHov(true)}
                onMouseLeave={() => setSwitchHov(false)}
              >
                Switch
              </button>
            </div>
          </div>
        )}

        {(phase === 'progress' || phase === 'done') && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-[15px] font-semibold text-text-primary">
                {phase === 'done' ? 'Switched!' : 'Switching...'}
              </h2>
              <p className="text-[12px] text-text-muted">
                To <span className="text-text-secondary">{to.name}</span>
              </p>
            </div>

            {/* Progress bar */}
            <div className="w-full h-1 bg-surface-selected rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{ backgroundColor: 'var(--accent)', width: `${(step / STEPS.length) * 100}%` }}
              />
            </div>

            {/* Steps */}
            <div className="space-y-1.5">
              {STEPS.map((s, i) => (
                <div key={s} className={cn(
                  'flex items-center gap-2 text-[12px] transition-colors duration-200',
                  i < step ? 'text-text-faint' : i === step ? 'text-text-secondary' : 'text-text-ghost',
                )}>
                  <span
                    className={cn('w-1 h-1 rounded-full shrink-0', i === step && 'animate-pulse', i >= step && i !== step && 'bg-surface-selected')}
                    style={i < step
                      ? { backgroundColor: 'color-mix(in srgb, var(--accent) 50%, transparent)' }
                      : i === step
                        ? { backgroundColor: 'var(--accent)' }
                        : undefined}
                  />
                  {s}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
