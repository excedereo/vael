import { ipcMain, BrowserWindow, shell, dialog, nativeImage } from 'electron'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { PATHS } from '../services/SettingsService.js'
import { isExternalUrl } from '../services/Guard.js'

/** Путь из ссылки file:///… или null, если это не локальный файл */
function filePathFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !/^file:/i.test(url)) return null
  try {
    const p = fileURLToPath(url)
    return path.isAbsolute(p) ? p : null
  } catch { return null }
}

export function registerWindowHandlers(getWindow: () => BrowserWindow | null) {
  // Карточки файлов в чате: модель пишет ссылку file:///…, окно спрашивает
  // размер и превью, а по клику файл показывается в проводнике. Ничего не
  // открываем и не запускаем: ссылку пишет модель, и это мог быть .exe
  ipcMain.handle('file:info', (_, url: string) => {
    const p = filePathFromUrl(url)
    if (!p) return null
    try {
      const st = fs.statSync(p)
      return { path: p, exists: true, size: st.size, isDir: st.isDirectory(), mtime: st.mtimeMs }
    } catch {
      return { path: p, exists: false, size: 0, isDir: false, mtime: 0 }
    }
  })
  // Превью от самой Windows (то же, что в проводнике); нет превью — null
  ipcMain.handle('file:thumb', async (_, url: string, size: number) => {
    const p = filePathFromUrl(url)
    if (!p) return null
    try {
      const side = Math.min(Math.max(Math.round(size) || 128, 32), 512)
      const img = await nativeImage.createThumbnailFromPath(p, { width: side, height: side })
      return img.isEmpty() ? null : img.toDataURL()
    } catch { return null }
  })
  // Картинка для галереи в чате: окно в dev открыто с http://, и file:// оттуда
  // не грузится — отдаём data URL, уменьшенный до maxSide по длинной стороне
  ipcMain.handle('file:image', async (_, url: string, maxSide: number) => {
    const p = filePathFromUrl(url)
    if (!p) return null
    const side = Math.min(Math.max(Math.round(maxSide) || 800, 64), 2400)
    try {
      let img = nativeImage.createFromPath(p)
      // Форматы, которые nativeImage не читает (webp, svg…) — через превью Windows
      if (img.isEmpty()) img = await nativeImage.createThumbnailFromPath(p, { width: side, height: side })
      if (img.isEmpty()) return null
      const { width, height } = img.getSize()
      if (Math.max(width, height) > side) {
        img = width >= height ? img.resize({ width: side, quality: 'good' }) : img.resize({ height: side, quality: 'good' })
      }
      // Прозрачность держит только PNG; остальное в JPEG — в разы легче
      return /\.(png|gif|webp|svg|ico)$/i.test(p) ? img.toDataURL() : 'data:image/jpeg;base64,' + img.toJPEG(88).toString('base64')
    } catch { return null }
  })
  ipcMain.handle('file:reveal', (_, url: string) => {
    const p = filePathFromUrl(url)
    if (p && fs.existsSync(p)) shell.showItemInFolder(p)
  })

  ipcMain.handle('window:minimize', () => getWindow()?.minimize())
  ipcMain.handle('window:maximize', () => {
    const win = getWindow()
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })
  ipcMain.handle('window:close', () => getWindow()?.close())
  ipcMain.handle('window:isMaximized', () => getWindow()?.isMaximized() ?? false)
  // Цвета системных кнопок окна под текущую тему. Только цвета вида #rgb/#rrggbb/rgb()/rgba()
  ipcMain.handle('window:setOverlay', (e, color: string, symbolColor: string) => {
    const isColor = (v: unknown) => typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\))$/i.test(v)
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || !isColor(color) || !isColor(symbolColor)) return
    try { win.setTitleBarOverlay({ color, symbolColor, height: 43 }) } catch { /* окно без overlay */ }
  })

  ipcMain.handle('shell:openExternal', (_, url: string) => isExternalUrl(url) ? shell.openExternal(url) : undefined)

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
