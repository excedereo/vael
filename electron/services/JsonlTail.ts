import fs from 'fs'

/**
 * Строки jsonl с конца, кусками по 256 КБ: fn вернул true — дальше не читаем.
 * Статус, мета-ответ и последний текст лежат в самом хвосте, а файл сессии —
 * десятки МБ: раньше он целиком читался на каждый опрос (раз в 400 мс) и на
 * каждое изменение файла, и main-процесс почти не вылезал из чтения
 */
export function forEachLineFromEnd(jsonlPath: string, fn: (line: string) => boolean | void) {
  const CHUNK = 256 * 1024
  let fd: number
  try { fd = fs.openSync(jsonlPath, 'r') } catch { return }
  try {
    let end = fs.fstatSync(fd).size
    let tail = Buffer.alloc(0)
    while (end > 0) {
      const start = Math.max(0, end - CHUNK)
      const buf = Buffer.alloc(end - start)
      fs.readSync(fd, buf, 0, buf.length, start)
      const data = tail.length ? Buffer.concat([buf, tail]) : buf
      const nl = start > 0 ? data.indexOf(0x0a) : -1
      end = start
      // Кусок целиком внутри одной длинной строки — копим дальше
      if (start > 0 && nl === -1) { tail = data; continue }
      const body = nl === -1 ? data : data.subarray(nl + 1)
      tail = nl === -1 ? Buffer.alloc(0) : data.subarray(0, nl + 1)
      const lines = body.toString('utf-8').split('\n')
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim() && fn(lines[i])) return
      }
    }
  } finally {
    fs.closeSync(fd)
  }
}
