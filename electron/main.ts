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
import { PtySessionManager } from './PtySessionManager.js'
import { PtyManager } from './PtyManager.js'
import { parseUsage, parseContextFromMarkdown, readLastContextTokens } from './usageParser.js'
import type { ContextData } from './usageParser.js'
import { ModuleRegistry } from './ModuleRegistry.js'

const accountManager = new AccountManager()
const claudeRunner = new PtySessionManager()
const moduleRegistry = new ModuleRegistry()

// contextPty — spawned on /context command to query context size
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
        setLastConfigDir(meta.configDir as string ?? '')
      }
    }
  }

  // Init module registry
  moduleRegistry.init({
    claudeRunner,
    accountManager,
    getLastConfigDir: () => lastConfigDir,
    getLastSessionId: () => lastSessionId,
    sendToWindow: (channel, ...args) => mainWindow?.webContents.send(channel, ...args),
    userData: app.getPath('userData'),
  })


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
app.on('before-quit', () => moduleRegistry.destroy())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

// ── Memory watcher — rebuild indexes on external file changes ─────────────
let watchDebounce: ReturnType<typeof setTimeout> | null = null
function startMemoryWatcher() {
  const memDir = path.join(os.homedir(), '.vael', 'memory')
  if (!fs.existsSync(memDir)) return
  try {
    fs.watch(memDir, { recursive: true }, (_, filename) => {
      if (!filename || filename.endsWith('INDEX.md')) return
      if (watchDebounce) clearTimeout(watchDebounce)
      watchDebounce = setTimeout(() => { rebuildAllIndexes() }, 500)
    })
  } catch {}
}
app.whenReady().then(() => {
  setTimeout(startMemoryWatcher, 2000)
  setTimeout(() => rebuildAllIndexes(), 3000)
})

// ── IPC Handlers ──────────────────────────────────────────────────────────────

// ── Memory / file system ──────────────────────────────────────
const VAEL_DIR = path.join(os.homedir(), '.vael')
const MEMORY_DIR = path.join(VAEL_DIR, 'memory')
const GLOBAL_CLAUDE_MD = path.join(os.homedir(), '.claude', 'CLAUDE.md')

function ensureMemoryDir() {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true })
}

interface FsEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  mtime?: number
  auto?: boolean
  tag?: string
}

ipcMain.handle('memory:listDir', async (_, dirPath?: string) => {
  ensureMemoryDir()
  const target = dirPath ?? MEMORY_DIR
  try {
    const entries = fs.readdirSync(target, { withFileTypes: true })
    const result: FsEntry[] = entries.map(e => {
      const fullPath = path.join(target, e.name)
      const stat = fs.statSync(fullPath)
      const isDir = e.isDirectory()
      let auto = false
      let tag: string | undefined
      if (!isDir) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8')
          const fm = parseFrontmatter(content)
          auto = fm?.auto ?? false
          tag = fm?.tag
        } catch {}
      }
      return { name: e.name, path: fullPath, type: isDir ? 'dir' : 'file', size: stat.size, mtime: stat.mtimeMs, auto, tag }
    }).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return { ok: true, entries: result, rootDir: target }
  } catch {
    return { ok: false, entries: [], rootDir: target }
  }
})

ipcMain.handle('memory:readFile', async (_, filePath: string) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return { ok: true, content }
  } catch {
    return { ok: false, content: '' }
  }
})

ipcMain.handle('memory:writeFile', async (_, filePath: string, content: string) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content, 'utf-8')
    // Rebuild indexes so desc from frontmatter stays fresh
    if (filePath.startsWith(MEMORY_DIR) && !filePath.endsWith('INDEX.md')) {
      rebuildAllIndexes()
    }
    return { ok: true }
  } catch {
    return { ok: false }
  }
})

ipcMain.handle('memory:createFile', async (_, name: string, dirPath?: string) => {
  ensureMemoryDir()
  const target = dirPath ?? MEMORY_DIR
  const filePath = path.join(target, name)
  try {
    if (fs.existsSync(filePath)) return { ok: false, error: 'exists' }
    fs.writeFileSync(filePath, '', 'utf-8')
    rebuildAllIndexes()
    return { ok: true, path: filePath }
  } catch {
    return { ok: false }
  }
})

ipcMain.handle('memory:deleteFile', async (_, filePath: string) => {
  try {
    const stat = fs.statSync(filePath)
    if (stat.isDirectory()) {
      fs.rmSync(filePath, { recursive: true, force: true })
    } else {
      fs.unlinkSync(filePath)
    }
    rebuildAllIndexes()
    return { ok: true }
  } catch {
    return { ok: false }
  }
})

ipcMain.handle('memory:getClaudeMd', async () => {
  try {
    const content = fs.existsSync(GLOBAL_CLAUDE_MD) ? fs.readFileSync(GLOBAL_CLAUDE_MD, 'utf-8') : ''
    return { ok: true, path: GLOBAL_CLAUDE_MD, content }
  } catch {
    return { ok: false, path: GLOBAL_CLAUDE_MD, content: '' }
  }
})

ipcMain.handle('memory:createDir', async (_, name: string, dirPath?: string) => {
  ensureMemoryDir()
  const target = dirPath ?? MEMORY_DIR
  const dirFullPath = path.join(target, name)
  try {
    if (fs.existsSync(dirFullPath)) return { ok: false, error: 'exists' }
    fs.mkdirSync(dirFullPath, { recursive: true })
    rebuildAllIndexes()
    return { ok: true, path: dirFullPath }
  } catch {
    return { ok: false }
  }
})

ipcMain.handle('memory:getMemoryDir', () => MEMORY_DIR)

// ── Memory metadata & index system ───────────────────────────────────────

// Forward declaration — will be defined after rebuildClaudeMdBlock
function rebuildAllIndexes() {
  try {
    const meta = loadMeta()
    function walkDirs(dirPath: string) {
      try {
        for (const name of fs.readdirSync(dirPath)) {
          const full = path.join(dirPath, name)
          if (fs.statSync(full).isDirectory()) {
            const indexContent = buildIndexContent(full, meta)
            if (indexContent) fs.writeFileSync(path.join(full, 'INDEX.md'), indexContent, 'utf-8')
            walkDirs(full)
          }
        }
      } catch {}
    }
    walkDirs(MEMORY_DIR)
    rebuildClaudeMdBlock(meta)
  } catch {}
}

const MEMORY_META_FILE = path.join(VAEL_DIR, 'memory-meta.json')
const VAEL_BLOCK_START = '<!-- [VAEL MEMORY] -->'
const VAEL_BLOCK_END = '<!-- [/VAEL MEMORY] -->'

let lastMemoryTokens = { auto: 0, total: 0 }

interface MemoryMeta {
  [relativePath: string]: { auto: boolean }
}

function loadMeta(): MemoryMeta {
  try {
    if (fs.existsSync(MEMORY_META_FILE)) return JSON.parse(fs.readFileSync(MEMORY_META_FILE, 'utf-8'))
  } catch {}
  return {}
}

function saveMeta(meta: MemoryMeta) {
  fs.mkdirSync(VAEL_DIR, { recursive: true })
  fs.writeFileSync(MEMORY_META_FILE, JSON.stringify(meta, null, 2), 'utf-8')
}

// Parse ### Title\nDescription\nauto (optional)\n--- from file content
function parseFrontmatter(content: string): { title: string; desc: string; auto: boolean; tag?: string } | null {
  const lines = content.split('\n')
  if (!lines[0]?.startsWith('### ')) return null
  const title = lines[0].slice(4).trim()
  const descLines: string[] = []
  let auto = false
  let tag: string | undefined
  let i = 1
  while (i < lines.length && lines[i].trim() !== '---') {
    const line = lines[i].trim()
    if (line === 'auto') { auto = true }
    else if (line.startsWith('tag: ')) { tag = line.slice(5).trim() }
    else if (line) descLines.push(lines[i])
    i++
  }
  return { title, desc: descLines.join(' ').trim(), auto, tag }
}

// Check if file has auto flag in frontmatter
function isFileAuto(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const fm = parseFrontmatter(content)
    return fm?.auto ?? false
  } catch { return false }
}

// Get relative path from memory root
function relPath(absPath: string): string {
  return path.relative(MEMORY_DIR, absPath).replace(/\\/g, '/')
}

// Build INDEX.md content for a directory
function buildIndexContent(dirPath: string, meta: MemoryMeta): string {
  const dirName = path.basename(dirPath)

  let entries: string[]
  try {
    entries = fs.readdirSync(dirPath)
  } catch { return '' }

  // Preserve existing header (everything before and including ---)
  const indexPath = path.join(dirPath, 'INDEX.md')
  let header = `### ${dirName}\n\n---\n`
  if (fs.existsSync(indexPath)) {
    try {
      const existing = fs.readFileSync(indexPath, 'utf-8')
      const sepIdx = existing.indexOf('\n---')
      if (sepIdx !== -1) {
        header = existing.slice(0, sepIdx + 4) // keep everything up to and including ---
      }
    } catch {}
  }

  const lines: string[] = [header, '']

  // Sort: dirs first, then files
  const sorted = entries
    .filter(e => !e.startsWith('.') && e !== 'INDEX.md')
    .map(e => ({ name: e, fullPath: path.join(dirPath, e), isDir: fs.statSync(path.join(dirPath, e)).isDirectory() }))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  for (const entry of sorted) {
    const entryRel = relPath(entry.fullPath)
    const entryMeta = meta[entryRel] || {}
    let desc = entryMeta.desc || ''

    // Try to read desc from frontmatter if not in meta
    if (!desc && !entry.isDir) {
      try {
        const content = fs.readFileSync(entry.fullPath, 'utf-8')
        const fm = parseFrontmatter(content)
        if (fm) desc = fm.desc
      } catch {}
    }

    if (entry.isDir) {
      lines.push(`- [${entry.name}/](${entry.name}/INDEX.md)${desc ? ' — ' + desc : ''}`)
    } else {
      lines.push(`- [${entry.name}](${entry.name})${desc ? ' — ' + desc : ''}`)
    }
  }

  return lines.join('\n') + '\n'
}

// Rebuild INDEX.md for a dir and all parent dirs up to MEMORY_DIR
function rebuildIndexChain(startDir: string, meta: MemoryMeta) {
  let current = startDir
  while (true) {
    // Don't write INDEX.md in root — root is handled by CLAUDE.md block
    if (current !== MEMORY_DIR) {
      const indexPath = path.join(current, 'INDEX.md')
      const content = buildIndexContent(current, meta)
      if (content) fs.writeFileSync(indexPath, content, 'utf-8')
    }
    if (current === MEMORY_DIR) break
    current = path.dirname(current)
  }
}

// Rebuild the [VAEL MEMORY] block in CLAUDE.md
function rebuildClaudeMdBlock(meta: MemoryMeta) {
  if (!fs.existsSync(GLOBAL_CLAUDE_MD)) return

  const existing = fs.readFileSync(GLOBAL_CLAUDE_MD, 'utf-8')

  // Collect always-loaded files
  const alwaysLines: string[] = []
  const onDemandLines: string[] = []
  const tagMap: Record<string, string[]> = {}

  function scanDir(dirPath: string, dirRel: string) {
    let entries: string[]
    try { entries = fs.readdirSync(dirPath) } catch { return }

    for (const name of entries.sort()) {
      if (name.startsWith('.') || name === 'INDEX.md') continue
      const fullPath = path.join(dirPath, name)
      const rel = dirRel ? dirRel + '/' + name : name
      const isDir = fs.statSync(fullPath).isDirectory()

      if (isDir) {
        scanDir(fullPath, rel)
      } else {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8')
          const fm = parseFrontmatter(content)
          if (fm?.auto) {
            alwaysLines.push(`### ${rel}\n${content.trim()}`)
          } else if (fm?.tag) {
            if (!tagMap[fm.tag]) tagMap[fm.tag] = []
            tagMap[fm.tag].push(rel)
          } else {
            const desc = fm?.desc || ''
            onDemandLines.push(`- ${rel}${desc ? ' — ' + desc : ''}`)
          }
        } catch {}
      }
    }
  }

  scanDir(MEMORY_DIR, '')

  // Build top-level on-demand structure (dirs with INDEX.md links)
  const topDirs: string[] = []
  try {
    for (const name of fs.readdirSync(MEMORY_DIR)) {
      const fullPath = path.join(MEMORY_DIR, name)
      if (!fs.statSync(fullPath).isDirectory()) continue
      // Try to get desc from INDEX.md frontmatter
      let desc = ''
      const indexPath = path.join(fullPath, 'INDEX.md')
      if (fs.existsSync(indexPath)) {
        try {
          const fm = parseFrontmatter(fs.readFileSync(indexPath, 'utf-8'))
          if (fm) desc = fm.desc
        } catch {}
      }
      topDirs.push(`- ${name}/ — ${desc || name}. Read ${name}/INDEX.md for details.`)
    }
  } catch {}

  const claudeMdPath2 = path.join(os.homedir(), '.claude', 'CLAUDE.md')

  const tagLines: string[] = []
  for (const [tag, paths] of Object.entries(tagMap).sort()) {
    for (const p of paths) {
      tagLines.push(`[${tag}] - ${p}`)
    }
  }

  // Count tokens (approx 4 chars = 1 token)
  const alwaysContent = alwaysLines.join('\n\n')
  const autoTokens = Math.round(alwaysContent.length / 4)

  // Total = scan all files in memory dir
  let totalChars = 0
  function countDir(dirPath: string) {
    try {
      for (const name of fs.readdirSync(dirPath)) {
        if (name.startsWith('.') || name === 'INDEX.md') continue
        const fullPath = path.join(dirPath, name)
        if (fs.statSync(fullPath).isDirectory()) countDir(fullPath)
        else { try { totalChars += fs.readFileSync(fullPath, 'utf-8').length } catch {} }
      }
    } catch {}
  }
  countDir(MEMORY_DIR)
  const totalTokens = Math.round(totalChars / 4)
  lastMemoryTokens = { auto: autoTokens, total: totalTokens }

  function fmtTokens(n: number) {
    if (n >= 1000) return Math.round(n / 100) / 10 + 'k'
    return String(n)
  }

  const block = [
    VAEL_BLOCK_START,
    `Memory root: ${MEMORY_DIR}`,
    '',
    alwaysLines.length > 0 ? '## Always loaded:\n' + alwaysLines.join('\n\n') : '',
    topDirs.length > 0 ? '## Available on demand (read INDEX.md of category first):\n' + topDirs.join('\n') : '',
    onDemandLines.length > 0 ? '## Individual files on demand:\n' + onDemandLines.join('\n') : '',
    tagLines.length > 0 ? '## Tags:\nФайлы с тегами загружаются только когда в сообщении встречается соответствующий тег в скобках, например [TG]. При виде тега — прочитать соответствующий файл.\n' + tagLines.join('\n') : '',
  ].filter(Boolean).join('\n') + '\n' + VAEL_BLOCK_END

  // Replace or append block
  const startIdx = existing.indexOf(VAEL_BLOCK_START)
  const endIdx = existing.indexOf(VAEL_BLOCK_END)
  let updated: string
  if (startIdx !== -1 && endIdx !== -1) {
    // Skip everything after VAEL_BLOCK_END until next newline that isn't the token line
    let afterEnd = endIdx + VAEL_BLOCK_END.length
    // Skip the token stats line if it follows (line starting with -----------)
    const rest = existing.slice(afterEnd)
    const tokenLineMatch = rest.match(/^\n-{3,}[^\n]*-{3,}/)
    if (tokenLineMatch) afterEnd += tokenLineMatch[0].length
    updated = existing.slice(0, startIdx) + block + existing.slice(afterEnd)
  } else {
    updated = existing.trimEnd() + '\n\n' + block + '\n'
  }

  fs.writeFileSync(claudeMdPath2, updated, 'utf-8')
}

ipcMain.handle('memory:getMeta', () => loadMeta())
ipcMain.handle('memory:getTokens', () => lastMemoryTokens)

ipcMain.handle('memory:setMeta', async (_, relativePath: string, data: { auto?: boolean; desc?: string }) => {
  const meta = loadMeta()
  meta[relativePath] = { ...meta[relativePath], ...data }
  saveMeta(meta)
  rebuildClaudeMdBlock(meta)
  // Rebuild index chain for affected dir
  const absPath = path.join(MEMORY_DIR, relativePath)
  const isDir = fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()
  rebuildIndexChain(isDir ? absPath : path.dirname(absPath), meta)
  return { ok: true }
})

ipcMain.handle('memory:rebuildAll', async () => {
  const meta = loadMeta()
  // Rebuild all INDEX.md files
  function walkDirs(dirPath: string) {
    try {
      for (const name of fs.readdirSync(dirPath)) {
        const full = path.join(dirPath, name)
        if (fs.statSync(full).isDirectory()) {
          const indexContent = buildIndexContent(full, meta)
          if (indexContent) fs.writeFileSync(path.join(full, 'INDEX.md'), indexContent, 'utf-8')
          walkDirs(full)
        }
      }
    } catch {}
  }
  walkDirs(MEMORY_DIR)
  rebuildClaudeMdBlock(meta)
  return { ok: true }
})

ipcMain.handle('memory:rename', async (_, oldPath: string, newName: string) => {
  try {
    const newPath = path.join(path.dirname(oldPath), newName)
    if (fs.existsSync(newPath)) return { ok: false, error: 'exists' }
    fs.renameSync(oldPath, newPath)
    rebuildAllIndexes()
    return { ok: true, path: newPath }
  } catch {
    return { ok: false }
  }
})

ipcMain.handle('stats:get', async () => {
  try {
    const statsPath = path.join(os.homedir(), '.claude', 'stats-cache.json')
    const raw = fs.readFileSync(statsPath, 'utf-8')
    return { ok: true, data: JSON.parse(raw) }
  } catch {
    return { ok: false, data: null }
  }
})

ipcMain.handle('update:download', () => autoUpdater.downloadUpdate())
ipcMain.handle('update:install', () => autoUpdater.quitAndInstall())
ipcMain.handle('update:getVaelVersion', () => app.getVersion())
ipcMain.handle('update:setAutoDownload', (_: unknown, enabled: boolean) => {
  autoUpdater.autoDownload = enabled
  autoUpdater.autoInstallOnAppQuit = enabled
})

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

ipcMain.handle('accounts:logout', (_, id: string) => {
  try {
    accountManager.logoutAccount(id)
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
    setLastConfigDir(account.configDir)
  }
  return { ok: true }
})

ipcMain.handle('account:switch', async (_, fromId: string, toId: string) => {
  try {
    accountManager.setActiveAccountId(toId)
    accountManager.syncSessionsTo(fromId, toId)
    const toAccount = accountManager.getAccount(toId)
    if (toAccount) setLastConfigDir(toAccount.configDir)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

let tempCleanupCancelled = false
let lastUsageData: { usage: unknown; context: unknown } | null = null
let lastSessionId: string | null = null
let lastConfigDir: string = (loadVaeliSettings().lastConfigDir as string) || ''

function setLastConfigDir(dir: string) {
  lastConfigDir = dir
  const s = loadVaeliSettings(); s.lastConfigDir = dir; saveVaeliSettings(s)
}
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

// usage/context fetched only on explicit user request (/usage, /context commands)

ipcMain.handle('claude:send', async (_, sessionId: string, text: string, accountId: string, model: string, effort: string, permissionMode: string) => {
  const configDir = accountManager.getConfigDir(accountId)

  claudeRunner.sendMessage(
    sessionId, text, configDir, model, effort || null, permissionMode || 'bypassPermissions',
    (event) => {
      trackCacheFromEvent(event)
      mainWindow?.webContents.send('stream:event', event)
      // после result читаем usage из jsonl — там точный контекст
      if (event.type === 'result') {
        setTimeout(() => {
          const projectsDir = path.join(configDir, 'projects')
          try {
            for (const proj of fs.readdirSync(projectsDir)) {
              const candidate = path.join(projectsDir, proj, `${sessionId}.jsonl`)
              if (fs.existsSync(candidate)) {
                const count = readLastContextTokens(candidate)
                if (count !== null) {
                  mainWindow?.webContents.send('stream:event', { type: 'pty_tokens', count })
                }
                break
              }
            }
          } catch {}
        }, 800)
      }
    },
    (code) => {
      mainWindow?.webContents.send('stream:done', code)
      lastSessionId = sessionId
      setLastConfigDir(configDir)
    },
  )
  return { ok: true }
})

ipcMain.handle('claude:new', async (_, text: string, accountId: string, model: string, effort: string, permissionMode: string) => {
  const configDir = accountManager.getConfigDir(accountId)

  // snapshot existing sessions before sending so we can detect the new one after
  const existingIds = new Set(
    accountManager.findNewSessions(configDir, new Set(), 100).concat(
      // also include currently known sessions
      Array.from({ length: 0 })
    )
  )

  claudeRunner.startNewSession(
    text, configDir, model, effort || null, permissionMode || 'bypassPermissions',
    (event) => {
      trackCacheFromEvent(event)
      mainWindow?.webContents.send('stream:event', event)
    },
    async (code) => {
      mainWindow?.webContents.send('stream:done', code)

      // small delay — claude may not have flushed the .jsonl yet
      await new Promise(r => setTimeout(r, 800))

      // find which new .jsonl appeared since we sent
      const newIds = accountManager.findNewSessions(configDir, existingIds, 3)
      const newSessionId = newIds[0] ?? null
      console.log('[claude:new] detected new sessionId:', newSessionId)

      if (newSessionId) {
        lastSessionId = newSessionId
        setLastConfigDir(configDir)
        accountManager.setSessionMeta(newSessionId, configDir, { configDir, accountId })
        // notify renderer so sidebar updates
        mainWindow?.webContents.send('session:created', newSessionId)
      }
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
  contextPty.spawn(configDir, sessionId)
  contextPty.onOutput((data) => mainWindow?.webContents.send('pty:output', data))
  return { ok: true }
})

ipcMain.handle('pty:send', (_, command: string) => {
  contextPty.sendCommand(command)
  return { ok: true }
})

ipcMain.handle('session:command', async (_, command: string) => {
  console.log('[session:command] received:', command, 'lastSessionId:', lastSessionId)
  if (!lastSessionId || !lastConfigDir) {
    console.log('[session:command] no active session, ignoring')
    return { ok: false, error: 'no active session' }
  }
  claudeRunner.sendMessage(
    lastSessionId, command, lastConfigDir, 'claude-sonnet-4-5', null, 'bypassPermissions',
    (event) => { trackCacheFromEvent(event); mainWindow?.webContents.send('stream:event', event) },
    (code) => {
      mainWindow?.webContents.send('stream:done', code)
    },
  )
  return { ok: true }
})

ipcMain.handle('pty:kill', () => {
  contextPty.kill()
  return { ok: true }
})

ipcMain.handle('session:select', (_, sessionId: string) => {
  lastSessionId = sessionId
  // Send cached context immediately if available
  const context = contextCache.get(sessionId) ?? null
  mainWindow?.webContents.send('usage:data', { usage: lastUsageData?.usage ?? null, context })
})

ipcMain.handle('pty:session:kill', (_, sessionId?: string) => {
  if (sessionId) claudeRunner.killSession(sessionId)
  else claudeRunner.killAll()
  return { ok: true }
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

// ── Pyre Module Registry ──────────────────────────────────────────────────────

// modules:list — список всех модулей и их статус
ipcMain.handle('modules:list', () => moduleRegistry.list())

// modules:getSettings / modules:setSettings — проксируют в модуль
ipcMain.handle('modules:getSettings', (_, id: string) => moduleRegistry.getSettings(id))
ipcMain.handle('modules:setSettings', (_, id: string, settings: Record<string, unknown>) => {
  moduleRegistry.setSettings(id, settings)
  return { ok: true }
})

ipcMain.handle('modules:start', (_, id: string) => ({ ok: moduleRegistry.start(id) }))
ipcMain.handle('modules:stop', (_, id: string) => ({ ok: moduleRegistry.stop(id) }))

// Backward-compat aliases for TgPanel (tg:* → modules:* telegram)
ipcMain.handle('tg:getSettings', () => moduleRegistry.getSettings('telegram'))
ipcMain.handle('tg:setSettings', (_, settings: Record<string, unknown>) => {
  moduleRegistry.setSettings('telegram', settings)
  return { ok: true }
})
ipcMain.handle('tg:start', () => ({ ok: moduleRegistry.start('telegram') }))
ipcMain.handle('tg:stop', () => ({ ok: moduleRegistry.stop('telegram') }))

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
  return { ok: true }
})
