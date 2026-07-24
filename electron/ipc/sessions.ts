import { ipcMain, BrowserWindow, dialog, clipboard } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { AccountManager } from '../AccountManager.js'
import { readMeta, writeMeta } from '../services/SessionMetaService.js'
import { readSessionInfo } from '../services/SessionInfoService.js'
import type { SessionMeta } from '../../shared/types.js'

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

  // Пользовательские метаданные (<id>.meta.json): имя, архив, теги, порядок
  ipcMain.handle('session:readMeta', (_, jsonlPath: string) => readMeta(jsonlPath))
  ipcMain.handle('session:writeMeta', (_, jsonlPath: string, patch: Partial<SessionMeta>) =>
    writeMeta(jsonlPath, patch)
  )

  // Фактические параметры сессии из jsonl (model/effort/permissionMode + последний ответ)
  ipcMain.handle('session:info', (_, jsonlPath: string) => readSessionInfo(jsonlPath))

  ipcMain.handle('sessions:findNew', (_, configDir: string, excludeIds: string[]) => {
    return accountManager.findNewSessions(configDir, new Set(excludeIds), 5)
  })

  ipcMain.handle('session:reload', (_, sessionId: string) => {
    getWindow()?.webContents.send('session:reload', sessionId)
  })

  const ATTACHMENTS_DIR = path.join(os.homedir(), '.vael', 'attachments')

  // Читаем clipboard из main process — работает без browser permissions
  ipcMain.handle('clipboard:read', async () => {
    // 1. Файлы через нативный CF_HDROP (скопированные в проводнике)
    try {
      const { NativeConsole } = await import('../NativeConsole.js')
      const files = NativeConsole.getClipboardFiles()
      if (files && files.length > 0) return { type: 'paths', paths: files }
    } catch (e) {
      console.log('[clipboard] CF_HDROP error:', e)
    }

    // 2. Текст
    const text = clipboard.readText()
    if (text) return { type: 'text', text }

    // 3. Изображение из буфера (скриншот)
    const img = clipboard.readImage()
    if (!img.isEmpty()) {
      fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true })
      const fp = path.join(ATTACHMENTS_DIR, `clipboard_${Date.now()}.png`)
      fs.writeFileSync(fp, img.toPNG())
      return { type: 'file', filePath: fp }
    }

    return { type: 'empty' }
  })

  ipcMain.handle('attachments:save', async (_, buffer: ArrayBuffer, filename: string) => {
    fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true })
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const fp = path.join(ATTACHMENTS_DIR, `${Date.now()}_${safe}`)
    fs.writeFileSync(fp, Buffer.from(buffer))
    return { ok: true, filePath: fp }
  })

  ipcMain.handle('attachments:getDirSize', async () => {
    try {
      if (!fs.existsSync(ATTACHMENTS_DIR)) return { bytes: 0, count: 0 }
      const files = fs.readdirSync(ATTACHMENTS_DIR)
      let bytes = 0
      for (const f of files) {
        try { bytes += fs.statSync(path.join(ATTACHMENTS_DIR, f)).size } catch {}
      }
      return { bytes, count: files.length }
    } catch { return { bytes: 0, count: 0 } }
  })

  ipcMain.handle('attachments:clear', async (_, maxAgeDays?: number) => {
    try {
      if (!fs.existsSync(ATTACHMENTS_DIR)) return { ok: true, count: 0 }
      const files = fs.readdirSync(ATTACHMENTS_DIR)
      const now = Date.now()
      const maxAgeMs = maxAgeDays ? maxAgeDays * 86400000 : 0
      let count = 0
      for (const f of files) {
        const fp = path.join(ATTACHMENTS_DIR, f)
        try {
          if (!maxAgeMs || now - fs.statSync(fp).mtimeMs > maxAgeMs) {
            fs.unlinkSync(fp); count++
          }
        } catch {}
      }
      return { ok: true, count }
    } catch (e) { return { ok: false, count: 0 } }
  })

  ipcMain.handle('attachments:openFolder', async () => {
    const { shell } = await import('electron')
    fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true })
    shell.openPath(ATTACHMENTS_DIR)
    return { ok: true }
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
