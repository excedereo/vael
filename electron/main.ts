import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'path'
import { appendFileSync } from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

import { AccountManager } from './AccountManager.js'
import { ModuleRegistry } from './ModuleRegistry.js'
import { loadVaeliSettings, saveVaeliSettings, migrateFromUserData, PATHS } from './services/SettingsService.js'
import { linkAllAccounts, linkAccountSessions } from './services/SessionStoreService.js'
import { rebuildAllIndexes, startMemoryWatcher } from './services/MemoryService.js'
import { registerAllHandlers } from './ipc/index.js'
import { watchSessionDirect, unsubscribeSessionReply, subscribeSessionReply, ptyWriteBySessionId, stopAllSessionWatches, killAllPtys, detectStatus, isPtyAlive, listAlivePtySessions } from './ipc/pty.js'
import { runStartupTempCleanup } from './ipc/temp.js'
import { registerNotificationIpc } from './ipc/notifications.js'
import { destroyNotificationWindow } from './services/NotificationWindow.js'

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
  try {
    if (mainWindow?.webContents && !mainWindow.isDestroyed()) mainWindow.webContents.send('console:log', entry)
    else logBuffer.push(entry)
  } catch { logBuffer.push(entry) }
}

function flushLogBuffer() {
  while (logBuffer.length > 0) mainWindow?.webContents.send('console:log', logBuffer.shift()!)
}

console.log = (...args) => { originalLog(...args); sendLog('log', args) }
console.warn = (...args) => { originalWarn(...args); sendLog('warn', args) }
console.error = (...args) => { originalError(...args); sendLog('error', args) }

// Все необработанные исключения main-процесса логируем в файл с полным стеком
// (диалог Electron показывает только верхний фрейм — по нему первопричину не
// найти). Файл: <userData>/crash-trace.log.
process.on('uncaughtException', (err) => {
  try {
    appendFileSync(
      path.join(app.getPath('userData'), 'crash-trace.log'),
      `\n[${new Date().toISOString()}] ${err.stack || err}\n`,
    )
  } catch {}
  originalError('[uncaughtException]', err)

  // «Object has been destroyed» — это всегда гонка: отложенный колбэк дошёл до
  // окна/webContents, которое между делом закрыли. Уронить из-за неё весь Vael
  // непропорционально — просто игнорируем, приложение работает дальше.
  //
  // Любое ДРУГОЕ исключение — настоящий баг, приложению нельзя оставаться в
  // подвешенном состоянии. НЕ делаем re-throw внутри обработчика (Node после
  // этого оставляет процесс-зомби без окна) — завершаемся явно через exit.
  if (!/Object has been destroyed/i.test(String(err?.message))) {
    app.quit()
    process.exit(1)
  }
})

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

  // Закрытие главного окна = выход. Окно уведомлений — это отдельный alwaysOnTop
  // BrowserWindow: пока оно живо, window-all-closed НЕ стреляет (окна не «все»
  // закрыты), и процесс остаётся зомби, держа кэш и singleInstanceLock. Поэтому
  // гасим приложение явно, а before-quit уберёт окно уведомлений.
  mainWindow.on('closed', () => {
    mainWindow = null
    app.quit()
  })

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

/**
 * Путь к <sessionId>.jsonl. Ищем по всем аккаунтам, а не только по активному:
 * heartbeat может будить сессию, которая живёт под другим аккаунтом, чем тот,
 * что открыт в окне прямо сейчас.
 */
function findJsonlForSession(sessionId: string): string | null {
  for (const acc of accountManager.getAccounts()) {
    const found = accountManager.findSessionFile(sessionId, acc.configDir)
    if (found) return found
  }
  return null
}

app.whenReady().then(() => {
  // Разовый переезд данных из AppData в ~/.vael — до первого обращения к ним
  migrateFromUserData()

  // projects каждого аккаунта → junction на общее хранилище ~/.vael/sessions.
  // Идемпотентно: у кого ссылка уже стоит, тот пропускается
  linkAllAccounts(accountManager.getAccounts().map(a => a.configDir))

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
    sendToWindow: (channel, ...args) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
    },
    watchSession: (sessionId, jsonlPath) => watchSessionDirect(sessionId, jsonlPath, () => mainWindow),
    unwatchSession: (sessionId) => unsubscribeSessionReply(sessionId),
    subscribeReply: (sessionId, cb) => subscribeSessionReply(sessionId, cb),
    unsubscribeReply: (sessionId) => unsubscribeSessionReply(sessionId),
    ptyWrite: (sessionId, data) => ptyWriteBySessionId(sessionId, data),
    userData: app.getPath('userData'),
    getSessionStatus: (sessionId) => {
      const jsonl = findJsonlForSession(sessionId)
      return jsonl ? detectStatus(jsonl, sessionId) : null
    },
    findSessionJsonl: (sessionId) => findJsonlForSession(sessionId),
    getModule: (id) => moduleRegistry.get(id),
    isPtyAlive: (sessionId) => isPtyAlive(sessionId),
    listAlivePtySessions: () => listAlivePtySessions(),
  })

  registerNotificationIpc(() => mainWindow)

  setupAutoUpdater()

  setTimeout(startMemoryWatcher, 2000)
  setTimeout(rebuildAllIndexes, 3000)

  runStartupTempCleanup(() => mainWindow)
})

app.on('before-quit', () => {
  moduleRegistry.destroy()
  stopAllSessionWatches()
  killAllPtys()
  destroyNotificationWindow()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
