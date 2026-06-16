import { ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'
import type { PtySessionManager } from '../PtySessionManager.js'

// Map: sessionId → FSWatcher
const sessionWatchers = new Map<string, fs.FSWatcher>()

function detectStatus(jsonlPath: string): 'thinking' | 'streaming' | 'idle' {
  try {
    const content = fs.readFileSync(jsonlPath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    if (lines.length === 0) return 'idle'

    // Ищем последнюю валидную запись
    let lastEntry: { type?: string; message?: { stop_reason?: string } } | null = null
    for (let i = lines.length - 1; i >= 0; i--) {
      try { lastEntry = JSON.parse(lines[i]); break } catch {}
    }
    if (!lastEntry) return 'idle'

    if (lastEntry.type === 'user') return 'thinking'
    if (lastEntry.type === 'assistant') {
      if (lastEntry.message?.stop_reason) return 'idle'
      return 'streaming'
    }
  } catch {}
  return 'idle'
}

export function registerPtyHandlers(
  claudeRunner: PtySessionManager,
  getWindow?: () => BrowserWindow | null,
) {
  ipcMain.handle('pty:session:kill', (_, sessionId?: string) => {
    if (sessionId) claudeRunner.killSession(sessionId)
    else claudeRunner.killAll()
    return { ok: true }
  })

  ipcMain.handle('pty:session:alive', (_, sessionId: string) => {
    return { alive: claudeRunner.isAlive(sessionId) }
  })

  // Запустить fs.watch на jsonl файл сессии
  ipcMain.handle('pty:watch-session', (_, sessionId: string, jsonlPath: string) => {
    if (sessionWatchers.has(sessionId)) {
      try { sessionWatchers.get(sessionId)!.close() } catch {}
    }

    try {
      const watcher = fs.watch(jsonlPath, { persistent: false }, () => {
        const status = detectStatus(jsonlPath)
        const win = getWindow?.()
        if (win && !win.isDestroyed()) {
          win.webContents.send('session:status', sessionId, status)
        }
      })
      sessionWatchers.set(sessionId, watcher)
    } catch (e) {
      console.warn(`[pty:watch-session] failed to watch ${jsonlPath}:`, e)
    }

    return { ok: true }
  })

  // Остановить fs.watch
  ipcMain.handle('pty:unwatch-session', (_, sessionId: string) => {
    const watcher = sessionWatchers.get(sessionId)
    if (watcher) {
      try { watcher.close() } catch {}
      sessionWatchers.delete(sessionId)
    }
    return { ok: true }
  })
}
