// pty-test2.mjs — raw dump of exactly what arrives after sending a message
// to an already-running session (simulates VaeliGUI sendMessage flow)

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
const MESSAGE = 'допиши в файл C:/Users/reaya/Documents/test.txt число 3333'

const exe = findClaudeExe()
console.log('exe:', exe)
console.log('session:', SESSION_ID)
console.log()

// use --resume only if SESSION_ID given, otherwise new session
const spawnArgs = SESSION_ID
  ? ['--dangerously-skip-permissions', '--resume', SESSION_ID]
  : ['--dangerously-skip-permissions']
const proc = pty.spawn(exe, spawnArgs, {
  name: 'xterm-256color', cols: 220, rows: 50,
  cwd: os.homedir(),
  env: { ...process.env, CLAUDE_CONFIG_DIR: CONFIG_DIR },
})

let rawBuf = ''
let chunkN = 0
let phase = 'boot'   // boot → ready → sent → done
let t0 = Date.now()

const ts = () => `+${Date.now() - t0}ms`

function autoAnswer() {
  const s = strip(rawBuf).replace(/\s+/g, '')
  if (s.includes('trustthisfolder') || s.includes('Isthisaproject')) { proc.write('1'); return }
  if (s.includes('dangerously-skip-permissions') && s.includes('Iaccept')) { proc.write('2'); return }
  if (s.includes('Darkmode') && s.includes('Lightmode')) { proc.write('1'); return }
}

proc.onData((data) => {
  rawBuf += data
  chunkN++
  autoAnswer()

  const stripped = strip(data)
  const isReady = stripped.includes('? for shortcuts') || stripped.includes('for agents') || stripped.includes('← for agents')

  if (phase === 'boot') {
    if (isReady) {
      phase = 'ready'
      console.log(`[${ts()}] === READY — sending message ===`)
      // simulate VaeliGUI: reset parser state, then send
      setTimeout(() => {
        phase = 'sent'
        t0 = Date.now()  // reset timer from send moment
        chunkN = 0
        proc.write(MESSAGE + '\r')
        console.log(`[+0ms] === SENT: ${MESSAGE} ===`)
      }, 300)
    }
    return  // don't log boot phase
  }

  if (phase === 'sent' || phase === 'done') {
    const lines = stripped.split('\n').map(l => l.trim()).filter(Boolean)
    console.log(`\n[${ts()}] chunk #${chunkN} (${data.length} bytes, ${lines.length} lines):`)
    lines.forEach(l => console.log(`  | ${JSON.stringify(l)}`))

    if (isReady && phase === 'sent') {
      phase = 'done'
      console.log(`\n[${ts()}] === READY AGAIN — response complete ===`)
      setTimeout(() => { proc.kill(); process.exit(0) }, 500)
    }
  }
})

proc.onExit(() => process.exit(0))
setTimeout(() => { console.log('TIMEOUT'); proc.kill(); process.exit(1) }, 120000)
