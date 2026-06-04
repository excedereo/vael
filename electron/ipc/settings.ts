import { ipcMain } from 'electron'
import fs from 'fs'
import os from 'os'
import { PATHS, loadVaeliSettings, saveVaeliSettings, patchVaeliSettings } from '../services/SettingsService.js'

export function registerSettingsHandlers(
  setLastConfigDir: (dir: string) => void,
) {
  ipcMain.handle('settings:get', () => {
    if (!fs.existsSync(PATHS.globalSettings)) return {}
    try { return JSON.parse(fs.readFileSync(PATHS.globalSettings, 'utf-8')) }
    catch { return {} }
  })

  ipcMain.handle('settings:save', (_, data: unknown) => {
    try {
      fs.mkdirSync(os.homedir() + '/.claude', { recursive: true })
      fs.writeFileSync(PATHS.globalSettings, JSON.stringify(data, null, 2))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('settings:getVersion', () => {
    try {
      const p = os.homedir() + '/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/package.json'
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf-8')).version || ''
      }
    } catch {}
    return ''
  })

  ipcMain.handle('console:flush', () => ({ ok: true }))

  ipcMain.handle('usage:fetch', () => ({ ok: true }))
  ipcMain.handle('usage:getCached', () => ({ ok: true }))
  ipcMain.handle('context:fetch', () => ({ ok: true }))
}
