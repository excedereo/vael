import fs from 'fs'

// Достаёт из jsonl фактическое состояние сессии — то, что нельзя знать из
// локального конфига, потому что модель/эффорт могли поменять командой внутри
// сессии (/model, /effort). Источник правды — сам лог.

export interface SessionInfo {
  /** message.model последнего ответа ассистента */
  model: string | null
  /** effort последней записи, где он был */
  effort: string | null
  /** permissionMode последней записи, где он был */
  permissionMode: string | null
  /** текст последнего ответа ассистента (для превью «на чём остановились») */
  lastText: string | null
  /** timestamp последнего ответа ассистента (ISO) */
  lastAt: string | null
}

export function readSessionInfo(jsonlPath: string): SessionInfo {
  const out: SessionInfo = { model: null, effort: null, permissionMode: null, lastText: null, lastAt: null }
  if (!fs.existsSync(jsonlPath)) return out

  let content: string
  try { content = fs.readFileSync(jsonlPath, 'utf-8') } catch { return out }

  const lines = content.split('\n')
  for (const line of lines) {
    if (!line.trim()) continue
    let d: Record<string, unknown>
    try { d = JSON.parse(line) } catch { continue }

    // permissionMode / effort пишутся на служебных и обычных записях — берём последнее
    if (typeof d.permissionMode === 'string') out.permissionMode = d.permissionMode
    if (typeof d.effort === 'string') out.effort = d.effort

    if (d.type === 'assistant' && d.message && typeof d.message === 'object') {
      const msg = d.message as { model?: string; content?: Array<{ type: string; text?: string }> }
      if (msg.model) out.model = msg.model
      const text = (msg.content || [])
        .filter(c => c.type === 'text' && c.text)
        .map(c => c.text as string)
        .join('')
        .trim()
      if (text) {
        out.lastText = text
        if (typeof d.timestamp === 'string') out.lastAt = d.timestamp
      }
    }
  }
  return out
}
