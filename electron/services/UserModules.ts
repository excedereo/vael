import { app, protocol, net } from 'electron'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { createRequire } from 'module'
import os from 'os'
import { PATHS } from './SettingsService.js'
import { isInside } from './Guard.js'

// Модули-страницы: папка в modules/ с module.json и index.html.
// Положил папку — модуль появился в разделе «Модули», страница рисуется
// справа в iframe. Отдаются по своей схеме vael-module://<папка>/..., только
// файлы внутри папки модуля: окну приложения они чужие, доступа к api нет.

// Модули лежат внутри программы: в dev — папка modules в корне проекта, в
// собранной — рядом с exe. В гит не идут (.gitignore): это наши личные модули
export const MODULES_DIR = app.isPackaged
  ? path.join(path.dirname(app.getPath('exe')), 'modules')
  : path.join(app.getAppPath(), 'modules')
export const MODULE_SCHEME = 'vael-module'

export interface UserModuleInfo {
  id: string          // ext:<папка>
  name: string
  description?: string
  icon?: string       // путь к картинке внутри модуля → url схемы
  entry: string       // url страницы
  order: number
}

// Хост у стандартной схемы всегда в нижнем регистре — папки называем так же
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9а-яё_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'module'
const asciiSlug = (s: string) => slug(s).replace(/[^a-z0-9_-]/g, '') || 'module'

/** До app.ready: схема должна быть стандартной, иначе у страниц нет нормального origin и относительных путей */
export function registerModuleScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: MODULE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

function readManifest(dir: string): Record<string, unknown> | null {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'module.json'), 'utf-8')) } catch { return null }
}

export function listUserModules(): UserModuleInfo[] {
  let names: string[] = []
  try { names = fs.readdirSync(MODULES_DIR) } catch { return [] }
  const out: UserModuleInfo[] = []
  for (const folder of names) {
    const dir = path.join(MODULES_DIR, folder)
    try { if (!fs.statSync(dir).isDirectory()) continue } catch { continue }
    // Папка, которую нельзя адресовать хостом url, не откроется — пропускаем
    if (folder !== folder.toLowerCase() || !/^[a-z0-9_-]+$/.test(folder)) continue
    const m = readManifest(dir) ?? {}
    const entry = typeof m.entry === 'string' ? m.entry : 'index.html'
    if (!fs.existsSync(path.join(dir, entry))) continue
    const base = `${MODULE_SCHEME}://${folder}/`
    out.push({
      id: 'ext:' + folder,
      name: typeof m.name === 'string' && m.name ? m.name : folder,
      description: typeof m.description === 'string' ? m.description : undefined,
      icon: typeof m.icon === 'string' && m.icon ? base + m.icon : undefined,
      entry: base + entry,
      order: typeof m.order === 'number' ? m.order : 100,
    })
  }
  return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

export function handleModuleScheme() {
  protocol.handle(MODULE_SCHEME, req => {
    const u = new URL(req.url)
    const file = path.join(MODULES_DIR, u.hostname, decodeURIComponent(u.pathname))
    if (!isInside(file, path.join(MODULES_DIR, u.hostname))) return new Response('not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

/** Следим за папкой: модуль добавили, убрали или поправили module.json — список обновится сам */
export function watchUserModules(onChange: () => void) {
  fs.mkdirSync(MODULES_DIR, { recursive: true })
  let timer: NodeJS.Timeout | null = null
  try {
    fs.watch(MODULES_DIR, { recursive: true }, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(onChange, 300)
    })
  } catch {}
}

const TEMPLATE_HTML = (name: string) => `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${name.replace(/</g, '&lt;')}</title>
<style>
  /* Цвета приходят от Vael сообщением vael:theme — так модуль совпадает с темой */
  :root { --bg-base: #0f1110; --bg-elevated: #171a19; --text-primary: rgba(250,253,251,.87); --text-secondary: rgba(250,253,251,.6); --text-faint: rgba(250,253,251,.35); --accent: #d97757; --border-subtle: rgba(255,255,255,.08); }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body { background: var(--bg-base); color: var(--text-primary); font: 14px/1.5 'Onest', 'Segoe UI', system-ui, sans-serif; padding: 28px 32px; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 6px; }
  p { color: var(--text-secondary); margin: 0 0 18px; }
  .card { padding: 16px 18px; border-radius: 12px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); }
  code { color: var(--accent); }
</style>
</head>
<body>
  <h1>${name.replace(/</g, '&lt;')}</h1>
  <p>Заготовка модуля. Правь эту страницу как обычный сайт — Vael перезагрузит её при сохранении.</p>
  <div class="card">Внешний вид в сайдбаре — в <code>module.json</code>: имя, описание, иконка, порядок.</div>
  <script>
    addEventListener('message', e => {
      if (e.data?.type !== 'vael:theme') return
      for (const [k, v] of Object.entries(e.data.vars)) document.documentElement.style.setProperty(k, v)
    })
  </script>
</body>
</html>
`

const TEMPLATE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#d97757" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>
`

/** Заготовка нового модуля. Возвращает id или ошибку */
export function createUserModule(name: string): { ok: true; id: string } | { ok: false; error: string } {
  const title = String(name ?? '').trim().slice(0, 60)
  if (!title) return { ok: false, error: 'empty name' }
  fs.mkdirSync(MODULES_DIR, { recursive: true })
  const base = asciiSlug(title)
  let folder = base
  for (let i = 2; fs.existsSync(path.join(MODULES_DIR, folder)); i++) folder = `${base}-${i}`
  const dir = path.join(MODULES_DIR, folder)
  fs.mkdirSync(dir)
  const manifest = { name: title, description: 'Новый модуль', icon: 'icon.svg', entry: 'index.html', order: 100 }
  fs.writeFileSync(path.join(dir, 'module.json'), JSON.stringify(manifest, null, 2) + '\n')
  fs.writeFileSync(path.join(dir, 'index.html'), TEMPLATE_HTML(title))
  fs.writeFileSync(path.join(dir, 'icon.svg'), TEMPLATE_ICON)
  return { ok: true, id: 'ext:' + folder }
}

// ── Серверная часть модуля ──────────────────────────────────────────────────
// module.json → "main": "main.cjs". Это обычный CommonJS в main-процессе, с
// полным Node: грузим только из папки modules, то есть свой код владельца.
// Экспорт: activate(ctx) — при загрузке, deactivate() — перед выгрузкой,
// handlers — методы, которые страница зовёт через vael.call(method, ...args)

interface Backend {
  activate?: (ctx: BackendContext) => void
  deactivate?: () => void
  handlers?: Record<string, (...args: unknown[]) => unknown>
}

export interface BackendContext {
  /** Папка модуля */
  dir: string
  /** ~/.vael */
  vaelRoot: string
  /** ~/.claude/CLAUDE.md — общий для всех сессий */
  claudeMd: string
  log: (...args: unknown[]) => void
  /** Сообщить странице модуля: придёт как { type: 'vael:event', name, data } */
  emit: (name: string, data?: unknown) => void
}

const requireCjs = createRequire(import.meta.url)
const backends = new Map<string, { mod: Backend; file: string; mtime: number }>()
let emitToWindow: (moduleId: string, name: string, data: unknown) => void = () => {}

function unloadBackend(id: string) {
  const b = backends.get(id)
  if (!b) return
  try { b.mod.deactivate?.() } catch (e) { console.error(`[module ${id}] deactivate:`, e) }
  delete requireCjs.cache[requireCjs.resolve(b.file)]
  backends.delete(id)
}

/** Загрузить, перезагрузить или выгрузить серверные части по текущему содержимому папки */
export function syncBackends() {
  const want = new Map<string, string>()
  let names: string[] = []
  try { names = fs.readdirSync(MODULES_DIR) } catch {}
  for (const folder of names) {
    const dir = path.join(MODULES_DIR, folder)
    const m = readManifest(dir)
    if (!m || typeof m.main !== 'string') continue
    const file = path.join(dir, m.main)
    if (isInside(file, dir) && fs.existsSync(file)) want.set('ext:' + folder, file)
  }
  for (const id of [...backends.keys()]) {
    const b = backends.get(id)!
    let mtime = 0
    try { mtime = fs.statSync(b.file).mtimeMs } catch {}
    if (want.get(id) !== b.file || mtime !== b.mtime) unloadBackend(id)
  }
  for (const [id, file] of want) {
    if (backends.has(id)) continue
    const dir = path.dirname(file)
    const tag = `[module ${id.slice(4)}]`
    try {
      const mod = requireCjs(file) as Backend
      mod.activate?.({
        dir,
        vaelRoot: PATHS.vael,
        claudeMd: path.join(os.homedir(), '.claude', 'CLAUDE.md'),
        log: (...a) => console.log(tag, ...a),
        emit: (name, data) => emitToWindow(id, name, data),
      })
      backends.set(id, { mod, file, mtime: fs.statSync(file).mtimeMs })
      console.log(tag, 'загружен')
    } catch (e) {
      console.error(tag, 'не загрузился:', e)
      delete requireCjs.cache[file]
    }
  }
}

export function initBackends(emit: typeof emitToWindow) {
  emitToWindow = emit
  syncBackends()
}

export function stopBackends() {
  for (const id of [...backends.keys()]) unloadBackend(id)
}

/** Вызов со страницы модуля: только свои handlers, только по имени */
export async function callBackend(id: string, method: string, args: unknown[]) {
  const fn = backends.get(id)?.mod.handlers?.[method]
  if (typeof fn !== 'function') throw new Error(`нет метода ${method}`)
  return await fn(...(Array.isArray(args) ? args : []))
}

/** Путь папки модуля — для «открыть в проводнике» */
export function userModuleDir(id: string): string | null {
  if (typeof id !== 'string' || !id.startsWith('ext:')) return MODULES_DIR
  const dir = path.join(MODULES_DIR, id.slice(4))
  return isInside(dir, MODULES_DIR) ? dir : null
}
