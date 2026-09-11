import fs from 'fs'
import path from 'path'

/**
 * Статистика по jsonl-файлам сессий.
 *
 * Раньше читался `~/.claude/stats-cache.json`, но CLI перестал его обновлять
 * (у пользователя файл замер на несколько месяцев), да и путь был жёстко
 * дефолтным — статистика другого аккаунта туда не попадала в принципе.
 * Считаем сами из логов активного аккаунта: они пишутся всегда и содержат
 * и модель, и разбивку токенов, и время.
 */

export interface StatsDailyActivity {
  date: string
  messageCount: number
  sessionCount: number
  toolCallCount: number
  /**
   * id сессий, активных в этот день. Нужны, чтобы посчитать сессии за период
   * без двойного учёта: сумма sessionCount по дням завышает результат —
   * сессия, шедшая три дня, попадает в каждый из них.
   */
  sessionIds?: string[]
}

export interface StatsModelUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  webSearchRequests?: number
}

export interface StatsCache {
  version: number
  lastComputedDate: string
  dailyActivity: StatsDailyActivity[]
  modelUsage: Record<string, StatsModelUsage>
  dailyModelTokens?: Record<string, Record<string, number>>
  /**
   * Подневная разбивка по типам токенов: день → модель → usage.
   * Нужна, чтобы фильтр периода показывал in/out, а не только общий объём.
   */
  dailyModelUsage?: Record<string, Record<string, StatsModelUsage>>
  totalSessions?: number
  firstSessionDate?: string
  /** Распределение сообщений по часам суток, 0..23 */
  hourCounts?: number[]
}

interface JsonlUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  server_tool_use?: { web_search_requests?: number }
}

interface JsonlLine {
  type?: string
  timestamp?: string
  message?: {
    model?: string
    usage?: JsonlUsage
    content?: Array<{ type?: string }> | string
  }
}

/** YYYY-MM-DD в локальной зоне: сутки должны совпадать с теми, что видит человек */
function localDay(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function emptyUsage(): StatsModelUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0 }
}

/**
 * @param configDir конфиг-дир аккаунта (в нём лежит projects/<encoded>/<id>.jsonl)
 */
export function computeStats(configDir: string): StatsCache | null {
  const projectsDir = path.join(configDir, 'projects')
  if (!fs.existsSync(projectsDir)) return null

  const modelUsage: Record<string, StatsModelUsage> = {}
  const daily = new Map<string, { messageCount: number; toolCallCount: number; sessions: Set<string> }>()
  const dailyModelTokens: Record<string, Record<string, number>> = {}
  const dailyModelUsage: Record<string, Record<string, StatsModelUsage>> = {}
  const hourCounts = new Array(24).fill(0) as number[]

  let totalSessions = 0
  let firstTs: number | null = null

  let projects: fs.Dirent[]
  try { projects = fs.readdirSync(projectsDir, { withFileTypes: true }) } catch { return null }

  for (const proj of projects) {
    if (!proj.isDirectory()) continue
    const dir = path.join(projectsDir, proj.name)

    let files: string[]
    try { files = fs.readdirSync(dir) } catch { continue }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      const sessionId = file.replace(/\.jsonl$/, '')
      totalSessions++

      let content: string
      try { content = fs.readFileSync(path.join(dir, file), 'utf-8') } catch { continue }

      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        let d: JsonlLine
        try { d = JSON.parse(line) } catch { continue }

        const day = d.timestamp ? localDay(d.timestamp) : null
        if (day) {
          const ts = new Date(d.timestamp!).getTime()
          if (firstTs === null || ts < firstTs) firstTs = ts

          if (!daily.has(day)) daily.set(day, { messageCount: 0, toolCallCount: 0, sessions: new Set() })
          const bucket = daily.get(day)!
          bucket.sessions.add(sessionId)

          if (d.type === 'user' || d.type === 'assistant') {
            bucket.messageCount++
            hourCounts[new Date(d.timestamp!).getHours()]++
          }
          if (d.type === 'assistant' && Array.isArray(d.message?.content)) {
            bucket.toolCallCount += d.message!.content!.filter(c => c.type === 'tool_use').length
          }
        }

        if (d.type !== 'assistant' || !d.message?.usage) continue
        const model = d.message.model
        // <synthetic> — служебные записи без реального запроса к модели
        if (!model || model === '<synthetic>') continue

        const u = d.message.usage
        const acc = modelUsage[model] ?? (modelUsage[model] = emptyUsage())
        acc.inputTokens += u.input_tokens ?? 0
        acc.outputTokens += u.output_tokens ?? 0
        acc.cacheReadInputTokens += u.cache_read_input_tokens ?? 0
        acc.cacheCreationInputTokens += u.cache_creation_input_tokens ?? 0
        acc.webSearchRequests = (acc.webSearchRequests ?? 0) + (u.server_tool_use?.web_search_requests ?? 0)

        if (day) {
          const total = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) +
                        (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
          dailyModelTokens[day] = dailyModelTokens[day] ?? {}
          dailyModelTokens[day][model] = (dailyModelTokens[day][model] ?? 0) + total

          dailyModelUsage[day] = dailyModelUsage[day] ?? {}
          const dayAcc = dailyModelUsage[day][model] ?? (dailyModelUsage[day][model] = emptyUsage())
          dayAcc.inputTokens += u.input_tokens ?? 0
          dayAcc.outputTokens += u.output_tokens ?? 0
          dayAcc.cacheReadInputTokens += u.cache_read_input_tokens ?? 0
          dayAcc.cacheCreationInputTokens += u.cache_creation_input_tokens ?? 0
        }
      }
    }
  }

  const dailyActivity: StatsDailyActivity[] = [...daily.entries()]
    .map(([date, v]) => ({
      date,
      messageCount: v.messageCount,
      sessionCount: v.sessions.size,
      toolCallCount: v.toolCallCount,
      sessionIds: [...v.sessions],
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    version: 5,
    lastComputedDate: localDay(new Date().toISOString())!,
    dailyActivity,
    modelUsage,
    dailyModelTokens,
    dailyModelUsage,
    totalSessions,
    firstSessionDate: firstTs ? localDay(new Date(firstTs).toISOString())! : undefined,
    hourCounts,
  }
}
