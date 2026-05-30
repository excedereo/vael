import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Accounts
  getAccounts: () => ipcRenderer.invoke('accounts:get'),
  createAccount: (id: string) => ipcRenderer.invoke('accounts:create', id),
  deleteAccount: (id: string) => ipcRenderer.invoke('accounts:delete', id),
  openAuth: (configDir: string) => ipcRenderer.invoke('accounts:openAuth', configDir),
  checkCredentials: (configDir: string) => ipcRenderer.invoke('accounts:checkCredentials', configDir),

  // Sessions
  getSessions: (accountId: string) => ipcRenderer.invoke('sessions:get', accountId),
  readSession: (sessionPath: string) => ipcRenderer.invoke('sessions:read', sessionPath),
  deleteSession: (sessionPath: string) => ipcRenderer.invoke('sessions:delete', sessionPath),

  // Account switch (sync + set active)
  switchAccount: (fromId: string, toId: string) => ipcRenderer.invoke('account:switch', fromId, toId),
  setActiveAccount: (id: string) => ipcRenderer.invoke('account:setActive', id),

  // Send message via -p flag
  sendMessage: (sessionId: string, text: string, accountId: string, model: string, effort: string, permissionMode: string) =>
    ipcRenderer.invoke('claude:send', sessionId, text, accountId, model, effort, permissionMode),

  // New session
  newSession: (text: string, accountId: string, model: string, effort: string, permissionMode: string) =>
    ipcRenderer.invoke('claude:new', text, accountId, model, effort, permissionMode),

  // Abort running process
  abortRun: () => ipcRenderer.invoke('claude:abort'),

  // PTY slash commands
  ptySpawn: (configDir: string, sessionId?: string) =>
    ipcRenderer.invoke('pty:spawn', configDir, sessionId),
  ptySend: (command: string) => ipcRenderer.invoke('pty:send', command),
  ptyKill: () => ipcRenderer.invoke('pty:kill'),

  // Event listeners
  onStreamEvent: (cb: (event: unknown) => void) => {
    const handler = (_: unknown, event: unknown) => cb(event)
    ipcRenderer.on('stream:event', handler)
    return () => ipcRenderer.removeListener('stream:event', handler)
  },
  onStreamDone: (cb: (code: number | null) => void) => {
    const handler = (_: unknown, code: number | null) => cb(code)
    ipcRenderer.on('stream:done', handler)
    return () => ipcRenderer.removeListener('stream:done', handler)
  },
  onPtyOutput: (cb: (data: string) => void) => {
    const handler = (_: unknown, data: string) => cb(data)
    ipcRenderer.on('pty:output', handler)
    return () => ipcRenderer.removeListener('pty:output', handler)
  },
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

  // Auto-updater
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
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
