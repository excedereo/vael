import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const _require = createRequire(import.meta.url)

// Load native addon — compiled for Electron, lives in native/build/Release/
let _addon: {
  spawn: (parentHwnd: string, sessionPath: string, x: number, y: number, w: number, h: number) => boolean
  move: (x: number, y: number, w: number, h: number) => boolean
  kill: () => boolean
  isAlive: () => boolean
  setVisible: (visible: boolean) => void
} | null = null

function getAddon() {
  if (!_addon) {
    const addonPath = path.join(__dirname, '..', 'native', 'build', 'Release', 'console_window.node')
    _addon = _require(addonPath)
  }
  return _addon!
}

export interface SpawnOptions {
  parentHwnd: string   // HWND as decimal string
  sessionPath: string  // path to project directory for claude --resume
  x: number
  y: number
  w: number
  h: number
}

export const NativeConsole = {
  spawn(opts: SpawnOptions): boolean {
    try {
      return getAddon().spawn(opts.parentHwnd, opts.sessionPath, opts.x, opts.y, opts.w, opts.h)
    } catch (e) {
      console.error('[NativeConsole] spawn error:', e)
      return false
    }
  },

  move(x: number, y: number, w: number, h: number): boolean {
    try {
      return getAddon().move(x, y, w, h)
    } catch (e) {
      console.error('[NativeConsole] move error:', e)
      return false
    }
  },

  kill(): boolean {
    try {
      return getAddon().kill()
    } catch (e) {
      console.error('[NativeConsole] kill error:', e)
      return false
    }
  },

  isAlive(): boolean {
    try {
      return getAddon().isAlive()
    } catch (e) {
      return false
    }
  },

  setVisible(visible: boolean): void {
    try {
      getAddon().setVisible(visible)
    } catch {}
  },
}
