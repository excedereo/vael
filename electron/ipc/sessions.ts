import { ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'
import type { AccountManager } from '../AccountManager.js'

export function registerSessionHandlers(
  accountManager: AccountManager,
  getWindow: () => BrowserWindow | null,
) {
  ipcMain.handle('sessions:get', (_, accountId: string) =>
    accountManager.getSessionsForAccount(accountId)
  )

  ipcMain.handle('sessions:read', (_, sessionPath: string) => {
    if (!fs.existsSync(sessionPath)) return []
    const content = fs.readFileSync(sessionPath, 'utf-8')
    return content.split('\n')
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
  })

  ipcMain.handle('sessions:delete', (_, sessionPath: string) => {
    try {
      if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath)
      const metaPath = sessionPath.replace(/\.jsonl$/, '.meta.json')
      if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('session:select', () => {
    return { ok: true }
  })

  ipcMain.handle('sessions:findNew', (_, configDir: string, excludeIds: string[]) => {
    return accountManager.findNewSessions(configDir, new Set(excludeIds), 5)
  })

  ipcMain.handle('session:reload', (_, sessionId: string) => {
    getWindow()?.webContents.send('session:reload', sessionId)
  })
}
