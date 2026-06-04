import fs from 'fs'
import path from 'path'
import os from 'os'
import type { PyreModule, ModuleContext } from './types.js'
import { ClaudeRunner } from '../ClaudeRunner.js'

interface TgSettings {
  botToken: string
  chatId: string
  enabled: boolean
  sessionId?: string
  model?: string
  effort?: string
}

const SETTINGS_PATH = path.join(os.homedir(), '.vael', 'tg-settings.json')
const TEMP_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'vael', 'temp')

function loadSettings(): TgSettings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return { botToken: '', chatId: '', enabled: false, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) }
    }
  } catch {}
  return { botToken: '', chatId: '', enabled: false }
}

function saveSettings(s: TgSettings) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf-8')
}

async function apiFetch(botToken: string, method: string, body?: Record<string, unknown>): Promise<unknown> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

async function sendMessage(botToken: string, chatId: string, text: string) {
  const limit = 4096
  const parts: string[] = []
  let remaining = text
  while (remaining.length > limit) {
    const idx = remaining.lastIndexOf('\n', limit) !== -1 ? remaining.lastIndexOf('\n', limit) : limit
    parts.push(remaining.slice(0, idx))
    remaining = remaining.slice(idx).trimStart()
  }
  if (remaining) parts.push(remaining)
  for (const part of parts) {
    try { await apiFetch(botToken, 'sendMessage', { chat_id: chatId, text: part }) }
    catch (e) { console.error('[TG] sendMessage error:', e) }
  }
}

async function sendFile(botToken: string, chatId: string, filePath: string) {
  try {
    const buf = fs.readFileSync(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const isImage = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)
    const formData = new FormData()
    formData.append('chat_id', chatId)
    formData.append(isImage ? 'photo' : 'document', new Blob([buf]), path.basename(filePath))
    await fetch(`https://api.telegram.org/bot${botToken}/${isImage ? 'sendPhoto' : 'sendDocument'}`, {
      method: 'POST', body: formData,
    })
  } catch (e) {
    console.error('[TG] sendFile error:', e)
    await sendMessage(botToken, chatId, `[файл: ${path.basename(filePath)}]`)
  }
}

export class TelegramModule implements PyreModule {
  id = 'telegram'
  name = 'Telegram'
  icon = 'tg'

  private ctx: ModuleContext | null = null
  private runner = new ClaudeRunner()
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private offset = 0
  private conflictUntil = 0

  init(ctx: ModuleContext) {
    this.ctx = ctx
    const s = loadSettings()
    if (s.enabled && s.botToken) this.startPolling()
  }

  destroy() {
    this.stopPolling()
    this.ctx = null
  }

  getSettings() {
    return loadSettings() as unknown as Record<string, unknown>
  }

  setSettings(settings: Record<string, unknown>) {
    const s = settings as unknown as TgSettings
    saveSettings(s)
    this.stopPolling()
    if (s.enabled && s.botToken) this.startPolling()
  }

  isRunning() {
    return this.pollInterval !== null
  }

  private startPolling() {
    if (this.pollInterval) return
    console.log('[TG] polling started')
    this.pollInterval = setInterval(() => this.poll(), 2000)
  }

  private stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
      console.log('[TG] polling stopped')
    }
  }

  private async poll() {
    const s = loadSettings()
    if (!s.botToken || !s.enabled) { this.stopPolling(); return }
    if (Date.now() < this.conflictUntil) return
    try {
      const data = await apiFetch(s.botToken, 'getUpdates', { offset: this.offset, timeout: 0, limit: 10 }) as {
        ok: boolean; error_code?: number; result: {
          update_id: number
          message?: {
            chat: { id: number }
            text?: string
            caption?: string
            photo?: { file_id: string }[]
            document?: { file_id: string; file_name?: string }
          }
        }[]
      }
      if (!data.ok) {
        if (data.error_code === 409) {
          this.conflictUntil = Date.now() + 15000
          console.warn('[TG] 409 conflict, backing off 15s')
        } else {
          console.warn('[TG] getUpdates not ok:', JSON.stringify(data))
        }
        return
      }
      if (!data.result?.length) return
      console.log('[TG] got', data.result.length, 'updates, offset was', this.offset)
      for (const update of data.result) {
        this.offset = update.update_id + 1
        const msg = update.message
        if (!msg) continue
        const chatId = String(msg.chat.id)
        if (s.chatId && chatId !== s.chatId) continue

        let filePath: string | null = null
        try {
          let fileId: string | null = null
          let fileName: string | null = null
          if (msg.photo?.length) {
            fileId = msg.photo[msg.photo.length - 1].file_id
            fileName = `tg_photo_${Date.now()}.jpg`
          } else if (msg.document) {
            fileId = msg.document.file_id
            fileName = msg.document.file_name || `tg_doc_${Date.now()}`
          }
          if (fileId && fileName) {
            const fileInfo = await apiFetch(s.botToken, 'getFile', { file_id: fileId }) as { ok: boolean; result?: { file_path?: string } }
            if (fileInfo.ok && fileInfo.result?.file_path) {
              const fileUrl = `https://api.telegram.org/file/bot${s.botToken}/${fileInfo.result.file_path}`
              const resp = await fetch(fileUrl)
              const buf = Buffer.from(await resp.arrayBuffer())
              fs.mkdirSync(TEMP_DIR, { recursive: true })
              filePath = path.join(TEMP_DIR, `${Date.now()}_${fileName}`)
              fs.writeFileSync(filePath, buf)
            }
          }
        } catch (e) { console.error('[TG] file download error:', e) }

        const text = msg.text || msg.caption || ''
        if (!text && !filePath) continue

        console.log('[TG] incoming:', (text || '[file]').slice(0, 80))
        this.handleMessage(s, chatId, text, filePath).catch(e => console.error('[TG] handleMessage error:', e))
      }
    } catch (e) { console.error('[TG] poll error:', e) }
  }

  private async handleMessage(s: TgSettings, chatId: string, text: string, filePath: string | null) {
    if (!this.ctx) return
    let prompt = text || ''
    if (filePath) prompt = filePath + (text ? `\n${text}` : '')
    if (!prompt) return

    const sessionId = s.sessionId || this.ctx.getLastSessionId() || null
    const model = s.model || 'claude-sonnet-4-6'
    const effort = s.effort || null
    const configDir = this.ctx.getLastConfigDir()
    if (!configDir) { console.warn('[TG] no configDir'); return }

    console.log('[TG] sending to Claude, session:', sessionId || 'new', 'configDir:', configDir)

    this.ctx.claudeRunner.abort()
    const chunks: string[] = []

    await new Promise<void>((resolve) => {
      const onEvent = (event: import('../../shared/types.js').StreamEvent) => {
        if (event.type === 'assistant') {
          const content = (event as unknown as { message?: { content?: { type: string; text: string }[] } }).message?.content
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text') chunks.push(block.text)
            }
          }
        }
      }
      const onDone = () => resolve()
      if (sessionId) {
        this.runner.sendMessage(sessionId, prompt, configDir, model, effort, 'bypassPermissions', onEvent, onDone)
      } else {
        this.runner.startNewSession(prompt, configDir, model, effort, 'bypassPermissions', onEvent, onDone)
      }
    })

    const reply = chunks.join('')
    console.log('[TG] reply:', reply.slice(0, 80))
    if (reply) await sendMessage(s.botToken, chatId, reply)

    if (sessionId) this.ctx.sendToWindow('session:reload', sessionId)
  }
}
