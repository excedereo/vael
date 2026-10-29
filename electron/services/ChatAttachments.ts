import fs from 'fs'
import path from 'path'
import type { ChatAttachment } from '../../shared/types.js'

// Лимиты API: картинка до 5 МБ; PDF берём до 20 МБ — дальше дешевле пусть модель читает сама
const IMAGE_MAX = 5 * 1024 * 1024
const PDF_MAX = 20 * 1024 * 1024
// Текст целиком в сообщении — это токены в контекст навсегда, поэтому скромно
const TEXT_MAX = 256 * 1024

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
}

/** Бинарный ли файл: нулевой байт в начале почти всегда значит «не текст» */
function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

export function readAttachment(filePath: string): ChatAttachment {
  const name = path.basename(filePath)
  let stat: fs.Stats
  try { stat = fs.statSync(filePath) } catch { return { kind: 'path', name, size: 0, path: filePath, reason: 'файл не найден' } }
  if (stat.isDirectory()) return { kind: 'path', name, size: 0, path: filePath, reason: 'папка' }

  const size = stat.size
  const ext = path.extname(filePath).toLowerCase()

  const mediaType = IMAGE_TYPES[ext]
  if (mediaType) {
    if (size > IMAGE_MAX) return { kind: 'path', name, size, path: filePath, reason: 'картинка больше 5 МБ' }
    return { kind: 'image', name, size, mediaType, data: fs.readFileSync(filePath).toString('base64') }
  }
  if (ext === '.pdf') {
    if (size > PDF_MAX) return { kind: 'path', name, size, path: filePath, reason: 'PDF больше 20 МБ' }
    return { kind: 'pdf', name, size, data: fs.readFileSync(filePath).toString('base64') }
  }
  if (size > TEXT_MAX) return { kind: 'path', name, size, path: filePath, reason: 'файл больше 256 КБ' }
  const buf = fs.readFileSync(filePath)
  if (looksBinary(buf)) return { kind: 'path', name, size, path: filePath, reason: 'бинарный файл' }
  return { kind: 'text', name, size, text: buf.toString('utf8'), path: filePath }
}
