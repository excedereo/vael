import type { ChatItem } from '../types/index'
import { t } from './i18n.js'

// Что сейчас «вокруг» сессии — вычисляется из ленты чата, поэтому одинаково
// работает и вживую, и после перезагрузки из истории.

export type Artifact = { url: string; title: string }

/**
 * Разбор одного элемента ленты, запомненный за его объектом. Лента обновляется
 * каждый кадр, но изменённый элемент — всегда новый объект, а старые те же:
 * без кэша регулярки гоняли бы по всем результатам сессии 60 раз в секунду
 */
export function perItem<T>(fn: (it: ChatItem) => T): (it: ChatItem) => T {
  const cache = new WeakMap<ChatItem, T>()
  return it => {
    if (cache.has(it)) return cache.get(it) as T
    const v = fn(it)
    cache.set(it, v)
    return v
  }
}

// Только поле artifactUrl ответа Claude Docs: просто упоминание ссылки (в выводе
// Bash, в тексте) — не создание артефакта, и названия у него нет
const artifactUrl = perItem(it => it.kind === 'tool' && it.result && !it.isError
  ? it.result.match(/"artifactUrl"\s*:\s*"(https:\/\/claude\.ai\/artifact\/[\w-]+)"/)?.[1]
  : undefined)

/** Артефакты claude.ai (Claude Docs), созданные в сессии. Новые сначала */
export function deriveArtifacts(items: ChatItem[]): Artifact[] {
  const seen = new Set<string>()
  const out: Artifact[] = []
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind !== 'tool') continue
    const url = artifactUrl(it)
    if (!url || seen.has(url)) continue
    seen.add(url)
    const input = (it.input ?? {}) as { container?: { create?: { name?: string } }; title?: string; name?: string }
    out.push({ url, title: input.container?.create?.name || input.title || input.name || t('Артефакт', 'Artifact') })
  }
  return out
}

export type ContextFile = { path: string; from: 'compact' | 'read' }

/**
 * Файлы в контексте: после последнего компакта там только то, что он вернул,
 * плюс прочитанное после него. Что читалось до компакта — уже выпало.
 * Вложения отдельно: у них есть только имя, пути нет
 */
export function deriveContextFiles(items: ChatItem[]): { files: ContextFile[]; attachments: string[] } {
  let start = 0
  const files = new Map<string, ContextFile>()
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'compact' && it.state === 'done') {
      start = i + 1
      for (const f of it.files ?? []) files.set(f.path, { path: f.path, from: 'compact' })
      break
    }
  }
  const attachments: string[] = []
  for (let i = start; i < items.length; i++) {
    const it = items[i]
    if (it.kind === 'tool' && it.name === 'Read' && it.done && !it.isError) {
      const p = (it.input as { file_path?: string } | null)?.file_path
      if (p) { files.delete(p); files.set(p, { path: p, from: 'read' }) }
    } else if (it.kind === 'user' && it.attachments) {
      for (const a of it.attachments) if (a !== 'вложение' && !attachments.includes(a)) attachments.push(a)
    }
  }
  return { files: [...files.values()].reverse(), attachments: attachments.reverse() }
}

/** Путь Windows → file:/// для карточек и «показать в проводнике» */
export const fileUrl = (p: string) => 'file:///' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F')
