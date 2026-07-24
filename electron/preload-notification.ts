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
  maxStack: number
  scale: number
  grow: 'up' | 'down'
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
  /** Клик по карточке — открыть Vael на этой сессии. */
  activate: (sessionId: string) => ipcRenderer.send('notification:activate', sessionId),
  /** Есть ли сейчас видимые карточки (нужно ли ловить мышь). */
  setInteractive: (interactive: boolean) => ipcRenderer.send('notification:interactive', interactive),
  /** Стопка опустела — окно можно спрятать. */
  notifyEmpty: () => ipcRenderer.send('notification:empty'),
})
