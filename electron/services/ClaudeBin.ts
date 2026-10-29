import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync } from 'child_process'

// Единственное место где ищем claude binary — импортировать отсюда везде

// Нативный установщик (install.ps1) кладёт claude сюда и дописывает папку в PATH пользователя,
// но у уже запущенного Vael PATH старый — добавляем её сами, чтобы claude находился без перезапуска
const LOCAL_BIN = path.join(os.homedir(), '.local', 'bin')
function ensureLocalBinOnPath() {
  const parts = (process.env.PATH ?? '').split(path.delimiter)
  if (!parts.some(p => p.toLowerCase() === LOCAL_BIN.toLowerCase())) process.env.PATH = [...parts, LOCAL_BIN].join(path.delimiter)
}

export function findClaudeBin(): string {
  ensureLocalBinOnPath()
  if (process.env.CLAUDE_BIN && fs.existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN
  if (process.platform === 'win32') {
    for (const name of ['claude.cmd', 'claude']) {
      try {
        const found = execSync(`where ${name}`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' }).trim().split('\n')[0].trim()
        if (found && fs.existsSync(found)) return found
      } catch {}
    }
  } else {
    try {
      const found = execSync('which claude', { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' }).trim()
      if (found) return found
    } catch {}
  }
  const home = os.homedir()
  const candidates = process.platform === 'win32'
    ? [
        path.join(LOCAL_BIN, 'claude.exe'),
        path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
        path.join(home, 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
      ]
    : [path.join(LOCAL_BIN, 'claude'), path.join(home, '.npm-global', 'bin', 'claude'), '/usr/local/bin/claude']
  for (const p of candidates) { if (fs.existsSync(p)) return p }
  return process.platform === 'win32' ? 'claude.cmd' : 'claude'
}

export function findClaudeExe(bin: string): string {
  if (bin.endsWith('.exe')) return bin
  if (bin.endsWith('.cmd')) {
    const exeNext = bin.replace('.cmd', '.exe')
    if (fs.existsSync(exeNext)) return exeNext
    const viaModules = path.join(path.dirname(bin), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    if (fs.existsSync(viaModules)) return viaModules
  }
  return bin
}

/**
 * Путь к claude для запуска. Ищется заново, пока не найден реальный файл:
 * если Claude Code поставили, когда Vael уже работал, перезапуск не нужен
 */
let cachedExe: string | null = null
export function claudeExe(): string {
  if (cachedExe && fs.existsSync(cachedExe)) return cachedExe
  const exe = findClaudeExe(findClaudeBin())
  cachedExe = fs.existsSync(exe) ? exe : null
  return exe
}
