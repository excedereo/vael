import type { ChatAttachment } from './types.js'

// Как вложения едут в сообщении и как их потом достать обратно для ленты.
// Общий для main (история из jsonl) и окна (живой поток) — формат должен совпадать.
//
// Вложение стоит в тексте там, куда его вставили, обычной ссылкой в скобках —
// модель видит, к какой фразе оно относится:
//   картинка / PDF:  «…держи [shot.png]» + сразу за этим текстом блок image/document
//   текстовый файл:  «…[notes.md]» + блок <file name="notes.md">содержимое</file>
//   не прикрепить:   «…[C:\путь\к\файлу]» — прочитает модель сама

/** Сообщение из композера: текст вперемешку с вложениями в порядке ввода */
export type ComposedPart = string | ChatAttachment

export function attachmentToken(a: ChatAttachment): string {
  return `[${a.kind === 'path' ? a.path : a.name}]`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

export function buildUserContent(parts: ComposedPart[]): string | unknown[] {
  if (parts.every(p => typeof p === 'string')) return (parts as string[]).join('')

  const blocks: unknown[] = []
  let text = ''
  const flush = () => { if (text) { blocks.push({ type: 'text', text }); text = '' } }

  for (const p of parts) {
    if (typeof p === 'string') { text += p; continue }
    text += attachmentToken(p)
    if (p.kind === 'path') continue
    // Блок вложения — сразу за текстом, где оно стоит
    flush()
    if (p.kind === 'image') blocks.push({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } })
    else if (p.kind === 'pdf') blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.data } })
    else blocks.push({ type: 'text', text: `<file name="${esc(p.name)}">\n${p.text}\n</file>` })
  }
  flush()
  return blocks
}

type Block = { type: string; text?: string }

/**
 * Текст сообщения для ленты + имена вложений. Вложения остаются в тексте
 * ссылками [имя] — лента рисует на их месте чипы.
 */
export function splitUserContent(content: unknown): { text: string; attachments: string[] } {
  const blocks: Block[] = typeof content === 'string' ? [{ type: 'text', text: content }]
    : Array.isArray(content) ? content as Block[] : []
  const names: string[] = []
  let text = ''
  let lastText = ''

  for (const b of blocks) {
    if (b.type === 'image' || b.type === 'document') {
      // Имя — последняя ссылка в скобках перед блоком; иначе картинку вставили не через Vael
      const m = lastText.match(/\[([^\]\n]+)\]\s*$/)
      if (m) { if (names[names.length - 1] !== m[1]) names.push(m[1]) }
      else { names.push('вложение'); text += '[вложение]' }
      lastText = ''
      continue
    }
    if (b.type !== 'text' || !b.text) continue
    const file = b.text.match(/^<file name="([^"]*)"[^>]*>[\s\S]*<\/file>$/)
    if (file) { names.push(unesc(file[1])); lastText = ''; continue }

    // Прежний формат вложений (до ссылок в тексте) — чтобы старая история не сломалась
    let t = b.text
    t = t.replace(/<attachment name="([^"]*)"\/>/g, (_, n) => { names.push(unesc(n)); return `[${unesc(n)}]` })
    t = t.replace(/<file name="([^"]*)"[^>]*?\/>/g, (_, n) => { names.push(unesc(n)); return `[${unesc(n)}]` })
    t = t.replace(/<file name="([^"]*)"[^>]*>[\s\S]*?<\/file>/g, (_, n) => { names.push(unesc(n)); return `[${unesc(n)}]` })
    text += t
    lastText = t
  }
  // Пути вложений, которые нельзя было прикрепить, — тоже чипы
  for (const m of text.matchAll(/\[([A-Za-z]:\\[^\]\n]+|\/[^\]\n]+)\]/g)) if (!names.includes(m[1])) names.push(m[1])
  return { text: text.trim(), attachments: names }
}
