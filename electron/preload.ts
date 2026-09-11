import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Accounts
  getAccounts: () => ipcRenderer.invoke('accounts:get'),
  createAccount: (id: string) => ipcRenderer.invoke('accounts:create', id),
  deleteAccount: (id: string) => ipcRenderer.invoke('accounts:delete', id),
  logoutAccount: (id: string) => ipcRenderer.invoke('accounts:logout', id),
  openAuth: (configDir: string) => ipcRenderer.invoke('accounts:openAuth', configDir),
  checkCredentials: (configDir: string) => ipcRenderer.invoke('accounts:checkCredentials', configDir),
  getAuthInfo: (configDir: string) => ipcRenderer.invoke('accounts:authInfo', configDir),
  checkNetwork: () => ipcRenderer.invoke('network:check'),

  // Sessions
  getSessions: (accountId: string) => ipcRenderer.invoke('sessions:get', accountId),
  readSession: (sessionPath: string) => ipcRenderer.invoke('sessions:read', sessionPath),
  deleteSession: (sessionPath: string) => ipcRenderer.invoke('sessions:delete', sessionPath),
  readSessionMeta: (jsonlPath: string) => ipcRenderer.invoke('session:readMeta', jsonlPath),
  writeSessionMeta: (jsonlPath: string, patch: Record<string, unknown>) => ipcRenderer.invoke('session:writeMeta', jsonlPath, patch),
  getSessionInfo: (jsonlPath: string) => ipcRenderer.invoke('session:info', jsonlPath),
  findNewSessions: (configDir: string, excludeIds: string[]) => ipcRenderer.invoke('sessions:findNew', configDir, excludeIds),
  importSessions: (configDir: string) => ipcRenderer.invoke('sessions:import', configDir),
  saveAttachment: (buffer: ArrayBuffer, filename: string) => ipcRenderer.invoke('attachments:save', buffer, filename),
  clipboardRead: () => ipcRenderer.invoke('clipboard:read'),
  attachmentsGetDirSize: () => ipcRenderer.invoke('attachments:getDirSize'),
  attachmentsClear: (maxAgeDays?: number) => ipcRenderer.invoke('attachments:clear', maxAgeDays),
  attachmentsOpenFolder: () => ipcRenderer.invoke('attachments:openFolder'),

  // Account switch (sync + set active)
  switchAccount: (fromId: string, toId: string) => ipcRenderer.invoke('account:switch', fromId, toId),
  setActiveAccount: (id: string) => ipcRenderer.invoke('account:setActive', id),

  // Abort running process
  abortRun: () => ipcRenderer.invoke('claude:abort'),

  // PTY terminal
  ptySpawn: (termId: string, sessionId: string, projectPath: string, configDir: string, cols: number, rows: number, model?: string, effort?: string, permissionMode?: string) =>
    ipcRenderer.invoke('pty:spawn', termId, sessionId, projectPath, configDir, cols, rows, model, effort, permissionMode),
  ptyWrite: (termId: string, data: string) => ipcRenderer.send('pty:write', termId, data),
  ptyResize: (termId: string, cols: number, rows: number) => ipcRenderer.invoke('pty:resize', termId, cols, rows),
  ptyKill: (termId: string) => ipcRenderer.invoke('pty:kill', termId),
  ptyAlive: (termId: string) => ipcRenderer.invoke('pty:alive', termId),
  onPtyData: (cb: (termId: string, data: string) => void) => {
    const handler = (_: unknown, termId: string, data: string) => cb(termId, data)
    ipcRenderer.on('pty:data', handler)
    return () => ipcRenderer.removeListener('pty:data', handler)
  },
  onPtyExit: (cb: (termId: string) => void) => {
    const handler = (_: unknown, termId: string) => cb(termId)
    ipcRenderer.on('pty:exit', handler)
    return () => ipcRenderer.removeListener('pty:exit', handler)
  },

  // Native console window (Win32 SetParent embedding)
  nconSpawn: (sessionPath: string, x: number, y: number, w: number, h: number) =>
    ipcRenderer.invoke('ncon:spawn', sessionPath, x, y, w, h),
  nconMove: (x: number, y: number, w: number, h: number) =>
    ipcRenderer.invoke('ncon:move', x, y, w, h),
  nconKill: () => ipcRenderer.invoke('ncon:kill'),
  nconIsAlive: () => ipcRenderer.invoke('ncon:isAlive'),
  nconSetVisible: (visible: boolean) => ipcRenderer.invoke('ncon:setVisible', visible),
  onSyncStatus: (cb: (status: string, message?: string) => void) => {
    const handler = (_: unknown, status: string, message?: string) => cb(status, message)
    ipcRenderer.on('sync:status', handler)
    return () => ipcRenderer.removeListener('sync:status', handler)
  },
  fetchUsage: () => ipcRenderer.invoke('usage:fetch'),
  fetchContext: () => ipcRenderer.invoke('context:fetch'),
  getCachedUsage: () => ipcRenderer.invoke('usage:getCached'),
  selectSession: (sessionId: string) => ipcRenderer.invoke('session:select', sessionId),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (data: unknown) => ipcRenderer.invoke('settings:save', data),
  getClaudeVersion: () => ipcRenderer.invoke('settings:getVersion'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  pickAvatar: () => ipcRenderer.invoke('avatar:pick'),

  listThemes: () => ipcRenderer.invoke('themes:list'),
  openThemesFolder: () => ipcRenderer.invoke('themes:openFolder'),

  consoleFlush: () => ipcRenderer.invoke('console:flush'),
  onConsoleLog: (cb: (entry: { level: string; text: string; ts: number }) => void) => {
    const handler = (_: unknown, entry: { level: string; text: string; ts: number }) => cb(entry)
    ipcRenderer.on('console:log', handler)
    return () => ipcRenderer.removeListener('console:log', handler)
  },
  onAuthDone: (cb: (configDir: string) => void) => {
    const handler = (_: unknown, configDir: string) => cb(configDir)
    ipcRenderer.on('auth:done', handler)
    return () => ipcRenderer.removeListener('auth:done', handler)
  },
  onUsageData: (cb: (data: { usage: unknown; context: unknown }) => void) => {
    const handler = (_: unknown, data: { usage: unknown; context: unknown }) => cb(data)
    ipcRenderer.on('usage:data', handler)
    return () => ipcRenderer.removeListener('usage:data', handler)
  },

  checkDeps: () => ipcRenderer.invoke('claude:checkDeps'),
  installClaude: () => ipcRenderer.invoke('claude:install'),
  installClaudeVersion: (version: string) => ipcRenderer.invoke('claude:installVersion', version),
  tempSave: (buffer: ArrayBuffer, filename: string) => ipcRenderer.invoke('temp:save', buffer, filename),
  tempDelete: (filePath: string) => ipcRenderer.invoke('temp:delete', filePath),
  tempClear: () => ipcRenderer.invoke('temp:clear'),
  tempGetSettings: () => ipcRenderer.invoke('temp:getSettings'),
  tempSaveSettings: (data: Record<string, unknown>) => ipcRenderer.invoke('temp:saveSettings', data),
  tempCancelCleanup: () => ipcRenderer.invoke('temp:cancelCleanup'),
  tempGetDirSize: () => ipcRenderer.invoke('temp:getDirSize'),
  onTempCleanupStart: (cb: (autoDelete: string) => void) => {
    const handler = (_: unknown, autoDelete: string) => cb(autoDelete)
    ipcRenderer.on('temp:cleanupStart', handler)
    return () => ipcRenderer.removeListener('temp:cleanupStart', handler)
  },
  onTempCleanupDone: (cb: (count: number) => void) => {
    const handler = (_: unknown, count: number) => cb(count)
    ipcRenderer.on('temp:cleanupDone', handler)
    return () => ipcRenderer.removeListener('temp:cleanupDone', handler)
  },
  onTempCleanupCancelled: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('temp:cleanupCancelled', handler)
    return () => ipcRenderer.removeListener('temp:cleanupCancelled', handler)
  },

  // Window controls
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // Memory
  memoryListDir: (dirPath?: string) => ipcRenderer.invoke('memory:listDir', dirPath),
  memoryReadFile: (filePath: string) => ipcRenderer.invoke('memory:readFile', filePath),
  memoryWriteFile: (filePath: string, content: string) => ipcRenderer.invoke('memory:writeFile', filePath, content),
  memoryCreateFile: (name: string, dirPath?: string) => ipcRenderer.invoke('memory:createFile', name, dirPath),
  memoryCreateDir: (name: string, dirPath?: string) => ipcRenderer.invoke('memory:createDir', name, dirPath),
  memoryDeleteFile: (filePath: string) => ipcRenderer.invoke('memory:deleteFile', filePath),
  memoryGetClaudeMd: () => ipcRenderer.invoke('memory:getClaudeMd'),
  memoryGetDir: () => ipcRenderer.invoke('memory:getMemoryDir'),
  memoryRename: (oldPath: string, newName: string) => ipcRenderer.invoke('memory:rename', oldPath, newName),
  memoryGetMeta: () => ipcRenderer.invoke('memory:getMeta'),
  memoryGetTokens: () => ipcRenderer.invoke('memory:getTokens'),
  memorySetMeta: (relativePath: string, data: { auto: boolean }) => ipcRenderer.invoke('memory:setMeta', relativePath, data),
  memoryRebuildAll: () => ipcRenderer.invoke('memory:rebuildAll'),

  // Telegram integration
  tgGetSettings: () => ipcRenderer.invoke('tg:getSettings'),
  tgSetSettings: (settings: { botToken: string; chatId: string; enabled: boolean }) => ipcRenderer.invoke('tg:setSettings', settings),
  tgDetectChatId: (botToken: string) => ipcRenderer.invoke('tg:detectChatId', botToken),
  tgStart: () => ipcRenderer.invoke('tg:start'),
  tgStop: () => ipcRenderer.invoke('tg:stop'),
  tgReply: (chatId: string, text: string) => ipcRenderer.invoke('tg:reply', chatId, text),
  onTgMessage: (cb: (chatId: string, text: string, filePath?: string) => void) => {
    const handler = (_: unknown, chatId: string, text: string, filePath?: string) => cb(chatId, text, filePath)
    ipcRenderer.on('tg:message', handler)
    return () => ipcRenderer.removeListener('tg:message', handler)
  },
  onSessionReload: (cb: (sessionId: string) => void) => {
    const handler = (_: unknown, sessionId: string) => cb(sessionId)
    ipcRenderer.on('session:reload', handler)
    return () => ipcRenderer.removeListener('session:reload', handler)
  },
  onSessionCreated: (cb: (sessionId: string) => void) => {
    const handler = (_: unknown, sessionId: string) => cb(sessionId)
    ipcRenderer.on('session:created', handler)
    return () => ipcRenderer.removeListener('session:created', handler)
  },

  // Session status watching
  watchSession: (sessionId: string, jsonlPath: string) => ipcRenderer.invoke('pty:watch-session', sessionId, jsonlPath),
  unwatchSession: (sessionId: string) => ipcRenderer.invoke('pty:unwatch-session', sessionId),
  onSessionStatus: (cb: (sessionId: string, status: string) => void) => {
    const handler = (_: unknown, sessionId: string, status: string) => cb(sessionId, status)
    ipcRenderer.on('session:status', handler)
    return () => ipcRenderer.removeListener('session:status', handler)
  },
  onSessionReply: (cb: (sessionId: string, text: string) => void) => {
    const handler = (_: unknown, sessionId: string, text: string) => cb(sessionId, text)
    ipcRenderer.on('session:reply', handler)
    return () => ipcRenderer.removeListener('session:reply', handler)
  },
  // Диагностика: каждое срабатывание jsonl-watcher'а с переходом статуса
  onSessionStatusLog: (cb: (sessionId: string, transition: string) => void) => {
    const handler = (_: unknown, sessionId: string, transition: string) => cb(sessionId, transition)
    ipcRenderer.on('session:status-log', handler)
    return () => ipcRenderer.removeListener('session:status-log', handler)
  },

  // Уведомления
  setActiveSessionForNotify: (sessionId: string | null) => ipcRenderer.send('notification:set-active-session', sessionId),
  setSessionTitleForNotify: (sessionId: string, title: string) => ipcRenderer.send('notification:set-session-title', sessionId, title),
  onNotificationOpenSession: (cb: (sessionId: string) => void) => {
    const handler = (_: unknown, sessionId: string) => cb(sessionId)
    ipcRenderer.on('notification:open-session', handler)
    return () => ipcRenderer.removeListener('notification:open-session', handler)
  },
  applyNotificationSettings: (settings: unknown) => ipcRenderer.send('notification:apply-settings', settings),
  previewNotifications: () => ipcRenderer.send('notification:preview'),
  previewNotification: (kind: string) => ipcRenderer.send('notification:preview-one', kind),
  getNotificationMaxStack: (scale: number) => ipcRenderer.invoke('notification:max-stack', scale) as Promise<number>,
  getNotificationSounds: () => ipcRenderer.invoke('notification:sounds') as Promise<string[]>,
  getNotificationWorkArea: () => ipcRenderer.invoke('notification:work-area') as Promise<{ width: number; height: number; scaleFactor: number }>,

  // Pyre modules
  modulesList: () => ipcRenderer.invoke('modules:list'),
  modulesGetSettings: (id: string) => ipcRenderer.invoke('modules:getSettings', id),
  modulesSetSettings: (id: string, settings: Record<string, unknown>) => ipcRenderer.invoke('modules:setSettings', id, settings),
  modulesStart: (id: string) => ipcRenderer.invoke('modules:start', id),
  modulesStop: (id: string) => ipcRenderer.invoke('modules:stop', id),

  // Heartbeat — очередь побудок
  heartbeatQueue: () => ipcRenderer.invoke('heartbeat:queue'),
  heartbeatCancel: (id: string) => ipcRenderer.invoke('heartbeat:cancel', id),
  heartbeatAdd: (entry: Record<string, unknown>) => ipcRenderer.invoke('heartbeat:add', entry),
  heartbeatClear: () => ipcRenderer.invoke('heartbeat:clear'),
  heartbeatHealth: () => ipcRenderer.invoke('heartbeat:health'),
  onHeartbeatSettingsChanged: (cb: (s: Record<string, unknown>) => void) => {
    const h = (_: unknown, s: Record<string, unknown>) => cb(s)
    ipcRenderer.on('heartbeat:settings-changed', h)
    return () => ipcRenderer.removeListener('heartbeat:settings-changed', h)
  },
  onHeartbeatQueue: (cb: (queue: unknown[]) => void) => {
    const h = (_: unknown, queue: unknown[]) => cb(queue)
    ipcRenderer.on('heartbeat:queue', h)
    return () => ipcRenderer.removeListener('heartbeat:queue', h)
  },
  onHeartbeatFired: (cb: (info: { message: string; at: number }) => void) => {
    const h = (_: unknown, info: { message: string; at: number }) => cb(info)
    ipcRenderer.on('heartbeat:fired', h)
    return () => ipcRenderer.removeListener('heartbeat:fired', h)
  },

  // Stats
  getStats: (configDir?: string) => ipcRenderer.invoke('stats:get', configDir),

  // Auto-updater
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  getVaelVersion: () => ipcRenderer.invoke('update:getVaelVersion'),
  setAutoDownload: (enabled: boolean) => ipcRenderer.invoke('update:setAutoDownload', enabled),
  onUpdateAvailable: (cb: (version: string) => void) => {
    const handler = (_: unknown, version: string) => cb(version)
    ipcRenderer.on('update:available', handler)
    return () => ipcRenderer.removeListener('update:available', handler)
  },
  onUpdateProgress: (cb: (progress: number) => void) => {
    const handler = (_: unknown, progress: number) => cb(progress)
    ipcRenderer.on('update:progress', handler)
    return () => ipcRenderer.removeListener('update:progress', handler)
  },
  onUpdateReady: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('update:ready', handler)
    return () => ipcRenderer.removeListener('update:ready', handler)
  },
  onUpdateError: (cb: (message: string) => void) => {
    const handler = (_: unknown, message: string) => cb(message)
    ipcRenderer.on('update:error', handler)
    return () => ipcRenderer.removeListener('update:error', handler)
  },
})
