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
    '--accent', '--accent-hi', '--accent-deep', '--accent-wash', '--accent-dim', '--accent-glow', '--accent-crystal',
    '--success', '--success-glow',
    '--toolbar-bg', '--dropdown-bg', '--welcome-bg', '--welcome-card', '--welcome-card-hover',
    '--code-bg', '--error-bg', '--error-border', '--error-text',
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
// Falls back to Ambient builtin theme for new users.
// ВАЖНО: для builtin-тем берём СВЕЖИЕ значения из массива, а не сохранённый
// снапшот vars — иначе редизайн палитры не подхватится, пока юзер вручную не
// переключит тему (старый снапшот с #8b5cf6 держался в localStorage).
export function restoreSavedTheme() {
  try {
    const file = localStorage.getItem(THEME_FILE_KEY)
    const builtin = file ? BUILTIN_THEMES.find(t => t.file === file) : null
    if (builtin) {
      applyTheme(builtin.vars)
      localStorage.setItem(THEME_VARS_KEY, JSON.stringify(builtin.vars))
      return
    }
    const raw = localStorage.getItem(THEME_VARS_KEY)
    if (raw) {
      applyTheme(JSON.parse(raw) as Record<string, string>)
    } else {
      // Дефолт для новых юзеров — Claude (терракот)
      const fallback = BUILTIN_THEMES.find(t => t.file === '__builtin_claude')
        ?? BUILTIN_THEMES.find(t => t.file === '__builtin_dark')
      if (fallback) applyTheme(fallback.vars)
    }
  } catch {}
}
