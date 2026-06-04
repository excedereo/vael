import { ipcMain } from 'electron'
import type { PtySessionManager } from '../PtySessionManager.js'

export function registerPtyHandlers(
  claudeRunner: PtySessionManager,
) {
  ipcMain.handle('pty:session:kill', (_, sessionId?: string) => {
    if (sessionId) claudeRunner.killSession(sessionId)
    else claudeRunner.killAll()
    return { ok: true }
  })

  ipcMain.handle('pty:session:alive', (_, sessionId: string) => {
    return { alive: claudeRunner.isAlive(sessionId) }
  })
}
