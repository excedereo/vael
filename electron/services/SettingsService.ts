import fs from 'fs'
import path from 'path'
import os from 'os'
import { app } from 'electron'

// Все пути в одном месте — не разбросаны по main.ts
export const PATHS = {
  userData: app.getPath('userData'),
  themes: path.join(app.getPath('userData'), 'themes'),
  temp: path.join(app.getPath('userData'), 'temp'),
  vaeliSettings: path.join(app.getPath('userData'), 'vaeli-settings.json'),
  globalSettings: path.join(os.homedir(), '.claude', 'settings.json'),
  claudeMd: path.join(os.homedir(), '.claude', 'CLAUDE.md'),
  vael: path.join(os.homedir(), '.vael'),
  memory: path.join(os.homedir(), '.vael', 'memory'),
  memoryMeta: path.join(os.homedir(), '.vael', 'memory-meta.json'),
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
