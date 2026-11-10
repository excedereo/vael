import type { PyreModule, ModuleContext } from './modules/types.js'
import { HeartbeatModule } from './modules/heartbeat.js'
import { listUserModules } from './services/UserModules.js'

export class ModuleRegistry {
  private modules: Map<string, PyreModule> = new Map()
  private ctx: ModuleContext | null = null

  constructor() {
    this.register(new HeartbeatModule())
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

  /** Встроенные модули, а следом страницы из папки modules */
  list() {
    const builtin = Array.from(this.modules.values()).map(m => ({
      id: m.id,
      name: m.name,
      icon: m.icon,
      running: m.isRunning(),
      kind: 'builtin' as const,
    }))
    const pages = listUserModules().map(m => ({
      id: m.id,
      name: m.name,
      icon: m.icon,
      running: true,
      kind: 'page' as const,
      description: m.description,
      entry: m.entry,
    }))
    return [...builtin, ...pages]
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
    if ('start' in mod && typeof (mod as { start?: () => void }).start === 'function') {
      (mod as { start: () => void }).start()
    } else {
      mod.destroy()
      mod.init(this.ctx)
    }
    return true
  }

  stop(id: string) {
    const mod = this.modules.get(id)
    if (!mod) return true
    if ('stop' in mod && typeof (mod as { stop?: () => void }).stop === 'function') {
      (mod as { stop: () => void }).stop()
    } else {
      mod.destroy()
    }
    return true
  }

}
