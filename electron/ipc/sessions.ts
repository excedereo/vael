import { ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'
import type { AccountManager } from '../AccountManager.js'
import type { ContextData } from '../usageParser.js'

export function registerSessionHandlers(
  accountManager: AccountManager,
  contextCache: Map<string, ContextData>,
  lastUsageData: () => { usage: unknown; context: unknown } | null,
  getLastSessionId: () => string | null,
  setLastSessionId: (id: string) => void,
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

  ipcMain.handle('session:select', (_, sessionId: string) => {
    setLastSessionId(sessionId)
    const context = contextCache.get(sessionId) ?? null
    getWindow()?.webContents.send('usage:data', { usage: lastUsageData()?.usage ?? null, context })
  })

  ipcMain.handle('session:reload', (_, sessionId: string) => {
    getWindow()?.webContents.send('session:reload', sessionId)
  })
}
