// pty-test.mjs — multi-message PTY tester
// Usage: node pty-test.mjs [sessionId]

import * as pty from 'node-pty'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

function findClaude() {
  for (const name of ['claude.cmd', 'claude']) {
    try {
      const found = execSync(`where ${name}`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' }).trim().split('\n')[0].trim()
      if (found && fs.existsSync(found)) return found
    } catch {}
  }
  return 'claude.cmd'
}

function findClaudeExe(bin) {
  if (bin.endsWith('.exe')) return bin
  if (bin.endsWith('.cmd')) {
    const exe = bin.replace('.cmd', '.exe')
    if (fs.existsSync(exe)) return exe
    const via = path.join(path.dirname(bin), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    if (fs.existsSync(via)) return via
  }
  return bin
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

const SPINNER_CHARS = new Set(['✻', '✽', '✶', '*', '·', '✢', '⠂', '⠐', '⠄'])
const THINKING_WORDS = ['Smooshing', 'Brewing', 'Baking', 'Cooking', 'Cogitating', 'Churning', 'Sautéed', 'Cooked', 'Brewed', 'Hashing', 'Propagating', 'Worked']

// ── config ────────────────────────────────────────────────────────────────────

const SESSION_ID = process.argv[2] || '028d27b8-ebae-4605-8bb3-4aeddf5b175d'
const CONFIG_DIR = path.join(os.homedir(), '.claude-accounts', 'sY')

const MESSAGES = [
  'привет! помнишь о чём мы говорили?',
  'назови три любых цвета одной строкой',
  'окей, спасибо. пока!',
]

const bin = findClaude()
const exe = findClaudeExe(bin)

console.log('=== PTY MULTI-MESSAGE TEST ===')
console.log('exe:', exe)
console.log('session:', SESSION_ID)
console.log('messages:', MESSAGES)
console.log('==============================\n')

const proc = pty.spawn(exe, ['--dangerously-skip-permissions', '--resume', SESSION_ID], {
  name: 'xterm-256color',
  cols: 220,
  rows: 50,
  cwd: os.homedir(),
  env: { ...process.env, CLAUDE_CONFIG_DIR: CONFIG_DIR },
})

// ── state ─────────────────────────────────────────────────────────────────────

let rawBuf = ''
let trustAnswered = false
let bypassAnswered = false
let themeAnswered = false

let msgIndex = 0
let waitingForReady = true   // true = ждём prompt перед отправкой
let seenSpinner = false
let answering = false
let textLines = []
let parseBuf = ''            // буфер только для текущего сообщения (сбрасывается при send)

function isReadyPrompt(s) {
  return s.includes('? for shortcuts') || s.includes('for agents') || s.includes('← for agents')
}

function sendNext() {
  if (msgIndex >= MESSAGES.length) {
    console.log('\n=== ALL MESSAGES DONE ===')
    proc.kill()
    process.exit(0)
  }
  const msg = MESSAGES[msgIndex++]
  console.log(`\n>>> SEND [${msgIndex}/${MESSAGES.length}]: ${msg}\n`)
  waitingForReady = false
  seenSpinner = false
  answering = false
  textLines = []
  parseBuf = ''   // сбрасываем буфер — берём только данные после отправки
  setTimeout(() => proc.write(msg + '\r'), 300)
}

// ── data handler ──────────────────────────────────────────────────────────────

proc.onData((data) => {
  rawBuf += data
  const s = strip(rawBuf).replace(/\s+/g, '')

  // auto-answer dialogs
  if (!trustAnswered && (s.includes('trustthisfolder') || s.includes('Isthisaproject'))) {
    trustAnswered = true
    setTimeout(() => proc.write('1'), 100)
  }
  if (!bypassAnswered && s.includes('dangerously-skip-permissions') && s.includes('Iaccept')) {
    bypassAnswered = true
    setTimeout(() => proc.write('2'), 300)
  }
  if (!themeAnswered && s.includes('Darkmode') && s.includes('Lightmode')) {
    themeAnswered = true
    setTimeout(() => proc.write('1'), 100)
  }

  const stripped = strip(data)

  // waiting for initial ready — send first message
  if (waitingForReady && isReadyPrompt(stripped)) {
    waitingForReady = false
    sendNext()
    return
  }

  if (waitingForReady) return

  // accumulate parse buffer (only data after send)
  parseBuf += stripped

  // parse response line by line
  const lines = stripped.split('\n').map(l => l.trim()).filter(Boolean)
  let sawReady = false

  for (const line of lines) {
    const hasSpinner = [...line].some(c => SPINNER_CHARS.has(c))
    const hasThinking = THINKING_WORDS.some(w => line.includes(w))
    const isReady = isReadyPrompt(line)

    if (isReady) { sawReady = true; continue }

    if (hasSpinner || hasThinking) {
      seenSpinner = true
      // каждый spinner сбрасывает буфер — берём только последний блок после последнего spinner
      if (!answering) textLines = []
      answering = false  // spinner после ответа — сбрасываем, ждём новый ●
      continue
    }

    if (!seenSpinner) continue
    if (line.match(/^\d+%/) || line.includes('tokens')) continue
    if (/^(>|\?|esc|─|▔|Claude Code|Sonnet|Opus|Haiku|⏵|❯)/.test(line)) continue

    if (line.startsWith('●')) {
      const content = line.slice(1).trim()
      if (content) {
        answering = true
        textLines = [content]  // каждый новый ● начинает свежий блок
      }
      continue
    }

    if (answering && line.length > 2) {
      textLines.push(line)
    }
  }

  if (sawReady && seenSpinner) {
    const response = textLines.join('\n').trim()
    console.log(`<<< RESPONSE [${msgIndex}/${MESSAGES.length}]: ${JSON.stringify(response)}`)
    // reset state for next message
    seenSpinner = false
    answering = false
    textLines = []
    waitingForReady = false
    // small delay before sending next — let claude settle
    setTimeout(sendNext, 500)
  }
})

proc.onExit((e) => {
  console.log('[EXIT] code:', e.exitCode)
  process.exit(0)
})

setTimeout(() => {
  console.log('[TIMEOUT] 120s')
  proc.kill()
  process.exit(1)
}, 120000)
