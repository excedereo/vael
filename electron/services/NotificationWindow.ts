import { BrowserWindow, screen, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export type NotificationKind = 'asking' | 'done' | 'error'

export interface NotificationPayload {
  id: string
  kind: NotificationKind
  title: string
  body: string
  sessionId: string
}

export type NotificationCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface NotificationSettings {
  enabled: boolean
  corner: NotificationCorner
  width: number
  scale: number
  maxStack: number
  holdSeconds: number
  holdForever: boolean
  soundEnabled: boolean
  soundFile: string
  soundVolume: number
}

const BASE_CARD_HEIGHT = 78
const GAP = 8
const MARGIN = 16

let settings: NotificationSettings = {
  enabled: true,
  corner: 'bottom-right',
  width: 340,
  scale: 1.15,
  maxStack: 5,
  holdSeconds: 5,
  holdForever: false,
  soundEnabled: true,
  soundFile: 'norification.mp3',
  soundVolume: 0.6,
}

let win: BrowserWindow | null = null
let onActivate: ((sessionId: string) => void) | null = null

function cardHeight() {
  return Math.round(BASE_CARD_HEIGHT * settings.scale)
}

/**
 * Сколько карточек физически влезает в рабочую область экрана.
 * Настройка maxStack ограничивается этим числом — иначе стопка уехала бы
 * за пределы экрана и верхние карточки стали бы невидимыми.
 */
export function maxStackForScreen(scale = settings.scale): number {
  const { workArea } = screen.getPrimaryDisplay()
  const h = Math.round(BASE_CARD_HEIGHT * scale) + GAP
  return Math.max(1, Math.floor((workArea.height - MARGIN * 2) / h))
}

function effectiveStack() {
  return Math.min(settings.maxStack, maxStackForScreen())
}

function windowBounds() {
  const { workArea } = screen.getPrimaryDisplay()
  const width = settings.width + MARGIN * 2
  const height = effectiveStack() * (cardHeight() + GAP) + MARGIN
  const right = settings.corner.endsWith('right')
  const top = settings.corner.startsWith('top')

  return {
    width,
    height,
    x: right ? workArea.x + workArea.width - width : workArea.x,
    y: top ? workArea.y : workArea.y + workArea.height - height,
  }
}

function ensureWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win

  const bounds = windowBounds()

  win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: false,          // не крадём фокус у активного окна
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      // После сборки main.js, preload'ы и html лежат плоско в dist-electron/
      preload: path.join(__dirname, 'preload-notification.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Окно нефокусируемое и клика в нём может не быть никогда — без этого
      // Chromium заблокирует звук уведомления политикой автоплея
      autoplayPolicy: 'no-user-gesture-required',
    },
  })

  // Поверх полноэкранных окон тоже
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.loadFile(path.join(__dirname, 'notification.html'))

  // Окно могут уничтожить (выключение уведомлений) до конца загрузки —
  // проверяем, что оно ещё живо, иначе emit прилетит в мёртвый объект
  win.webContents.once('did-finish-load', () => {
    if (win && !win.isDestroyed()) pushConfig()
  })

  // Пока карточек нет — окно пропускает мышь насквозь. Без { forward: true },
  // иначе прозрачное окно форвардит каждое движение курсора и он дёргается.
  win.setIgnoreMouseEvents(true)

  win.on('closed', () => { win = null })

  return win
}

/** Регистрирует IPC-каналы окна уведомлений. Вызывается один раз при старте. */
export function registerNotificationHandlers(activate: (sessionId: string) => void) {
  onActivate = activate

  // Клик по карточке — открыть Vael на нужной сессии
  ipcMain.on('notification:activate', (_, sessionId: string) => {
    onActivate?.(sessionId)
  })

  // Рендерер сообщает, есть ли сейчас карточки под курсором: когда стопка
  // пуста, окно должно пропускать клики насквозь, иначе оно невидимым
  // прямоугольником перехватывало бы мышь над десктопом.
  ipcMain.on('notification:interactive', (_, interactive: boolean) => {
    if (!win || win.isDestroyed()) return
    if (interactive) {
      // Курсор над карточкой — окно ловит мышь (для hover-крестика)
      win.setIgnoreMouseEvents(false)
    } else {
      // Карточки есть, но курсор не над ними — клики проходят насквозь.
      // ВАЖНО: без { forward: true }. forward заставляет прозрачное always-on-top
      // окно хит-тестить и пересылать КАЖДОЕ движение мыши в систему — это давало
      // глобальное дёрганье курсора даже при свёрнутом приложении. Простой
      // ignore без forward пропускает мышь и мышь не трогает.
      win.setIgnoreMouseEvents(true)
    }
  })

  ipcMain.on('notification:empty', () => {
    // Карточек не осталось — окно полностью убираем из хит-теста мыши
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(true)
      win.hide()
    }
  })

  // Сколько карточек влезает на экран — чтобы UI настроек не давал выставить больше
  ipcMain.handle('notification:max-stack', (_, scale: number) => maxStackForScreen(scale))

  // Рабочая область экрана в тех же единицах (DIP), в которых считается
  // позиция окна уведомлений. Превью в настройках берёт её отсюда, а не
  // угадывает 1920: при масштабировании Windows логический размер меньше
  // физического, и карточка занимает заметно большую долю экрана
  ipcMain.handle('notification:work-area', () => {
    const { workArea, scaleFactor } = screen.getPrimaryDisplay()
    return { width: workArea.width, height: workArea.height, scaleFactor }
  })

  // Список звуков — читаем папку, чтобы добавленный файл появился в настройках
  // сам, без правки кода
  ipcMain.handle('notification:sounds', () => {
    try {
      return fs.readdirSync(path.join(__dirname, 'sounds'))
        .filter(f => /\.(mp3|wav|ogg|m4a)$/i.test(f))
        .sort()
    } catch {
      return []
    }
  })
}

/**
 * Единственный способ послать что-либо в окно уведомлений. Проверяет живость
 * окна И webContents — чтобы отложенные колбэки (did-finish-load, showInactive)
 * не били по уничтоженному объекту. Все отправки идут ТОЛЬКО через него, иначе
 * снова легко забыть проверку и уронить main-процесс.
 */
function sendToNotify(channel: string, ...args: unknown[]): boolean {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return false
  win.webContents.send(channel, ...args)
  return true
}

/** Передаёт текущие настройки в окно (размеры, направление роста стопки, таймер). */
function pushConfig() {
  sendToNotify('notification:config', {
    holdMs: settings.holdSeconds * 1000,
    /* Бессрочно — карточка живёт до клика по ней, крестика или открытия Vael */
    holdForever: settings.holdForever,
    maxStack: effectiveStack(),
    scale: settings.scale,
    /* Снизу карточки растут вверх, сверху — вниз */
    grow: settings.corner.startsWith('top') ? 'down' : 'up',
    /* sounds/ лежит рядом с notification.html — оба копируются в dist-electron */
    soundSrc: settings.soundEnabled ? `sounds/${settings.soundFile}` : null,
    soundVolume: settings.soundVolume,
  })
}

export function applyNotificationSettings(next: NotificationSettings) {
  settings = { ...settings, ...next }

  if (!settings.enabled) {
    destroyNotificationWindow()
    return
  }

  if (win && !win.isDestroyed()) {
    win.setBounds(windowBounds())
    pushConfig()
  }
}

export function showNotification(payload: NotificationPayload) {
  if (!settings.enabled) return
  const target = ensureWindow()
  const send = () => {
    if (!win || win.isDestroyed()) return
    win.showInactive()   // показываем, не забирая фокус
    sendToNotify('notification:push', payload)
  }

  if (target.webContents.isLoading()) {
    target.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

/**
 * Убирает все карточки со экрана. Нужно для режима holdForever: карточка висит
 * бессрочно, и «прочитанной» её делает не таймер, а то, что пользователь
 * вернулся в Vael.
 */
export function clearNotifications() {
  sendToNotify('notification:clear')
}

export function destroyNotificationWindow() {
  if (win && !win.isDestroyed()) win.destroy()
  win = null
}
