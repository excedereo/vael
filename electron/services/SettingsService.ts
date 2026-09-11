import fs from 'fs'
import path from 'path'
import os from 'os'
import { app } from 'electron'

const VAEL_ROOT = path.join(os.homedir(), '.vael')

// Все пути в одном месте — не разбросаны по main.ts.
// Данные Vael живут в ~/.vael, а не в AppData: путь читаемый, папку видно
// рядом с памятью и вложениями, переустановка приложения её не уносит.
export const PATHS = {
  userData: app.getPath('userData'),
  vael: VAEL_ROOT,
  themes: path.join(VAEL_ROOT, 'themes'),
  temp: path.join(VAEL_ROOT, 'temp'),
  vaeliSettings: path.join(VAEL_ROOT, 'vaeli-settings.json'),
  /** Хранилище сессий: конфиги аккаунтов смотрят сюда junction'ом */
  sessions: path.join(VAEL_ROOT, 'sessions'),
  globalSettings: path.join(os.homedir(), '.claude', 'settings.json'),
  claudeMd: path.join(os.homedir(), '.claude', 'CLAUDE.md'),
  memory: path.join(VAEL_ROOT, 'memory'),
  memoryMeta: path.join(VAEL_ROOT, 'memory-meta.json'),
}

/**
 * Разовый переезд из AppData в ~/.vael. Копируем, а не переносим: если
 * что-то пойдёт не так, старые данные остаются на месте нетронутыми.
 * Уже существующие в ~/.vael файлы не трогаем — они новее.
 */
export function migrateFromUserData(): void {
  const legacy = app.getPath('userData')

  const items: Array<{ from: string; to: string; dir: boolean }> = [
    { from: path.join(legacy, 'themes'), to: PATHS.themes, dir: true },
    { from: path.join(legacy, 'temp'), to: PATHS.temp, dir: true },
    { from: path.join(legacy, 'vaeli-settings.json'), to: PATHS.vaeliSettings, dir: false },
  ]

  for (const { from, to, dir } of items) {
    try {
      if (!fs.existsSync(from) || fs.existsSync(to)) continue
      if (dir) {
        fs.mkdirSync(to, { recursive: true })
        for (const name of fs.readdirSync(from)) {
          const src = path.join(from, name)
          if (!fs.statSync(src).isFile()) continue
          fs.copyFileSync(src, path.join(to, name))
        }
      } else {
        fs.copyFileSync(from, to)
      }
      console.log(`[migrate] ${from} → ${to}`)
    } catch (e) {
      console.warn(`[migrate] не удалось перенести ${from}:`, e)
    }
  }
}

export function loadVaeliSettings(): Record<string, unknown> {
  try {
    if (fs.existsSync(PATHS.vaeliSettings)) {
      return JSON.parse(fs.readFileSync(PATHS.vaeliSettings, 'utf-8'))
    }
  } catch {}
  return {}
}

export function saveVaeliSettings(data: Record<string, unknown>) {
  fs.writeFileSync(PATHS.vaeliSettings, JSON.stringify(data, null, 2), 'utf-8')
}

export function patchVaeliSettings(patch: Record<string, unknown>) {
  const current = loadVaeliSettings()
  saveVaeliSettings({ ...current, ...patch })
}
