/**
 * useSettings — глобальные настройки приложения.
 * Этап 3 рефакторинга: здесь будет логика из SettingsPage.tsx.
 * Сейчас заглушка — читает из localStorage напрямую.
 */

import { useState, useEffect } from 'react'
import { DEFAULT_CONTENT_PADDING } from '../components/SettingsPage.js'

export interface UISettings {
  contentPadding: number
  reduceMotion: boolean
  showTurnDuration: boolean
  autoScroll: boolean
}

export interface SessionDefaults {
  model: string
  effort: string
  permissionMode: string
}

const UI_SETTINGS_KEY = 'vaeliUISettings'

function loadUISettings(): UISettings {
  try {
    const s = localStorage.getItem(UI_SETTINGS_KEY)
    return s ? { contentPadding: DEFAULT_CONTENT_PADDING, reduceMotion: false, showTurnDuration: true, autoScroll: true, ...JSON.parse(s) } : { contentPadding: DEFAULT_CONTENT_PADDING, reduceMotion: false, showTurnDuration: true, autoScroll: true }
  } catch {
    return { contentPadding: DEFAULT_CONTENT_PADDING, reduceMotion: false, showTurnDuration: true, autoScroll: true }
  }
}

export function useSettings() {
  const [uiSettings, setUISettingsState] = useState<UISettings>(loadUISettings)

  useEffect(() => {
    const handler = () => setUISettingsState(loadUISettings())
    window.addEventListener('vaeli:uiSettingsChanged', handler)
    return () => window.removeEventListener('vaeli:uiSettingsChanged', handler)
  }, [])

  const setUISettings = (s: Partial<UISettings>) => {
    const next = { ...uiSettings, ...s }
    setUISettingsState(next)
    localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(next))
    window.dispatchEvent(new Event('vaeli:uiSettingsChanged'))
  }

  return { uiSettings, setUISettings }
}
