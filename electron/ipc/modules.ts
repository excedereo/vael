import { ipcMain } from 'electron'
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
