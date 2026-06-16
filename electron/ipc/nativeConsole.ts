import { ipcMain, BrowserWindow } from 'electron'
import { NativeConsole } from '../NativeConsole.js'

export function registerNativeConsoleHandlers(getWindow: () => BrowserWindow | null) {
  // Spawn native console window embedded in Electron
  ipcMain.handle('ncon:spawn', (_, sessionPath: string, x: number, y: number, w: number, h: number) => {
    const win = getWindow()
    if (!win) return { ok: false, error: 'no window' }

    const hwnd = win.getNativeWindowHandle()
    // getNativeWindowHandle returns Buffer with HWND bytes (little-endian on Windows)
    const hwndStr = hwnd.readBigUInt64LE(0).toString()

    const ok = NativeConsole.spawn({ parentHwnd: hwndStr, sessionPath, x, y, w, h })
    return { ok }
  })

  // Move/resize the embedded console
  ipcMain.handle('ncon:move', (_, x: number, y: number, w: number, h: number) => {
    const ok = NativeConsole.move(x, y, w, h)
    return { ok }
  })

  // Kill the embedded console process
  ipcMain.handle('ncon:kill', () => {
    const ok = NativeConsole.kill()
    return { ok }
  })

  // Check if console process is still alive
  ipcMain.handle('ncon:isAlive', () => {
    return { alive: NativeConsole.isAlive() }
  })

  // Show/hide
  ipcMain.handle('ncon:setVisible', (_, visible: boolean) => {
    NativeConsole.setVisible(visible)
    return { ok: true }
  })
}
