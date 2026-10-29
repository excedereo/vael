import { ipcMain, BrowserWindow, dialog } from 'electron'
import type { ChatStartOptions } from '../../shared/types.js'
import { initChatService, startChat, sendChatMessage, control, killChat, isChatAlive, describeChats, getChatInit, getAccountLimits } from '../services/ChatService.js'
import { readAttachment } from '../services/ChatAttachments.js'
import { readChatHistory, readCompactTail, readSummaries } from '../services/ChatHistory.js'

export function registerChatHandlers(getWindow: () => BrowserWindow | null) {
  initChatService(getWindow)

  ipcMain.handle('chat:start', async (_, opts: ChatStartOptions) => {
    const sessionId = await startChat(opts)
    return { ok: true, sessionId }
  })

  ipcMain.handle('chat:send', (_, sessionId: string, content: string | unknown[]) => {
    return { ok: sendChatMessage(sessionId, content) }
  })

  ipcMain.handle('chat:init', (_, sessionId: string) => getChatInit(sessionId))

  ipcMain.handle('limits:get', (_, configDir: string | null) => getAccountLimits(configDir))

  // Размер контекста без единого сообщения — тот же расчёт, что у /context, но молча
  ipcMain.handle('chat:contextUsage', async (_, sessionId: string) => {
    try {
      const r = await control(sessionId, { subtype: 'get_context_usage' }, 20000)
      return { ok: true, totalTokens: r.totalTokens as number, maxTokens: r.maxTokens as number }
    } catch (err) { return { ok: false, error: String((err as Error).message) } }
  })

  ipcMain.handle('chat:readAttachments', (_, paths: string[]) => paths.map(readAttachment))

  ipcMain.handle('chat:pickFiles', async () => {
    const win = getWindow()
    const opts = { properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'> }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? [] : r.filePaths
  })

  ipcMain.handle('chat:interrupt', async (_, sessionId: string) => {
    try { await control(sessionId, { subtype: 'interrupt' }); return { ok: true } }
    catch (err) { return { ok: false, error: String((err as Error).message) } }
  })

  ipcMain.handle('chat:setModel', async (_, sessionId: string, model: string) => {
    try {
      const r = await control(sessionId, { subtype: 'set_model', model })
      return { ok: true, model: (r.model as string | undefined) ?? model }
    } catch (err) { return { ok: false, error: String((err as Error).message) } }
  })

  ipcMain.handle('chat:setPermissionMode', async (_, sessionId: string, mode: string) => {
    try {
      const r = await control(sessionId, { subtype: 'set_permission_mode', mode })
      return { ok: true, mode: (r.mode as string | undefined) ?? mode }
    } catch (err) { return { ok: false, error: String((err as Error).message) } }
  })

  ipcMain.handle('chat:kill', async (_, sessionId: string) => {
    await killChat(sessionId)
    return { ok: true }
  })

  ipcMain.handle('chat:alive', (_, sessionId: string) => ({ alive: isChatAlive(sessionId) }))

  ipcMain.handle('chat:list', () => describeChats())

  ipcMain.handle('chat:history', (_, jsonlPath: string) => readChatHistory(jsonlPath))
  ipcMain.handle('chat:compactFiles', (_, jsonlPath: string, pre?: number) => readCompactTail(jsonlPath, pre))
  ipcMain.handle('chat:summaries', (_, jsonlPath: string) => readSummaries(jsonlPath))
}
