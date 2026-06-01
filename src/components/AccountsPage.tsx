import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Plus, Trash2, LogOut, LogIn } from 'lucide-react'
import { Account } from '../types/index'
import { api } from '../lib/api.js'
import { cn } from '../lib/utils.js'
import { WindowControls } from './WindowControls.js'

interface Props {
  accounts: Account[]
  activeAccountId: string
  onBack: () => void
  onAccountsChange: () => void
  onSwitchAccount: (id: string) => void
}

type ConfirmAction = { type: 'delete' | 'logout'; id: string }

export function AccountsPage({ accounts, activeAccountId, onBack, onAccountsChange, onSwitchAccount }: Props) {
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [pendingAuth, setPendingAuth] = useState<Account | null>(null)
  const [addHov, setAddHov] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)
  const [credStatus, setCredStatus] = useState<Record<string, boolean>>({})
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Check credentials for all accounts
  useEffect(() => {
    accounts.forEach(async acc => {
      const ok = await api.checkCredentials(acc.configDir)
      setCredStatus(prev => ({ ...prev, [acc.id]: ok }))
    })
  }, [accounts])

  useEffect(() => {
    if (!pendingAuth) return
    pollRef.current = setInterval(async () => {
      const ok = await api.checkCredentials(pendingAuth.configDir)
      if (ok) {
        clearInterval(pollRef.current!)
        setPendingAuth(null)
        setCredStatus(prev => ({ ...prev, [pendingAuth.id]: true }))
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

  const handleLogin = (acc: Account) => {
    setPendingAuth(acc)
    api.openAuth(acc.configDir)
  }

  const handleConfirm = async () => {
    if (!confirm) return
    if (confirm.type === 'delete') {
      await api.deleteAccount(confirm.id)
      // If deleting active account, switch to another
      if (confirm.id === activeAccountId) {
        const other = accounts.find(a => a.id !== confirm.id)
        if (other) onSwitchAccount(other.id)
      }
    } else {
      await api.logoutAccount(confirm.id)
      setCredStatus(prev => ({ ...prev, [confirm.id]: false }))
      // If logging out active account, switch to a logged-in one
      if (confirm.id === activeAccountId) {
        const other = accounts.find(a => a.id !== confirm.id && credStatus[a.id])
        if (other) onSwitchAccount(other.id)
      }
    }
    setConfirm(null)
    onAccountsChange()
  }

  const confirmAcc = confirm ? accounts.find(a => a.id === confirm.id) : null

  return (
    <div className="flex flex-col h-full">

      {/* Confirm modal */}
      {confirm && confirmAcc && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-bg-surface border border-border-default rounded-2xl shadow-2xl p-5 w-72 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-text-primary">
                {confirm.type === 'delete' ? 'Удалить аккаунт?' : 'Выйти из аккаунта?'}
              </span>
              <span className="text-[14px] text-text-muted">
                {confirm.type === 'delete'
                  ? <><span className="text-text-secondary font-medium">{confirmAcc.name}</span> и все его сессии будут удалены безвозвратно.</>
                  : <>Авторизация <span className="text-text-secondary font-medium">{confirmAcc.name}</span> будет сброшена. Сессии сохранятся.</>
                }
              </span>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirm(null)}
                className="px-3 py-1.5 rounded-lg text-[14px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleConfirm}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-[14px] transition-colors',
                  confirm.type === 'delete'
                    ? 'text-red-400 hover:text-red-300 bg-red-400/10 hover:bg-red-400/20'
                    : 'text-amber-400 hover:text-amber-300 bg-amber-400/10 hover:bg-amber-400/20',
                )}
              >
                {confirm.type === 'delete' ? 'Удалить' : 'Выйти'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 px-4 border-b border-border-subtle shrink-0 app-drag-region h-10">
        <button
          onClick={onBack}
          className="p-1 rounded-md text-text-faint hover:text-text-secondary hover:bg-surface-hover transition-colors no-drag"
        >
          <ArrowLeft size={15} />
        </button>
        <span className="text-sm font-medium text-text-secondary flex-1">Manage accounts</span>
        <div className="no-drag">
          <WindowControls />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">

        {/* Pending auth notice */}
        {pendingAuth && (
          <div className="rounded-xl border px-3 py-3 flex items-center gap-2.5" style={{ borderColor: 'color-mix(in srgb, var(--accent) 20%, transparent)', backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 60%, transparent)' }} />
            <p className="text-[13px] text-text-muted">
              Waiting for login to <span className="text-text-secondary font-medium">{pendingAuth.name}</span>...
            </p>
          </div>
        )}

        {/* Account list */}
        <div className="space-y-1">
          <p className="text-[11px] text-text-faint uppercase tracking-widest px-1 mb-2">Accounts</p>
          {accounts.length === 0 && (
            <p className="text-[13px] text-text-ghost px-1 py-4 text-center">No accounts yet</p>
          )}
          {accounts.map(acc => {
            const isActive = acc.id === activeAccountId
            const isLoggedIn = credStatus[acc.id] ?? true
            return (
              <div
                key={acc.id}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors',
                  !isActive && 'border-border-subtle bg-surface-hover',
                  !isLoggedIn && 'opacity-60',
                )}
                style={isActive ? {
                  borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)',
                  backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)',
                } : undefined}
              >
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 50%, transparent)' }}>
                  <span className="text-[13px] font-semibold text-text-primary">
                    {acc.name[0].toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] text-text-secondary truncate">{acc.name}</p>
                  <p className="text-[11px] text-text-faint truncate">
                    {isLoggedIn ? acc.email || acc.configDir : 'Не авторизован'}
                  </p>
                </div>
                {isActive && isLoggedIn && (
                  <span className="text-[11px] shrink-0" style={{ color: 'color-mix(in srgb, var(--accent) 70%, transparent)' }}>active</span>
                )}
                <div className="flex items-center gap-1 shrink-0">
                  {!isLoggedIn ? (
                    <button
                      onClick={() => handleLogin(acc)}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[13px] text-text-muted hover:text-text-primary hover:bg-surface-active transition-colors"
                      title="Войти"
                    >
                      <LogIn size={12} />
                      Войти
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirm({ type: 'logout', id: acc.id })}
                      className="p-1 rounded transition-colors text-text-ghost hover:text-amber-400 hover:bg-amber-400/10"
                      title="Выйти (сохранить сессии)"
                    >
                      <LogOut size={13} />
                    </button>
                  )}
                  <button
                    onClick={() => accounts.length > 1 ? setConfirm({ type: 'delete', id: acc.id }) : undefined}
                    disabled={accounts.length <= 1}
                    className={cn(
                      'p-1 rounded transition-colors',
                      accounts.length > 1
                        ? 'text-text-ghost hover:text-red-400 hover:bg-red-400/10'
                        : 'text-text-ghost opacity-30 cursor-not-allowed',
                    )}
                    title={accounts.length <= 1 ? 'Нельзя удалить единственный аккаунт' : 'Удалить аккаунт'}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Add account */}
        <div className="space-y-2">
          <p className="text-[11px] text-text-faint uppercase tracking-widest px-1">Add account</p>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value.replace(/[^a-zA-Zа-яА-ЯёЁ0-9 \-_.]/g, ''))}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="Account name (e.g. work)"
              className="flex-1 bg-surface-hover border border-border-default rounded-xl px-3 py-2 text-[14px] text-text-primary placeholder:text-text-ghost outline-none transition-colors"
              onFocus={e => (e.target.style.borderColor = 'color-mix(in srgb, var(--accent) 40%, transparent)')}
              onBlur={e => (e.target.style.borderColor = '')}
            />
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium transition-colors shrink-0',
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
