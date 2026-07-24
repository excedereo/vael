import { useState, useEffect, useRef } from 'react'
import { ExternalLink, Trash2, HardDrive, Loader2, X, Plus, FolderOpen } from 'lucide-react'
import { api } from '../lib/api.js'
import { cn } from '../lib/utils.js'
import { loadActiveThemeFile, applyTheme } from '../lib/theme.js'
import { BUILTIN_THEMES } from '../lib/builtinThemes.js'
import {
  Section, ToggleRow, SettingRow, ThemePicker, Dropdown,
  PendingSection, PendingRow,
} from './SettingsComponents.js'
import { NotificationSettingsSection } from './NotificationSettings.js'
import { useSettingsTab } from '../lib/sectionTabs.js'
import {
  loadCustomOptions, saveCustomOptions,
  CustomOption, OptionCategory,
} from '../lib/customOptions.js'
import { useSettings, DEFAULT_CONTENT_PADDING as SETTINGS_DEFAULT_CONTENT_PADDING } from '../hooks/useSettings.js'
import type { UISettings } from '../hooks/useSettings.js'

interface Props {
  onBack: () => void
}

// Settings stored in ~/.claude/settings.json
interface ClaudeSettings {
  autoCompactEnabled?: boolean
  alwaysThinkingEnabled?: boolean
  fileCheckpointingEnabled?: boolean
  awaySummaryEnabled?: boolean
  useAutoModeDuringPlan?: boolean
  effortLevel?: string
  defaultPermissionMode?: string
  outputStyle?: string
  spinnerTipsEnabled?: boolean
  promptSuggestionEnabled?: boolean
  verbose?: boolean
  terminalProgressBar?: boolean
  worktreeBaseRef?: string
  respectGitignore?: boolean
  skipCopyPicker?: boolean
  autoConnectIde?: boolean
  claudeInChromeDefaultEnabled?: boolean
  remoteControlAtStartup?: boolean
  autoUpdatesChannel?: string
  notifChannel?: string
  pushNotifWhenActionsRequired?: boolean
  pushNotifWhenClaudeDecides?: boolean
}

// Re-export для обратной совместимости с App.tsx
export const DEFAULT_CONTENT_PADDING = SETTINGS_DEFAULT_CONTENT_PADDING


export interface DefaultSessionConfig {
  model: string
  effort: string
  permissionMode: string
}

export const DEFAULT_SESSION_CONFIG: DefaultSessionConfig = {
  model: 'claude-sonnet-4-6',
  effort: 'high',
  permissionMode: 'bypassPermissions',
}

const MODEL_MIGRATION: Record<string, string> = {
  'sonnet':  'claude-sonnet-4-6',
  'opus':    'claude-opus-4-8',
  'haiku':   'claude-haiku-4-5-20251001',
  'fable':   'claude-fable-5',
}

export function loadDefaultSessionConfig(): DefaultSessionConfig {
  try {
    const raw = localStorage.getItem('vaeli:default-session-config')
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DefaultSessionConfig>
      if (parsed.model && MODEL_MIGRATION[parsed.model]) {
        parsed.model = MODEL_MIGRATION[parsed.model]
        localStorage.setItem('vaeli:default-session-config', JSON.stringify({ ...DEFAULT_SESSION_CONFIG, ...parsed }))
      }
      return { ...DEFAULT_SESSION_CONFIG, ...parsed }
    }
  } catch {}
  return DEFAULT_SESSION_CONFIG
}

function saveDefaultSessionConfig(c: DefaultSessionConfig) {
  localStorage.setItem('vaeli:default-session-config', JSON.stringify(c))
}

const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-6',          label: 'Sonnet 4.6', sub: 'claude-sonnet-4-6' },
  { value: 'claude-opus-4-8',            label: 'Opus 4.8',   sub: 'claude-opus-4-8' },
  { value: 'claude-fable-5',             label: 'Fable 5',    sub: 'claude-fable-5' },
  { value: 'claude-haiku-4-5-20251001',  label: 'Haiku 4.5',  sub: 'claude-haiku-4-5' },
]
const EFFORT_OPTIONS_DEF = [
  { value: 'low',    label: 'Low',    sub: 'быстро, экономно' },
  { value: 'medium', label: 'Medium', sub: 'баланс' },
  { value: 'high',   label: 'High',   sub: 'глубже' },
  { value: 'xhigh',  label: 'X-High', sub: 'очень глубоко' },
  { value: 'max',    label: 'Max',    sub: 'максимум' },
]
const PERMISSION_OPTIONS_DEF = [
  { value: 'bypassPermissions', label: 'Bypass',       sub: 'пропустить все проверки' },
  { value: 'auto',              label: 'Auto',         sub: 'автоматически' },
  { value: 'acceptEdits',       label: 'Accept Edits', sub: 'принимать правки' },
  { value: 'default',           label: 'Default',      sub: 'стандартный' },
  { value: 'plan',              label: 'Plan',         sub: 'только планировать' },
]

// PTY-recommended values — applied when applyPtyOptimizations is true
const PTY_RECOMMENDED: Partial<ClaudeSettings> = {
  promptSuggestionEnabled: false,
  spinnerTipsEnabled:       false,
  skipCopyPicker:           false,
}

const CAT_LABELS: Record<OptionCategory, string> = {
  model:      'Модель',
  effort:     'Мышление',
  permission: 'Доступ',
}

const CAT_COLORS: Record<OptionCategory, { bg: string; text: string }> = {
  model:      { bg: 'rgba(217,119,87,0.12)', text: 'var(--accent)' },
  effort:     { bg: 'rgba(139,92,246,0.12)', text: '#a78bfa' },
  permission: { bg: 'rgba(34,197,94,0.10)',  text: '#4ade80' },
}

function CustomOptionsTable() {
  const cats: OptionCategory[] = ['model', 'effort', 'permission']
  const [allOpts, setAllOpts] = useState<Record<OptionCategory, CustomOption[]>>(() => ({
    model:      loadCustomOptions('model'),
    effort:     loadCustomOptions('effort'),
    permission: loadCustomOptions('permission'),
  }))
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ cat: 'model' as OptionCategory, value: '', label: '', sub: '' })
  const [err, setErr] = useState('')

  const allEntries = cats.flatMap(cat => allOpts[cat].map(opt => ({ cat, opt })))

  const refresh = (cat: OptionCategory, next: CustomOption[]) => {
    setAllOpts(prev => ({ ...prev, [cat]: next }))
    saveCustomOptions(cat, next)
    window.dispatchEvent(new Event('vaeli:customOptionsChanged'))
  }

  const handleAdd = () => {
    const v = form.value.trim()
    const l = form.label.trim()
    if (!v || !l) { setErr('Значение и название обязательны'); return }
    if (allOpts[form.cat].find(o => o.value === v)) { setErr('Такое значение уже есть'); return }
    refresh(form.cat, [...allOpts[form.cat], { value: v, label: l, sub: form.sub.trim() || undefined }])
    setForm(f => ({ cat: f.cat, value: '', label: '', sub: '' }))
    setAdding(false)
    setErr('')
  }

  const inputBase = [
    'bg-transparent border-b border-border-default',
    'px-0 py-1 text-[13px] text-text-primary placeholder:text-text-ghost',
    'focus:outline-none focus:border-border-strong transition-colors w-full',
  ].join(' ')

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-medium text-text-faint uppercase tracking-wider">Кастомные опции</span>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] border border-border-default text-text-muted hover:text-text-primary hover:border-border-strong transition-colors"
          >
            <Plus size={11} />
            Добавить
          </button>
        )}
      </div>

      {allEntries.length === 0 && !adding && (
        <div
          className="rounded-xl border border-dashed border-border-subtle px-4 py-5 text-center text-[13px] text-text-ghost"
          style={{ background: 'var(--bg-surface)' }}
        >
          Нет кастомных опций
        </div>
      )}

      {allEntries.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {allEntries.map(({ cat, opt }) => {
            const clr = CAT_COLORS[cat]
            return (
              <div
                key={cat + opt.value}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border-subtle"
                style={{ background: 'var(--bg-surface)' }}
              >
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md shrink-0"
                  style={{ background: clr.bg, color: clr.text }}
                >
                  {CAT_LABELS[cat]}
                </span>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-[13px] font-medium leading-tight" style={{ color: 'var(--text-primary)' }}>{opt.label}</span>
                  <span className="text-[11px] font-mono mt-0.5 truncate" style={{ color: 'var(--text-faint)' }}>{opt.value}</span>
                </div>
                {opt.sub && (
                  <span className="text-[12px] shrink-0 max-w-[140px] truncate" style={{ color: 'var(--text-muted)' }}>{opt.sub}</span>
                )}
                <button
                  onClick={() => refresh(cat, allOpts[cat].filter(o => o.value !== opt.value))}
                  className="shrink-0 p-1 rounded-lg transition-colors"
                  style={{ color: 'var(--text-ghost)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-ghost)')}
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {adding && (
        <div
          className="rounded-xl border border-border-default px-4 py-3.5 flex flex-col gap-3"
          style={{ background: 'var(--bg-surface)' }}
        >
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-text-faint uppercase tracking-wider mr-1">Тип</span>
            {cats.map(c => {
              const clr = CAT_COLORS[c]
              const active = form.cat === c
              return (
                <button
                  key={c}
                  onClick={() => setForm(f => ({ ...f, cat: c }))}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold uppercase tracking-wide border transition-all"
                  style={active
                    ? { background: clr.bg, color: clr.text, borderColor: 'transparent' }
                    : { borderColor: 'var(--border-subtle)', color: 'var(--text-ghost)', background: 'transparent' }}
                >
                  {CAT_LABELS[c]}
                </button>
              )
            })}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>Значение / флаг</span>
              <input
                autoFocus
                value={form.value}
                onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="claude-opus-4-8"
                className={inputBase + ' font-mono'}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>Название</span>
              <input
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="Opus 4.8"
                className={inputBase}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>Описание</span>
              <input
                value={form.sub}
                onChange={e => setForm(f => ({ ...f, sub: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="необязательно"
                className={inputBase}
              />
            </div>
          </div>

          {err && <div className="text-[11px]" style={{ color: '#f87171' }}>{err}</div>}

          <div className="flex items-center gap-2 pt-0.5">
            <button
              onClick={handleAdd}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-opacity hover:opacity-90"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              Добавить
            </button>
            <button
              onClick={() => { setAdding(false); setErr('') }}
              className="px-3 py-1.5 rounded-lg text-[12px] border border-border-default transition-colors hover:border-border-strong"
              style={{ color: 'var(--text-muted)' }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function SettingsPage(_props: Props) {
  const tab = useSettingsTab()
  const [saving, _setSaving] = useState(false)
  const [version, setVersion] = useState<string>('')
  const { uiSettings, setUISettings, notifications, setNotifications } = useSettings()
  const [defaultConfig, setDefaultConfig] = useState<DefaultSessionConfig>(() => loadDefaultSessionConfig())
  const [customModels, setCustomModels]      = useState(() => loadCustomOptions('model'))
  const [customEfforts, setCustomEfforts]    = useState(() => loadCustomOptions('effort'))
  const [customPerms, setCustomPerms]        = useState(() => loadCustomOptions('permission'))

  useEffect(() => {
    const refresh = () => {
      setCustomModels(loadCustomOptions('model'))
      setCustomEfforts(loadCustomOptions('effort'))
      setCustomPerms(loadCustomOptions('permission'))
    }
    window.addEventListener('vaeli:customOptionsChanged', refresh)
    return () => window.removeEventListener('vaeli:customOptionsChanged', refresh)
  }, [])

  const updateUI = (patch: Partial<UISettings>) => {
    const next = { ...uiSettings, ...patch }
    setUISettings(next)
    window.dispatchEvent(new Event('vaeli:uiSettingsChanged'))
  }

  const updateDefaultConfig = (patch: Partial<DefaultSessionConfig>) => {
    const next = { ...defaultConfig, ...patch }
    setDefaultConfig(next)
    saveDefaultSessionConfig(next)
  }

  const [themes, setThemes] = useState<Array<{ file: string; name: string; vars: Record<string, string> }>>([])
  const [activeThemeFile, setActiveThemeFile] = useState<string | null>(null)

  useEffect(() => {
    api.listThemes().then(list => {
      const all = [...BUILTIN_THEMES, ...list]
      setThemes(all)
      const saved = loadActiveThemeFile() ?? '__builtin_claude'
      setActiveThemeFile(saved)
      const found = all.find(t => t.file === saved)
      if (found) applyTheme(found.vars)
    })
  }, [])

  useEffect(() => {
    api.getClaudeVersion().then(v => setVersion(v || ''))
  }, [])

  const [devConsole, setDevConsole] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('vaeliDevConsole') ?? 'false') } catch { return false }
  })
  const [showDev, setShowDev] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('vaeliShowDev') ?? 'false') } catch { return false }
  })
  const [autoDownload, setAutoDownload] = useState(() => {
    try { return JSON.parse(localStorage.getItem('vaeliAutoDownload') || 'false') } catch { return false }
  })
  const [vaelVersion, setVaelVersion] = useState<string>('')

  useEffect(() => {
    api.getVaelVersion().then(v => setVaelVersion(v)).catch(() => {})
  }, [])

  const [tempAutoDelete, setTempAutoDelete] = useState<string>('1d')
  const [tempDirSize, setTempDirSize] = useState<{ bytes: number; count: number } | null>(null)
  const [tempClearing, setTempClearing] = useState(false)
  const [tempClearCountdown, setTempClearCountdown] = useState(0)
  const tempClearCancelRef = useRef<boolean>(false)

  const [attachDirSize, setAttachDirSize] = useState<{ bytes: number; count: number } | null>(null)
  const [attachAutoDelete, setAttachAutoDelete] = useState<string>('never')
  const [attachClearing, setAttachClearing] = useState(false)

  useEffect(() => {
    api.tempGetSettings().then(s => {
      if (s.tempAutoDelete) setTempAutoDelete(s.tempAutoDelete as string)
      if (s.attachAutoDelete) setAttachAutoDelete(s.attachAutoDelete as string)
    })
    api.tempGetDirSize().then(s => setTempDirSize(s))
    api.attachmentsGetDirSize().then(s => setAttachDirSize(s))
  }, [])

  const handleTempClear = async () => {
    setTempClearing(true)
    tempClearCancelRef.current = false
    setTempClearCountdown(3)
    const interval = setInterval(() => {
      setTempClearCountdown(c => c - 1)
    }, 1000)
    await new Promise<void>(resolve => {
      setTimeout(async () => {
        clearInterval(interval)
        if (tempClearCancelRef.current) {
          setTempClearing(false)
          setTempClearCountdown(0)
          resolve()
          return
        }
        await api.tempClear()
        const size = await api.tempGetDirSize()
        setTempDirSize(size)
        setTempClearing(false)
        setTempClearCountdown(0)
        resolve()
      }, 3000)
    })
  }

  return (
    <div className="flex flex-col h-full bg-bg-base">
      <div className="flex flex-1 min-h-0 overflow-y-auto">
        <div className="flex w-full">
          <div className="flex-1 py-6 px-8 space-y-5 overflow-y-auto max-w-[560px] mx-auto">

            {tab === 'interface' && (<>
              <SettingRow label="Тема">
                <ThemePicker themes={themes} activeThemeFile={activeThemeFile} setActiveThemeFile={setActiveThemeFile} />
              </SettingRow>

              <Section label="Отображение">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-text-primary">Отступ контента</span>
                    <span className="text-xs text-text-muted">Боковые отступы чата и инпута</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={uiSettings.contentPadding}
                      onChange={e => {
                        const raw = e.target.value.replace(/^0+(\d)/, '$1').replace(/\D/g, '')
                        const v = raw === '' ? 0 : Number(raw)
                        if (v <= 600) updateUI({ contentPadding: v })
                      }}
                      className="w-20 bg-bg-elevated border border-border-default rounded-lg px-2 py-1 text-sm text-text-primary text-right focus:outline-none focus:border-border-strong [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="text-xs text-text-muted">px</span>
                  </div>
                </div>
              </Section>
            </>)}

            {tab === 'notifications' && (
              <NotificationSettingsSection settings={notifications} onChange={setNotifications} />
            )}

            {tab === 'sessions' && (<>
              <Section label="По умолчанию">
                {([
                  { label: 'Модель',    key: 'model' as const,          options: [...MODEL_OPTIONS,       ...customModels]  },
                  { label: 'Мышление',  key: 'effort' as const,         options: [...EFFORT_OPTIONS_DEF,  ...customEfforts] },
                  { label: 'Доступ',    key: 'permissionMode' as const,  options: [...PERMISSION_OPTIONS_DEF, ...customPerms] },
                ] as const).map(({ label, key, options }) => (
                  <div key={key} className="flex items-center justify-between px-4 py-2">
                    <span className="text-[13px] text-text-secondary">{label}</span>
                    <Dropdown value={defaultConfig[key]} options={options} onChange={v => updateDefaultConfig({ [key]: v })} />
                  </div>
                ))}
              </Section>

              <CustomOptionsTable />
            </>)}

            {tab === 'system' && (<>
              <Section label="Вложения">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <HardDrive size={13} className="text-text-faint" />
                    <div>
                      <div className="text-[14px] text-text-secondary">Папка attachments</div>
                      <div className="text-[12px] text-text-faint mt-0.5">
                        {attachDirSize
                          ? `${attachDirSize.count} файлов · ${(attachDirSize.bytes / 1024).toFixed(1)} KB`
                          : 'Загрузка...'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => api.attachmentsOpenFolder()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] border border-border-default text-text-muted hover:text-text-primary hover:border-border-strong transition-colors"
                    >
                      <FolderOpen size={11} />
                      Открыть
                    </button>
                    <button
                      onClick={async () => {
                        setAttachClearing(true)
                        await api.attachmentsClear()
                        const s = await api.attachmentsGetDirSize()
                        setAttachDirSize(s)
                        setAttachClearing(false)
                      }}
                      disabled={attachClearing}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] border transition-colors',
                        attachClearing
                          ? 'border-border-subtle text-text-ghost cursor-not-allowed'
                          : 'border-border-default text-text-muted hover:text-red-400 hover:border-red-400/30',
                      )}
                    >
                      {attachClearing ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      Очистить
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle">
                  <div>
                    <div className="text-[14px] text-text-secondary">Авто-удаление</div>
                    <div className="text-[12px] text-text-faint mt-0.5">Удалять вложения старше указанного времени</div>
                  </div>
                  <Dropdown
                    value={attachAutoDelete}
                    options={[
                      { value: '7d',    label: '7 дней' },
                      { value: '14d',   label: '14 дней' },
                      { value: '1mo',   label: '1 месяц' },
                      { value: '3mo',   label: '3 месяца' },
                      { value: 'never', label: 'Никогда' },
                    ]}
                    onChange={async v => {
                      setAttachAutoDelete(v)
                      await api.tempSaveSettings({ attachAutoDelete: v })
                    }}
                  />
                </div>
              </Section>

              <Section label="Обновления">
                <ToggleRow
                  label="Авто-обновление"
                  desc="Скачивать и устанавливать обновления автоматически"
                  value={autoDownload}
                  onChange={async v => {
                    setAutoDownload(v)
                    localStorage.setItem('vaeliAutoDownload', JSON.stringify(v))
                    await api.setAutoDownload(v)
                  }}
                />
                {vaelVersion && (
                  <div className="flex items-center justify-between px-4 py-3">
                    <div>
                      <div className="text-[14px] text-text-secondary">Vael</div>
                      <div className="text-[12px] text-text-faint mt-0.5">Текущая версия приложения</div>
                    </div>
                    <a
                      href="#"
                      className="flex items-center gap-1.5 text-[13px] transition-colors"
                      style={{ color: 'color-mix(in srgb, var(--accent) 70%, transparent)' }}
                      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'var(--accent)')}
                      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'color-mix(in srgb, var(--accent) 70%, transparent)')}
                      onClick={e => { e.preventDefault(); api.openExternal('https://github.com/stralitz/vael/releases') }}
                    >
                      v{vaelVersion}
                      <ExternalLink size={10} />
                    </a>
                  </div>
                )}
                {version && (
                  <div className="flex items-center justify-between px-4 py-3">
                    <div>
                      <div className="text-[14px] text-text-secondary">Claude Code CLI</div>
                      <div className="text-[12px] text-text-faint mt-0.5">Текущая версия</div>
                    </div>
                    <a
                      href="#"
                      className="flex items-center gap-1.5 text-[13px] transition-colors"
                      style={{ color: 'color-mix(in srgb, var(--accent) 70%, transparent)' }}
                      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'var(--accent)')}
                      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'color-mix(in srgb, var(--accent) 70%, transparent)')}
                      onClick={e => { e.preventDefault(); api.openExternal('https://github.com/anthropics/claude-code/releases') }}
                    >
                      v{version}
                      <ExternalLink size={10} />
                    </a>
                  </div>
                )}
              </Section>

              <Section label="Developer">
                <ToggleRow
                  label="Включить Dev-настройки"
                  desc="Показать расширенные настройки для разработчиков"
                  value={showDev}
                  onChange={v => {
                    setShowDev(v)
                    localStorage.setItem('vaeliShowDev', JSON.stringify(v))
                    // При выключении — сбрасываем devConsole, при включении — восстанавливаем
                    if (!v && devConsole) {
                      setDevConsole(false)
                      localStorage.setItem('vaeliDevConsole', 'false')
                      window.dispatchEvent(new Event('vaeli:devConsoleChanged'))
                    }
                  }}
                />
                {showDev && (
                  <ToggleRow
                    label="Dev окно"
                    desc="Показывать вкладку Dev в сайдбаре для тестирования"
                    value={devConsole}
                    onChange={v => {
                      setDevConsole(v)
                      localStorage.setItem('vaeliDevConsole', JSON.stringify(v))
                      window.dispatchEvent(new Event('vaeli:devConsoleChanged'))
                    }}
                  />
                )}
              </Section>

              <PendingSection label="Уведомления" reason="Будет реализовано через Vael">
                <PendingRow label="Local notifications"         desc="Системные уведомления Windows" />
                <PendingRow label="Push: when actions required" desc="Когда клод ждёт подтверждения" />
                <PendingRow label="Push: when Claude decides"   desc="Когда клод принял решение" />
              </PendingSection>
            </>)}

          </div>
        </div>
      </div>
    </div>
  )
}
