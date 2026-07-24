import fs from 'fs'
import path from 'path'
import os from 'os'
import type { PyreModule, ModuleContext } from './types.js'

interface TgSettings {
  botToken: string
  chatId: string
  enabled: boolean
  sessionId?: string
  autostart?: boolean
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

async function apiFetch(botToken: string, method: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
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
  private polling = false
  private pollGen = 0
  private pollAbort: AbortController | null = null
  private offset = 0
  private conflictUntil = 0
  // requestId → { resolve, reject, timer }
  private pending = new Map<string, { resolve: (text: string) => void; reject: () => void; timer: ReturnType<typeof setTimeout> }>()

  init(ctx: ModuleContext) {
    this.ctx = ctx
    const s = loadSettings()
    if (s.enabled && s.botToken && s.autostart) {
      const hasSession = !!(s.sessionId || ctx.getLastSessionId())
      if (hasSession) this.startPolling()
      else console.log('[TG] autostart skipped — no active session')
    }
  }

  destroy() {
    this.polling = false
    this.pollAbort?.abort()
    this.pollAbort = null
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject() }
    this.pending.clear()
    this.ctx = null
  }

  getSettings() {
    return loadSettings() as unknown as Record<string, unknown>
  }

  setSettings(settings: Record<string, unknown>) {
    const s = settings as unknown as TgSettings
    saveSettings(s)
    this.polling = false
    this.pollAbort?.abort()
    this.pollAbort = null
    if (s.enabled && s.botToken) this.startPolling()
  }

  isRunning() {
    return this.polling
  }

  start() {
    if (!this.polling) this.startPolling()
  }

  stop() {
    this.polling = false
    this.pollAbort?.abort()
    this.pollAbort = null
  }

  async sendReply(chatId: string, text: string) {
    const s = loadSettings()
    if (!s.botToken) return
    await sendMessage(s.botToken, chatId, text)
  }

  private askSession(sessionId: string, text: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject()
      }, 120_000)
      this.pending.set(requestId, { resolve, reject, timer })

      this.ctx?.subscribeReply(sessionId, (replyText) => {
        const p = this.pending.get(requestId)
        if (!p) return
        clearTimeout(p.timer)
        this.pending.delete(requestId)
        p.resolve(replyText)
      })

      // Текст и Enter шлём раздельно: если отправить их одним куском,
      // Claude CLI трактует финальный \r как перенос строки внутри вставки,
      // а не как отправку. Пауза даёт readline закрыть строку ввода.
      this.ctx?.ptyWrite(sessionId, text)
      setTimeout(() => this.ctx?.ptyWrite(sessionId, '\r'), 60)
    })
  }

  private async startPolling() {
    this.polling = true
    const gen = ++this.pollGen
    console.log('[TG] long polling started')
    // Пропускаем накопившиеся сообщения — берём текущий offset
    try {
      const s = loadSettings()
      const data = await apiFetch(s.botToken, 'getUpdates', { offset: -1, timeout: 0, limit: 1 }) as { ok: boolean; result: { update_id: number }[] }
      if (data.ok && data.result?.length) {
        this.offset = data.result[data.result.length - 1].update_id + 1
      }
    } catch {}
    this.pollLoop(gen)
  }

  private async pollLoop(gen: number) {
    while (this.polling && this.pollGen === gen) {
      const s = loadSettings()
      if (!s.botToken) { console.log('[TG] stop: no botToken'); this.polling = false; break }
      if (Date.now() < this.conflictUntil) {
        await new Promise(r => setTimeout(r, this.conflictUntil - Date.now()))
        continue
      }
      await this.poll()
    }
    console.log(`[TG] long polling stopped (gen=${gen} current=${this.pollGen} polling=${this.polling})`)
  }

  private async poll() {
    const s = loadSettings()
    this.pollAbort = new AbortController()
    try {
      const data = await apiFetch(s.botToken, 'getUpdates', { offset: this.offset, timeout: 30, limit: 10 }, this.pollAbort.signal) as {
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
          await new Promise(r => setTimeout(r, 3000))
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

        if (text.trim() === '/getctx') {
          this.handleGetCtx(s, chatId).catch(e => console.error('[TG] handleGetCtx error:', e))
          continue
        }

        this.handleMessage(s, chatId, text, filePath).catch(e => console.error('[TG] handleMessage error:', e))
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') { console.log('[TG] stop: aborted'); return }
      console.error('[TG] poll error:', e)
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  private async handleGetCtx(s: TgSettings, chatId: string) {
    const sessionId = s.sessionId || this.ctx?.getLastSessionId() || null
    if (!sessionId) { await sendMessage(s.botToken, chatId, 'Нет активной сессии'); return }

    this.ensureWatcher(sessionId)

    try {
      const reply = await this.askSession(sessionId, '/context')
      // reply — ответ ассистента после /context, ищем строку с токенами
      const match = reply.match(/([\d.]+k\s*\/\s*[\d.]+k\s*\(\d+%\))/)
      const tokLine = match ? match[1].trim() : null
      await sendMessage(s.botToken, chatId,
        `Контекст сессии ${sessionId.slice(0, 8)}…\n` +
        (tokLine ? tokLine : reply.slice(0, 300))
      )
    } catch {
      await sendMessage(s.botToken, chatId, 'Нет ответа от сессии (таймаут)')
    }
  }

  private ensureWatcher(sessionId: string) {
    if (!this.ctx) return
    const activeId = this.ctx.accountManager.getActiveAccountId()
    if (!activeId) return
    const sessions = this.ctx.accountManager.getSessionsForAccount(activeId)
    const session = sessions.find(s => s.id === sessionId)
    if (!session) return
    const jsonlPath = path.join(session.projectPath, `${sessionId}.jsonl`)
    this.ctx.watchSession(sessionId, jsonlPath)
  }

  private async handleMessage(s: TgSettings, chatId: string, text: string, filePath: string | null) {
    if (!this.ctx) return
    let prompt = text || ''
    if (filePath) prompt = filePath + (text ? `\n${text}` : '')
    if (!prompt) return

    const sessionId = s.sessionId || this.ctx.getLastSessionId() || null
    if (!sessionId) { console.warn('[TG] no sessionId'); return }

    this.ensureWatcher(sessionId)

    try {
      const reply = await this.askSession(sessionId, prompt)
      if (reply) await sendMessage(s.botToken, chatId, reply)
    } catch {
      console.warn('[TG] no reply received (timeout or no active session)')
    }
  }
}
