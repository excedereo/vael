import { contextBridge, ipcRenderer } from 'electron'

export interface NotificationPayload {
  id: string
  kind: 'asking' | 'done' | 'error'
  title: string
  body: string
  sessionId: string
}

export interface NotificationConfig {
  holdMs: number
  /** Не гасить по таймеру — до клика или возвращения в Vael */
  holdForever: boolean
  maxStack: number
  scale: number
  grow: 'up' | 'down'
  /** Путь к звуку относительно notification.html, null — звук выключен */
  soundSrc: string | null
  soundVolume: number
}

contextBridge.exposeInMainWorld('notifyApi', {
  onPush: (cb: (payload: NotificationPayload) => void) => {
    const handler = (_: unknown, payload: NotificationPayload) => cb(payload)
    ipcRenderer.on('notification:push', handler)
    return () => ipcRenderer.removeListener('notification:push', handler)
  },
  onConfig: (cb: (config: NotificationConfig) => void) => {
    const handler = (_: unknown, config: NotificationConfig) => cb(config)
    ipcRenderer.on('notification:config', handler)
    return () => ipcRenderer.removeListener('notification:config', handler)
  },
  /** Vael снова в фокусе — снять все карточки. */
  onClear: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('notification:clear', handler)
    return () => ipcRenderer.removeListener('notification:clear', handler)
  },
  /** Клик по карточке — открыть Vael на этой сессии. */
  activate: (sessionId: string) => ipcRenderer.send('notification:activate', sessionId),
  /** Есть ли сейчас видимые карточки (нужно ли ловить мышь). */
  setInteractive: (interactive: boolean) => ipcRenderer.send('notification:interactive', interactive),
  /** Стопка опустела — окно можно спрятать. */
  notifyEmpty: () => ipcRenderer.send('notification:empty'),
})
