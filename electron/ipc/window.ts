import { ipcMain, BrowserWindow, shell, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import { PATHS } from '../services/SettingsService.js'

export function registerWindowHandlers(getWindow: () => BrowserWindow | null) {
  ipcMain.handle('window:minimize', () => getWindow()?.minimize())
  ipcMain.handle('window:maximize', () => {
    const win = getWindow()
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })
  ipcMain.handle('window:close', () => getWindow()?.close())
  ipcMain.handle('window:isMaximized', () => getWindow()?.isMaximized() ?? false)

  ipcMain.handle('shell:openExternal', (_, url: string) => shell.openExternal(url))

  ipcMain.handle('avatar:pick', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'gif', 'webp', 'jpg', 'jpeg'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('themes:list', () => {
    if (!fs.existsSync(PATHS.themes)) fs.mkdirSync(PATHS.themes, { recursive: true })
    const files = fs.readdirSync(PATHS.themes).filter(f => f.endsWith('.json'))
    return files.map(f => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(PATHS.themes, f), 'utf-8'))
        return { file: f, name: raw.name ?? f.replace('.json', ''), vars: raw.vars ?? {} }
      } catch { return null }
    }).filter(Boolean)
  })

  ipcMain.handle('themes:openFolder', () => {
    if (!fs.existsSync(PATHS.themes)) fs.mkdirSync(PATHS.themes, { recursive: true })
    shell.openPath(PATHS.themes)
    return { ok: true }
  })
}
