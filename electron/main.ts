import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

import { AccountManager } from './AccountManager.js'
import { PtySessionManager } from './PtySessionManager.js'
import { PtyManager } from './PtyManager.js'
import { ModuleRegistry } from './ModuleRegistry.js'
import { parseUsage } from './usageParser.js'
import type { ContextData } from './usageParser.js'
import { loadVaeliSettings, saveVaeliSettings, PATHS } from './services/SettingsService.js'
import { rebuildAllIndexes, startMemoryWatcher } from './services/MemoryService.js'
import { registerAllHandlers } from './ipc/index.js'
import { runStartupTempCleanup } from './ipc/temp.js'

// ── Singletons ────────────────────────────────────────────────────────────────

const accountManager = new AccountManager()
const claudeRunner = new PtySessionManager()
const moduleRegistry = new ModuleRegistry()
const contextPty = new PtyManager()
const contextCache = new Map<string, ContextData>()

let mainWindow: BrowserWindow | null = null

// ── Session state ─────────────────────────────────────────────────────────────

let lastSessionId: string | null = null
let lastConfigDir: string = (loadVaeliSettings().lastConfigDir as string) || ''
let lastUsageData: { usage: unknown; context: unknown } | null = null
let lastCacheHit: boolean | null = null
let lastCacheReadTokens = 0
let lastCacheCreatedTokens = 0

function setLastConfigDir(dir: string) {
  lastConfigDir = dir
  const s = loadVaeliSettings(); s.lastConfigDir = dir; saveVaeliSettings(s)
}

function trackCacheFromEvent(event: unknown) {
  const e = event as { type?: string; usage?: { cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
  if (e.type === 'result' && e.usage) {
    lastCacheReadTokens = e.usage.cache_read_input_tokens ?? 0
    lastCacheCreatedTokens = e.usage.cache_creation_input_tokens ?? 0
    lastCacheHit = lastCacheReadTokens > 0
  }
}

// ── Console forwarding ────────────────────────────────────────────────────────

const logBuffer: { level: string; text: string; ts: number }[] = []
const originalLog = console.log.bind(console)
const originalWarn = console.warn.bind(console)
const originalError = console.error.bind(console)

function sendLog(level: string, args: unknown[]) {
  const text = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
  const entry = { level, text, ts: Date.now() }
  if (mainWindow?.webContents) mainWindow.webContents.send('console:log', entry)
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
    },
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
  // Restore context cache from stored metas
  for (const meta of accountManager.getAllSessionMetas()) {
    const sid = meta.sessionId as string
    const ctx = meta.lastContext as ContextData | undefined
    if (sid && ctx) contextCache.set(sid, ctx)
  }

  // Register IPC handlers before creating window to avoid race conditions
  registerAllHandlers({
    getWindow: () => mainWindow,
    accountManager,
    claudeRunner,
    contextPty,
    moduleRegistry,
    contextCache,
    lastUsageData: () => lastUsageData,
    getLastSessionId: () => lastSessionId,
    setLastSessionId: (id) => { lastSessionId = id },
    getLastConfigDir: () => lastConfigDir,
    setLastConfigDir,
    trackCacheFromEvent,
    flushLogBuffer,
  })

  createWindow()

  moduleRegistry.init({
    claudeRunner,
    accountManager,
    getLastConfigDir: () => lastConfigDir,
    getLastSessionId: () => lastSessionId,
    sendToWindow: (channel, ...args) => mainWindow?.webContents.send(channel, ...args),
    userData: app.getPath('userData'),
  })

  setupAutoUpdater()

  // Memory watcher + initial rebuild
  setTimeout(startMemoryWatcher, 2000)
  setTimeout(rebuildAllIndexes, 3000)

  // Temp cleanup on startup
  runStartupTempCleanup(() => mainWindow)
})

app.on('before-quit', () => moduleRegistry.destroy())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
