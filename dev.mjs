import { spawn } from 'child_process'

let devUrl = null
let electronStarted = false

// Start vite, capture its URL from stdout
const vite = spawn('npx', ['vite'], {
  shell: true,
  env: process.env,
})

vite.stdout.on('data', async (chunk) => {
  const text = chunk.toString()
  process.stdout.write(text)

  // Parse the Local URL line (strip ANSI first)
  const clean = text.replace(/\x1B\[[0-9;]*[mGKHFJABCDsuhlp]/g, '')
  const match = clean.match(/Local:\s+(http:\/\/localhost:\d+)/)
  if (match && !electronStarted) {
    devUrl = match[1]
    electronStarted = true
    console.log(`\nVite ready at ${devUrl}, building electron...`)
    await startElectron(devUrl)
  }
})

vite.stderr.on('data', (chunk) => {
  process.stderr.write(chunk)
})

async function startElectron(url) {
  // Build electron first
  const build = spawn('node', ['electron-build.mjs'], {
    stdio: 'inherit',
    shell: false,
  })

  await new Promise((resolve, reject) => {
    build.on('close', (code) => code === 0 ? resolve() : reject(new Error('Build failed')))
  })

  console.log('Starting Electron...')
  const electron = spawn('electron', ['.'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  })

  electron.on('close', () => {
    vite.kill()
    process.exit(0)
  })
}

process.on('SIGINT', () => {
  vite.kill()
  process.exit(0)
})
