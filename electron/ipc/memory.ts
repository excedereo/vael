import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  ensureMemoryDir, loadMeta, saveMeta, parseFrontmatter, relPath,
  buildIndexContent, rebuildIndexChain, rebuildAllIndexes, rebuildClaudeMdBlock,
  lastMemoryTokens,
} from '../services/MemoryService.js'
import type { FsEntry } from '../services/MemoryService.js'
import { PATHS } from '../services/SettingsService.js'

export function registerMemoryHandlers() {
  ipcMain.handle('memory:listDir', async (_, dirPath?: string) => {
    ensureMemoryDir()
    const target = dirPath ?? PATHS.memory
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
            const fm = parseFrontmatter(fs.readFileSync(fullPath, 'utf-8'))
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
      return { ok: true, content: fs.readFileSync(filePath, 'utf-8') }
    } catch {
      return { ok: false, content: '' }
    }
  })

  ipcMain.handle('memory:writeFile', async (_, filePath: string, content: string) => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, content, 'utf-8')
      if (filePath.startsWith(PATHS.memory) && !filePath.endsWith('INDEX.md')) {
        rebuildAllIndexes()
      }
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  ipcMain.handle('memory:createFile', async (_, name: string, dirPath?: string) => {
    ensureMemoryDir()
    const filePath = path.join(dirPath ?? PATHS.memory, name)
    try {
      if (fs.existsSync(filePath)) return { ok: false, error: 'exists' }
      fs.writeFileSync(filePath, '', 'utf-8')
      rebuildAllIndexes()
      return { ok: true, path: filePath }
    } catch {
      return { ok: false }
    }
  })

  ipcMain.handle('memory:createDir', async (_, name: string, dirPath?: string) => {
    ensureMemoryDir()
    const dirFullPath = path.join(dirPath ?? PATHS.memory, name)
    try {
      if (fs.existsSync(dirFullPath)) return { ok: false, error: 'exists' }
      fs.mkdirSync(dirFullPath, { recursive: true })
      rebuildAllIndexes()
      return { ok: true, path: dirFullPath }
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

  ipcMain.handle('memory:getClaudeMd', async () => {
    try {
      const content = fs.existsSync(PATHS.claudeMd) ? fs.readFileSync(PATHS.claudeMd, 'utf-8') : ''
      return { ok: true, path: PATHS.claudeMd, content }
    } catch {
      return { ok: false, path: PATHS.claudeMd, content: '' }
    }
  })

  ipcMain.handle('memory:getMemoryDir', () => PATHS.memory)
  ipcMain.handle('memory:getMeta', () => loadMeta())
  ipcMain.handle('memory:getTokens', () => lastMemoryTokens)

  ipcMain.handle('memory:setMeta', async (_, relativePath: string, data: { auto?: boolean; desc?: string }) => {
    const meta = loadMeta()
    meta[relativePath] = { ...meta[relativePath], ...data }
    saveMeta(meta)
    rebuildClaudeMdBlock(meta)
    const absPath = path.join(PATHS.memory, relativePath)
    const isDir = fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()
    rebuildIndexChain(isDir ? absPath : path.dirname(absPath), meta)
    return { ok: true }
  })

  ipcMain.handle('memory:rebuildAll', async () => {
    const meta = loadMeta()
    function walkDirs(dirPath: string) {
      try {
        for (const name of fs.readdirSync(dirPath)) {
          const full = path.join(dirPath, name)
          if (fs.statSync(full).isDirectory()) {
            const content = buildIndexContent(full, meta)
            if (content) fs.writeFileSync(path.join(full, 'INDEX.md'), content, 'utf-8')
            walkDirs(full)
          }
        }
      } catch {}
    }
    walkDirs(PATHS.memory)
    rebuildClaudeMdBlock(meta)
    return { ok: true }
  })

  ipcMain.handle('stats:get', async () => {
    try {
      const statsPath = path.join(os.homedir(), '.claude', 'stats-cache.json')
      return { ok: true, data: JSON.parse(fs.readFileSync(statsPath, 'utf-8')) }
    } catch {
      return { ok: false, data: null }
    }
  })
}
