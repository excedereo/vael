import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import { spawn, exec } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
import { AccountManager } from './AccountManager.js'
import { ClaudeRunner } from './ClaudeRunner.js'
import { PtyManager } from './PtyManager.js'
import { parseUsage, parseContextFromMarkdown } from './usageParser.js'
import type { ContextData } from './usageParser.js'

const accountManager = new AccountManager()
const claudeRunner = new ClaudeRunner()

// Two separate PTY instances:
// usagePty  — fixed per-account "vaeli-usage" session, only /usage queries
// contextPty — spawned with current user session after stream:done, only /context queries
const usagePty = new PtyManager()
const contextPty = new PtyManager()

// Per-session context cache: sessionId → ContextData
const contextCache = new Map<string, ContextData>()

let mainWindow: BrowserWindow | null = null

// Intercept console methods and forward to renderer
const originalLog = console.log.bind(console)
const originalWarn = console.warn.bind(console)
const originalError = console.error.bind(console)

const logBuffer: { level: string; text: string; ts: number }[] = []

function sendLog(level: string, args: unknown[]) {
  const text = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
  const entry = { level, text, ts: Date.now() }
  if (mainWindow?.webContents) {
    mainWindow.webContents.send('console:log', entry)
  } else {
    logBuffer.push(entry)
  }
}

function flushLogBuffer() {
  while (logBuffer.length > 0) {
    const entry = logBuffer.shift()!
    mainWindow?.webContents.send('console:log', entry)
  }
}

console.log = (...args) => { originalLog(...args); sendLog('log', args) }
console.warn = (...args) => { originalWarn(...args); sendLog('warn', args) }
console.error = (...args) => { originalError(...args); sendLog('error', args) }

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hidden',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Block ALL navigation away from the app
  mainWindow.webContents.on('will-navigate', (e, url) => {
    console.log('[nav] will-navigate:', url)
    const devUrl = process.env.VITE_DEV_SERVER_URL
    const isDevUrl = devUrl && url.startsWith(devUrl)
    const isAppFile = url.startsWith(`file://${path.resolve(__dirname, '..')}`)
    if (!isDevUrl && !isAppFile) e.preventDefault()
  })
  mainWindow.webContents.on('will-redirect', (e, url) => { console.log('[nav] will-redirect:', url); e.preventDefault() })
  mainWindow.webContents.on('did-navigate', (_, url) => console.log('[nav] did-navigate:', url))
  mainWindow.webContents.on('did-navigate-in-page', (_, url) => console.log('[nav] in-page:', url))

  if (process.env.VITE_DEV_SERVER_URL) {
    const tryLoad = async (retries = 20): Promise<void> => {
      try {
        await mainWindow!.loadURL(process.env.VITE_DEV_SERVER_URL!)
      } catch {
        if (retries > 0) {
          await new Promise(r => setTimeout(r, 500))
          return tryLoad(retries - 1)
        }
      }
    }
    tryLoad()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// ── Usage PTY setup ───────────────────────────────────────────────────────────

// Create an empty JSONL session file for claude to resume into.
// Claude stores sessions as <configDir>/projects/<encoded-cwd>/<sessionId>.jsonl
// We create the file ourselves — no LLM request, works at 100% usage limit.
function createUsageSession(configDir: string): string {
  const cwd = os.homedir() // claude's cwd when spawned
  // Encode path the same way claude does: drive colon → nothing, slashes → dashes
  const encoded = cwd.replace(/^([A-Za-z]):/, '$1').replace(/[\\/]/g, '-')
  const projectsDir = path.join(configDir, 'projects', encoded)
  fs.mkdirSync(projectsDir, { recursive: true })
  const sessionId = randomUUID()
  fs.writeFileSync(path.join(projectsDir, `${sessionId}.jsonl`), '')
  return sessionId
}

// Ensure a stable "vaeli-usage" session exists for the account.
function ensureUsageSession(accountId: string, configDir: string): string {
  const existing = accountManager.getUsageSessionId(accountId)
  if (existing) return existing

  const sessionId = createUsageSession(configDir)
  accountManager.setUsageSessionId(accountId, sessionId)
  console.log('[usagePty] usage session created:', sessionId)
  return sessionId
}

async function spawnUsagePty(accountId: string, configDir: string) {
  // Try to resume existing usage session — avoids startup notifications from claude
  const existingSessionId = accountManager.getUsageSessionId(accountId)
  if (existingSessionId) {
    console.log('[usagePty] resuming existing usage session:', existingSessionId)
    usagePty.spawn(configDir, existingSessionId)
    return
  }

  // No existing session — create one via ClaudeRunner (stream-json, no PTY needed)
  console.log('[usagePty] creating usage session via ClaudeRunner')
  const { ClaudeRunner } = await import('./ClaudeRunner.js')
  const tempRunner = new ClaudeRunner()
  let createdSessionId: string | null = null

  await new Promise<void>((resolve) => {
    tempRunner.startNewSession(
      'hi',
      configDir,
      'claude-haiku-4-5',
      null,
      'bypassPermissions',
      (event) => {
        const e = event as Record<string, unknown>
        if (e.type === 'system' && e.session_id) {
          createdSessionId = e.session_id as string
        }
      },
      () => resolve(),
    )
    setTimeout(resolve, 20000)
  })

  if (createdSessionId) {
    console.log('[usagePty] created usage session:', createdSessionId)
    accountManager.setUsageSessionId(accountId, createdSessionId)
    usagePty.spawn(configDir, createdSessionId)
  } else {
    console.log('[usagePty] failed to create usage session, spawning without resume')
    usagePty.spawn(configDir)
  }
}

// ── Themes ────────────────────────────────────────────────────────────────────

const THEMES_DIR = path.join(app.getPath('userData'), 'themes')
const TEMP_DIR = path.join(app.getPath('userData'), 'temp')
const TEMP_SETTINGS_KEY = 'tempAutoDelete' // stored in userData/vaeli-settings.json

const VAELI_SETTINGS_PATH = path.join(app.getPath('userData'), 'vaeli-settings.json')

function loadVaeliSettings(): Record<string, unknown> {
  try {
    if (fs.existsSync(VAELI_SETTINGS_PATH)) return JSON.parse(fs.readFileSync(VAELI_SETTINGS_PATH, 'utf-8'))
  } catch {}
  return {}
}

function saveVaeliSettings(data: Record<string, unknown>) {
  fs.writeFileSync(VAELI_SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true })
}

// Returns count of deleted files
function cleanupTempDir(maxAgeMs: number | null): number {
  ensureTempDir()
  if (maxAgeMs === null) return 0
  const now = Date.now()
  let count = 0
  try {
    for (const f of fs.readdirSync(TEMP_DIR)) {
      const fp = path.join(TEMP_DIR, f)
      try {
        const stat = fs.statSync(fp)
        if (now - stat.mtimeMs > maxAgeMs) { fs.unlinkSync(fp); count++ }
      } catch {}
    }
  } catch {}
  return count
}

function ensureThemesDir() {
  if (!fs.existsSync(THEMES_DIR)) {
    fs.mkdirSync(THEMES_DIR, { recursive: true })
  }
}

ipcMain.handle('themes:list', () => {
  ensureThemesDir()
  const files = fs.readdirSync(THEMES_DIR).filter(f => f.endsWith('.json'))
  const themes = files.map(f => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(THEMES_DIR, f), 'utf-8'))
      return { file: f, name: raw.name ?? f.replace('.json', ''), vars: raw.vars ?? {} }
    } catch {
      return null
    }
  }).filter(Boolean)
  return themes
})

ipcMain.handle('themes:openFolder', () => {
  ensureThemesDir()
  shell.openPath(THEMES_DIR)
  return { ok: true }
})

// ── Single instance lock ───────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Вторая попытка запуска — фокусируем существующее окно
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// ── App ready ─────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  ensureThemesDir()
  // Auto-cleanup temp on startup
  ensureTempDir()
  ;(async () => {
    const settings = loadVaeliSettings()
    const autoDelete = settings[TEMP_SETTINGS_KEY] as string | undefined
    if (!autoDelete || autoDelete === 'never') return
    const MS: Record<string, number> = {
      '3h': 3 * 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '12h': 12 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '3d': 3 * 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '14d': 14 * 24 * 60 * 60 * 1000,
      '1mo': 30 * 24 * 60 * 60 * 1000,
    }
    const maxAge = MS[autoDelete]
    if (!maxAge) return
    tempCleanupCancelled = false
    mainWindow?.webContents.send('temp:cleanupStart', autoDelete)
    await new Promise(r => setTimeout(r, 4000))
    if (tempCleanupCancelled) {
      mainWindow?.webContents.send('temp:cleanupCancelled')
      return
    }
    const count = cleanupTempDir(maxAge)
    mainWindow?.webContents.send('temp:cleanupDone', count)
  })()
  createWindow()
  // Restore context cache from meta files
  for (const meta of accountManager.getAllSessionMetas()) {
    const sid = meta.sessionId as string
    const ctx = meta.lastContext as ContextData | undefined
    if (sid && ctx) {
      contextCache.set(sid, ctx)
      // Restore last session pointers (most recent wins via sort by lastContextAt)
      const at = (meta.lastContextAt as number) ?? 0
      if (!lastSessionId || at > ((contextCache.get(lastSessionId) as unknown as { _at?: number })?._at ?? 0)) {
        lastSessionId = sid
        lastConfigDir = meta.configDir as string ?? ''
      }
    }
  }

  // usagePty is spawned on first account:setActive IPC from renderer

  // ── Auto-updater ────────────────────────────────────────────────────────────
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update:available', info.version)
  })
  autoUpdater.on('download-progress', (p) => {
    mainWindow?.webContents.send('update:progress', Math.round(p.percent))
  })
  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update:ready')
  })
  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update:error', err.message)
  })

  // Check for updates after window is ready (delay to not block startup)
  setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}) }, 3000)
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

// ── IPC Handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('update:download', () => autoUpdater.downloadUpdate())
ipcMain.handle('update:install', () => autoUpdater.quitAndInstall())

ipcMain.handle('accounts:get', () => accountManager.getAccounts())

ipcMain.handle('accounts:create', (_, id: string) => accountManager.createAccount(id))

ipcMain.handle('accounts:openAuth', (_, configDir: string) => {
  console.log('[openAuth] launching terminal for:', configDir)

  const claudeJsonPath = path.join(configDir, '.claude.json')
  const homedir = os.homedir()

  // Do NOT pre-populate .claude.json — let claude run its natural first-startup auth flow
  // (opens browser with simple Authorize button via PKCE)
  // Auto-answer trust/theme dialogs via SendKeys

  const winTitle = `VaeliAuth-${Date.now()}`
  const batPath = path.join(configDir, '_auth.bat')
  fs.writeFileSync(batPath,
    `@echo off\ntitle ${winTitle}\ncd /d "${homedir}"\nset CLAUDE_CONFIG_DIR=${configDir}\nclaude auth login --claudeai\nexit\n`)

  const pidFile = path.join(configDir, '_auth.pid')
  const psOpen = [
    `$wsh = New-Object -ComObject WScript.Shell`,
    `$proc = Start-Process cmd.exe -ArgumentList '/c "${batPath}"' -PassThru`,
    `$proc.Id | Set-Content '${pidFile}'`,
  ].join('; ')

  const child = spawn('powershell.exe', ['-NoProfile', '-Command', psOpen], { windowsHide: true })
  child.on('error', (err) => console.error('[openAuth] error:', err))

  const closeTerminal = () => {
    // Kill cmd process by saved PID — reliable regardless of window title changes
    try {
      const pid = fs.readFileSync(pidFile, 'utf-8').trim()
      spawn('cmd.exe', ['/c', `taskkill /F /PID ${pid} /T`], { windowsHide: true })
      fs.unlinkSync(pidFile)
    } catch (e) {
      console.error('[openAuth] closeTerminal error:', e)
    }
  }

  // Poll for oauthAccount or .credentials.json, then auto-close terminal
  const pollLogin = setInterval(() => {
    try {
      const credPath = path.join(configDir, '.credentials.json')
      const hasCredentials = fs.existsSync(credPath)
      const cfg = fs.existsSync(claudeJsonPath) ? JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8')) : {}
      if (cfg.oauthAccount || hasCredentials) {
        clearInterval(pollLogin)
        console.log('[openAuth] login detected, patching .claude.json and killing terminal')
        // Patch trust + onboarding flags so dialogs don't reappear in PTY
        try {
          if (!cfg.projects) cfg.projects = {}
          const homedirKey = homedir.replace(/\\/g, '/')
          if (!cfg.projects[homedirKey]) cfg.projects[homedirKey] = {}
          cfg.projects[homedirKey].hasTrustDialogAccepted = true
          cfg.hasCompletedOnboarding = true
          cfg.lastOnboardingVersion = '99.0.0'
          fs.writeFileSync(claudeJsonPath, JSON.stringify(cfg, null, 2))
        } catch {}
        setTimeout(closeTerminal, 500)
        mainWindow?.webContents.send('auth:done', configDir)
      }
    } catch (e) {
      console.log('[openAuth] poll error:', e)
    }
  }, 1500)

  setTimeout(() => clearInterval(pollLogin), 5 * 60 * 1000)
  return { ok: true }
})

ipcMain.handle('accounts:checkCredentials', (_, configDir: string) => {
  // Check for real OAuth credentials (oauthAccount field in .claude.json)
  const claudeJsonPath = path.join(configDir, '.claude.json')
  if (fs.existsSync(claudeJsonPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'))
      if (cfg.oauthAccount) return true
    } catch {}
  }
  return fs.existsSync(path.join(configDir, '.credentials.json'))
})

ipcMain.handle('accounts:delete', (_, id: string) => {
  try {
    accountManager.deleteAccount(id)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('sessions:get', (_, accountId: string) =>
  accountManager.getSessionsForAccount(accountId)
)

ipcMain.handle('sessions:delete', (_, sessionPath: string) => {
  try {
    if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath)
    // also remove meta file if exists
    const metaPath = sessionPath.replace(/\.jsonl$/, '.meta.json')
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('sessions:read', (_, sessionPath: string) => {
  if (!fs.existsSync(sessionPath)) return []
  const content = fs.readFileSync(sessionPath, 'utf-8')
  return content.split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
})

const GLOBAL_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')

ipcMain.handle('settings:getVersion', () => {
  try {
    const candidates = [
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'package.json'),
    ]
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'))
        return pkg.version || ''
      }
    }
  } catch {}
  return ''
})

ipcMain.handle('shell:openExternal', (_, url: string) => {
  shell.openExternal(url)
})


ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.handle('window:close', () => mainWindow?.close())
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

ipcMain.handle('settings:get', () => {
  if (!fs.existsSync(GLOBAL_SETTINGS_PATH)) return {}
  try { return JSON.parse(fs.readFileSync(GLOBAL_SETTINGS_PATH, 'utf-8')) }
  catch { return {} }
})

ipcMain.handle('settings:save', (_, data: unknown) => {
  try {
    fs.mkdirSync(path.dirname(GLOBAL_SETTINGS_PATH), { recursive: true })
    fs.writeFileSync(GLOBAL_SETTINGS_PATH, JSON.stringify(data, null, 2))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('account:setActive', async (_, id: string) => {
  accountManager.setActiveAccountId(id)
  const account = accountManager.getAccount(id)
  if (account) {
    // Respawn usagePty if account changed or not yet started
    const currentDir = usagePty.getConfigDir()
    if (currentDir !== account.configDir) {
      spawnUsagePty(id, account.configDir)
      await new Promise(r => setTimeout(r, 3000))
      fetchAndSendUsage(lastSessionId ?? undefined)
    } else if (!usagePty.isAlive()) {
      spawnUsagePty(id, account.configDir)
      await new Promise(r => setTimeout(r, 3000))
      fetchAndSendUsage(lastSessionId ?? undefined)
    }
  }
  return { ok: true }
})

ipcMain.handle('account:switch', async (_, fromId: string, toId: string) => {
  try {
    accountManager.setActiveAccountId(toId)
    accountManager.syncSessionsTo(fromId, toId)
    // Respawn usagePty for new account
    const toAccount = accountManager.getAccount(toId)
    if (toAccount) {
      spawnUsagePty(toId, toAccount.configDir)
      await new Promise(r => setTimeout(r, 3000))
      fetchAndSendUsage(lastSessionId ?? undefined)
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

let tempCleanupCancelled = false
let lastUsageData: { usage: unknown; context: unknown } | null = null
let lastSessionId: string | null = null
let lastConfigDir: string = ''
let lastCacheHit: boolean | null = null
let lastCacheReadTokens = 0
let lastCacheCreatedTokens = 0

function trackCacheFromEvent(event: unknown) {
  const e = event as { type?: string; usage?: { cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
  if (e.type === 'result' && e.usage) {
    const read = e.usage.cache_read_input_tokens ?? 0
    const created = e.usage.cache_creation_input_tokens ?? 0
    lastCacheReadTokens = read
    lastCacheCreatedTokens = created
    lastCacheHit = read > 0
    console.log('[cache] read:', read, 'created:', created, 'hit:', lastCacheHit)
  }
}

async function fetchAndSendUsage(sessionId?: string) {
  try {
    // /usage always from the stable usage PTY
    const usageRaw = await usagePty.queryUsage()
    const usage = usageRaw ? parseUsage(usageRaw) : null

    // /context from cache only — updated after each stream:done via fetchContextForSession
    let context: ContextData | null = null
    if (sessionId && contextCache.has(sessionId)) {
      context = contextCache.get(sessionId)!
    }

    console.log('[usage] parsed usage:', JSON.stringify(usage))
    lastUsageData = { usage, context }
    mainWindow?.webContents.send('usage:data', lastUsageData)
  } catch (e) {
    console.error('[usage] fetch error:', e)
  }
}

async function fetchContextForSession(sessionId: string, configDir: string) {
  try {
    // Trigger /context all via PTY — this writes an isMeta user entry to the JSONL
    contextPty.spawn(configDir, sessionId)
    await contextPty.waitForPrompt(15000)
    const sentAt = Date.now()
    contextPty.sendCommand('/context all\r')

    // Poll JSONL until a fresh isMeta entry appears (written by claude after /context all)
    const markdown = await new Promise<string | null>((resolve) => {
      const maxWait = 10000
      const interval = 300
      let elapsed = 0
      const timer = setInterval(() => {
        elapsed += interval
        const md = accountManager.getLatestContextMarkdown(sessionId, configDir)
        if (md) {
          // Check if it's a fresh entry (written after we sent the command)
          const jsonlPath = accountManager.findSessionFile(sessionId, configDir)
          const mtime = jsonlPath ? fs.statSync(jsonlPath).mtimeMs : 0
          if (mtime >= sentAt) {
            clearInterval(timer)
            resolve(md)
            return
          }
        }
        if (elapsed >= maxWait) {
          clearInterval(timer)
          resolve(null)
        }
      }, interval)
    })

    if (markdown) {
      const context = parseContextFromMarkdown(markdown)
      if (context) {
        const contextWithCache = { ...context, cacheHit: lastCacheHit, cacheReadTokens: lastCacheReadTokens, cacheCreatedTokens: lastCacheCreatedTokens }
        contextCache.set(sessionId, contextWithCache)
        accountManager.setSessionMeta(sessionId, configDir, { configDir, lastContext: contextWithCache, lastContextAt: Date.now() })
        console.log('[context] parsed from JSONL for session', sessionId)
        mainWindow?.webContents.send('usage:data', { usage: lastUsageData?.usage ?? null, context: contextWithCache })
      }
    } else {
      console.warn('[context] no fresh isMeta found in JSONL for', sessionId)
    }
  } catch (e) {
    console.error('[context] PTY trigger error:', e)
  } finally {
    try { contextPty.kill() } catch {}
  }

}

// Poll usage every 5 minutes
setInterval(() => fetchAndSendUsage(), 5 * 60 * 1000)

ipcMain.handle('claude:send', (_, sessionId: string, text: string, accountId: string, model: string, effort: string, permissionMode: string) => {
  const configDir = accountManager.getConfigDir(accountId)

  claudeRunner.sendMessage(
    sessionId, text, configDir, model, effort, permissionMode || 'bypassPermissions',
    (event) => { trackCacheFromEvent(event); mainWindow?.webContents.send('stream:event', event) },
    (code) => {
      mainWindow?.webContents.send('stream:done', code)
      lastSessionId = sessionId
      lastConfigDir = configDir
      fetchAndSendUsage(sessionId)
      fetchContextForSession(sessionId, configDir)
    },
  )
  return { ok: true }
})

ipcMain.handle('claude:new', (_, text: string, accountId: string, model: string, effort: string, permissionMode: string) => {
  const configDir = accountManager.getConfigDir(accountId)
  let newSessionId: string | null = null

  claudeRunner.startNewSession(
    text, configDir, model, effort, permissionMode || 'bypassPermissions',
    (event) => {
      trackCacheFromEvent(event)
      if (event.type === 'system' && (event as { session_id?: string }).session_id) {
        newSessionId = (event as { session_id: string }).session_id
      }
      mainWindow?.webContents.send('stream:event', event)
    },
    (code) => {
      mainWindow?.webContents.send('stream:done', code)
      if (newSessionId) {
        lastSessionId = newSessionId
        lastConfigDir = configDir
        // Write initial meta so session is discoverable on restart
        accountManager.setSessionMeta(newSessionId, configDir, { configDir, accountId })
      }
      fetchAndSendUsage(newSessionId ?? undefined)
      if (newSessionId) fetchContextForSession(newSessionId, configDir)
    },
  )
  return { ok: true }
})

ipcMain.handle('avatar:pick', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'gif', 'webp', 'jpg', 'jpeg'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('claude:abort', () => {
  claudeRunner.abort()
  return { ok: true }
})

ipcMain.handle('pty:spawn', (_, configDir: string, sessionId?: string) => {
  usagePty.spawn(configDir, sessionId)
  usagePty.onOutput((data) => mainWindow?.webContents.send('pty:output', data))
  return { ok: true }
})

ipcMain.handle('pty:send', (_, command: string) => {
  usagePty.sendCommand(command)
  return { ok: true }
})

ipcMain.handle('pty:kill', () => {
  usagePty.kill()
  return { ok: true }
})

ipcMain.handle('session:select', (_, sessionId: string) => {
  lastSessionId = sessionId
  // Send cached context immediately if available
  const context = contextCache.get(sessionId) ?? null
  mainWindow?.webContents.send('usage:data', { usage: lastUsageData?.usage ?? null, context })
})

ipcMain.handle('console:flush', () => {
  flushLogBuffer()
  return { ok: true }
})

ipcMain.handle('usage:getCached', () => {
  if (lastUsageData) mainWindow?.webContents.send('usage:data', lastUsageData)
  return { ok: true }
})

ipcMain.handle('context:fetch', async () => {
  if (lastSessionId && lastConfigDir) {
    fetchContextForSession(lastSessionId, lastConfigDir)
  }
  return { ok: true }
})

// ── Temp dir IPC ─────────────────────────────────────────────────────────────

ipcMain.handle('temp:save', async (_, buffer: ArrayBuffer, filename: string) => {
  ensureTempDir()
  const name = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const fp = path.join(TEMP_DIR, name)
  fs.writeFileSync(fp, Buffer.from(buffer))
  return { ok: true, filePath: fp }
})

ipcMain.handle('temp:clear', async () => {
  ensureTempDir()
  let count = 0
  for (const f of fs.readdirSync(TEMP_DIR)) {
    try { fs.unlinkSync(path.join(TEMP_DIR, f)); count++ } catch {}
  }
  return { ok: true, count }
})

ipcMain.handle('temp:getSettings', async () => {
  return loadVaeliSettings()
})

ipcMain.handle('temp:saveSettings', async (_, data: Record<string, unknown>) => {
  const current = loadVaeliSettings()
  saveVaeliSettings({ ...current, ...data })
  return { ok: true }
})

ipcMain.handle('temp:cancelCleanup', async () => {
  tempCleanupCancelled = true
  return { ok: true }
})

ipcMain.handle('temp:delete', async (_, filePath: string) => {
  try {
    // Only allow deleting files inside TEMP_DIR
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(path.resolve(TEMP_DIR))) return { ok: false }
    if (fs.existsSync(resolved)) fs.unlinkSync(resolved)
    return { ok: true }
  } catch { return { ok: false } }
})

ipcMain.handle('claude:checkDeps', async () => {
  const check = (cmd: string): Promise<string | null> =>
    new Promise(resolve => exec(cmd, (err, stdout) => resolve(err ? null : stdout.trim())))

  const [npmVersion, claudeVersion] = await Promise.all([
    check('npm --version'),
    check('claude --version'),
  ])

  return {
    npm: npmVersion,
    claude: claudeVersion,
    ready: !!claudeVersion,
  }
})

ipcMain.handle('claude:install', async () => {
  return new Promise<{ ok: boolean; log: string }>((resolve) => {
    // Use native PowerShell installer — no Node/npm required
    const cmd = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"'
    exec(cmd, { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, log: stderr || err.message })
      else resolve({ ok: true, log: stdout })
    })
  })
})

ipcMain.handle('temp:getDirSize', async () => {
  ensureTempDir()
  let total = 0; let count = 0
  for (const f of fs.readdirSync(TEMP_DIR)) {
    try { total += fs.statSync(path.join(TEMP_DIR, f)).size; count++ } catch {}
  }
  return { bytes: total, count }
})

ipcMain.handle('usage:fetch', async () => {
  if (lastUsageData) mainWindow?.webContents.send('usage:data', lastUsageData)
  // Always respawn PTY on explicit refresh — ensures fresh data after 5h window reset
  const accounts = accountManager.getAccounts()
  if (accounts.length > 0) {
    const activeId = accountManager.getActiveAccountId?.() ?? accounts[0].id
    const activeAccount = accountManager.getAccount(activeId) ?? accounts[0]
    if (usagePty.isAlive()) usagePty.kill()
    spawnUsagePty(activeAccount.id, activeAccount.configDir)
    await new Promise(r => setTimeout(r, 2500))
  }
  await fetchAndSendUsage(lastSessionId ?? undefined)
  // Also refresh context if we have a session
  if (lastSessionId && lastConfigDir) {
    fetchContextForSession(lastSessionId, lastConfigDir)
  }
  return { ok: true }
})
