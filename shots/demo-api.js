// Заглушка window.api для скриншотов README: настоящий интерфейс Vael, выдуманные данные.
// Ничего реального здесь нет — ни сессий, ни почты, ни путей
;(function () {
  const NOW = Date.now()
  const H = 3600e3, D = 24 * H
  const PROJ = 'C:\\Users\\demo\\.vael\\sessions\\C--Users-demo'

  const accounts = [
    { id: 'main', name: 'main', configDir: 'C:\\Users\\demo\\.claude-accounts\\main', email: 'alex@example.com' },
    { id: 'work', name: 'work', configDir: 'C:\\Users\\demo\\.claude-accounts\\work', email: 'alex@company.dev' },
  ]

  const s = (id, title, ago, msgs) => ({ id, projectPath: PROJ, projectName: 'demo', accountId: 'main', lastModified: NOW - ago, createdAt: NOW - ago - 2 * H, messageCount: msgs, title })
  const sessions = [
    s('demo-chat', 'Settings page freezes on open', 4 * 60e3, 38),
    s('demo-compact', 'Refactor the export pipeline', 50 * 60e3, 412),
    s('d3', 'Dark mode for the docs site', 3 * H, 24),
    s('d4', 'Flaky upload test', 26 * H, 61),
    s('d5', 'Rust CLI: parse config', 30 * H, 17),
    s('d6', 'Landing page copy', 52 * H, 9),
    s('d7', 'Migrate to Postgres 18', 3 * D, 133),
    s('d8', 'Release notes 2.4', 4 * D, 12),
    s('d9', 'Profile slow startup', 9 * D, 77),
    s('d10', 'Websocket reconnect logic', 12 * D, 45),
  ]

  const EDIT_OLD = `  useEffect(() => {
    const themes = fs.readdirSync(THEMES_DIR)
    setThemes(themes.map(f => loadTheme(f)))
  }, [])`
  const EDIT_NEW = `  useEffect(() => {
    let alive = true
    api.listThemes().then(list => { if (alive) setThemes(list) })
    return () => { alive = false }
  }, [])`

  const chatItems = [
    { kind: 'user', key: 'hu1', text: 'The settings page freezes for about a second every time I open it. Can you find out why?', at: NOW - 9 * 60e3 },
    { kind: 'tool', key: 'ht1', id: 't1', name: 'Grep', input: { pattern: 'readdirSync|readFileSync', path: 'src/components' }, result: 'src/components/SettingsPage.tsx:212\nsrc/components/ThemePicker.tsx:48', done: true },
    { kind: 'tool', key: 'ht2', id: 't2', name: 'Read', input: { file_path: 'src/components/ThemePicker.tsx' }, result: '…', done: true },
    { kind: 'tool', key: 'ht3', id: 't3', name: 'Read', input: { file_path: 'src/components/SettingsPage.tsx' }, result: '…', done: true },
    { kind: 'tool', key: 'ht4', id: 't4', name: 'Bash', input: { command: 'ls themes | wc -l', description: 'Count theme files' }, result: '214', done: true },
    { kind: 'tool', key: 'ht5', id: 't5', name: 'Edit', input: { file_path: 'src/components/ThemePicker.tsx', old_string: EDIT_OLD, new_string: EDIT_NEW }, result: 'ok', done: true },
    { kind: 'text', key: 'ha1', at: NOW - 7 * 60e3, text: `Found it. \`ThemePicker\` reads and parses **every theme file synchronously** while the page mounts. There are 214 of them, so the UI thread is blocked until all of them are loaded.

What I changed:

- the list now comes from \`api.listThemes()\`, which reads the folder in the main process
- the page renders immediately and the picker fills in a moment later
- a guard drops the result if you leave the page before it arrives

Opening settings should feel instant now. If you want, I can also cache the parsed themes between visits.` },
    { kind: 'meta', key: 'hm1', text: '', stats: { sec: 41.2, input: 3120, cache: 412000, output: 1840, requests: 6 } },
    { kind: 'user', key: 'hu2', text: 'Nice, it is instant now. Yes, cache them please', at: NOW - 5 * 60e3 },
    { kind: 'tool', key: 'ht6', id: 't6', name: 'Edit', input: { file_path: 'electron/ipc/themes.ts', old_string: 'export async function listThemes() {\n  return readAll(THEMES_DIR)\n}', new_string: 'let cached: Theme[] | null = null\n\nexport async function listThemes() {\n  return (cached ??= await readAll(THEMES_DIR))\n}' }, result: 'ok', done: true },
    { kind: 'text', key: 'ha2', at: NOW - 4 * 60e3, text: 'Done: themes are parsed once and reused. The cache resets when you open the themes folder from settings, so new files still show up.' },
    { kind: 'meta', key: 'hm2', text: '', stats: { sec: 9.8, input: 640, cache: 98000, output: 410, requests: 2 } },
  ]

  const SUMMARY = `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

Summary:
1. **Primary request**: split the monolithic \`export.ts\` into a pipeline of small stages (collect → transform → write) without changing the output format.
2. **Done so far**:
   - \`stages/collect.ts\` and \`stages/transform.ts\` extracted, covered by snapshot tests
   - CSV and JSON writers moved behind a \`Writer\` interface
3. **Open**: the XLSX writer still reads the whole dataset into memory; streaming is the next step.`

  const compactItems = [
    { kind: 'user', key: 'hc1', text: 'Before we go on with the XLSX writer, compact please', at: NOW - 52 * 60e3 },
    { kind: 'compact', key: 'hc2', state: 'done', before: 612000, after: 21400, summary: SUMMARY, files: [
      { path: 'C:\\Users\\demo\\code\\exporter\\src\\stages\\collect.ts', lines: 88 },
      { path: 'C:\\Users\\demo\\code\\exporter\\src\\stages\\transform.ts', lines: 141 },
      { path: 'C:\\Users\\demo\\code\\exporter\\src\\writers\\Writer.ts', lines: 24 },
      { path: 'C:\\Users\\demo\\code\\exporter\\src\\writers\\xlsx.ts', ref: true },
      { path: 'C:\\Users\\demo\\code\\exporter\\test\\export.snap.test.ts', ref: true },
    ] },
    { kind: 'user', key: 'hc3', text: 'Now make the XLSX writer stream rows instead of loading everything', at: NOW - 50 * 60e3 },
    { kind: 'text', key: 'hc4', at: NOW - 49 * 60e3, text: 'On it. I will switch `xlsx.ts` to the streaming writer and keep the snapshot tests as the safety net.' },
  ]

  const limits = { info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.34, resetsAt: (NOW + 2.6 * H) / 1000 }, seven_day: { utilization: 0.21, resetsAt: (NOW + 3.2 * D) / 1000 } } }, at: NOW - 60e3 }

  const models = [
    { value: 'opus', displayName: 'Opus 5.5', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { value: 'sonnet', displayName: 'Sonnet 5.5', supportedEffortLevels: ['low', 'medium', 'high'] },
    { value: 'haiku', displayName: 'Haiku 5.5' },
  ]

  const stubs = {
    checkDeps: async () => ({ npm: '11.6.2', claude: '2.1.310 (Claude Code)', ready: true }),
    getAccounts: async () => accounts,
    checkCredentials: async () => true,
    getAuthInfo: async (dir) => ({ loggedIn: true, expired: false, expiresAt: NOW + 6 * H, refreshExpiresAt: NOW + (dir.endsWith('work') ? 9 : 27) * D, subscriptionType: dir.endsWith('work') ? 'team' : 'max' }),
    getSessions: async () => sessions,
    switchAccount: async () => ({ ok: true }),
    getSettings: async () => ({}),
    chatList: async () => [{ sessionId: 'demo-chat', hasJsonl: true }, { sessionId: 'demo-compact', hasJsonl: true }],
    chatAlive: async () => true,
    chatInit: async () => ({ commands: [{ name: 'compact' }, { name: 'context' }, { name: 'model' }], models, account: { email: 'alex@example.com', subscriptionType: 'max' } }),
    chatHistory: async (p) => p.includes('demo-compact')
      ? { items: compactItems, contextTokens: 24800, model: 'opus' }
      : { items: chatItems, contextTokens: 101200, model: 'opus' },
    chatContextUsage: async (id) => ({ ok: true, totalTokens: id === 'demo-compact' ? 24800 : 101200, maxTokens: 1000000 }),
    chatSummaries: async () => [{ at: NOW - 52 * 60e3, before: 612000, after: 21400, summary: SUMMARY }],
    chatCompactTail: async () => ({ files: [], summary: null }),
    limitsGet: async () => limits,
    getStats: async () => ({ ok: false, data: null }),
    windowIsMaximized: async () => false,
    getVaelVersion: async () => '3.0.0',
    getClaudeVersion: async () => '2.1.310',
  }
  const LISTS = /^(modulesList|listThemes|heartbeatQueue|getNotificationSounds|memoryListDir|memoryTree|findNewSessions|chatReadAttachments)$/

  window.api = new Proxy(stubs, {
    get(t, k) {
      if (k in t) return t[k]
      if (typeof k !== 'string') return undefined
      if (/^on[A-Z]/.test(k)) return () => () => {}
      if (LISTS.test(k)) return async () => []
      return async () => null
    },
  })

  // Состояние, которое App поднимает из localStorage
  try {
    localStorage.setItem('activeAccountId', 'main')
    localStorage.setItem('vaeli:view-mode:default', 'chat')
    for (const x of sessions) localStorage.setItem('vaeli:view-mode:' + x.id, 'chat')
    localStorage.setItem('vaeli:session-config:demo-chat', JSON.stringify({ model: 'opus', effort: 'high', permissionMode: 'default' }))
    localStorage.setItem('vaeli:session-config:demo-compact', JSON.stringify({ model: 'opus', effort: 'high', permissionMode: 'default' }))
  } catch {}
})()
