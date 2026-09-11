import fs from 'fs'
import path from 'path'
import { PATHS } from './SettingsService.js'

/**
 * Хранилище сессий вне конфигов аккаунтов.
 *
 * У CLI нет опции «где держать projects/» — он всегда пишет в
 * <CLAUDE_CONFIG_DIR>/projects. Поэтому подменяем эту папку junction'ом на
 * общее хранилище в ~/.vael/sessions: CLI работает как обычно и подмены не
 * замечает (проверено — и запись, и --resume), а файлы физически лежат у нас.
 *
 * Что это даёт:
 *  - удаление аккаунта больше не уносит сессии (раньше rmSync конфига
 *    сносил их вместе со всем каталогом);
 *  - аккаунты видят одни и те же файлы, поэтому копировать сессии между
 *    ними не нужно — нечего дублировать и нечего затирать.
 *
 * ⚠️ Junction нельзя удалять рекурсивным rmSync: удаление уйдёт по ссылке и
 * снесёт хранилище. Только fs.unlinkSync / rmdirSync по самой ссылке.
 */

/** Ссылка ли это (junction/symlink), а не настоящая папка */
export function isLink(p: string): boolean {
  try { return fs.lstatSync(p).isSymbolicLink() } catch { return false }
}

/** Куда указывает ссылка, либо null */
export function linkTarget(p: string): string | null {
  try { return isLink(p) ? fs.readlinkSync(p) : null } catch { return null }
}

/**
 * Безопасно убрать projects-ссылку у аккаунта.
 * Возвращает true, если это была ссылка и её сняли.
 */
export function unlinkProjects(configDir: string): boolean {
  const link = path.join(configDir, 'projects')
  if (!isLink(link)) return false
  try {
    fs.unlinkSync(link)
    return true
  } catch {
    // На Windows junction иногда снимается только как каталог
    try { fs.rmdirSync(link); return true } catch { return false }
  }
}

/** Переносит файлы из src в dst, не затирая то, что уже есть в dst */
function mergeInto(src: string, dst: string): number {
  let moved = 0
  fs.mkdirSync(dst, { recursive: true })

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dst, entry.name)

    if (entry.isDirectory()) {
      moved += mergeInto(from, to)
      continue
    }
    if (!entry.isFile()) continue

    // Конфликт одноимённых сессий: оставляем ту, что новее и больше —
    // затирать историю нельзя, это ровно тот сценарий потери, от которого
    // мы и уходим
    if (fs.existsSync(to)) {
      try {
        const a = fs.statSync(from)
        const b = fs.statSync(to)
        if (a.size <= b.size && a.mtimeMs <= b.mtimeMs) continue
      } catch { continue }
    }

    try { fs.copyFileSync(from, to); moved++ } catch {}
  }
  return moved
}

export interface LinkResult {
  ok: boolean
  linked: boolean
  movedFiles: number
  error?: string
}

/**
 * Переводит projects аккаунта на общее хранилище.
 * Идемпотентна: если ссылка уже стоит — ничего не делает.
 */
export function linkAccountSessions(configDir: string): LinkResult {
  const link = path.join(configDir, 'projects')
  const store = PATHS.sessions

  try {
    fs.mkdirSync(store, { recursive: true })

    if (isLink(link)) return { ok: true, linked: false, movedFiles: 0 }

    let movedFiles = 0
    if (fs.existsSync(link)) {
      // Забираем накопленные сессии в хранилище и убираем оригинал
      movedFiles = mergeInto(link, store)
      fs.rmSync(link, { recursive: true, force: true })
    }

    fs.symlinkSync(store, link, 'junction')
    console.log(`[sessions] ${link} → ${store} (перенесено файлов: ${movedFiles})`)
    return { ok: true, linked: true, movedFiles }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.warn(`[sessions] не удалось связать ${link}:`, error)
    return { ok: false, linked: false, movedFiles: 0, error }
  }
}

/** Прогоняет связывание по всем конфиг-дирам аккаунтов */
export function linkAllAccounts(configDirs: string[]): void {
  for (const dir of configDirs) {
    if (fs.existsSync(dir)) linkAccountSessions(dir)
  }
}
