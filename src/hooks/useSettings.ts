import { useState } from 'react'
import { api } from '../lib/api.js'

export interface DefaultSessionConfig {
  model: string
  effort: string
  permissionMode: string
}

export interface UISettings {
  reduceMotion: boolean
  showTurnDuration: boolean
  autoScroll: boolean
  contentPadding: number
}

export type NotificationCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface NotificationSettings {
  enabled: boolean
  corner: NotificationCorner
  /** Ширина карточки, px */
  width: number
  /** Масштаб содержимого карточки (шрифты, иконка, высота) */
  scale: number
  /** Сколько карточек держим на экране одновременно */
  maxStack: number
  /** Сколько секунд карточка висит без наведения */
  holdSeconds: number
  /** Не гасить карточку по таймеру — висит, пока её не закроют или не откроют Vael */
  holdForever: boolean
  /** Звук при появлении карточки */
  soundEnabled: boolean
  /** Файл звука из public/sounds */
  soundFile: string
  /** Громкость звука, 0..1 */
  soundVolume: number
}

/**
 * Предупреждение о выходе в сеть без VPN.
 *
 * Страна берётся у самого api.anthropic.com (/cdn-cgi/trace) — то есть та,
 * которую реально видит Anthropic. Список стран настраиваемый: какие считать
 * нежелательными — решение пользователя, а не приложения.
 */
export interface VpnCheckSettings {
  enabled: boolean
  /** ISO-коды стран, при которых показываем предупреждение */
  warnCountries: string[]
}

export const DEFAULT_VPN_CHECK: VpnCheckSettings = {
  enabled: true,
  warnCountries: ['RU', 'BY'],
}

export function loadVpnCheck(): VpnCheckSettings {
  try {
    const raw = localStorage.getItem('vaeli:vpn-check')
    if (raw) return { ...DEFAULT_VPN_CHECK, ...JSON.parse(raw) as Partial<VpnCheckSettings> }
  } catch {}
  return { ...DEFAULT_VPN_CHECK }
}

export function saveVpnCheck(s: VpnCheckSettings) {
  localStorage.setItem('vaeli:vpn-check', JSON.stringify(s))
}

export const DEFAULT_CONTENT_PADDING = 160

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  corner: 'bottom-right',
  width: 340,
  scale: 1.15,
  maxStack: 5,
  holdSeconds: 5,
  holdForever: false,
  soundEnabled: true,
  soundFile: 'norification.mp3',
  soundVolume: 0.6,
}

export const DEFAULT_SESSION_CONFIG: DefaultSessionConfig = {
  model: 'claude-sonnet-5',
  effort: 'high',
  permissionMode: 'bypassPermissions',
}

const MODEL_MIGRATION: Record<string, string> = {
  'sonnet': 'claude-sonnet-5',
  'opus':   'claude-opus-5',
  'haiku':  'claude-haiku-4-5-20251001',
  'fable':  'claude-fable-5',
  'claude-sonnet-4-6': 'claude-sonnet-5',
  'claude-opus-4-8':   'claude-opus-5',
}

export function loadDefaultSessionConfig(): DefaultSessionConfig {
  try {
    const raw = localStorage.getItem('vaeli:default-session-config')
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DefaultSessionConfig>
      if (parsed.model && MODEL_MIGRATION[parsed.model]) {
        parsed.model = MODEL_MIGRATION[parsed.model]
        localStorage.setItem('vaeli:default-session-config', JSON.stringify({ ...DEFAULT_SESSION_CONFIG, ...parsed }))
      }
      return { ...DEFAULT_SESSION_CONFIG, ...parsed }
    }
  } catch {}
  return DEFAULT_SESSION_CONFIG
}

export function saveDefaultSessionConfig(c: DefaultSessionConfig) {
  localStorage.setItem('vaeli:default-session-config', JSON.stringify(c))
}

function loadUISettings(): UISettings {
  try {
    const s = localStorage.getItem('vaeliUISettings')
    const parsed = s ? JSON.parse(s) : {}
    return {
      reduceMotion: false,
      showTurnDuration: false,
      autoScroll: true,
      contentPadding: DEFAULT_CONTENT_PADDING,
      ...parsed,
    }
  } catch {
    return {
      reduceMotion: false,
      showTurnDuration: false,
      autoScroll: true,
      contentPadding: DEFAULT_CONTENT_PADDING,
    }
  }
}

function saveUISettings(s: UISettings) {
  localStorage.setItem('vaeliUISettings', JSON.stringify(s))
}

export function loadNotificationSettings(): NotificationSettings {
  try {
    const raw = localStorage.getItem('vaeli:notification-settings')
    if (raw) return { ...DEFAULT_NOTIFICATION_SETTINGS, ...JSON.parse(raw) as Partial<NotificationSettings> }
  } catch {}
  return { ...DEFAULT_NOTIFICATION_SETTINGS }
}

function saveNotificationSettings(s: NotificationSettings) {
  localStorage.setItem('vaeli:notification-settings', JSON.stringify(s))
}

export function useSettings() {
  const [sessionDefaults, setSessionDefaultsState] = useState<DefaultSessionConfig>(() => loadDefaultSessionConfig())
  const [uiSettings, setUISettingsState] = useState<UISettings>(() => loadUISettings())
  const [notifications, setNotificationsState] = useState<NotificationSettings>(() => loadNotificationSettings())

  function setSessionDefaults(c: DefaultSessionConfig) {
    setSessionDefaultsState(c)
    saveDefaultSessionConfig(c)
  }

  function setUISettings(s: UISettings) {
    setUISettingsState(s)
    saveUISettings(s)
  }

  function setNotifications(s: NotificationSettings) {
    setNotificationsState(s)
    saveNotificationSettings(s)
    api.applyNotificationSettings(s)
  }

  return {
    sessionDefaults,
    setSessionDefaults,
    uiSettings,
    setUISettings,
    notifications,
    setNotifications,
  }
}
