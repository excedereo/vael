import fs from 'fs'

// Достаёт из jsonl фактическое состояние сессии — то, что нельзя знать из
// локального конфига, потому что модель/эффорт могли поменять командой внутри
// сессии (/model, /effort). Источник правды — сам лог.
//
// Всё нужное — последние значения, поэтому читаем с конца кусками и
// останавливаемся, как только нашли всё. Раньше файл (у нас десятки МБ)
// синхронно читался и парсился целиком при каждом открытии экрана сессии.

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

const CHUNK = 4 * 1024 * 1024

/** Одна запись, идём от конца: поле заполняем, только если оно ещё пустое */
function takeLine(out: SessionInfo, line: string) {
  if (!line.trim()) return
  let d: Record<string, unknown>
  try { d = JSON.parse(line) } catch { return }

  // permissionMode / effort пишутся на служебных и обычных записях — берём последнее
  if (out.permissionMode === null && typeof d.permissionMode === 'string') out.permissionMode = d.permissionMode
  if (out.effort === null && typeof d.effort === 'string') out.effort = d.effort

  if (d.type === 'assistant' && d.message && typeof d.message === 'object') {
    const msg = d.message as { model?: string; content?: Array<{ type: string; text?: string }> }
    // <synthetic> — ответы локальных команд (/context, /usage, ошибки лимита):
    // это не модель, запуск с ней шёл бы мимо кэша на ровном месте
    if (msg.model === '<synthetic>') return
    if (out.model === null && msg.model) out.model = msg.model
    if (out.lastText === null) {
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
}

const complete = (o: SessionInfo) => o.model !== null && o.effort !== null && o.permissionMode !== null && o.lastText !== null

export async function readSessionInfo(jsonlPath: string): Promise<SessionInfo> {
  const out: SessionInfo = { model: null, effort: null, permissionMode: null, lastText: null, lastAt: null }
  let fh: fs.promises.FileHandle
  try { fh = await fs.promises.open(jsonlPath, 'r') } catch { return out }
  try {
    let end = (await fh.stat()).size
    // Начало строки, обрезанной на границе куска, — ждёт следующего (более раннего) куска
    let tail = Buffer.alloc(0)
    while (end > 0 && !complete(out)) {
      const start = Math.max(0, end - CHUNK)
      const buf = Buffer.alloc(end - start)
      await fh.read(buf, 0, buf.length, start)
      const data = tail.length ? Buffer.concat([buf, tail]) : buf
      // В начале куска строка может быть неполной — её доразберём со следующим куском
      const nl = start > 0 ? data.indexOf(0x0a) : -1
      // Кусок целиком внутри одной огромной строки — копим дальше, не разбирая
      if (start > 0 && nl === -1) { tail = data; end = start; continue }
      const body = nl === -1 ? data : data.subarray(nl + 1)
      tail = nl === -1 ? Buffer.alloc(0) : data.subarray(0, nl + 1)
      const lines = body.toString('utf8').split('\n')
      for (let i = lines.length - 1; i >= 0 && !complete(out); i--) takeLine(out, lines[i])
      end = start
      if (start === 0) break
    }
  } finally {
    await fh.close()
  }
  return out
}
