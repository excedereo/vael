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

/** Человеческое имя для id или алиаса модели. Алиас семейства — по самой новой версии */
export function modelDisplayName(id: string | null | undefined, models = loadCliModels()): string | null {
  if (!id) return null
  const b = id.replace(/\[.*\]$/, '')
  if (MAIN_ALIASES.includes(b)) {
    const best = pickNewest(models).find(m => modelVersion(m)?.fam === b)
    if (best) return best.displayName
  }
  const hit = models.find(m => m.value !== 'default' && (m.resolvedModel === b || m.value === b))
  return hit?.displayName ?? prettyFromId(b)
}

// ── Самая новая модель семейства ────────────────────────────────────────────
// Алиас CLI бывает отстаёт: fable указывает на 5.1, когда 5.2 уже пришла в списке
// отдельной моделью. В настройках храним семейство (fable), а самую новую версию
// выбираем по списку CLI — в меню и в момент запуска сессии

/** Основные семейства, от самого сильного к самому быстрому — как на claude.ai */
export const MAIN_ALIASES = ['fable', 'opus', 'sonnet', 'haiku']

/** Семейство и версия: claude-fable-5-2 → fable, 502. У алиаса — по тому, во что он разворачивается */
export function modelVersion(m: ChatModelInfo): { fam: string; v: number } | null {
  const id = (m.resolvedModel ?? m.value).replace(/\[.*\]$/, '')
  const mm = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/)
  if (mm) return { fam: mm[1], v: +mm[2] * 100 + (mm[3] ? +mm[3] : 0) }
  return MAIN_ALIASES.includes(m.value) ? { fam: m.value, v: -1 } : null
}

/** Самая новая модель каждого семейства; при равной версии — алиас: он сам переедет дальше */
export function pickNewest(list: ChatModelInfo[]): ChatModelInfo[] {
  return MAIN_ALIASES.map(fam => {
    let best: ChatModelInfo | undefined, bestV = -2
    for (const m of list) {
      const mv = modelVersion(m)
      if (!mv || mv.fam !== fam) continue
      if (mv.v > bestV || (mv.v === bestV && m.value === fam)) { best = m; bestV = mv.v }
    }
    return best
  }).filter(Boolean) as ChatModelInfo[]
}

/**
 * Пункты выбора модели для настроек: сверху семейства (значение — алиас, подпись —
 * самая новая версия), ниже всё остальное, что знает CLI. Пусто — алиасы без версий
 */
export function modelChoiceOptions(models = loadCliModels()): { value: string; label: string; sub: string }[] {
  const list = models.filter(m => m.value !== 'default')
  if (!list.length) return MAIN_ALIASES.map(a => ({ value: a, label: a[0].toUpperCase() + a.slice(1), sub: '' }))
  const best = pickNewest(list)
  const main = best.map(m => ({ value: modelVersion(m)!.fam, label: m.displayName, sub: m.description ?? '' }))
  const rest = list.filter(m => !MAIN_ALIASES.includes(m.value) && !best.includes(m))
    .map(m => ({ value: m.value, label: m.displayName, sub: m.description ?? '' }))
  return [...main, ...rest]
}

/** Что передать CLI при запуске: семейство → самая новая известная версия, остальное как есть */
export function resolveModel(value: string, models = loadCliModels()): string {
  if (!MAIN_ALIASES.includes(value)) return value
  return pickNewest(models).find(m => modelVersion(m)?.fam === value)?.value ?? value
}
