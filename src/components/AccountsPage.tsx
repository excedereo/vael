import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { Account } from '../types/index'
import { api } from '../lib/api.js'
import { cn } from '../lib/utils.js'

interface Props {
  accounts: Account[]
  activeAccountId: string
  onBack: () => void
  onAccountsChange: () => void
}

export function AccountsPage({ accounts, activeAccountId, onBack, onAccountsChange }: Props) {
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [pendingAuth, setPendingAuth] = useState<Account | null>(null)
  const [addHov, setAddHov] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!pendingAuth) return
    pollRef.current = setInterval(async () => {
      const ok = await api.checkCredentials(pendingAuth.configDir)
      if (ok) {
        clearInterval(pollRef.current!)
        setPendingAuth(null)
        onAccountsChange()
      }
    }, 1500)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [pendingAuth])

  const handleCreate = async () => {
    const id = newName.trim()
    if (!id) return
    setCreating(true)
    try {
      const acc: Account = await api.createAccount(id)
      setNewName('')
      setPendingAuth(acc)
      api.openAuth(acc.configDir)
    } catch (e) {
      console.error('create account failed', e)
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    await api.deleteAccount(id)
    onAccountsChange()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle shrink-0 app-drag-region">
        <button
          onClick={onBack}
          className="p-1 rounded-md text-text-faint hover:text-text-secondary hover:bg-surface-hover transition-colors"
        >
          <ArrowLeft size={15} />
        </button>
        <span className="text-sm font-medium text-text-secondary">Manage accounts</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">

        {/* Pending auth notice */}
        {pendingAuth && (
          <div className="rounded-xl border px-3 py-3 flex items-center gap-2.5" style={{ borderColor: 'color-mix(in srgb, var(--accent) 20%, transparent)', backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 60%, transparent)' }} />
            <p className="text-[12px] text-text-muted">
              Waiting for login to <span className="text-text-secondary font-medium">{pendingAuth.name}</span>...
            </p>
          </div>
        )}

        {/* Account list */}
        <div className="space-y-1">
          <p className="text-[10px] text-text-faint uppercase tracking-widest px-1 mb-2">Accounts</p>
          {accounts.length === 0 && (
            <p className="text-[12px] text-text-ghost px-1 py-4 text-center">No accounts yet</p>
          )}
          {accounts.map(acc => (
            <div
              key={acc.id}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors',
                acc.id !== activeAccountId && 'border-border-subtle bg-surface-hover hover:bg-surface-hover',
              )}
              style={acc.id === activeAccountId ? {
                borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)',
                backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)',
              } : undefined}
            >
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 50%, transparent)' }}>
                <span className="text-[12px] font-semibold text-text-primary">
                  {acc.name[0].toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-text-secondary truncate">{acc.name}</p>
                <p className="text-[10px] text-text-faint truncate">{acc.configDir}</p>
              </div>
              {acc.id === activeAccountId && (
                <span className="text-[10px] shrink-0" style={{ color: 'color-mix(in srgb, var(--accent) 70%, transparent)' }}>active</span>
              )}
              {acc.id !== activeAccountId && (
                <button
                  onClick={() => handleDelete(acc.id)}
                  className="p-1 rounded text-text-ghost hover:text-red-400 hover:bg-red-400/10 transition-colors shrink-0"
                  title="Delete account"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Add account */}
        <div className="space-y-2">
          <p className="text-[10px] text-text-faint uppercase tracking-widest px-1">Add account</p>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value.replace(/[^a-zA-Zа-яА-ЯёЁ0-9 \-_.]/g, ''))}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="Account name (e.g. work)"
              className="flex-1 bg-surface-hover border border-border-default rounded-xl px-3 py-2 text-[13px] text-text-primary placeholder:text-text-ghost outline-none transition-colors"
              onFocus={e => (e.target.style.borderColor = 'color-mix(in srgb, var(--accent) 40%, transparent)')}
              onBlur={e => (e.target.style.borderColor = '')}
            />
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium transition-colors shrink-0',
                newName.trim() && !creating
                  ? 'text-white'
                  : 'bg-surface-hover text-text-faint cursor-not-allowed',
              )}
              style={newName.trim() && !creating ? {
                backgroundColor: `color-mix(in srgb, var(--accent) ${addHov ? 90 : 70}%, transparent)`,
              } : undefined}
              onMouseEnter={() => setAddHov(true)}
              onMouseLeave={() => setAddHov(false)}
            >
              <Plus size={13} />
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
