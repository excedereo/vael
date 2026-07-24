import fs from 'fs'
import type { SessionMeta } from '../../shared/types.js'

// <id>.meta.json лежит рядом с <id>.jsonl. Это НАША надстройка над сессией:
// имя, архив, теги, ручной порядок. Сам jsonl и claude CLI об этом файле не знают.

function metaPathFor(jsonlPath: string): string {
  return jsonlPath.replace(/\.jsonl$/, '.meta.json')
}

export function readMeta(jsonlPath: string): SessionMeta {
  const p = metaPathFor(jsonlPath)
  if (!fs.existsSync(p)) return {}
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as SessionMeta
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

export function writeMeta(jsonlPath: string, patch: Partial<SessionMeta>): SessionMeta {
  const p = metaPathFor(jsonlPath)
  const current = readMeta(jsonlPath)
  const next: SessionMeta = { ...current, ...patch }

  // чистим пустые значения, чтобы файл не копил мусор
  if (next.customTitle === '' || next.customTitle === undefined) delete next.customTitle
  if (!next.archived) delete next.archived
  if (next.tags && next.tags.length === 0) delete next.tags
  if (next.order === undefined) delete next.order

  // если после чистки пусто — удаляем файл целиком
  if (Object.keys(next).length === 0) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p) } catch {}
    return {}
  }

  try {
    fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf-8')
  } catch {
    // молча — метаданные не критичны, не роняем процесс
  }
  return next
}
