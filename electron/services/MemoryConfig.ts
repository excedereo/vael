import fs from 'fs'
import path from 'path'

// Сборка блока памяти для CLAUDE.md по внешнему конфигу.
//
// Раньше политика загрузки жила внутри самих файлов (фронтматтер с `auto`,
// `desc`, тегами) и размазывалась по всей памяти: чтобы понять, что попадёт
// в контекст, надо было открыть каждый файл. Теперь правила снаружи, в одном
// memory.config.json, а файлы памяти — просто текст.
//
// Отбор «что грузить» вообще перестал быть проблемой: вся память это ~50k
// токенов при окне в миллион. Экономить нечего, поэтому грузим почти всё,
// а конфиг решает лишь, что оставить за бортом (летопись) и сколько взять
// от хронологии.

export interface RecentRule {
  dir: string
  /** сколько последних взять; 'all' — все */
  take: number | 'all'
  /** только 'name': дата в имени файла и есть хронология */
  sortBy?: 'name'
  order?: 'asc' | 'desc'
}

export interface MemoryConfig {
  /** пути от корня памяти; со слэшем на конце — папка целиком */
  always: string[]
  recent: RecentRule[]
  never: string[]
  /** тег в сообщении → файл, который надо прочитать */
  tags: Record<string, string>
}

const DEFAULT_CONFIG: MemoryConfig = {
  always: [],
  recent: [],
  never: [],
  tags: {},
}

export function loadMemoryConfig(memoryRoot: string): MemoryConfig {
  const p = path.join(memoryRoot, 'memory.config.json')
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
      return { ...DEFAULT_CONFIG, ...raw }
    }
  } catch (e) {
    console.error('[memory] битый memory.config.json:', e)
  }
  return DEFAULT_CONFIG
}

/** Есть ли конфиг — по этому решаем, какой сборкой блока пользоваться. */
export function hasMemoryConfig(memoryRoot: string): boolean {
  return fs.existsSync(path.join(memoryRoot, 'memory.config.json'))
}

interface Collected {
  /** rel-путь → содержимое */
  files: Map<string, string>
  chars: number
}

function readFileSafe(p: string): string | null {
  try { return fs.readFileSync(p, 'utf-8') } catch { return null }
}

function collectDir(root: string, rel: string, out: Collected, skip: (rel: string) => boolean) {
  const abs = path.join(root, rel)
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(abs, { withFileTypes: true }) } catch { return }

  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.')) continue
    const childRel = rel ? `${rel}/${e.name}` : e.name
    if (skip(childRel)) continue
    if (e.isDirectory()) {
      collectDir(root, childRel, out, skip)
    } else if (e.name.endsWith('.md')) {
      const text = readFileSafe(path.join(root, childRel))
      if (text !== null) { out.files.set(childRel, text); out.chars += text.length }
    }
  }
}

/**
 * Что попадёт в контекст. Возвращает файлы в порядке: always, затем recent
 * (свежие сверху), затем список тегов отдельно.
 */
export function collectMemory(memoryRoot: string, cfg: MemoryConfig) {
  const out: Collected = { files: new Map(), chars: 0 }

  const tagged = new Set(Object.values(cfg.tags))
  const skip = (rel: string) => {
    if (cfg.never.some(n => rel === n || rel.startsWith(n.replace(/\/$/, '') + '/'))) return true
    // Файлы с тегом грузятся только по тегу — в общий блок не идут
    if (tagged.has(rel)) return true
    return false
  }

  // корневой индекс — всегда первым, это карта памяти
  for (const name of ['MEMORY.md', 'INDEX.md']) {
    const text = readFileSafe(path.join(memoryRoot, name))
    if (text !== null) { out.files.set(name, text); out.chars += text.length; break }
  }

  for (const item of cfg.always) {
    if (item.endsWith('/')) {
      collectDir(memoryRoot, item.replace(/\/$/, ''), out, skip)
    } else {
      if (skip(item)) continue
      const text = readFileSafe(path.join(memoryRoot, item))
      if (text !== null) { out.files.set(item, text); out.chars += text.length }
    }
  }

  const recentPicked: { rel: string; dir: string }[] = []
  for (const rule of cfg.recent) {
    const abs = path.join(memoryRoot, rule.dir)
    let names: string[]
    try {
      names = fs.readdirSync(abs).filter(f => f.endsWith('.md'))
    } catch { continue }

    // Сортируем по имени, а не по mtime: правка старой записи не должна
    // выталкивать свежую из окна
    names.sort()
    if ((rule.order ?? 'desc') === 'desc') names.reverse()
    const take = rule.take === 'all' ? names.length : rule.take
    for (const n of names.slice(0, take)) {
      const rel = `${rule.dir}/${n}`
      const text = readFileSafe(path.join(memoryRoot, rel))
      if (text !== null) {
        out.files.set(rel, text)
        out.chars += text.length
        recentPicked.push({ rel, dir: rule.dir })
      }
    }
  }

  return { files: out.files, chars: out.chars, recentPicked }
}

/** Кириллица укладывается примерно в 1.8 символа на токен. */
export function estimateTokens(chars: number): number {
  return Math.round(chars * 0.55)
}

export function buildBlockBody(memoryRoot: string, cfg: MemoryConfig): { body: string; tokens: number; fileCount: number } {
  const { files, chars } = collectMemory(memoryRoot, cfg)

  const parts: string[] = [`Memory root: ${memoryRoot}`, '']

  for (const [rel, text] of files) {
    parts.push(`### ${rel}`, text.trim(), '')
  }

  const tagEntries = Object.entries(cfg.tags)
  if (tagEntries.length) {
    parts.push(
      '## Теги',
      'Эти файлы не загружены. Читать по требованию, когда в сообщении встретился тег:',
      ...tagEntries.map(([tag, rel]) => `[${tag}] — ${rel}`),
      '',
    )
  }

  if (cfg.never.length) {
    parts.push(
      '## Не загружено',
      `Читать по требованию: ${cfg.never.join(', ')}`,
      '',
    )
  }

  return { body: parts.join('\n'), tokens: estimateTokens(chars), fileCount: files.size }
}
