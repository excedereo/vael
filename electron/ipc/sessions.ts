import { ipcMain, BrowserWindow, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
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

  ipcMain.handle('sessions:import', async (_, configDir: string) => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Импорт сессии',
      filters: [{ name: 'Claude session', extensions: ['jsonl'] }],
      properties: ['openFile', 'multiSelections'],
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, imported: [] }

    // Кладём в папку текущего homedir (стандартная папка claude)
    const homeEncoded = os.homedir().replace(/[/\\:]/g, '-').replace(/^-+/, '')
    const targetDir = path.join(configDir, 'projects', homeEncoded)
    fs.mkdirSync(targetDir, { recursive: true })

    const imported: string[] = []
    for (const src of result.filePaths) {
      const filename = path.basename(src)
      // Проверяем что это валидный UUID.jsonl
      const sessionId = filename.replace('.jsonl', '')
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (!uuidRe.test(sessionId)) continue

      const dest = path.join(targetDir, filename)
      // Не перезаписываем если уже есть
      if (!fs.existsSync(dest)) fs.copyFileSync(src, dest)
      imported.push(sessionId)
    }
    return { ok: true, imported }
  })
}
