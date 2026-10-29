import type { ChatModelInfo } from './api.js'

// Список моделей приходит от CLI в initialize живого чата. Кэшируем его, чтобы
// экран новой сессии и подписи показывали те же модели, что и сам CLI
const KEY = 'vaeli:cli-models'

export function saveCliModels(models: ChatModelInfo[]) {
  if (!models.length) return
  try { localStorage.setItem(KEY, JSON.stringify(models)) } catch {}
  window.dispatchEvent(new Event('vaeli:cliModelsChanged'))
}

export function loadCliModels(): ChatModelInfo[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

/** claude-opus-5-5 → Opus 5.5, если CLI ещё ни разу не прислал список */
function prettyFromId(id: string): string {
  const m = id.replace(/\[.*\]$/, '').match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/)
  if (!m) return id
  return m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + (m[3] ? '.' + m[3] : '')
}

/** Человеческое имя для id или алиаса модели */
export function modelDisplayName(id: string | null | undefined, models = loadCliModels()): string | null {
  if (!id) return null
  const b = id.replace(/\[.*\]$/, '')
  const hit = models.find(m => m.value !== 'default' && (m.resolvedModel === b || m.value === b))
  return hit?.displayName ?? prettyFromId(b)
}
