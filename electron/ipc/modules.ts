import { ipcMain, shell } from 'electron'
import fs from 'fs'
import { createUserModule, userModuleDir, callBackend, MODULES_DIR } from '../services/UserModules.js'
import type { ModuleRegistry } from '../ModuleRegistry.js'
import { loadQueue, saveQueue, type WakeEntry } from '../modules/heartbeat.js'
import { listAlivePtySessions } from './pty.js'
import { listChatSessions } from '../services/ChatService.js'

export function registerModuleHandlers(moduleRegistry: ModuleRegistry) {
  ipcMain.handle('modules:list', () => moduleRegistry.list())
  ipcMain.handle('modules:getSettings', (_, id: string) => moduleRegistry.getSettings(id))
  ipcMain.handle('modules:setSettings', (_, id: string, settings: Record<string, unknown>) => {
    moduleRegistry.setSettings(id, settings)
    return { ok: true }
  })
  ipcMain.handle('modules:start', (_, id: string) => ({ ok: moduleRegistry.start(id) }))
  ipcMain.handle('modules:stop', (_, id: string) => ({ ok: moduleRegistry.stop(id) }))

  // Страницы-модули: заготовка из раздела и папка в проводнике
  ipcMain.handle('modules:create', (_, name: string) => {
    try { return createUserModule(name) } catch (err) { return { ok: false, error: String((err as Error).message) } }
  })
  // Страница модуля зовёт свою серверную часть. Ошибку отдаём текстом, а не исключением
  ipcMain.handle('modules:call', async (_, id: string, method: string, args: unknown[]) => {
    if (typeof id !== 'string' || typeof method !== 'string') return { ok: false, error: 'bad call' }
    try { return { ok: true, result: await callBackend(id, method, args) } }
    catch (err) { return { ok: false, error: String((err as Error)?.message ?? err) } }
  })
  ipcMain.handle('modules:openFolder', async (_, id?: string) => {
    const dir = userModuleDir(id ?? '')
    if (!dir) return
    fs.mkdirSync(MODULES_DIR, { recursive: true })
    await shell.openPath(dir)
  })

  // Heartbeat — очередь побудок. Правится и из UI, и снаружи (`vael wake`),
  // поэтому источник правды всегда файл, а не состояние в памяти.
  ipcMain.handle('heartbeat:queue', () => loadQueue())
  ipcMain.handle('heartbeat:cancel', (_, id: string) => {
    saveQueue(loadQueue().filter(e => e.id !== id))
    return { ok: true }
  })
  ipcMain.handle('heartbeat:add', (_, entry: WakeEntry) => {
    saveQueue([...loadQueue(), entry])
    return { ok: true }
  })
  ipcMain.handle('heartbeat:clear', () => {
    saveQueue([])
    return { ok: true }
  })
  // Почему модуль не может работать + какие сессии вообще живы — панель
  // показывает это предупреждением и подсказкой в выпадашке
  ipcMain.handle('heartbeat:health', () => {
    const mod = moduleRegistry.get('heartbeat') as { blockedReason?: () => string | null } | null
    return {
      blocked: mod?.blockedReason?.() ?? null,
      alive: [...listAlivePtySessions(), ...listChatSessions()],
    }
  })
}
