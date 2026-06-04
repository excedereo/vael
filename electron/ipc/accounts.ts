import { ipcMain, BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import type { AccountManager } from '../AccountManager.js'

export function registerAccountHandlers(accountManager: AccountManager, getWindow: () => BrowserWindow | null) {
  ipcMain.handle('accounts:get', () => accountManager.getAccounts())

  ipcMain.handle('accounts:create', (_, id: string) => accountManager.createAccount(id))

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

  ipcMain.handle('accounts:checkCredentials', (_, configDir: string) => {
    const claudeJsonPath = path.join(configDir, '.claude.json')
    if (fs.existsSync(claudeJsonPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'))
        if (cfg.oauthAccount) return true
      } catch {}
    }
    return fs.existsSync(path.join(configDir, '.credentials.json'))
  })

  ipcMain.handle('accounts:openAuth', (_, configDir: string) => {
    console.log('[openAuth] launching terminal for:', configDir)
    const claudeJsonPath = path.join(configDir, '.claude.json')
    const homedir = os.homedir()
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
      try {
        const pid = fs.readFileSync(pidFile, 'utf-8').trim()
        spawn('cmd.exe', ['/c', `taskkill /F /PID ${pid} /T`], { windowsHide: true })
        fs.unlinkSync(pidFile)
      } catch (e) {
        console.error('[openAuth] closeTerminal error:', e)
      }
    }

    const pollLogin = setInterval(() => {
      try {
        const credPath = path.join(configDir, '.credentials.json')
        const hasCredentials = fs.existsSync(credPath)
        const cfg = fs.existsSync(claudeJsonPath) ? JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8')) : {}
        if (cfg.oauthAccount || hasCredentials) {
          clearInterval(pollLogin)
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
          getWindow()?.webContents.send('auth:done', configDir)
        }
      } catch (e) {
        console.log('[openAuth] poll error:', e)
      }
    }, 1500)

    setTimeout(() => clearInterval(pollLogin), 5 * 60 * 1000)
    return { ok: true }
  })

  ipcMain.handle('account:setActive', async (_, id: string) => {
    accountManager.setActiveAccountId(id)
    return { ok: true }
  })

  ipcMain.handle('account:switch', async (_, fromId: string, toId: string) => {
    try {
      accountManager.setActiveAccountId(toId)
      accountManager.syncSessionsTo(fromId, toId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
