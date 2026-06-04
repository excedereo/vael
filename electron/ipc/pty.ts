import { ipcMain, BrowserWindow } from 'electron'
import type { PtySessionManager } from '../PtySessionManager.js'
import type { PtyManager } from '../PtyManager.js'

export function registerPtyHandlers(
  claudeRunner: PtySessionManager,
  contextPty: PtyManager,
  getWindow: () => BrowserWindow | null,
) {
  ipcMain.handle('pty:spawn', (_, configDir: string, sessionId?: string) => {
    contextPty.spawn(configDir, sessionId)
    contextPty.onOutput((data) => getWindow()?.webContents.send('pty:output', data))
    return { ok: true }
  })

  ipcMain.handle('pty:send', (_, command: string) => {
    contextPty.sendCommand(command)
    return { ok: true }
  })

  ipcMain.handle('pty:kill', () => {
    contextPty.kill()
    return { ok: true }
  })

  ipcMain.handle('pty:session:kill', (_, sessionId?: string) => {
    if (sessionId) claudeRunner.killSession(sessionId)
    else claudeRunner.killAll()
    return { ok: true }
  })

  ipcMain.handle('pty:session:alive', (_, sessionId: string) => {
    return { alive: claudeRunner.isAlive(sessionId) }
  })
}
