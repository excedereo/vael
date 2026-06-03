import { spawn } from 'child_process'
import path from 'path'
import os from 'os'

const CONFIG_DIR = path.join(os.homedir(), '.claude-accounts', 'proton')
const SESSION_ID = 'f012424c-6648-4356-a02e-2a11e502b3f5'
const MESSAGE = 'привет, скажи одно слово'

const exe = 'C:/Users/reaya/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe'

console.log('=== stream-json test ===')
console.log('message:', MESSAGE)

const t0 = Date.now()

const proc = spawn(exe, [
  '--resume', SESSION_ID,
  '--output-format', 'stream-json',
  '--print', MESSAGE,
  '--dangerously-skip-permissions',
], {
  env: { ...process.env, CLAUDE_CONFIG_DIR: CONFIG_DIR },
  cwd: os.homedir(),
})

let output = ''
proc.stdout.on('data', d => {
  const s = d.toString()
  output += s
  // print each JSON line as it arrives
  for (const line of s.split('\n').filter(Boolean)) {
    try {
      const e = JSON.parse(line)
      console.log(`[+${Date.now()-t0}ms] type:${e.type} subtype:${e.subtype||''} ${e.type==='assistant' ? JSON.stringify(e.message?.content).slice(0,80) : ''}`)
      if (e.type === 'result') {
        console.log('\n=== RESULT ===')
        console.log('input_tokens:', e.usage?.input_tokens)
        console.log('output_tokens:', e.usage?.output_tokens)
        console.log('cache_read:', e.usage?.cache_read_input_tokens)
        console.log('total_cost_usd:', e.total_cost_usd)
        console.log('duration_ms:', e.duration_ms)
      }
    } catch {}
  }
})
proc.stderr.on('data', d => console.error('stderr:', d.toString()))
proc.on('exit', code => {
  console.log('\nexited:', code, 'total time:', Date.now()-t0, 'ms')
})
