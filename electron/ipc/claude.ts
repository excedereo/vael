import { ipcMain, BrowserWindow } from 'electron'
import { exec, execFile } from 'child_process'
import { claudeExe } from '../services/ClaudeBin.js'

export function registerClaudeHandlers(
  getWindow: () => BrowserWindow | null,
) {
  ipcMain.handle('claude:abort', () => {
    return { ok: true }
  })

  ipcMain.handle('claude:checkDeps', async () => {
    const check = (cmd: string): Promise<string | null> =>
      new Promise(resolve => exec(cmd, (err, stdout) => resolve(err ? null : stdout.trim())))
    // claude — по найденному пути, а не через PATH: после установки PATH процесса устаревший
    const exe = claudeExe()
    const claudeVersion = (): Promise<string | null> =>
      new Promise(resolve => execFile(exe, ['--version'], { timeout: 15000, shell: exe.endsWith('.cmd') }, (err, stdout) => resolve(err ? null : stdout.trim() || null)))
    const [npmVersion, claudeVer] = await Promise.all([check('npm --version'), claudeVersion()])
    return { npm: npmVersion, claude: claudeVer, ready: !!claudeVer }
  })

  ipcMain.handle('claude:install', async () => {
    return new Promise<{ ok: boolean; log: string }>((resolve) => {
      const cmd = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"'
      exec(cmd, { timeout: 300000 }, (err, stdout, stderr) => {
        if (err) resolve({ ok: false, log: stderr || err.message })
        else resolve({ ok: true, log: stdout })
      })
    })
  })

  ipcMain.handle('claude:installVersion', async (_, version: string) => {
    return new Promise<{ ok: boolean; log: string }>((resolve) => {
      const pkg = `@anthropic-ai/claude-code@${version}`
      exec(`npm install -g ${pkg}`, { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) resolve({ ok: false, log: stderr || err.message })
        else resolve({ ok: true, log: stdout })
      })
    })
  })
}
