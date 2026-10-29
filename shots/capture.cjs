// Скриншоты для README: настоящий интерфейс на демо-данных (shots/demo-api.js).
// Запуск: npx vite --port 5199 (в корне), затем npx electron shots/capture.cjs [имя]
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

app.commandLine.appendSwitch('force-device-scale-factor', '2')
const OUT = path.join(__dirname, '..', 'docs', 'images')
const BASE = 'http://127.0.0.1:5199/shots/index.html?lang=' + (process.env.SHOT_LANG || 'en')
const LOG = path.join(__dirname, 'capture.log')
fs.writeFileSync(LOG, '')
const _log = console.log
console.log = (...a) => { fs.appendFileSync(LOG, a.join(' ') + '\n'); _log(...a) }
const only = process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.cjs'))
const wait = ms => new Promise(r => setTimeout(r, ms))
setTimeout(() => { console.log('timeout'); app.exit(1) }, 90000)

// Клик по элементу с таким текстом (ближайший кликабельный предок)
const clickText = (text) => `(() => {
  const row = [...document.querySelectorAll('.session-row')].find(r => r.textContent.includes(${JSON.stringify(text)}))
  if (row) { row.click(); return 'row' }
  const all = [...document.querySelectorAll('button, [role=button], a, span, p, div')]
  const el = all.find(e => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(text)})
  if (!el) return 'not found: ' + ${JSON.stringify(text)}
  ;(el.closest('button, [role=button], a') || el).click()
  return 'ok'
})()`

const SHOTS = {
  language: async () => {},
  hero: async w => {
    await js(w, clickText('Settings page freezes on open'))
    await wait(1500)
  },
  chat: async w => {
    await js(w, clickText('Settings page freezes on open'))
    await wait(800)
    await js(w, `(() => { const b = [...document.querySelectorAll('button')].find(b => /шаг|step/.test(b.textContent)); b && b.click(); return !!b })()`)
    await wait(400)
    await js(w, `(() => { const b = [...document.querySelectorAll('button')].filter(b => /ThemePicker/.test(b.textContent)).pop(); b && b.click(); return !!b })()`)
    await wait(800)
  },
  compact: async w => {
    await js(w, clickText('Refactor the export pipeline'))
    await wait(1000)
    await js(w, `(() => { const b = document.querySelector('.chat-compact-summary-toggle'); b && b.click(); return !!b })()`)
    await wait(800)
  },
  accounts: async w => {
    await js(w, `(() => { const b = document.querySelector('[title="Аккаунты"], [aria-label="Аккаунты"]'); if (b) { b.click(); return 'rail' } const c = [...document.querySelectorAll('button')].find(b => b.textContent.includes('main') && b.textContent.includes('@')); c && c.click(); return c ? 'bar' : 'none' })()`)
    await wait(600)
    await js(w, `(() => { const b = [...document.querySelectorAll('button')].find(b => /Manage accounts|Управление аккаунтами/.test(b.textContent)); b && b.click(); return !!b })()`)
    await wait(1500)
  },
}

let errors = []
async function js(w, code) {
  const r = await w.webContents.executeJavaScript(code).catch(e => 'err ' + e.message)
  console.log('  js →', r)
  return r
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  for (const [name, run] of Object.entries(SHOTS)) {
    if (only && only !== name) continue
    const w = new BrowserWindow({ width: 1440, height: 900, show: false, frame: false, backgroundColor: '#121212', webPreferences: { offscreen: true } })
    w.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) errors.push(msg.slice(0, 300)) })
    await w.loadURL(name === 'language' ? BASE.replace(/lang=\w+/, 'lang=none') : BASE)
    await wait(2500)
    console.log(name); await js(w, 'document.body.innerText.slice(0, 400).replace(/\s+/g, " ")')
    await run(w)
    const img = await w.capturePage()
    fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG())
    console.log('  saved', img.getSize())
    w.destroy()
  }
  if (errors.length) console.log('console errors:\n' + [...new Set(errors)].slice(0, 15).join('\n'))
  app.quit()
})
