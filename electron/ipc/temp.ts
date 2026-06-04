import { ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import { PATHS, loadVaeliSettings, patchVaeliSettings } from '../services/SettingsService.js'

let tempCleanupCancelled = false

function ensureTempDir() {
  if (!fs.existsSync(PATHS.temp)) fs.mkdirSync(PATHS.temp, { recursive: true })
}

function cleanupTempDir(maxAgeMs: number): number {
  ensureTempDir()
  const now = Date.now()
  let count = 0
  try {
    for (const f of fs.readdirSync(PATHS.temp)) {
      const fp = path.join(PATHS.temp, f)
      try {
        if (now - fs.statSync(fp).mtimeMs > maxAgeMs) { fs.unlinkSync(fp); count++ }
      } catch {}
    }
  } catch {}
  return count
}

export function registerTempHandlers(getWindow: () => BrowserWindow | null) {
  ipcMain.handle('temp:save', async (_, buffer: ArrayBuffer, filename: string) => {
    ensureTempDir()
    const name = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const fp = path.join(PATHS.temp, name)
    fs.writeFileSync(fp, Buffer.from(buffer))
    return { ok: true, filePath: fp }
  })

  ipcMain.handle('temp:delete', async (_, filePath: string) => {
    try {
      const resolved = path.resolve(filePath)
      if (!resolved.startsWith(path.resolve(PATHS.temp))) return { ok: false }
      if (fs.existsSync(resolved)) fs.unlinkSync(resolved)
      return { ok: true }
    } catch { return { ok: false } }
  })

  ipcMain.handle('temp:clear', async () => {
    ensureTempDir()
    let count = 0
    for (const f of fs.readdirSync(PATHS.temp)) {
      try { fs.unlinkSync(path.join(PATHS.temp, f)); count++ } catch {}
    }
    return { ok: true, count }
  })

  ipcMain.handle('temp:getSettings', async () => loadVaeliSettings())

  ipcMain.handle('temp:saveSettings', async (_, data: Record<string, unknown>) => {
    patchVaeliSettings(data)
    return { ok: true }
  })

  ipcMain.handle('temp:cancelCleanup', async () => {
    tempCleanupCancelled = true
    return { ok: true }
  })

  ipcMain.handle('temp:getDirSize', async () => {
    ensureTempDir()
    let total = 0; let count = 0
    for (const f of fs.readdirSync(PATHS.temp)) {
      try { total += fs.statSync(path.join(PATHS.temp, f)).size; count++ } catch {}
    }
    return { bytes: total, count }
  })
}

export function runStartupTempCleanup(getWindow: () => BrowserWindow | null) {
  const MS: Record<string, number> = {
    '3h': 3 * 3600_000, '6h': 6 * 3600_000, '12h': 12 * 3600_000,
    '1d': 86400_000, '3d': 3 * 86400_000, '7d': 7 * 86400_000,
    '14d': 14 * 86400_000, '1mo': 30 * 86400_000,
  }
  const settings = loadVaeliSettings()
  const autoDelete = settings['tempAutoDelete'] as string | undefined
  if (!autoDelete || autoDelete === 'never') return
  const maxAge = MS[autoDelete]
  if (!maxAge) return

  tempCleanupCancelled = false
  getWindow()?.webContents.send('temp:cleanupStart', autoDelete)
  setTimeout(() => {
    if (tempCleanupCancelled) {
      getWindow()?.webContents.send('temp:cleanupCancelled')
      return
    }
    const count = cleanupTempDir(maxAge)
    getWindow()?.webContents.send('temp:cleanupDone', count)
  }, 4000)
}
