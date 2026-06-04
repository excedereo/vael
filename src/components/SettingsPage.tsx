import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, ExternalLink, Plus, RotateCcw, Trash2, HardDrive, Loader2 } from 'lucide-react'
import { api } from '../lib/api.js'
import { cn } from '../lib/utils.js'
import { WindowControls } from './WindowControls.js'
import { loadActiveThemeFile } from '../lib/theme.js'
import { BUILTIN_THEMES } from '../lib/builtinThemes.js'
import {
  AVATAR_SLOTS,
  TAG_COLORS,
  loadSlotOverrides,
  saveSlotOverrides,
  resolveSlotSrc,
  SlotOverrides,
} from '../lib/avatarSlots.js'
import {
  Section, ToggleRow, SelectRow, TextRow, LockedRow,
  PendingSection, PendingRow, SettingRow, ThemePicker, PtyOptSection,
} from './SettingsComponents.js'

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

// Settings stored in localStorage (Vael-only)
interface UISettings {
  reduceMotion: boolean
  showTurnDuration: boolean
  autoScroll: boolean
  contentPadding: number
}

export const DEFAULT_CONTENT_PADDING = 160

type Tab = 'interface' | 'icons' | 'claude' | 'system'

const EFFORT_OPTIONS   = ['low', 'medium', 'high', 'xhigh', 'max']
const PERMISSION_OPTIONS = ['bypassPermissions', 'plan']
const OUTPUT_OPTIONS   = ['default', 'compact', 'verbose']
const UPDATE_OPTIONS   = ['latest', 'beta', 'disabled']
const NOTIF_OPTIONS    = ['auto', 'always', 'never']

function loadUISettings(): UISettings {
  try {
    const s = localStorage.getItem('vaeliUISettings')
    const parsed = s ? JSON.parse(s) : {}
    return { reduceMotion: false, showTurnDuration: false, autoScroll: true, contentPadding: DEFAULT_CONTENT_PADDING, ...parsed }
  } catch { return { reduceMotion: false, showTurnDuration: false, autoScroll: true, contentPadding: DEFAULT_CONTENT_PADDING } }
}

function saveUISettings(s: UISettings) {
  localStorage.setItem('vaeliUISettings', JSON.stringify(s))
}

// PTY-recommended values вЂ” applied when applyPtyOptimizations is true
const PTY_RECOMMENDED: Partial<ClaudeSettings> = {
  promptSuggestionEnabled: false,
  spinnerTipsEnabled:       false,
  skipCopyPicker:           false,
}

function SlotCard({ slot, slotOverrides, updateSlot }: {
  slot: typeof AVATAR_SLOTS[0]
  slotOverrides: SlotOverrides
  updateSlot: (id: string, path: string | null | undefined) => void
}) {
  const src = resolveSlotSrc(slot.id, slotOverrides)
  const isOverridden = slot.id in slotOverrides
  const isDeleted = isOverridden && slotOverrides[slot.id] === null
  return (
    <div
      className="flex gap-4 p-4 rounded-xl border border-border-subtle hover:border-border-default transition-all duration-150"
    >
      <button
        onClick={async (e) => {
          const picked = await api.pickAvatar()
          if (picked) updateSlot(slot.id, picked)
        }}
        className="w-24 h-24 shrink-0 group"
      >
        {src
          ? <img src={src} className="w-full h-full object-contain" />
          : <div className="w-full h-full rounded-2xl border-2 border-dashed border-border-default flex items-center justify-center group-hover:border-white/25 transition-colors">
              <Plus size={26} className="text-text-ghost group-hover:text-text-faint transition-colors" />
            </div>
        }
      </button>
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] text-text-secondary font-medium">{slot.label}</span>
          {slot.tag && <span className={cn('text-[11px] px-1.5 py-0.5 rounded-md font-medium', slot.tagColor)}>{slot.tag}</span>}
        </div>
        <div className="text-[12px] text-text-faint mt-0.5">
          {isOverridden && slotOverrides[slot.id]
            ? slotOverrides[slot.id]!.split(/[/\\]/).pop()
            : slot.builtinSrc ? 'С„Р°Р№Р»: РІСЃС‚СЂРѕРµРЅРЅС‹Р№' : 'С„Р°Р№Р»: РЅРµ СѓРєР°Р·Р°РЅ'
          }
        </div>
        {slot.desc && <div className="text-[11px] text-text-ghost mt-0.5">{slot.desc}</div>}
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => updateSlot(slot.id, undefined)}
            disabled={!isOverridden}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] border transition-colors',
              isOverridden ? 'border-border-strong text-text-muted hover:text-text-primary hover:border-white/25' : 'border-border-subtle text-text-ghost cursor-not-allowed')}
          >
            <RotateCcw size={11} />РЎР±СЂРѕСЃРёС‚СЊ
          </button>
          <button
            onClick={() => updateSlot(slot.id, null)}
            disabled={isDeleted}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] border transition-colors',
              !isDeleted ? 'border-border-strong text-red-400/55 hover:text-red-400/90 hover:border-red-400/30' : 'border-border-subtle text-text-ghost cursor-not-allowed')}
          >
            <Trash2 size={11} />РЈРґР°Р»РёС‚СЊ
          </button>
        </div>
      </div>
    </div>
  )
}

function IconsTab({ slotOverrides, updateSlot }: {
  slotOverrides: SlotOverrides
  updateSlot: (id: string, path: string | null | undefined) => void
}) {
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const allTags = Object.keys(TAG_COLORS)

  const filtered = AVATAR_SLOTS.filter(s => {
    const matchSearch = !search || s.label.toLowerCase().includes(search.toLowerCase())
    const matchTag = !activeTag || s.tag === activeTag
    return matchSearch && matchTag
  })

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="РџРѕРёСЃРє РїРѕ РЅР°Р·РІР°РЅРёСЋ..."
          className="flex-1 bg-surface-hover border border-border-default rounded-lg px-3 py-2 text-[13px] text-text-secondary placeholder:text-text-ghost outline-none focus:border-border-strong transition-colors"
        />
        <div className="flex gap-1.5">
          <button
            onClick={() => setActiveTag(null)}
            className={cn('px-3 py-2 rounded-lg text-[13px] border transition-colors',
              !activeTag ? 'border-border-strong text-text-secondary' : 'border-border-default text-text-faint hover:text-text-muted')}
          >
            Р’СЃРµ
          </button>
          {allTags.map(tag => (
            <button
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={cn('px-3 py-2 rounded-lg text-[13px] border transition-colors',
                activeTag === tag ? cn(TAG_COLORS[tag], 'border-transparent') : 'border-border-default text-text-faint hover:text-text-muted')}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {filtered.map(slot => (
          <SlotCard key={slot.id} slot={slot} slotOverrides={slotOverrides} updateSlot={updateSlot} />
        ))}
      </div>
    </div>
  )
}


export function SettingsPage({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>('interface')
  const [claude, setClaude] = useState<ClaudeSettings>({})
  const [saving, setSaving] = useState(false)
  const [version, setVersion] = useState<string>('')
  const [uiSettings, setUiSettings] = useState<UISettings>(() => loadUISettings())

  const updateUI = (patch: Partial<UISettings>) => {
    const next = { ...uiSettings, ...patch }
    setUiSettings(next)
    saveUISettings(next)
    window.dispatchEvent(new Event('vaeli:uiSettingsChanged'))
  }
  const [slotOverrides, setSlotOverrides] = useState<SlotOverrides>(() => loadSlotOverrides())

  const updateSlot = (id: string, path: string | null | undefined) => {
    const next = { ...slotOverrides }
    if (path === undefined) {
      delete next[id]  // СЃР±СЂРѕСЃ Рє РґРµС„РѕР»С‚Сѓ
    } else {
      next[id] = path  // null = РїСѓСЃС‚РѕС‚Р°, string = РєР°СЃС‚РѕРјРЅС‹Р№ РїСѓС‚СЊ
    }
    setSlotOverrides(next)
    saveSlotOverrides(next)
    window.dispatchEvent(new Event('vaeli:avatarSlotsChanged'))
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

  const [devConsole, setDevConsole] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('vaeliDevConsole') ?? 'false') } catch { return false }
  })

  const [showDev, setShowDev] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('vaeliDevConsole') || 'false') } catch { return false }
  })

  const [applyPty, setApplyPty] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('vaeliApplyPtyOptimizations') ?? 'true') }
    catch { return true }
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

  useEffect(() => {
    api.tempGetSettings().then(s => {
      if (s.tempAutoDelete) setTempAutoDelete(s.tempAutoDelete as string)
    })
    api.tempGetDirSize().then(s => setTempDirSize(s))
  }, [])

  useEffect(() => {
    api.getSettings().then(s => {
      const cs = s as ClaudeSettings
      setClaude({ ...cs, verbose: true })
    })
    api.getClaudeVersion().then(v => setVersion(v || ''))
  }, [])

  const updateClaude = async (patch: Partial<ClaudeSettings>) => {
    const ptyPatch = applyPty ? PTY_RECOMMENDED : {}
    const next = { ...claude, ...patch, ...ptyPatch, verbose: true }
    setClaude(next)
    setSaving(true)
    await api.saveSettings(next)
    setSaving(false)
  }

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

  const toggleApplyPty = async (v: boolean) => {
    setApplyPty(v)
    localStorage.setItem('vaeliApplyPtyOptimizations', JSON.stringify(v))
    // Apply immediately
    const ptyPatch = v ? PTY_RECOMMENDED : {}
    const next = { ...claude, ...ptyPatch, verbose: true }
    setClaude(next)
    setSaving(true)
    await api.saveSettings(next)
    setSaving(false)
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'interface', label: 'РРЅС‚РµСЂС„РµР№СЃ' },
    { id: 'icons',     label: 'РРєРѕРЅРєРё' },
    { id: 'claude',    label: 'Claude' },
    { id: 'system',    label: 'РЎРёСЃС‚РµРјР°' },
  ]

  return (
    <div className="flex flex-col h-full bg-bg-base">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 border-b border-border-subtle app-drag-region h-10 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-surface-selected transition-colors text-text-muted hover:text-text-secondary no-drag"
        >
          <ArrowLeft size={15} />
        </button>
        <h1 className="text-[14px] font-semibold text-text-primary flex-1">Settings</h1>
        {saving && <span className="text-[12px] text-text-faint">Saving...</span>}
        <div className="no-drag">
          <WindowControls />
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-y-auto">
        <div className={cn(
          "flex w-full mx-auto transition-all duration-300",
          "max-w-6xl"
        )}>
          {/* Sidebar */}
          <div className="w-44 shrink-0 py-4 flex flex-col gap-0.5 px-3">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg text-[14px] transition-all duration-150',
                  'hover:bg-surface-hover active:scale-[0.98]',
                  tab === t.id
                    ? 'text-text-primary bg-surface-selected font-medium'
                    : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Content */}
          {tab === 'icons' ? (
            <div className="flex-1 overflow-y-auto py-5 px-6 border-l border-border-subtle">
              <IconsTab slotOverrides={slotOverrides} updateSlot={updateSlot} />
            </div>
          ) : (
            <div className="flex-1 py-5 px-8 space-y-5 border-l border-border-subtle overflow-y-auto">

              {/* в”Ђв”Ђ INTERFACE TAB в”Ђв”Ђ */}
              {tab === 'interface' && (<>
                <SettingRow label="РўРµРјР°">
                  <ThemePicker themes={themes} activeThemeFile={activeThemeFile} setActiveThemeFile={setActiveThemeFile} />
                </SettingRow>

                <Section label="РћС‚РѕР±СЂР°Р¶РµРЅРёРµ">
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm text-text-primary">РћС‚СЃС‚СѓРї РєРѕРЅС‚РµРЅС‚Р°</span>
                      <span className="text-xs text-text-muted">Р‘РѕРєРѕРІС‹Рµ РѕС‚СЃС‚СѓРїС‹ С‡Р°С‚Р° Рё РёРЅРїСѓС‚Р°</span>
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

                <PendingSection label="РџСЂРѕС‡РµРµ" reason="Р‘СѓРґРµС‚ СЂРµР°Р»РёР·РѕРІР°РЅРѕ РІ РёРЅС‚РµСЂС„РµР№СЃРµ Vael">
                  <PendingRow label="Reduce motion"      desc="РЈР±СЂР°С‚СЊ Р°РЅРёРјР°С†РёРё РІ РёРЅС‚РµСЂС„РµР№СЃРµ" />
                  <PendingRow label="Show turn duration" desc="РџРѕРєР°Р·С‹РІР°С‚СЊ РІСЂРµРјСЏ РІС‹РїРѕР»РЅРµРЅРёСЏ РєР°Р¶РґРѕРіРѕ РѕС‚РІРµС‚Р°" />
                  <PendingRow label="Auto-scroll"        desc="РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРё СЃРєСЂРѕР»Р»РёС‚СЊ РІРЅРёР· РїСЂРё РЅРѕРІС‹С… СЃРѕРѕР±С‰РµРЅРёСЏС…" />
                </PendingSection>
              </>)}

              {/* в”Ђв”Ђ CLAUDE TAB в”Ђв”Ђ */}
              {tab === 'claude' && (<>
                <Section label="РџРѕРІРµРґРµРЅРёРµ">
                  <ToggleRow claude label="Auto-compact"              desc="РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРё СЃР¶РёРјР°С‚СЊ РєРѕРЅС‚РµРєСЃС‚ РєРѕРіРґР° РѕРЅ Р·Р°РїРѕР»РЅСЏРµС‚СЃСЏ"            value={claude.autoCompactEnabled ?? true}        onChange={v => updateClaude({ autoCompactEnabled: v })} />
                  <ToggleRow claude label="Thinking mode"             desc="Р Р°СЃС€РёСЂРµРЅРЅРѕРµ РјС‹С€Р»РµРЅРёРµ РґР»СЏ РїРѕРґРґРµСЂР¶РёРІР°РµРјС‹С… РјРѕРґРµР»РµР№ (Opus, Sonnet)" value={claude.alwaysThinkingEnabled ?? true}      onChange={v => updateClaude({ alwaysThinkingEnabled: v })} />
                  <ToggleRow claude label="Session recap"             desc="РљСЂР°С‚РєРѕРµ СЂРµР·СЋРјРµ СЃРµСЃСЃРёРё РїСЂРё РІРѕР·РІСЂР°С‰РµРЅРёРё СЃРїСѓСЃС‚СЏ РІСЂРµРјСЏ"             value={claude.awaySummaryEnabled ?? false}        onChange={v => updateClaude({ awaySummaryEnabled: v })} />
                  <ToggleRow claude label="Rewind code"               desc="РЎРѕС…СЂР°РЅСЏС‚СЊ С‡РµРєРїРѕРёРЅС‚С‹ С„Р°Р№Р»РѕРІ РґР»СЏ РІРѕР·РјРѕР¶РЅРѕСЃС‚Рё РѕС‚РєР°С‚Р°"              value={claude.fileCheckpointingEnabled ?? true}   onChange={v => updateClaude({ fileCheckpointingEnabled: v })} />
                  <ToggleRow claude label="Use auto mode during plan" desc="РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРё РїРµСЂРµРєР»СЋС‡Р°С‚СЊСЃСЏ РІ auto-СЂРµР¶РёРј РІРѕ РІСЂРµРјСЏ РїР»Р°РЅРёСЂРѕРІР°РЅРёСЏ"  value={claude.useAutoModeDuringPlan ?? true}      onChange={v => updateClaude({ useAutoModeDuringPlan: v })} />
                </Section>

                <Section label="РџРѕ СѓРјРѕР»С‡Р°РЅРёСЋ">
                  <SelectRow claude label="Effort level"       value={claude.effortLevel || 'medium'}            options={EFFORT_OPTIONS}     onChange={v => updateClaude({ effortLevel: v })} />
                  <SelectRow claude label="Permission mode"    value={claude.defaultPermissionMode || 'default'}  options={PERMISSION_OPTIONS}  onChange={v => updateClaude({ defaultPermissionMode: v })} />
                </Section>

                <Section label="Р¤Р°Р№Р»С‹">
                  <ToggleRow claude label="Respect .gitignore" desc="РЎРєСЂС‹РІР°С‚СЊ .gitignored С„Р°Р№Р»С‹ РІ С„Р°Р№Р»РѕРІРѕРј РїРёРєРµСЂРµ" value={claude.respectGitignore ?? true} onChange={v => updateClaude({ respectGitignore: v })} />
                  <TextRow   claude label="Worktree base ref"  desc="Р‘Р°Р·РѕРІР°СЏ РІРµС‚РєР° РґР»СЏ git worktree СЂРµР¶РёРјР°"        value={claude.worktreeBaseRef || ''} placeholder="main" onChange={v => updateClaude({ worktreeBaseRef: v })} />
                </Section>

                <Section label="РРЅС‚РµРіСЂР°С†РёРё">
                  <ToggleRow claude label="Claude in Chrome"      desc="Р Р°СЃС€РёСЂРµРЅРёРµ Chrome Р°РєС‚РёРІРЅРѕ РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ"  value={claude.claudeInChromeDefaultEnabled ?? true} onChange={v => updateClaude({ claudeInChromeDefaultEnabled: v })} />
                  <ToggleRow claude label="Enable Remote Control" desc="Р Р°Р·СЂРµС€РёС‚СЊ СѓРґР°Р»С‘РЅРЅРѕРµ СѓРїСЂР°РІР»РµРЅРёРµ СЃРµСЃСЃРёСЏРјРё" value={claude.remoteControlAtStartup ?? false}      onChange={v => updateClaude({ remoteControlAtStartup: v })} />
                </Section>

                <Section label="РўРµС…РЅРёС‡РµСЃРєРёРµ">
                  <LockedRow label="Output style"   desc="РћР±СЏР·Р°С‚РµР»СЊРЅРѕ РґР»СЏ СЂР°Р±РѕС‚С‹ Vael вЂ” РЅРµР»СЊР·СЏ РѕС‚РєР»СЋС‡РёС‚СЊ" value="Default" />
                  <LockedRow label="Verbose output" desc="РћР±СЏР·Р°С‚РµР»СЊРЅРѕ РґР»СЏ СЂР°Р±РѕС‚С‹ Vael вЂ” РЅРµР»СЊР·СЏ РѕС‚РєР»СЋС‡РёС‚СЊ" value="Р’РєР»СЋС‡С‘РЅ" />
                </Section>

                <PtyOptSection applyPty={applyPty} onToggle={toggleApplyPty} />
              </>)}

              {/* в”Ђв”Ђ SYSTEM TAB в”Ђв”Ђ */}
              {tab === 'system' && (<>
                <Section label="Р’СЂРµРјРµРЅРЅС‹Рµ С„Р°Р№Р»С‹">
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2">
                      <HardDrive size={13} className="text-text-faint" />
                      <div>
                        <div className="text-[14px] text-text-secondary">РџР°РїРєР° temp</div>
                        <div className="text-[12px] text-text-faint mt-0.5">
                          {tempDirSize
                            ? `${tempDirSize.count} С„Р°Р№Р»РѕРІ В· ${(tempDirSize.bytes / 1024).toFixed(1)} KB`
                            : 'Р—Р°РіСЂСѓР·РєР°...'}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={handleTempClear}
                      disabled={tempClearing}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] border transition-colors',
                        tempClearing
                          ? 'border-border-subtle text-text-ghost cursor-not-allowed'
                          : 'border-border-default text-text-muted hover:text-red-400 hover:border-red-400/30',
                      )}
                    >
                      {tempClearing ? (
                        <>
                          <Loader2 size={11} className="animate-spin" />
                          РћС‚РјРµРЅР°? ({tempClearCountdown}СЃ)
                        </>
                      ) : (
                        <>
                          <Trash2 size={11} />
                          РћС‡РёСЃС‚РёС‚СЊ
                        </>
                      )}
                    </button>
                  </div>
                  {tempClearing && (
                    <div className="px-4 pb-3">
                      <button
                        onClick={() => { tempClearCancelRef.current = true }}
                        className="text-[12px] text-text-faint hover:text-text-secondary transition-colors"
                      >
                        РћС‚РјРµРЅРёС‚СЊ РѕС‡РёСЃС‚РєСѓ
                      </button>
                    </div>
                  )}
                  <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle">
                    <div>
                      <div className="text-[14px] text-text-secondary">РђРІС‚Рѕ-СѓРґР°Р»РµРЅРёРµ РїСЂРё Р·Р°РїСѓСЃРєРµ</div>
                      <div className="text-[12px] text-text-faint mt-0.5">РЈРґР°Р»СЏС‚СЊ С„Р°Р№Р»С‹ СЃС‚Р°СЂС€Рµ СѓРєР°Р·Р°РЅРЅРѕРіРѕ РІСЂРµРјРµРЅРё</div>
                    </div>
                    <Dropdown
                      value={tempAutoDelete}
                      options={[
                        { value: '3h',    label: '3 С‡Р°СЃР°' },
                        { value: '6h',    label: '6 С‡Р°СЃРѕРІ' },
                        { value: '12h',   label: '12 С‡Р°СЃРѕРІ' },
                        { value: '1d',    label: '1 РґРµРЅСЊ' },
                        { value: '3d',    label: '3 РґРЅСЏ' },
                        { value: '7d',    label: '7 РґРЅРµР№' },
                        { value: '14d',   label: '14 РґРЅРµР№' },
                        { value: '1mo',   label: '1 РјРµСЃСЏС†' },
                        { value: 'never', label: 'РќРёРєРѕРіРґР°' },
                      ]}
                      onChange={async v => {
                        setTempAutoDelete(v)
                        await api.tempSaveSettings({ tempAutoDelete: v })
                      }}
                    />
                  </div>
                </Section>

                <Section label="РћР±РЅРѕРІР»РµРЅРёСЏ">
                  <ToggleRow
                    label="РђРІС‚Рѕ-РѕР±РЅРѕРІР»РµРЅРёРµ"
                    desc="РЎРєР°С‡РёРІР°С‚СЊ Рё СѓСЃС‚Р°РЅР°РІР»РёРІР°С‚СЊ РѕР±РЅРѕРІР»РµРЅРёСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё"
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
                        <div className="text-[12px] text-text-faint mt-0.5">РўРµРєСѓС‰Р°СЏ РІРµСЂСЃРёСЏ РїСЂРёР»РѕР¶РµРЅРёСЏ</div>
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
                  <SelectRow label="Claude CLI: РєР°РЅР°Р» РѕР±РЅРѕРІР»РµРЅРёР№" value={claude.autoUpdatesChannel || 'latest'} options={UPDATE_OPTIONS} onChange={v => updateClaude({ autoUpdatesChannel: v })} />
                  {version && (
                    <div className="flex items-center justify-between px-4 py-3">
                      <div>
                        <div className="text-[14px] text-text-secondary">Claude Code CLI</div>
                        <div className="text-[12px] text-text-faint mt-0.5">РўРµРєСѓС‰Р°СЏ РІРµСЂСЃРёСЏ</div>
                      </div>
                      <a
                        href={`https://github.com/anthropics/claude-code/releases/tag/v${version}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 text-[13px] transition-colors"
                        style={{ color: 'color-mix(in srgb, var(--accent) 70%, transparent)' }}
                        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'var(--accent)')}
                        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'color-mix(in srgb, var(--accent) 70%, transparent)')}
                        onClick={e => { e.preventDefault(); api.openExternal(`https://github.com/anthropics/claude-code/releases`) }}
                      >
                        v{version}
                        <ExternalLink size={10} />
                      </a>
                    </div>
                  )}
                </Section>

                <Section label="Developer">
                  <ToggleRow
                    label="Р’РєР»СЋС‡РёС‚СЊ Dev-РЅР°СЃС‚СЂРѕР№РєРё"
                    desc="РџРѕРєР°Р·Р°С‚СЊ СЂР°СЃС€РёСЂРµРЅРЅС‹Рµ РЅР°СЃС‚СЂРѕР№РєРё РґР»СЏ СЂР°Р·СЂР°Р±РѕС‚С‡РёРєРѕРІ"
                    value={showDev}
                    onChange={v => setShowDev(v)}
                  />
                  {showDev && (
                    <ToggleRow
                      label="Developer console"
                      desc="РџРѕРєР°Р·С‹РІР°С‚СЊ РІРєР»Р°РґРєСѓ Console РІ СЃР°Р№РґР±Р°СЂРµ СЃ Р»РѕРіР°РјРё main process"
                      value={devConsole}
                      onChange={v => {
                        setDevConsole(v)
                        localStorage.setItem('vaeliDevConsole', JSON.stringify(v))
                        window.dispatchEvent(new Event('vaeli:devConsoleChanged'))
                      }}
                    />
                  )}
                </Section>

                <PendingSection label="РЈРІРµРґРѕРјР»РµРЅРёСЏ" reason="Р‘СѓРґРµС‚ СЂРµР°Р»РёР·РѕРІР°РЅРѕ С‡РµСЂРµР· Vael">
                  <PendingRow label="Local notifications"         desc="РЎРёСЃС‚РµРјРЅС‹Рµ СѓРІРµРґРѕРјР»РµРЅРёСЏ Windows" />
                  <PendingRow label="Push: when actions required" desc="РљРѕРіРґР° РєР»РѕРґ Р¶РґС‘С‚ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ" />
                  <PendingRow label="Push: when Claude decides"   desc="РљРѕРіРґР° РєР»РѕРґ РїСЂРёРЅСЏР» СЂРµС€РµРЅРёРµ" />
                </PendingSection>
              </>)}

            </div>
          )}
        </div>
      </div>
    </div>
  )
}

