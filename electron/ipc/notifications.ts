import { app, BrowserWindow, ipcMain } from 'electron'
import { onSessionStatusChange, onPtyError } from './pty.js'
import {
  showNotification,
  registerNotificationHandlers,
  applyNotificationSettings,
  clearNotifications,
  type NotificationKind,
  type NotificationSettings,
} from '../services/NotificationWindow.js'

/** sessionId, открытый сейчас в UI — про него не уведомляем, если окно на виду. */
let activeSessionId: string | null = null
/** sessionId → человекочитаемый заголовок сессии (для текста уведомления). */
const sessionTitles = new Map<string, string>()

function titleFor(sessionId: string): string {
  return sessionTitles.get(sessionId) || `Сессия ${sessionId.slice(0, 8)}`
}

/**
 * Уведомлять ли о событии этой сессии.
 *
 * Про открытую сессию не сообщаем — она и так перед глазами. Но если окно
 * свёрнуто или ушло в фон, уведомляем про любую: иначе о готовом ответе
 * узнать неоткуда.
 */
function shouldNotify(sessionId: string, win: BrowserWindow | null): boolean {
  const visible = !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused()
  if (!visible) return true
  return sessionId !== activeSessionId
}

function trim(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export function registerNotificationIpc(getWindow: () => BrowserWindow | null) {
  registerNotificationHandlers((sessionId) => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    // Пустой id — это карточка-превью из настроек, переключать нечего
    if (sessionId) win.webContents.send('notification:open-session', sessionId)
  })

  // Вернулись в Vael — карточки прочитаны. Для holdForever это единственный
  // способ их снять, кроме клика: таймера, который бы их погасил, там нет.
  // Слушаем на уровне app, а не окна: окно могут пересоздать (app.activate),
  // и подписка на конкретный экземпляр потерялась бы.
  app.on('browser-window-focus', (_e, focused) => {
    const main = getWindow()
    if (main && !main.isDestroyed() && focused === main) clearNotifications()
  })

  ipcMain.on('notification:set-active-session', (_, sessionId: string | null) => {
    activeSessionId = sessionId
  })

  ipcMain.on('notification:set-session-title', (_, sessionId: string, title: string) => {
    if (title) sessionTitles.set(sessionId, title)
  })

  ipcMain.on('notification:apply-settings', (_, settings: NotificationSettings) => {
    applyNotificationSettings(settings)
  })

  // Демонстрация всех трёх видов карточек — чтобы настройки можно было
  // подобрать, не дожидаясь реальных событий
  const PREVIEW_SAMPLES: Record<NotificationKind, { title: string; body: string }> = {
    asking: { title: 'Рефакторинг сессий', body: 'Ждёт ответа на вопрос' },
    done:   { title: 'Сборка проекта',     body: 'Готово: собрала проект, ошибок нет' },
    error:  { title: 'Тесты',              body: 'Процесс завершился с кодом 1' },
  }

  ipcMain.on('notification:preview', () => {
    const kinds: NotificationKind[] = ['asking', 'done', 'error']
    kinds.forEach((kind, i) => {
      const s = PREVIEW_SAMPLES[kind]
      setTimeout(() => showNotification({
        id: `preview:${Date.now()}:${i}`,
        kind,
        title: s.title,
        body: s.body,
        sessionId: '',
      }), i * 350)
    })
  })

  // Одиночный показ — посмотреть конкретный тип, не вызывая всю тройку
  ipcMain.on('notification:preview-one', (_, kind: NotificationKind) => {
    const s = PREVIEW_SAMPLES[kind] ?? PREVIEW_SAMPLES.done
    showNotification({
      id: `preview:${Date.now()}`,
      kind,
      title: s.title,
      body: s.body,
      sessionId: '',
    })
  })

  onSessionStatusChange((sessionId, status, prev, replyText) => {
    const win = getWindow()
    if (!shouldNotify(sessionId, win)) return

    let kind: NotificationKind
    let body: string

    if (status === 'asking') {
      kind = 'asking'
      body = 'Ждёт ответа на вопрос'
    } else if (status === 'idle' && prev !== 'idle') {
      kind = 'done'
      body = replyText ? trim(replyText) : 'Ответ готов'
    } else {
      return
    }

    showNotification({
      id: `${sessionId}:${Date.now()}`,
      kind,
      title: titleFor(sessionId),
      body,
      sessionId,
    })
  })

  // Аварийное завершение PTY — сообщаем всегда, даже про открытую сессию
  onPtyError((sessionId, message) => {
    showNotification({
      id: `${sessionId}:err:${Date.now()}`,
      kind: 'error',
      title: titleFor(sessionId),
      body: message,
      sessionId,
    })
  })
}
