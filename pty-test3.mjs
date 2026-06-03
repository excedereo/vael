// pty-test3.mjs — PTY + xterm-headless
// xterm эмулирует экран правильно, мы читаем строки как пользователь видит

import * as pty from 'node-pty'
import pkg from '@xterm/headless'
const { Terminal } = pkg
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

function findClaudeExe() {
  for (const name of ['claude.cmd', 'claude']) {
    try {
      const found = execSync(`where ${name}`, { stdio: ['ignore','pipe','ignore'], encoding: 'utf-8' }).trim().split('\n')[0].trim()
      if (found && fs.existsSync(found)) {
        if (found.endsWith('.cmd')) {
          const exe = found.replace('.cmd', '.exe')
          if (fs.existsSync(exe)) return exe
          const via = path.join(path.dirname(found), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
          if (fs.existsSync(via)) return via
        }
        return found
      }
    } catch {}
  }
  return 'claude.cmd'
}

const COLS = 120
const ROWS = 50
const SESSION_ID = 'f012424c-6648-4356-a02e-2a11e502b3f5'
const CONFIG_DIR = path.join(os.homedir(), '.claude-accounts', 'proton')
const MESSAGE = 'допиши в файл C:/Users/reaya/Documents/test.txt число 5555'

const exe = findClaudeExe()
console.log('exe:', exe)

// xterm terminal emulator
const term = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true })

function getScreen() {
  const lines = []
  for (let i = 0; i < ROWS; i++) {
    const line = term.buffer.active.getLine(i)
    if (line) lines.push(line.translateToString(true))
  }
  return lines
}

function getVisibleText() {
  return getScreen().filter(l => l.trim()).join('\n')
}

const proc = pty.spawn(exe, ['--dangerously-skip-permissions', '--resume', SESSION_ID], {
  name: 'xterm-256color', cols: COLS, rows: ROWS,
  cwd: os.homedir(),
  env: { ...process.env, CLAUDE_CONFIG_DIR: CONFIG_DIR },
})

let rawBuf = ''
let phase = 'boot'
let chunkN = 0
let t0 = Date.now()
const ts = () => `+${Date.now()-t0}ms`

let lastScreen = ''

function autoAnswer() {
  const s = rawBuf.replace(/\x1B\[[0-9;?]*[a-zA-Z]/g, '').replace(/\s+/g, '')
  if (s.includes('trustthisfolder')) { proc.write('1'); return }
  if (s.includes('dangerously-skip-permissions') && s.includes('Iaccept')) { proc.write('2'); return }
  if (s.includes('Darkmode') && s.includes('Lightmode')) { proc.write('1'); return }
}

proc.onData((data) => {
  rawBuf += data
  chunkN++
  autoAnswer()

  // feed to xterm
  term.write(data)

  const screen = getVisibleText()
  const isReady = screen.includes('? for shortcuts') || screen.includes('for agents') || screen.includes('← for agents')

  if (phase === 'boot' && isReady) {
    phase = 'ready'
    console.log(`[${ts()}] === READY ===`)
    console.log('screen:\n' + getScreen().filter(l => l.trim()).map(l => '  |' + l).join('\n'))
    setTimeout(() => {
      phase = 'sent'
      t0 = Date.now()
      chunkN = 0
      lastScreen = ''
      // reset terminal to clean state
      term.reset()
      proc.write(MESSAGE + '\r')
      console.log(`\n[+0ms] === SENT: ${MESSAGE} ===\n`)
    }, 300)
    return
  }

  if (phase === 'sent') {
    const newScreen = getScreen().filter(l => l.trim()).join('\n')
    if (newScreen !== lastScreen) {
      lastScreen = newScreen
      console.log(`[${ts()}] chunk #${chunkN} screen:`)
      getScreen().filter(l => l.trim()).forEach(l => console.log('  |' + l))
      console.log()
    }

    if (isReady) {
      phase = 'done'
      console.log(`[${ts()}] === READY AGAIN ===`)
      proc.kill()
      process.exit(0)
    }
  }
})

proc.onExit(() => process.exit(0))
setTimeout(() => { console.log('TIMEOUT'); proc.kill(); process.exit(1) }, 60000)
