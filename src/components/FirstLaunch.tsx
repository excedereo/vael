import { useState, useEffect } from 'react'
import { LogIn, Plus } from 'lucide-react'
import type { Account } from '../types/index'
import { api } from '../lib/api.js'
import { cleanAccountName } from '../lib/accountName.js'
import { WindowControls } from './WindowControls.js'
import logo from '../assets/logo.svg'
import { t } from '../lib/i18n.js'

interface Props {
  /** Вход завершён: передаём аккаунт, в который вошли */
  onCreated: (acc: Account) => void
  /** Аккаунты есть, но ни в одном нет входа — предлагаем войти снова */
  relogin?: Account[]
}

/**
 * Стартовый экран: когда аккаунтов нет или из всех вышли.
 * Сам вход идёт в отдельном окне терминала (claude /login), здесь только ждём его.
 */
export function FirstLaunch({ onCreated, relogin }: Props) {
  const hasAccounts = !!relogin?.length
  const [adding, setAdding] = useState(!hasAccounts)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<Account | null>(null)

  // Ждём, пока в папке аккаунта появится вход
  useEffect(() => {
    if (!pending) return
    const t = setInterval(async () => {
      if (await api.checkCredentials(pending.configDir)) {
        clearInterval(t)
        onCreated(pending)
      }
    }, 1500)
    return () => clearInterval(t)
  }, [pending, onCreated])

  const login = (acc: Account) => {
    setPending(acc)
    api.openAuth(acc.configDir)
  }

  const create = async () => {
    const id = name.trim()
    if (!id || creating) return
    setCreating(true)
    setError('')
    try {
      login(await api.createAccount(id))
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : ''
      // EPERM на mkdir — Windows ещё удаляет одноимённую папку, пока её держит запущенный claude
      setError(/EPERM|EBUSY/.test(msg)
        ? t("Папка с таким именем ещё занята — скорее всего, её держит запущенный claude после удаления аккаунта. Подождите немного или выберите другое имя", "A folder with this name is still in use — most likely a running claude holds it after the account was deleted. Wait a moment or pick another name")
        : msg || t("Не получилось создать аккаунт", "Could not create the account"))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-bg-base flex flex-col">
      <div className="h-11 shrink-0 flex items-stretch">
        <div className="flex-1 app-drag-region" />
        <WindowControls />
      </div>

      <div className="flex-1 flex items-center justify-center px-6 pb-11">
        <div className="w-[380px] max-w-full flex flex-col items-center text-center">
          <img src={logo} alt="" width={64} height={64} draggable={false} className="select-none" />

          {pending ? (
            <>
              <h1 className="mt-5 text-[22px] font-medium text-text-primary">{t("Почти готово", "Almost there")}</h1>
              <p className="mt-1.5 text-[13.5px] text-text-muted">
                {t("Войдите в", "Log in to")}{' '}<span className="text-text-secondary">{pending.name}</span> {t("в открывшемся окне терминала", "in the terminal window that opened")}
              </p>
              <div className="acc-pending mt-6 w-full justify-center">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                {t("Жду вход…", "Waiting for login…")}
              </div>
              <div className="mt-4 flex gap-2">
                <button className="acc-btn" onClick={() => api.openAuth(pending.configDir)}>{t("Открыть терминал ещё раз", "Open the terminal again")}</button>
                <button className="acc-btn" onClick={() => setPending(null)}>{t("Назад", "Back")}</button>
              </div>
            </>
          ) : hasAccounts && !adding ? (
            <>
              <h1 className="mt-5 text-[22px] font-medium text-text-primary">{t("Войдите снова", "Log in again")}</h1>
              <p className="mt-1.5 text-[13.5px] text-text-muted">{t("Вы вышли из всех аккаунтов. Сессии на месте — они вернутся после входа", "You logged out of all accounts. Sessions are still here — they come back after you log in")}</p>
              <div className="mt-6 w-full flex flex-col gap-2">
                {relogin!.map(acc => (
                  <div key={acc.id} className="acc-card !flex-row items-center !py-3 !px-4 text-left">
                    <div className="acc-av is-off !w-8 !h-8 !text-[14px]">{acc.name.slice(0, 1).toUpperCase()}</div>
                    <div className="acc-name flex-1 truncate">{acc.name}</div>
                    <button className="acc-btn is-primary" onClick={() => login(acc)}><LogIn size={14} />{t("Войти", "Log in")}</button>
                  </div>
                ))}
              </div>
              <button className="mt-4 text-[13px] text-text-muted hover:text-text-primary transition-colors" onClick={() => setAdding(true)}>
                {t("или добавить другой аккаунт", "or add another account")}
              </button>
            </>
          ) : (
            <>
              <h1 className="mt-5 text-[22px] font-medium text-text-primary">{hasAccounts ? t("Новый аккаунт", "New account") : t("Добро пожаловать в Vael", "Welcome to Vael")}</h1>
              <p className="mt-1.5 text-[13.5px] text-text-muted">{t("Назовите аккаунт Claude — имя видно только вам, например main или work", "Name your Claude account — only you see the name, e.g. main or work")}</p>
              <div className="acc-add is-open mt-6">
                <input
                  autoFocus
                  value={name}
                  onChange={e => setName(cleanAccountName(e.target.value))}
                  onKeyDown={e => { if (e.key === 'Enter') create(); if (e.key === 'Escape' && hasAccounts) setAdding(false) }}
                  placeholder={t("Название аккаунта", "Account name")}
                />
                <button onClick={create} disabled={!name.trim() || creating} className="acc-btn is-primary disabled:opacity-40">
                  <Plus size={14} />{creating ? t("Создаю…", "Creating…") : t("Создать и войти", "Create and log in")}
                </button>
              </div>
              {error && <div className="acc-warn mt-3 w-full">{error}</div>}
              {hasAccounts && (
                <button className="mt-4 text-[13px] text-text-muted hover:text-text-primary transition-colors" onClick={() => setAdding(false)}>
                  {t("назад к аккаунтам", "back to accounts")}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
