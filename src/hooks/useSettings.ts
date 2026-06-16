import { useState } from 'react'

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

export const DEFAULT_CONTENT_PADDING = 160

export const DEFAULT_SESSION_CONFIG: DefaultSessionConfig = {
  model: 'claude-sonnet-4-6',
  effort: 'high',
  permissionMode: 'bypassPermissions',
}

const MODEL_MIGRATION: Record<string, string> = {
  'sonnet': 'claude-sonnet-4-6',
  'opus':   'claude-opus-4-8',
  'haiku':  'claude-haiku-4-5-20251001',
  'fable':  'claude-fable-5',
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

export function useSettings() {
  const [sessionDefaults, setSessionDefaultsState] = useState<DefaultSessionConfig>(() => loadDefaultSessionConfig())
  const [uiSettings, setUISettingsState] = useState<UISettings>(() => loadUISettings())

  function setSessionDefaults(c: DefaultSessionConfig) {
    setSessionDefaultsState(c)
    saveDefaultSessionConfig(c)
  }

  function setUISettings(s: UISettings) {
    setUISettingsState(s)
    saveUISettings(s)
  }

  return {
    sessionDefaults,
    setSessionDefaults,
    uiSettings,
    setUISettings,
  }
}
