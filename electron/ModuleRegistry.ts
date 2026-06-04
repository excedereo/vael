import type { PyreModule, ModuleContext } from './modules/types.js'
import { TelegramModule } from './modules/telegram.js'

interface ReplyableModule extends PyreModule {
  sendReply(chatId: string, text: string): Promise<void>
}

export class ModuleRegistry {
  private modules: Map<string, PyreModule> = new Map()
  private ctx: ModuleContext | null = null

  constructor() {
    this.register(new TelegramModule())
  }

  private register(mod: PyreModule) {
    this.modules.set(mod.id, mod)
  }

  init(ctx: ModuleContext) {
    this.ctx = ctx
    for (const mod of this.modules.values()) {
      mod.init(ctx)
    }
  }

  destroy() {
    for (const mod of this.modules.values()) {
      mod.destroy()
    }
  }

  list() {
    return Array.from(this.modules.values()).map(m => ({
      id: m.id,
      name: m.name,
      icon: m.icon,
      running: m.isRunning(),
    }))
  }

  get(id: string) {
    return this.modules.get(id) ?? null
  }

  getSettings(id: string) {
    return this.modules.get(id)?.getSettings() ?? null
  }

  setSettings(id: string, settings: Record<string, unknown>) {
    this.modules.get(id)?.setSettings(settings)
  }

  start(id: string) {
    const mod = this.modules.get(id)
    if (!mod || !this.ctx) return false
    mod.destroy()
    mod.init(this.ctx)
    return true
  }

  stop(id: string) {
    this.modules.get(id)?.destroy()
    return true
  }

  reply(moduleId: string, chatId: string, text: string) {
    const mod = this.modules.get(moduleId)
    if (mod && 'sendReply' in mod) return (mod as ReplyableModule).sendReply(chatId, text)
    return Promise.resolve()
  }
}
