// Общий стор для «под-вкладок» разделов Settings и Accounts.
// Список вкладок рисует общий Sidebar, а сама страница читает активную —
// связь через этот модуль, чтобы не тащить состояние через App.
import { useSyncExternalStore } from 'react'

export type SettingsTab = 'interface' | 'sessions' | 'notifications' | 'system'
export type AccountsTab = 'accounts' | 'stats'

interface TabState {
  settings: SettingsTab
  accounts: AccountsTab
}

const state: TabState = {
  settings: (localStorage.getItem('vaeli:settingsTab') as SettingsTab) || 'interface',
  accounts: (localStorage.getItem('vaeli:accountsTab') as AccountsTab) || 'accounts',
}

const listeners = new Set<() => void>()
function emit() { listeners.forEach(l => l()) }

export function setSettingsTab(t: SettingsTab) {
  state.settings = t
  localStorage.setItem('vaeli:settingsTab', t)
  emit()
}
export function setAccountsTab(t: AccountsTab) {
  state.accounts = t
  localStorage.setItem('vaeli:accountsTab', t)
  emit()
}

function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } }

export function useSettingsTab(): SettingsTab {
  return useSyncExternalStore(subscribe, () => state.settings)
}
export function useAccountsTab(): AccountsTab {
  return useSyncExternalStore(subscribe, () => state.accounts)
}
