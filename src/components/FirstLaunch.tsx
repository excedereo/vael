import { useState, useEffect, useRef } from 'react'
import { Plus } from 'lucide-react'
import { Account } from '../types/index'
import { api } from '../lib/api.js'
import { cn } from '../lib/utils.js'
import authLogo from '../assets/auth-logo.png'

interface Props {
  onCreated: () => void
}

export function FirstLaunch({ onCreated }: Props) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState<Account | null>(null)
  const [addHov, setAddHov] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!pending) return
    pollRef.current = setInterval(async () => {
      const ok = await api.checkCredentials(pending.configDir)
      if (ok) {
        clearInterval(pollRef.current!)
        onCreated()
      }
    }, 1500)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [pending])

  const handleCreate = async () => {
    const id = name.trim()
    if (!id || creating) return
    setCreating(true)
    try {
      const acc: Account = await api.createAccount(id)
      setPending(acc)
      api.openAuth(acc.configDir)
    } catch (e) {
      console.error('create account failed', e)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-bg-base flex flex-col text-white">
      {/* Drag region / titlebar */}
      <div className="h-8 shrink-0 app-drag-region w-full" />

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="w-72 flex flex-col items-center text-center space-y-6">

          <img src={authLogo} alt="logo" className="w-12 h-12 rounded-xl" />

          {!pending ? (
            <>
              <div className="space-y-1.5">
                <h1 className="text-[20px] font-semibold text-text-primary">Add your account</h1>
                <p className="text-[13px] text-text-faint">Give it a name to get started</p>
              </div>

              <div className="w-full flex gap-2">
                <input
                  autoFocus
                  value={name}
                  onChange={e => setName(e.target.value.replace(/[^a-zA-Zа-яА-ЯёЁ0-9 \-_.]/g, ''))}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  placeholder="e.g. main, work..."
                  className="flex-1 bg-surface-hover border border-border-default rounded-xl px-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-ghost outline-none transition-colors text-left"
                  onFocus={e => (e.target.style.borderColor = 'color-mix(in srgb, var(--accent) 40%, transparent)')}
                  onBlur={e => (e.target.style.borderColor = '')}
                />
                <button
                  onClick={handleCreate}
                  disabled={!name.trim() || creating}
                  className={cn(
                    'flex items-center gap-1 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors shrink-0',
                    name.trim() && !creating
                      ? 'text-white'
                      : 'bg-surface-hover text-text-ghost cursor-not-allowed',
                  )}
                  style={name.trim() && !creating ? {
                    backgroundColor: `color-mix(in srgb, var(--accent) ${addHov ? 90 : 70}%, transparent)`,
                  } : undefined}
                  onMouseEnter={() => setAddHov(true)}
                  onMouseLeave={() => setAddHov(false)}
                >
                  <Plus size={14} />
                  Add
                </button>

              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <h1 className="text-[20px] font-semibold text-text-primary">Almost there</h1>
                <p className="text-[13px] text-text-faint">
                  Log in to <span className="text-text-secondary">{pending.name}</span> in the terminal
                </p>
              </div>

              <div className="flex items-center gap-2 text-[12px] text-text-faint">
                <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 60%, transparent)' }} />
                Waiting for login...
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
