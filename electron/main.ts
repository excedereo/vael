import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

import { AccountManager } from './AccountManager.js'
import { ModuleRegistry } from './ModuleRegistry.js'
import { loadVaeliSettings, saveVaeliSettings, PATHS } from './services/SettingsService.js'
import { rebuildAllIndexes, startMemoryWatcher } from './services/MemoryService.js'
import { registerAllHandlers } from './ipc/index.js'
import { runStartupTempCleanup } from './ipc/temp.js'

// ── Singletons ────────────────────────────────────────────────────────────────

const accountManager = new AccountManager()
const moduleRegistry = new ModuleRegistry()

let mainWindow: BrowserWindow | null = null

// ── Console forwarding ────────────────────────────────────────────────────────

const logBuffer: { level: string; text: string; ts: number }[] = []
const originalLog = console.log.bind(console)
const originalWarn = console.warn.bind(console)
const originalError = console.error.bind(console)

function sendLog(level: string, args: unknown[]) {
  const text = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
  const entry = { level, text, ts: Date.now() }
  if (mainWindow?.webContents && !mainWindow.isDestroyed()) mainWindow.webContents.send('console:log', entry)
  else logBuffer.push(entry)
}

function flushLogBuffer() {
  while (logBuffer.length > 0) mainWindow?.webContents.send('console:log', logBuffer.shift()!)
}

console.log = (...args) => { originalLog(...args); sendLog('log', args) }
console.warn = (...args) => { originalWarn(...args); sendLog('warn', args) }
console.error = (...args) => { originalError(...args); sendLog('error', args) }

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hidden',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      clipboard: true,
    },
  })

  // Разрешаем clipboard-read для вставки в терминал
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') {
      callback(true)
    } else {
      callback(false)
    }
  })

  mainWindow.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL
    const isDevUrl = devUrl && url.startsWith(devUrl)
    const isAppFile = url.startsWith(`file://${path.resolve(__dirname, '..')}`)
    if (!isDevUrl && !isAppFile) e.preventDefault()
  })
  mainWindow.webContents.on('will-redirect', (e) => e.preventDefault())
  mainWindow.webContents.on('did-navigate', (_, url) => console.log('[nav] did-navigate:', url))

  if (process.env.VITE_DEV_SERVER_URL) {
    const tryLoad = async (retries = 20): Promise<void> => {
      try { await mainWindow!.loadURL(process.env.VITE_DEV_SERVER_URL!) }
      catch { if (retries > 0) { await new Promise(r => setTimeout(r, 500)); return tryLoad(retries - 1) } }
    }
    tryLoad()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// ── Auto-updater ──────────────────────────────────────────────────────────────

function setupAutoUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('update-available', (info) => mainWindow?.webContents.send('update:available', info.version))
  autoUpdater.on('download-progress', (p) => mainWindow?.webContents.send('update:progress', Math.round(p.percent)))
  autoUpdater.on('update-downloaded', () => mainWindow?.webContents.send('update:ready'))
  autoUpdater.on('error', (err) => mainWindow?.webContents.send('update:error', err.message))
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3000)

  ipcMain.handle('update:download', () => autoUpdater.downloadUpdate())
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall())
  ipcMain.handle('update:getVaelVersion', () => app.getVersion())
  ipcMain.handle('update:setAutoDownload', (_: unknown, enabled: boolean) => {
    autoUpdater.autoDownload = enabled
    autoUpdater.autoInstallOnAppQuit = enabled
  })
}

// ── Single instance ───────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() }
  })
}

// ── App ready ─────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  registerAllHandlers({
    getWindow: () => mainWindow,
    accountManager,
    moduleRegistry,
    flushLogBuffer,
  })

  createWindow()

  moduleRegistry.init({
    claudeRunner: null,
    accountManager,
    getLastConfigDir: () => '',
    getLastSessionId: () => null,
    sendToWindow: (channel, ...args) => mainWindow?.webContents.send(channel, ...args),
    userData: app.getPath('userData'),
  })

  setupAutoUpdater()

  setTimeout(startMemoryWatcher, 2000)
  setTimeout(rebuildAllIndexes, 3000)

  runStartupTempCleanup(() => mainWindow)
})

app.on('before-quit', () => {
  moduleRegistry.destroy()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
