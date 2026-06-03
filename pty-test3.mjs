// pty-test3.mjs — multi-turn session, raw dump
import * as pty from 'node-pty'
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

function strip(s) {
  return s
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B\[(\d+)C/g, (_, n) => ' '.repeat(parseInt(n) || 1))
    .replace(/\x1B\[[0-9;]*[HfABDEFGST]/g, '\n')
    .replace(/\x1B\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1B[()][AB012UK]/g, '')
    .replace(/\x1B[MNOPRST78=><FEDM]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\r/g, '')
}

const SESSION_ID = 'f012424c-6648-4356-a02e-2a11e502b3f5'
const CONFIG_DIR = path.join(os.homedir(), '.claude-accounts', 'proton')

const MESSAGES = [
  'привет',
  'допиши в файл C:/Users/reaya/Documents/test.txt число 8888',
  'умничка',
  'допиши туда же число 9999',
]

const exe = findClaudeExe()
console.log('exe:', exe, '| session:', SESSION_ID)

const proc = pty.spawn(exe, ['--dangerously-skip-permissions', '--resume', SESSION_ID], {
  name: 'xterm-256color', cols: 120, rows: 50,
  cwd: os.homedir(),
  env: { ...process.env, CLAUDE_CONFIG_DIR: CONFIG_DIR },
})

let rawBuf = ''
let phase = 'boot'
let msgIdx = 0
let t0 = Date.now()
const ts = () => `+${String(Date.now() - t0).padStart(5)}ms`

function isReady(s) {
  return s.includes('? for shortcuts') || s.includes('for agents') || s.includes('← for agents')
}

function autoAnswer() {
  const s = strip(rawBuf).replace(/\s+/g, '')
  if (s.includes('trustthisfolder') || s.includes('Isthisaproject')) { proc.write('1') }
  if (s.includes('dangerously-skip-permissions') && s.includes('Iaccept')) { proc.write('2') }
  if (s.includes('Darkmode') && s.includes('Lightmode')) { proc.write('1') }
}

function sendNext() {
  if (msgIdx >= MESSAGES.length) {
    console.log('\n=== DONE ===')
    setTimeout(() => { proc.kill(); process.exit(0) }, 500)
    return
  }
  const msg = MESSAGES[msgIdx++]
  t0 = Date.now()
  phase = 'sent'
  console.log(`\n${'─'.repeat(70)}`)
  console.log(`SEND #${msgIdx}: ${msg}`)
  console.log('─'.repeat(70))
  proc.write(msg + '\r')
}

proc.onData((data) => {
  rawBuf += data
  autoAnswer()

  const stripped = strip(data)
  const lines = stripped.split('\n').map(l => l.trimEnd()).filter(l => l.trim())

  if (phase === 'boot') {
    if (isReady(stripped)) {
      phase = 'ready'
      console.log('READY — starting')
      setTimeout(sendNext, 200)
    }
    return
  }

  if (phase === 'sent') {
    if (lines.length) {
      lines.forEach(l => console.log(`[${ts()}] | ${JSON.stringify(l)}`))
    }
    if (isReady(stripped)) {
      phase = 'ready'
      console.log(`[${ts()}] === READY ===`)
      setTimeout(sendNext, 300)
    }
  }
})

proc.onExit(() => process.exit(0))
setTimeout(() => { console.log('TIMEOUT'); proc.kill(); process.exit(1) }, 120000)
