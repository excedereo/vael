import { ipcMain, BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { findClaudeBin, findClaudeExe } from '../services/ClaudeBin.js'

const CLAUDE_BIN = findClaudeBin()
const CLAUDE_EXE = findClaudeExe(CLAUDE_BIN)

interface PtyEntry {
  proc: pty.IPty
  sessionPath: string
}

const sessions = new Map<string, PtyEntry>()

export function registerPtyHandlers(getWindow: () => BrowserWindow | null) {
  // Spawn claude --resume <sessionId> for a terminal session
  // sessionId: UUID, projectPath: path to project dir (cwd), configDir: claude config dir
  ipcMain.handle('pty:spawn', async (_, termId: string, sessionId: string, projectPath: string, configDir: string, cols: number, rows: number, model?: string, effort?: string, permissionMode?: string) => {
    const existing = sessions.get(termId)
    if (existing) {
      try { existing.proc.kill() } catch {}
      sessions.delete(termId)
    }

    const cwd = os.homedir()

    const env = { ...process.env } as Record<string, string>
    if (configDir) {
      env.CLAUDE_CONFIG_DIR = configDir
    } else {
      delete env.CLAUDE_CONFIG_DIR
    }

    console.log(`[pty:spawn] sessionId=${sessionId} cwd=${cwd} configDir=${configDir || '(default)'}`)

    const args: string[] = []
    if (!permissionMode || permissionMode === 'bypassPermissions') {
      args.push('--dangerously-skip-permissions')
    } else {
      args.push('--permission-mode', permissionMode)
    }
    if (model)     args.push('--model', model)
    if (effort)    args.push('--effort', effort)
    if (sessionId) args.push('--resume', sessionId)

    console.log(`[pty:spawn] args:`, args.join(' '))

    const proc = pty.spawn(CLAUDE_EXE, args, {
      name: 'xterm-256color',
      cols: cols || 120,
      rows: rows || 30,
      cwd,
      env,
    })

    let rawBuf = ''
    let trustAnswered = false
    let bypassAnswered = false
    let themeAnswered = false

    // Для новой сессии — polling файловой системы чтобы найти появившийся jsonl
    if (!sessionId && configDir) {
      // Снимаем snapshot всех существующих jsonl ДО запуска claude
      const knownIds = new Set<string>()
      const projectsDir = path.join(configDir, 'projects')
      if (fs.existsSync(projectsDir)) {
        for (const proj of fs.readdirSync(projectsDir, { withFileTypes: true })) {
          if (!proj.isDirectory()) continue
          for (const file of fs.readdirSync(path.join(projectsDir, proj.name))) {
            if (file.endsWith('.jsonl')) knownIds.add(file.replace('.jsonl', ''))
          }
        }
      }
      let attempts = 0
      const MAX_ATTEMPTS = 150 // 5 минут при интервале 2с
      const poll = setInterval(() => {
        attempts++
        const projectsDir = path.join(configDir, 'projects')
        if (!fs.existsSync(projectsDir)) {
          if (attempts >= MAX_ATTEMPTS) clearInterval(poll)
          return
        }
        let found: string | null = null
        outer: for (const proj of fs.readdirSync(projectsDir, { withFileTypes: true })) {
          if (!proj.isDirectory()) continue
          for (const file of fs.readdirSync(path.join(projectsDir, proj.name))) {
            if (!file.endsWith('.jsonl')) continue
            const sid = file.replace('.jsonl', '')
            if (!knownIds.has(sid)) { found = sid; break outer }
          }
        }
        if (found) {
          clearInterval(poll)
          sessions.set(termId, { proc, sessionPath: found })
          console.log(`[pty:spawn] new session detected via fs: ${found}`)
          const win = getWindow()
          if (win && !win.isDestroyed()) win.webContents.send('session:created', found)
        }
        if (attempts >= MAX_ATTEMPTS) clearInterval(poll)
      }, 2000)
    }

    proc.onData((data) => {
      rawBuf += data
      const s = rawBuf.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\s+/g, '')

      if (!trustAnswered && (s.includes('trustthisfolder') || s.includes('Isthisaproject'))) {
        trustAnswered = true
        setTimeout(() => proc.write('1'), 100)
      }
      if (!bypassAnswered && s.includes('dangerously-skip-permissions') && s.includes('Iaccept')) {
        bypassAnswered = true
        setTimeout(() => proc.write('2'), 300)
      }
      if (!themeAnswered && s.includes('Darkmode') && s.includes('Lightmode')) {
        themeAnswered = true
        setTimeout(() => proc.write('1'), 100)
      }

      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('pty:data', termId, data)
      }
    })

    proc.onExit(() => {
      sessions.delete(termId)
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('pty:exit', termId)
      }
    })

    sessions.set(termId, { proc, sessionPath: sessionId })
    return { ok: true }
  })

  ipcMain.on('pty:write', (_, termId: string, data: string) => {
    sessions.get(termId)?.proc.write(data)
  })

  ipcMain.handle('pty:resize', (_, termId: string, cols: number, rows: number) => {
    sessions.get(termId)?.proc.resize(cols, rows)
    return { ok: true }
  })

  ipcMain.handle('pty:kill', (_, termId: string) => {
    const entry = sessions.get(termId)
    if (entry) {
      try { entry.proc.kill() } catch {}
      sessions.delete(termId)
    }
    return { ok: true }
  })

  ipcMain.handle('pty:alive', (_, termId: string) => {
    return { alive: sessions.has(termId) }
  })
}
