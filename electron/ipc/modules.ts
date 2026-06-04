import { ipcMain } from 'electron'
import type { ModuleRegistry } from '../ModuleRegistry.js'

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
}
