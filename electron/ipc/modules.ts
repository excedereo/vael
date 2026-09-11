import { ipcMain } from 'electron'
import type { ModuleRegistry } from '../ModuleRegistry.js'
import { loadQueue, saveQueue, type WakeEntry } from '../modules/heartbeat.js'
import { listAlivePtySessions } from './pty.js'

export function registerModuleHandlers(moduleRegistry: ModuleRegistry) {
  ipcMain.handle('modules:list', () => moduleRegistry.list())
  ipcMain.handle('modules:getSettings', (_, id: string) => moduleRegistry.getSettings(id))
  ipcMain.handle('modules:setSettings', (_, id: string, settings: Record<string, unknown>) => {
    moduleRegistry.setSettings(id, settings)
    return { ok: true }
  })
  ipcMain.handle('modules:start', (_, id: string) => ({ ok: moduleRegistry.start(id) }))
  ipcMain.handle('modules:stop', (_, id: string) => ({ ok: moduleRegistry.stop(id) }))

  // Backward-compat aliases для TgPanel
  ipcMain.handle('tg:getSettings', () => moduleRegistry.getSettings('telegram'))
  ipcMain.handle('tg:setSettings', (_, settings: Record<string, unknown>) => {
    moduleRegistry.setSettings('telegram', settings)
    return { ok: true }
  })
  ipcMain.handle('tg:start', () => ({ ok: moduleRegistry.start('telegram') }))
  ipcMain.handle('tg:stop', () => ({ ok: moduleRegistry.stop('telegram') }))
  ipcMain.handle('tg:reply', (_, chatId: string, text: string) => moduleRegistry.reply('telegram', chatId, text))

  // Вытаскивает chat_id из последних апдейтов бота — чтобы не искать его
  // вручную: достаточно написать боту любое сообщение
  ipcMain.handle('tg:detectChatId', async (_, botToken: string) => {
    if (!botToken) return { ok: false, error: 'нет токена' }
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?offset=-10&timeout=0`)
      const data = await res.json() as {
        ok: boolean
        description?: string
        result?: { message?: { chat?: { id?: number; first_name?: string; username?: string } } }[]
      }
      if (!data.ok) return { ok: false, error: data.description || 'телеграм отказал' }

      const chats = new Map<string, string>()
      for (const u of data.result ?? []) {
        const c = u.message?.chat
        if (c?.id) chats.set(String(c.id), c.username || c.first_name || String(c.id))
      }
      if (chats.size === 0) {
        return { ok: false, error: 'нет сообщений — напиши боту и попробуй снова' }
      }
      return { ok: true, chats: Array.from(chats, ([id, name]) => ({ id, name })) }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
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
      alive: listAlivePtySessions(),
    }
  })
}
