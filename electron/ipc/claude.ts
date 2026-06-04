import { ipcMain, BrowserWindow } from 'electron'
import { exec } from 'child_process'
import path from 'path'
import fs from 'fs'
import type { PtySessionManager } from '../PtySessionManager.js'
import type { AccountManager } from '../AccountManager.js'
import { readLastContextTokens, readLastAssistantMessage } from '../usageParser.js'

export function registerClaudeHandlers(
  claudeRunner: PtySessionManager,
  accountManager: AccountManager,
  getLastSessionId: () => string | null,
  setLastSessionId: (id: string) => void,
  getLastConfigDir: () => string,
  setLastConfigDir: (dir: string) => void,
  trackCacheFromEvent: (event: unknown) => void,
  getWindow: () => BrowserWindow | null,
) {
  ipcMain.handle('claude:send', async (_, sessionId: string, text: string, accountId: string, model: string, effort: string, permissionMode: string) => {
    const configDir = accountManager.getConfigDir(accountId)

    claudeRunner.sendMessage(
      sessionId, text, configDir, model, effort || null, permissionMode || 'bypassPermissions',
      (event) => {
        trackCacheFromEvent(event)
        getWindow()?.webContents.send('stream:event', event)
        if (event.type === 'result') {
          setTimeout(() => {
            const projectsDir = path.join(configDir, 'projects')
            try {
              for (const proj of fs.readdirSync(projectsDir)) {
                const candidate = path.join(projectsDir, proj, `${sessionId}.jsonl`)
                if (fs.existsSync(candidate)) {
                  const count = readLastContextTokens(candidate)
                  if (count !== null) {
                    getWindow()?.webContents.send('stream:event', { type: 'pty_tokens', count })
                  }
                  const msg = readLastAssistantMessage(candidate)
                  if (msg !== null) {
                    getWindow()?.webContents.send('stream:event', { type: 'pty_final_message', entry: msg })
                  }
                  break
                }
              }
            } catch (e) { console.log('[claude:send] jsonl error:', e) }
          }, 300)
        }
      },
      (code) => {
        getWindow()?.webContents.send('stream:done', code)
        setLastSessionId(sessionId)
        setLastConfigDir(configDir)
      },
    )
    return { ok: true }
  })

  ipcMain.handle('claude:new', async (_, text: string, accountId: string, model: string, effort: string, permissionMode: string) => {
    const configDir = accountManager.getConfigDir(accountId)
    const existingIds = new Set(accountManager.findNewSessions(configDir, new Set(), 100))

    claudeRunner.startNewSession(
      text, configDir, model, effort || null, permissionMode || 'bypassPermissions',
      (event) => {
        trackCacheFromEvent(event)
        getWindow()?.webContents.send('stream:event', event)
      },
      async (code) => {
        getWindow()?.webContents.send('stream:done', code)
        await new Promise(r => setTimeout(r, 800))
        const newIds = accountManager.findNewSessions(configDir, existingIds, 3)
        const newSessionId = newIds[0] ?? null
        console.log('[claude:new] detected new sessionId:', newSessionId)
        if (newSessionId) {
          setLastSessionId(newSessionId)
          setLastConfigDir(configDir)
          accountManager.setSessionMeta(newSessionId, configDir, { configDir, accountId })
          getWindow()?.webContents.send('session:created', newSessionId)
        }
      },
    )
    return { ok: true }
  })

  ipcMain.handle('claude:abort', () => {
    claudeRunner.abort()
    return { ok: true }
  })

  ipcMain.handle('session:command', async (_, command: string) => {
    const lastSessionId = getLastSessionId()
    const lastConfigDir = getLastConfigDir()
    console.log('[session:command] received:', command, 'lastSessionId:', lastSessionId)
    if (!lastSessionId || !lastConfigDir) {
      return { ok: false, error: 'no active session' }
    }
    claudeRunner.sendMessage(
      lastSessionId, command, lastConfigDir, 'claude-sonnet-4-5', null, 'bypassPermissions',
      (event) => { trackCacheFromEvent(event); getWindow()?.webContents.send('stream:event', event) },
      (code) => { getWindow()?.webContents.send('stream:done', code) },
    )
    return { ok: true }
  })

  ipcMain.handle('claude:checkDeps', async () => {
    const check = (cmd: string): Promise<string | null> =>
      new Promise(resolve => exec(cmd, (err, stdout) => resolve(err ? null : stdout.trim())))
    const [npmVersion, claudeVersion] = await Promise.all([
      check('npm --version'),
      check('claude --version'),
    ])
    return { npm: npmVersion, claude: claudeVersion, ready: !!claudeVersion }
  })

  ipcMain.handle('claude:install', async () => {
    return new Promise<{ ok: boolean; log: string }>((resolve) => {
      const cmd = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"'
      exec(cmd, { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) resolve({ ok: false, log: stderr || err.message })
        else resolve({ ok: true, log: stdout })
      })
    })
  })
}
