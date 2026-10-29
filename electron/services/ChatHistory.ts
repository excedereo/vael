import fs from 'fs'
import type { ChatItem, ChatHistory, CompactFile, CompactTail, CompactSummary } from '../../shared/types.js'
import { splitUserContent } from '../../shared/chatContent.js'

// История сессии из jsonl в виде ленты чата — в той же форме, что строит живой поток

type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean }

export function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Block[]).map(b => b.type === 'text' ? (b.text ?? '') : `[${b.type}]`).join('\n')
  }
  return content == null ? '' : JSON.stringify(content)
}

// Служебные вставки CLI в user-записях, которые в ленте не нужны
function isServiceText(t: string): boolean {
  return t.startsWith('<local-command-caveat>') || t.startsWith('Caveat:') || t.startsWith('<system-reminder>')
}

/** Запись attachment сразу после компакта → файл, оставшийся в контексте */
function compactFile(a: Record<string, any> | undefined): CompactFile | null {
  if (!a || typeof a.filename !== 'string') return null
  if (a.type === 'file') return { path: a.filename, lines: a.content?.file?.numLines ?? undefined }
  if (a.type === 'compact_file_reference') return { path: a.filename, ref: true }
  return null
}

/** Текст пересказа из записи isCompactSummary: строка или блоки text */
function summaryText(e: Record<string, any>): string {
  const c = e.message?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.filter((b: Block) => b?.type === 'text' && b.text).map((b: Block) => b.text).join('\n\n')
  return ''
}

/** Пересказ и файлы после последнего compact_boundary — для живой карточки, когда сжатие только что закончилось */
export async function readCompactTail(jsonlPath: string, preTokens?: number): Promise<CompactTail> {
  const empty: CompactTail = { files: [], summary: null }
  let text: string
  try { text = await fs.promises.readFile(jsonlPath, 'utf-8') } catch { return empty }
  const at = text.lastIndexOf('"compact_boundary"')
  if (at < 0) return empty
  // Граница ещё не дописана — не отдавать хвост прошлого компакта
  if (preTokens != null) {
    try {
      const b = JSON.parse(text.slice(text.lastIndexOf('\n', at) + 1, text.indexOf('\n', at)))
      if ((b.compactMetadata?.preTokens ?? b.compact_metadata?.pre_tokens) !== preTokens) return empty
    } catch { return empty }
  }
  const tail: CompactTail = { files: [], summary: null }
  for (const line of text.slice(text.indexOf('\n', at) + 1).split('\n')) {
    if (!line.trim()) continue
    let e: Record<string, any>
    try { e = JSON.parse(line) } catch { continue }
    if (e.type === 'assistant') break
    if (e.isCompactSummary) { tail.summary = summaryText(e) || null; continue }
    const f = e.type === 'attachment' ? compactFile(e.attachment) : null
    if (f) tail.files.push(f)
  }
  return tail
}

/** Все пересказы сессии по порядку — для окна «Пересказы» и `vael summary` */
export async function readSummaries(jsonlPath: string): Promise<CompactSummary[]> {
  let text: string
  try { text = await fs.promises.readFile(jsonlPath, 'utf-8') } catch { return [] }
  const out: CompactSummary[] = []
  for (const line of text.split('\n')) {
    // Быстрый отсев: парсим только строки компакта
    if (!line.includes('compact_boundary') && !line.includes('"isCompactSummary":true')) continue
    let e: Record<string, any>
    try { e = JSON.parse(line) } catch { continue }
    if (e.type === 'system' && e.subtype === 'compact_boundary') {
      const pre = e.compactMetadata?.preTokens ?? e.compact_metadata?.pre_tokens
      const post = e.compactMetadata?.postTokens ?? e.compact_metadata?.post_tokens
      out.push({
        at: e.timestamp ? Date.parse(e.timestamp) || undefined : undefined,
        before: typeof pre === 'number' ? pre : undefined,
        after: typeof post === 'number' ? post : undefined,
        summary: '',
      })
    } else if (e.isCompactSummary && out.length && !out[out.length - 1].summary) {
      out[out.length - 1].summary = summaryText(e)
    }
  }
  return out.filter(s => s.summary)
}

export function readChatHistory(jsonlPath: string): ChatHistory {
  const items: ChatItem[] = []
  let contextTokens: number | null = null
  let model: string | null = null
  const tools = new Map<string, Extract<ChatItem, { kind: 'tool' }>>()
  let lastCompact: Extract<ChatItem, { kind: 'compact' }> | null = null

  let lines: string[]
  try { lines = fs.readFileSync(jsonlPath, 'utf-8').split('\n') } catch { return { items, contextTokens, model } }

  let n = 0
  const key = () => `h${n++}`

  for (const line of lines) {
    if (!line.trim()) continue
    let e: Record<string, any>
    try { e = JSON.parse(line) } catch { continue }
    if (e.isSidechain) continue
    const at = e.timestamp ? Date.parse(e.timestamp) || undefined : undefined

    if (e.type === 'system' && e.subtype === 'compact_boundary') {
      const pre = e.compactMetadata?.preTokens ?? e.compact_metadata?.pre_tokens
      const post = e.compactMetadata?.postTokens ?? e.compact_metadata?.post_tokens
      lastCompact = { kind: 'compact', key: key(), state: 'done', before: typeof pre === 'number' ? pre : undefined, after: typeof post === 'number' ? post : undefined }
      items.push(lastCompact)
      if (typeof post === 'number') contextTokens = post
      continue
    }
    if (e.isCompactSummary) {
      if (lastCompact) lastCompact.summary = summaryText(e) || undefined
      continue
    }
    if (e.type === 'attachment') {
      const f = lastCompact ? compactFile(e.attachment) : null
      if (f && lastCompact) (lastCompact.files ??= []).push(f)
      continue
    }
    if (e.type === 'assistant') lastCompact = null

    if (e.type === 'user') {
      const c = e.message?.content
      if (Array.isArray(c) && c.some((b: Block) => b.type === 'tool_result')) {
        for (const b of c as Block[]) {
          if (b.type !== 'tool_result' || !b.tool_use_id) continue
          const t = tools.get(b.tool_use_id)
          if (t) { t.result = toolResultText(b.content); t.isError = !!b.is_error; t.done = true }
        }
        continue
      }
      if (e.isMeta) continue
      const split = splitUserContent(c)
      const t = split.text.trim()
      if ((!t && split.attachments.length === 0) || isServiceText(t)) continue
      const out = t.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/)
      if (out) { if (out[1].trim()) items.push({ kind: 'note', key: key(), text: out[1].trim() }); continue }
      const cmd = t.match(/<command-name>([\s\S]*?)<\/command-name>/)
      if (cmd) {
        const args = t.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] ?? ''
        items.push({ kind: 'user', key: key(), text: (cmd[1] + ' ' + args).trim(), at })
        continue
      }
      items.push({ kind: 'user', key: key(), text: t, attachments: split.attachments.length ? split.attachments : undefined, at })
      continue
    }

    if (e.type === 'assistant') {
      const m = e.message
      const synthetic = m?.model === '<synthetic>'
      for (const b of (m?.content ?? []) as Block[]) {
        if (b.type === 'text' && b.text) {
          items.push(synthetic ? { kind: 'note', key: key(), text: b.text, markdown: true } : { kind: 'text', key: key(), text: b.text, at })
        } else if (b.type === 'tool_use' && b.id) {
          const item: Extract<ChatItem, { kind: 'tool' }> = { kind: 'tool', key: key(), id: b.id, name: b.name ?? '?', input: b.input, done: false }
          tools.set(b.id, item)
          items.push(item)
        }
      }
      const u = m?.usage
      if (u && !synthetic) {
        const total = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        if (total > 0) contextTokens = total
        if (m.model) model = m.model
      }
    }
  }
  return { items: reorderCompacts(items), contextTokens, model }
}

/**
 * CLI пишет в jsonl сначала границу компакта, а команду `/compact` и её вывод «Compacted» — после.
 * В ленте это выглядит как карточка над командой. Ставим команду перед карточкой,
 * а «Compacted» убираем: карточка и так говорит, что сжато
 */
function reorderCompacts(items: ChatItem[]): ChatItem[] {
  const out = [...items]
  for (let i = 0; i < out.length; i++) {
    if (out[i].kind !== 'compact') continue
    // Смотрим несколько записей вперёд: между ними бывают служебные строки
    for (let j = i + 1; j < Math.min(out.length, i + 4); j++) {
      const it = out[j]
      if (it.kind === 'user' && it.text.trim().startsWith('/compact')) {
        out.splice(j, 1)
        out.splice(i, 0, it)
        i++
      } else if ((it.kind === 'note' || it.kind === 'text') && /^compacted\b/i.test(it.text.trim())) {
        out.splice(j, 1)
        j--
      }
    }
  }
  return out
}
