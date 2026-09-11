import fs from 'fs'
import path from 'path'
import os from 'os'
import type { PyreModule, ModuleContext } from './types.js'

// Heartbeat — будит Ваели сама себя.
//
// Смысл модуля: между сообщениями Стралитза у Ваели не существует времени. Она
// включается только когда к ней обращаются. Heartbeat даёт ей «между» — печатает
// [FREE] прямо в живую сессию через тот же ptyWrite, которым пользуется телеграм,
// так что для сессии это выглядит как обычное входящее сообщение.
//
// Побудки ставит и сама Ваели (командой `vael wake ...` из своей же сессии) —
// поэтому очередь лежит в файле, а не в памяти процесса: у неё нет доступа к
// Electron, зато есть шелл. Модуль сторожит файл и подхватывает изменения.

export interface WakeEntry {
  id: string
  /** one — разовая в конкретный момент; every — повторяется с интервалом */
  kind: 'one' | 'every'
  /** для kind=one: когда сработать (epoch ms) */
  at?: number
  /** для kind=every: период в мс */
  intervalMs?: number
  /** для kind=every: когда сработает следующий раз (epoch ms) */
  nextAt?: number
  /** что подставить вместо <text> в шаблоне; пусто — просто фришка */
  text?: string
  /** кто поставил — для отображения в UI */
  source: 'vaeli' | 'user'
  createdAt: number
}

interface HeartbeatSettings {
  enabled: boolean
  autostart?: boolean
  /** сессия, в которую писать; пусто — последняя активная */
  sessionId?: string
  /** шаблон сообщения, плейсхолдеры ниже в renderTemplate */
  template: string
  /** дублировать фришки в телеграм */
  mirrorToTelegram?: boolean
}

const VAEL_DIR = path.join(os.homedir(), '.vael')
const SETTINGS_PATH = path.join(VAEL_DIR, 'heartbeat-settings.json')
const QUEUE_PATH = path.join(VAEL_DIR, 'heartbeat-queue.json')
/**
 * Команды снаружи (`vael hb on/off`, смена сессии). Правки settings-файла мало:
 * модуль читает настройки, но запускать/останавливать себя должен по явному
 * сигналу. Файл появился — выполнили — удалили.
 */
const CONTROL_PATH = path.join(VAEL_DIR, 'heartbeat-control.json')

const DEFAULT_TEMPLATE = '[FREE] прошло <timefromlastmessage> с последнего ответа<text?, >'

/** Тик планировщика. Секунда — точность заведомо выше, чем нужно побудкам. */
const TICK_MS = 1000

/**
 * Сколько ждать освобождения сессии, прежде чем написать всё равно.
 * Тик раз в секунду, так что это же и число попыток.
 */
const BUSY_MAX_WAIT_SEC = 5 * 60

function loadSettings(): HeartbeatSettings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return {
        enabled: false,
        template: DEFAULT_TEMPLATE,
        ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')),
      }
    }
  } catch {}
  return { enabled: false, template: DEFAULT_TEMPLATE }
}

function saveSettings(s: HeartbeatSettings) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf-8')
}

export function loadQueue(): WakeEntry[] {
  try {
    if (fs.existsSync(QUEUE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'))
      if (Array.isArray(raw)) return raw as WakeEntry[]
    }
  } catch {}
  return []
}

export function saveQueue(q: WakeEntry[]) {
  fs.mkdirSync(path.dirname(QUEUE_PATH), { recursive: true })
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2), 'utf-8')
}

/** «2 ч 15 мин», «40 мин», «меньше минуты» — по-русски, без библиотек. */
export function humanizeDuration(ms: number): string {
  if (ms < 60_000) return 'меньше минуты'
  const totalMin = Math.floor(ms / 60_000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60

  const parts: string[] = []
  if (days) parts.push(`${days} ${plural(days, 'день', 'дня', 'дней')}`)
  if (hours) parts.push(`${hours} ч`)
  if (mins && !days) parts.push(`${mins} мин`)
  return parts.join(' ') || 'меньше минуты'
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** Время последнего ответа ассистента в сессии (epoch ms), либо null. */
function readLastAssistantAt(jsonlPath: string): number | null {
  let content: string
  try { content = fs.readFileSync(jsonlPath, 'utf-8') } catch { return null }

  // Идём с конца — последний ответ почти всегда в хвосте файла
  const lines = content.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.trim()) continue
    let d: { type?: string; timestamp?: string; message?: { content?: Array<{ type: string; text?: string }> } }
    try { d = JSON.parse(line) } catch { continue }
    if (d.type !== 'assistant' || !d.timestamp) continue
    const hasText = (d.message?.content || []).some(c => c.type === 'text' && c.text?.trim())
    if (!hasText) continue
    const ts = Date.parse(d.timestamp)
    return Number.isNaN(ts) ? null : ts
  }
  return null
}

/**
 * Подставляет плейсхолдеры в шаблон фришки.
 *
 * <timefromlastmessage> — сколько прошло с моего последнего ответа
 * <time>                — текущее время ЧЧ:ММ
 * <date>                — сегодняшняя дата ДД.ММ.ГГГГ
 * <text>                — текст побудки (может быть пустым)
 * <text?, >             — то же, но с префиксом «, » только если текст есть
 */
export function renderTemplate(template: string, vars: { lastAt: number | null; text?: string }): string {
  const now = new Date()
  const since = vars.lastAt ? humanizeDuration(Date.now() - vars.lastAt) : 'неизвестно сколько'
  const text = (vars.text || '').trim()

  return template
    .replace(/<text\?(.*?)>/g, (_m, prefix: string) => (text ? `${prefix}${text}` : ''))
    .replace(/<timefromlastmessage>/g, since)
    .replace(/<time>/g, now.toTimeString().slice(0, 5))
    .replace(/<date>/g, now.toLocaleDateString('ru-RU'))
    .replace(/<text>/g, text)
    .trim()
}

interface TelegramLike {
  sendReply(chatId: string, text: string): Promise<void>
  getSettings(): Record<string, unknown>
}

export class HeartbeatModule implements PyreModule {
  id = 'heartbeat'
  name = 'Heartbeat'
  icon = 'heart'

  private ctx: ModuleContext | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  /** Опрос управляющего файла — живёт всё время, пока модуль зарегистрирован */
  private controlTimer: ReturnType<typeof setInterval> | null = null
  /** Ожидание живой сессии при автостарте */
  private awaitSessionTimer: ReturnType<typeof setInterval> | null = null
  private queueWatcher: fs.FSWatcher | null = null
  /** id побудки → сколько раз уже откладывали из-за занятой сессии */
  private deferred = new Map<string, number>()
  /** чтобы не сыпать одинаковым предупреждением каждую секунду */
  private warnedNoPty = false

  init(ctx: ModuleContext) {
    this.ctx = ctx
    // Опрос управляющего файла живёт отдельно от тика побудок: он должен
    // работать и при остановленном модуле, иначе `vael hb on` его не поднимет.
    this.controlTimer = setInterval(() => this.pollControl(), 1000)
    const s = loadSettings()
    if (s.autostart) {
      // На старте приложения PTY ещё не подняты, и start() отказался бы.
      // Ждём появления живой сессии — иначе автостарт не сработал бы никогда.
      this.awaitSessionTimer = setInterval(() => {
        if (this.timer) { this.clearAwait(); return }
        if (!this.blockedReason()) { this.clearAwait(); this.start() }
      }, 2000)
    } else if (s.enabled) {
      // enabled означает «тикает прямо сейчас», а не «разрешено». После
      // перезапуска без автостарта модуль не работает — значит и флаг должен
      // быть false, иначе `vael hb show` рапортует «включён», пока панель
      // честно показывает «Остановлено».
      s.enabled = false
      saveSettings(s)
    }
  }

  destroy() {
    // Не через stop(): выход из приложения не должен выглядеть как «выключил
    // модуль» и стирать enabled — иначе автостарт не сработает в следующий раз.
    this.haltTimers()
    if (this.controlTimer) { clearInterval(this.controlTimer); this.controlTimer = null }
    this.ctx = null
  }

  private clearAwait() {
    if (this.awaitSessionTimer) { clearInterval(this.awaitSessionTimer); this.awaitSessionTimer = null }
  }

  /** Гасит таймеры, не трогая настройки. */
  private haltTimers() {
    this.clearAwait()
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    if (this.queueWatcher) { try { this.queueWatcher.close() } catch { }; this.queueWatcher = null }
    this.deferred.clear()
    this.warnedNoPty = false
  }

  /** Забирает команду из heartbeat-control.json, выполняет и удаляет файл. */
  private pollControl() {
    let cmd: { action?: string; sessionId?: string; template?: string } | null = null
    try {
      if (!fs.existsSync(CONTROL_PATH)) return
      cmd = JSON.parse(fs.readFileSync(CONTROL_PATH, 'utf-8'))
    } catch { }
    try { fs.unlinkSync(CONTROL_PATH) } catch { }
    if (!cmd?.action) return

    console.log('[HB] команда извне:', cmd.action)

    if (cmd.action === 'on') {
      const s = loadSettings()
      if (cmd.sessionId !== undefined) s.sessionId = cmd.sessionId
      s.enabled = true
      saveSettings(s)
      this.start()
    } else if (cmd.action === 'off') {
      const s = loadSettings()
      s.enabled = false
      saveSettings(s)
      this.stop()
    } else if (cmd.action === 'set') {
      const s = loadSettings()
      if (cmd.sessionId !== undefined) s.sessionId = cmd.sessionId
      if (cmd.template !== undefined) s.template = cmd.template
      saveSettings(s)
    }

    // UI держит копию настроек в состоянии — просим перечитать
    this.ctx?.sendToWindow('heartbeat:settings-changed', loadSettings())
  }

  getSettings() {
    return loadSettings() as unknown as Record<string, unknown>
  }

  setSettings(settings: Record<string, unknown>) {
    const s = settings as unknown as HeartbeatSettings
    saveSettings(s)
    // haltTimers, а не stop(): stop() записал бы enabled:false поверх того,
    // что мы только что сохранили
    this.haltTimers()
    if (s.enabled) this.start()
  }

  isRunning() {
    return this.timer !== null
  }

  /**
   * Почему модуль сейчас не может работать — строка для UI, либо null если всё
   * в порядке. Держим здесь, а не в панели, чтобы условие было одно на всех.
   */
  blockedReason(): string | null {
    const s = loadSettings()
    const sessionId = this.resolveSessionId(s)
    if (!sessionId) return 'Не выбрана сессия — и нет последней активной'
    if (!this.ctx?.isPtyAlive(sessionId)) return 'Сессия не запущена — откройте её в Vael'
    return null
  }

  start() {
    if (this.timer) return

    // Без живой сессии запускаться бессмысленно: фришки будут копиться в
    // очереди, а пользователь будет думать, что всё работает.
    const blocked = this.blockedReason()
    if (blocked) {
      console.warn('[HB] запуск отклонён:', blocked)
      this.ctx?.sendToWindow('heartbeat:blocked', { reason: blocked })
      return
    }

    // enabled в файле — то же состояние, что и работающий таймер. Если их не
    // синхронизировать, `vael hb show` и панель начинают расходиться: один
    // смотрит в файл, другой на живой модуль.
    const s0 = loadSettings()
    if (!s0.enabled) { s0.enabled = true; saveSettings(s0) }

    fs.mkdirSync(VAEL_DIR, { recursive: true })
    if (!fs.existsSync(QUEUE_PATH)) saveQueue([])

    this.timer = setInterval(() => this.tick(), TICK_MS)

    // Очередь меняется снаружи (Ваели из своей сессии через `vael wake`).
    // Watcher нужен только чтобы UI обновлялся сразу — сам tick всё равно
    // перечитывает файл, так что потеря события ничего не ломает.
    try {
      this.queueWatcher = fs.watch(QUEUE_PATH, { persistent: false }, () => {
        this.ctx?.sendToWindow('heartbeat:queue', loadQueue())
      })
    } catch {}

    this.ctx?.sendToWindow('heartbeat:settings-changed', loadSettings())
    console.log('[HB] heartbeat started')
  }

  stop() {
    const s = loadSettings()
    if (s.enabled) { s.enabled = false; saveSettings(s) }
    this.haltTimers()
    this.ctx?.sendToWindow('heartbeat:settings-changed', loadSettings())
    console.log('[HB] heartbeat stopped')
  }

  /** Сессия, в которую пишем: явно заданная в настройках или последняя активная. */
  private resolveSessionId(s: HeartbeatSettings): string | null {
    return s.sessionId || this.ctx?.getLastSessionId() || null
  }

  private tick() {
    const s = loadSettings()
    if (!s.enabled) return

    const queue = loadQueue()
    if (queue.length === 0) return

    const now = Date.now()
    const due = queue.filter(e => this.dueAt(e) !== null && this.dueAt(e)! <= now)
    if (due.length === 0) return

    const sessionId = this.resolveSessionId(s)
    if (!sessionId) return   // некуда писать — ждём, пока сессия появится

    // Без живого PTY фришка уйдёт в никуда: ptyWrite просто ничего не найдёт.
    // Не сжигаем побудку молча — оставляем в очереди до запуска сессии.
    if (!this.ctx?.isPtyAlive(sessionId)) {
      if (!this.warnedNoPty) {
        this.warnedNoPty = true
        console.warn('[HB] PTY сессии не запущен — побудки ждут в очереди')
        this.ctx?.sendToWindow('heartbeat:no-pty', { sessionId })
      }
      return
    }
    this.warnedNoPty = false

    // Сессия занята — не лезем посреди работы, ждём. Но не бесконечно: если
    // Ваели надолго ушла в длинную задачу, побудка всё равно должна дойти.
    //
    // Ждём в памяти, а не сдвигая время в очереди: для повторяющейся побудки
    // сдвиг nextAt сливал отложенную фришку со следующим кругом, и она просто
    // пропадала. Здесь же запись остаётся просроченной, и каждый тик пробует
    // её снова, пока сессия не освободится.
    const status = this.ctx?.getSessionStatus(sessionId) ?? null
    if (status && status !== 'idle') {
      const stillWaiting = due.filter(e => {
        const tries = (this.deferred.get(e.id) ?? 0) + 1
        this.deferred.set(e.id, tries)
        return tries < BUSY_MAX_WAIT_SEC
      })
      // Пропускаем дальше только те, что ждали слишком долго
      if (stillWaiting.length === due.length) return
    }

    const toFire = status && status !== 'idle'
      ? due.filter(e => (this.deferred.get(e.id) ?? 0) >= BUSY_MAX_WAIT_SEC)
      : due

    for (const entry of toFire) {
      this.deferred.delete(entry.id)
      this.fire(s, sessionId, entry)
    }
    this.consume(toFire.map(e => e.id))
  }

  private dueAt(e: WakeEntry): number | null {
    if (e.kind === 'one') return e.at ?? null
    return e.nextAt ?? null
  }

  /** Убирает сработавшие разовые побудки и переводит интервальные на следующий круг. */
  private consume(firedIds: string[]) {
    const queue = loadQueue()
    const next: WakeEntry[] = []
    for (const e of queue) {
      if (!firedIds.includes(e.id)) { next.push(e); continue }
      if (e.kind === 'every' && e.intervalMs) {
        // Считаем от планового времени, а не от момента доставки: иначе
        // задержка (занятая сессия) накапливалась бы и цикл уплывал.
        // Если отстали больше чем на круг — берём текущее время, чтобы не
        // выстреливать пачкой пропущенных.
        const base = (e.nextAt ?? Date.now()) + e.intervalMs
        next.push({ ...e, nextAt: base > Date.now() ? base : Date.now() + e.intervalMs })
      }
      // kind === 'one' — просто выпадает из очереди
    }
    saveQueue(next)
    this.ctx?.sendToWindow('heartbeat:queue', next)
  }

  private fire(s: HeartbeatSettings, sessionId: string, entry: WakeEntry) {
    if (!this.ctx) return

    const jsonl = this.ctx.findSessionJsonl(sessionId)
    const lastAt = jsonl ? readLastAssistantAt(jsonl) : null
    const message = renderTemplate(s.template || DEFAULT_TEMPLATE, { lastAt, text: entry.text })

    console.log('[HB] wake →', message.slice(0, 80))

    // Как в телеграме: текст и Enter раздельно, иначе CLI считает \r частью вставки
    this.ctx.ptyWrite(sessionId, message)
    setTimeout(() => this.ctx?.ptyWrite(sessionId, '\r'), 60)

    this.ctx.sendToWindow('heartbeat:fired', { entry, message, at: Date.now() })

    if (s.mirrorToTelegram) this.sendToTelegram(`[heartbeat] ${message}`)
  }

  /** Отправить произвольный текст Стралитзу в телеграм через модуль telegram. */
  async sendToTelegram(text: string): Promise<boolean> {
    const tg = this.ctx?.getModule('telegram') as TelegramLike | null
    if (!tg) return false
    const tgSettings = tg.getSettings() as { chatId?: string; botToken?: string }
    if (!tgSettings?.chatId || !tgSettings?.botToken) return false
    try {
      await tg.sendReply(tgSettings.chatId, text)
      return true
    } catch (e) {
      console.error('[HB] telegram send failed:', e)
      return false
    }
  }
}
