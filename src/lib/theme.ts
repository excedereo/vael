import { BUILTIN_THEMES } from './builtinThemes.js'

const THEME_FILE_KEY = 'vaeli:activeTheme'
const THEME_VARS_KEY = 'vaeli:activeThemeVars'

export function applyTheme(vars: Record<string, string>) {
  const root = document.documentElement
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value)
  }
}

export function clearTheme() {
  const knownVars = [
    '--bg-base', '--bg-sidebar', '--bg-surface', '--bg-elevated',
    '--text-primary', '--text-secondary', '--text-muted', '--text-faint', '--text-ghost',
    '--border-subtle', '--border-default', '--border-strong',
    '--surface-hover', '--surface-selected', '--surface-active',
    '--accent', '--accent-dim',
  ]
  const root = document.documentElement
  for (const v of knownVars) root.style.removeProperty(v)
}

export function saveActiveTheme(file: string, vars: Record<string, string>) {
  localStorage.setItem(THEME_FILE_KEY, file)
  localStorage.setItem(THEME_VARS_KEY, JSON.stringify(vars))
}

export function loadActiveThemeFile(): string | null {
  return localStorage.getItem(THEME_FILE_KEY)
}

// Apply saved theme immediately from localStorage — no IPC needed
// Falls back to Claude builtin theme for new users
export function restoreSavedTheme() {
  try {
    const raw = localStorage.getItem(THEME_VARS_KEY)
    if (raw) {
      applyTheme(JSON.parse(raw) as Record<string, string>)
    } else {
      const claude = BUILTIN_THEMES.find(t => t.file === '__builtin_claude')
      if (claude) applyTheme(claude.vars)
    }
  } catch {}
}
