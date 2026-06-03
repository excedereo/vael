import { useState, useEffect, useRef, useCallback } from 'react'
import { File, Folder, Pin, Trash2, X, Eye, Code2, Pencil } from 'lucide-react'
import { api, FsEntry } from '../lib/api.js'
import authLogo from '../assets/auth-logo.png'

interface Props {
  onBack: () => void
}

interface Tab {
  path: string
  name: string
  pinned?: boolean
}

// ── Markdown renderer ──────────────────────────────────────────────────────

function inlineFormat(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:12px">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span style="color:var(--accent);text-decoration:underline;cursor:pointer">$1</span>')
}

function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.split('\n')
  const out: React.ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(lines[i]); i++ }
      out.push(<pre key={i} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '12px 16px', margin: '8px 0', overflowX: 'auto', fontSize: 13, fontFamily: 'monospace', color: 'rgba(255,255,255,0.7)' }}>
        {lang && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>{lang}</div>}
        <code>{code.join('\n')}</code>
      </pre>)
      i++; continue
    }
    if (line.startsWith('### ')) out.push(<h3 key={i} style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)', margin: '16px 0 4px' }}>{line.slice(4)}</h3>)
    else if (line.startsWith('## ')) out.push(<h2 key={i} style={{ fontSize: 17, fontWeight: 600, color: 'rgba(255,255,255,0.9)', margin: '20px 0 6px', paddingBottom: 4, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>{line.slice(3)}</h2>)
    else if (line.startsWith('# ')) out.push(<h1 key={i} style={{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.95)', margin: '8px 0 8px' }}>{line.slice(2)}</h1>)
    else if (/^[-*_]{3,}$/.test(line)) out.push(<hr key={i} style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '12px 0' }} />)
    else if (/^[-*+] /.test(line)) out.push(<div key={i} style={{ display: 'flex', gap: 8, fontSize: 14, color: 'rgba(255,255,255,0.65)', margin: '2px 0' }}>
      <span style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>•</span>
      <span dangerouslySetInnerHTML={{ __html: inlineFormat(line.slice(2)) }} />
    </div>)
    else if (line.trim() === '') out.push(<div key={i} style={{ height: 8 }} />)
    else out.push(<p key={i} style={{ fontSize: 14, color: 'rgba(255,255,255,0.65)', lineHeight: 1.7, margin: '2px 0' }} dangerouslySetInnerHTML={{ __html: inlineFormat(line) }} />)
    i++
  }
  return <div>{out}</div>
}

// ── Ghost item (inline rename/create) ─────────────────────────────────────

function GhostItem({ type, initialName, onCommit, onCancel }: {
  type: 'file' | 'dir'
  initialName?: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [val, setVal] = useState(initialName ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const commit = () => {
    const name = val.trim()
    if (name) onCommit(name)
    else onCancel()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 108, padding: '12px 8px' }}>
      <div style={{ width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.15)' }}>
        {type === 'dir'
          ? <Folder size={40} style={{ color: 'rgba(251,191,36,0.5)' }} />
          : <File size={34} style={{ color: 'rgba(255,255,255,0.25)' }} />}
      </div>
      <input
        ref={inputRef}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel() }}
        onBlur={commit}
        style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '3px 6px', fontSize: 12, color: 'rgba(255,255,255,0.9)', outline: 'none', textAlign: 'center' }}
      />
    </div>
  )
}

// ── Claude logo SVG ───────────────────────────────────────────────────────

function ClaudeLogo({ size = 36 }: { size?: number }) {
  return (
    <img src={authLogo} width={size} height={size} style={{ objectFit: 'contain', opacity: 0.9 }} />
  )
}

// ── CLAUDE.md split helper ─────────────────────────────────────────────────

const VAEL_BLOCK_START = '<!-- [VAEL MEMORY] -->'
const VAEL_BLOCK_END = '<!-- [/VAEL MEMORY] -->'

function splitClaudeMd(content: string): { user: string; auto: string } {
  const startIdx = content.indexOf(VAEL_BLOCK_START)
  const endIdx = content.indexOf(VAEL_BLOCK_END)
  if (startIdx === -1 || endIdx === -1) return { user: content, auto: '' }
  const user = content.slice(0, startIdx).trimEnd()
  const auto = content.slice(startIdx + VAEL_BLOCK_START.length, endIdx).trim()
  return { user, auto }
}

const MEMORY_SECTIONS: { prefix: string; color: string; label: string }[] = [
  { prefix: '## Always loaded:', color: '#f59e0b', label: 'Always loaded' },
  { prefix: '## Available on demand', color: '#6366f1', label: 'Available on demand' },
  { prefix: '## Individual files on demand:', color: '#10b981', label: 'Individual files on demand' },
  { prefix: '## Tags:', color: '#ec4899', label: 'Tags' },
]

function AutoBlockRenderer({ content }: { content: string }) {
  // Split content into sections by ## headings
  const lines = content.split('\n')
  type Section = { title: string; color: string; lines: string[] }
  const sections: Section[] = []
  let currentSection: Section | null = null
  let headerLines: string[] = []

  for (const line of lines) {
    const sectionDef = MEMORY_SECTIONS.find(s => line.startsWith(s.prefix))
    if (sectionDef) {
      if (currentSection) sections.push(currentSection)
      currentSection = { title: sectionDef.label, color: sectionDef.color, lines: [] }
    } else if (!currentSection) {
      headerLines.push(line)
    } else {
      currentSection.lines.push(line)
    }
  }
  if (currentSection) sections.push(currentSection)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {headerLines.filter(l => l.trim()).length > 0 && (
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', margin: 0 }}>{headerLines.filter(l => l.trim()).join(' ')}</p>
      )}
      {sections.map((sec, i) => (
        <div key={i} style={{ borderRadius: 10, border: `2px solid ${sec.color}55`, overflow: 'hidden' }}>
          <div style={{ padding: '6px 14px', background: `${sec.color}18`, borderBottom: `2px solid ${sec.color}55`, display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: sec.color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{sec.title}</span>
          </div>
          <div style={{ padding: '12px 16px' }}>
            {sec.title === 'Always loaded' ? (() => {
              // Split by ### file entries
              const raw = sec.lines.join('\n').trim()
              const chunks: string[] = []
              let cur: string[] = []
              // File entries are marked as "### rel/path.md" — contain / or .md
              const isFileHeader = (l: string) => l.startsWith('### ') && (l.includes('/') || l.endsWith('.md'))
              let skippedSep = false
              for (const line of raw.split('\n')) {
                if (isFileHeader(line) && cur.length > 0) { chunks.push(cur.join('\n')); cur = [line]; skippedSep = false }
                else if (line.trim() === '---' && !skippedSep) { skippedSep = true; continue }
                else cur.push(line)
              }
              if (cur.length > 0) chunks.push(cur.join('\n'))
              return <>
                {chunks.map((chunk, ci) => (
                  <div key={ci}>
                    {ci > 0 && <div style={{ height: 2, background: '#f59e0b55', margin: '14px 0', borderRadius: 1 }} />}
                    <MarkdownRenderer content={chunk} />
                  </div>
                ))}
              </>
            })() : (
              <MarkdownRenderer content={sec.lines.join('\n').trim()} />
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function MemoryPage({ onBack }: Props) {
  const [memoryDir, setMemoryDir] = useState('')
  const [claudeMdPath, setClaudeMdPath] = useState('')
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [dirStack, setDirStack] = useState<string[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [contents, setContents] = useState<Record<string, string>>({})
  const [viewMode, setViewMode] = useState<Record<string, 'raw' | 'rendered'>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry?: FsEntry } | null>(null)
  const [showNew, setShowNew] = useState<'file' | 'dir' | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const currentDirPath = dirStack.at(-1)

  const loadEntries = useCallback(async (dirPath?: string) => {
    const r = await api.memoryListDir(dirPath)
    if (r.ok) setEntries(r.entries as FsEntry[])
  }, [])

  useEffect(() => {
    Promise.all([api.memoryGetDir(), api.memoryGetClaudeMd()]).then(([dir, cm]) => {
      setMemoryDir(dir)
      setClaudeMdPath(cm.path)
      if (cm.ok) setContents(prev => ({ ...prev, [cm.path]: cm.content }))
      loadEntries()
    })
  }, [loadEntries])

  const openFile = useCallback(async (path: string, name: string, pinned?: boolean) => {
    setTabs(prev => prev.find(t => t.path === path) ? prev : [...prev, { path, name, pinned }])
    setActiveTab(path)
    const r = await api.memoryReadFile(path)
    if (r.ok) {
      setContents(prev => ({ ...prev, [path]: r.content }))
      setViewMode(prev => ({ ...prev, [path]: prev[path] ?? (r.content.trim() ? 'rendered' : 'raw') }))
    }
  }, [])

  const closeTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setTabs(prev => {
      const next = prev.filter(t => t.path !== path)
      if (activeTab === path) setActiveTab(next.at(-1)?.path ?? null)
      return next
    })
  }

  const handleEdit = (val: string) => {
    if (!activeTab) return
    setContents(prev => ({ ...prev, [activeTab]: val }))
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      await api.memoryWriteFile(activeTab, val)
      setSaving(false)
      await loadEntries(currentDirPath)
    }, 800)
  }

  const handleCreate = async (name: string) => {
    if (!name.trim()) { setShowNew(null); return }
    if (showNew === 'file') {
      const finalName = name.endsWith('.md') ? name : name + '.md'
      const r = await api.memoryCreateFile(finalName, currentDirPath)
      if (r.ok && r.path) {
        await loadEntries(currentDirPath)
        openFile(r.path, finalName)
      }
    } else if (showNew === 'dir') {
      const r = await api.memoryCreateDir(name, currentDirPath)
      if (r.ok) await loadEntries(currentDirPath)
    }
    setShowNew(null)
  }

  const handleRename = async (entry: FsEntry, newName: string) => {
    if (!newName.trim() || newName === entry.name) { setRenamingPath(null); return }
    const finalName = entry.type === 'file' && !newName.includes('.') ? newName + '.md' : newName
    const r = await api.memoryRename(entry.path, finalName)
    if (r.ok) {
      // update open tabs if renamed
      if (entry.type === 'file') {
        setTabs(prev => prev.map(t => t.path === entry.path ? { ...t, path: r.path!, name: finalName } : t))
        if (activeTab === entry.path) setActiveTab(r.path!)
      }
      await loadEntries(currentDirPath)
    }
    setRenamingPath(null)
  }

  const handleDelete = async (entry: FsEntry) => {
    await api.memoryDeleteFile(entry.path)
    if (entry.type === 'file') {
      setTabs(prev => prev.filter(t => t.path !== entry.path))
      if (activeTab === entry.path) setActiveTab(null)
    }
    await loadEntries(currentDirPath)
    setCtxMenu(null)
  }

  const enterDir = async (path: string) => {
    setDirStack(prev => [...prev, path])
    await loadEntries(path)
  }

  const goUp = async () => {
    const next = dirStack.slice(0, -1)
    setDirStack(next)
    await loadEntries(next.at(-1))
  }

  useEffect(() => {
    if (!ctxMenu) return
    const h = () => setCtxMenu(null)
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [ctxMenu])

  const isMd = (p: string | null) => !!p && /\.md$/i.test(p)
  const activeContent = activeTab ? (contents[activeTab] ?? '') : ''
  const activeViewMode = activeTab ? (viewMode[activeTab] ?? 'raw') : 'raw'


  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', height: 40, flexShrink: 0, overflow: 'hidden' }}>
        <button
          onClick={() => setActiveTab(null)}
          style={tabBtnStyle(activeTab === null)}
        >
          <Folder size={12} />
          memory
        </button>

        <div style={{ display: 'flex', gap: 2, flex: 1, overflow: 'hidden' }}>
          {tabs.map(tab => (
            <div key={tab.path} onClick={() => setActiveTab(tab.path)} style={tabStyle(activeTab === tab.path)}>
              {tab.pinned ? <Pin size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} /> : <File size={11} style={{ flexShrink: 0 }} />}
              <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tab.name}</span>
              {!tab.pinned && (
                <button onClick={e => closeTab(tab.path, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center' }}>
                  <X size={11} />
                </button>
              )}
            </div>
          ))}
        </div>

        {activeTab && isMd(activeTab) && (
          <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 2, flexShrink: 0 }}>
            {(['rendered', 'raw'] as const).map(mode => (
              <button key={mode} onClick={() => setViewMode(prev => ({ ...prev, [activeTab]: mode }))}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 500, background: activeViewMode === mode ? 'rgba(255,255,255,0.12)' : 'transparent', color: activeViewMode === mode ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)', transition: 'background 0.15s, color 0.15s' }}
              >
                {mode === 'rendered' ? <Eye size={13} /> : <Code2 size={13} />}
                {mode === 'rendered' ? 'Rendered' : 'Raw'}
              </button>
            ))}
          </div>
        )}

        {saving && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>saving…</span>}
      </div>

      {/* ── Body ── */}
      {activeTab === null ? (
        <div
          style={{ flex: 1, overflowY: 'auto', padding: 24, position: 'relative' }}
          onClick={e => { if (e.target === e.currentTarget) { setSelected(null); setCtxMenu(null) } }}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY }) }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>

            {/* .. back */}
            {dirStack.length > 0 && (
              <button onDoubleClick={goUp} style={itemStyle(false)}>
                <div style={iconWrap}><Folder size={52} style={{ color: 'rgba(255,255,255,0.15)' }} /></div>
                <span style={labelStyle}>..</span>
              </button>
            )}

            {/* pinned CLAUDE.md */}
            {dirStack.length === 0 && claudeMdPath && (
              renamingPath === claudeMdPath ? (
                <GhostItem type="file" initialName="CLAUDE.md" onCommit={name => handleRename({ name: 'CLAUDE.md', path: claudeMdPath, type: 'file' }, name)} onCancel={() => setRenamingPath(null)} />
              ) : (
                <button
                  onClick={e => { e.stopPropagation(); setSelected(claudeMdPath) }}
                  onDoubleClick={() => openFile(claudeMdPath, 'CLAUDE.md', true)}
                  onContextMenu={e => { e.stopPropagation(); e.preventDefault(); setSelected(claudeMdPath); setCtxMenu({ x: e.clientX, y: e.clientY, entry: { name: 'CLAUDE.md', path: claudeMdPath, type: 'file' } }) }}
                  style={itemStyle(selected === claudeMdPath)}
                >
                  <div style={{ ...iconWrap, background: 'rgba(200,100,60,0.12)', borderRadius: 14, position: 'relative' }}>
                    <ClaudeLogo size={40} />
                    <Pin size={11} style={{ position: 'absolute', top: -3, right: -3, color: 'var(--accent)' }} />
                  </div>
                  <span style={labelStyle}>CLAUDE.md</span>
                </button>
              )
            )}

            {/* entries */}
            {entries.map(entry => (
              renamingPath === entry.path ? (
                <GhostItem key={entry.path} type={entry.type} initialName={entry.name} onCommit={name => handleRename(entry, name)} onCancel={() => setRenamingPath(null)} />
              ) : (
                <button
                  key={entry.path}
                  onClick={e => { e.stopPropagation(); setSelected(entry.path) }}
                  onDoubleClick={() => entry.type === 'dir' ? enterDir(entry.path) : openFile(entry.path, entry.name)}
                  onContextMenu={e => { e.stopPropagation(); e.preventDefault(); setSelected(entry.path); setCtxMenu({ x: e.clientX, y: e.clientY, entry }) }}
                  style={itemStyle(selected === entry.path)}
                >
                  <div style={{ ...iconWrap, position: 'relative' }}>
                    {entry.type === 'dir'
                      ? <Folder size={52} style={{ color: 'rgba(251,191,36,0.75)' }} />
                      : <File size={42} style={{ color: 'rgba(255,255,255,0.35)' }} />}
                    {entry.auto && (
                      <span style={{ position: 'absolute', bottom: -2, right: -2, fontSize: 9, fontWeight: 700, background: 'var(--accent)', color: '#fff', borderRadius: 4, padding: '1px 4px', lineHeight: 1.4 }}>auto</span>
                    )}
                    {!entry.auto && entry.tag && (
                      <span style={{ position: 'absolute', bottom: -2, right: -2, fontSize: 9, fontWeight: 700, background: '#6366f1', color: '#fff', borderRadius: 4, padding: '1px 4px', lineHeight: 1.4 }}>{entry.tag}</span>
                    )}
                  </div>
                  <span style={labelStyle}>{entry.name}</span>
                </button>
              )
            ))}

            {/* ghost new item */}
            {showNew && (
              <GhostItem type={showNew} onCommit={handleCreate} onCancel={() => setShowNew(null)} />
            )}
          </div>

          {/* context menu */}
          {ctxMenu && (
            <div
              onMouseDown={e => e.stopPropagation()}
              style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999, background: 'rgba(28,28,28,0.98)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '4px 0', minWidth: 160, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
            >
              {ctxMenu.entry ? (<>
                <CtxItem icon={ctxMenu.entry.type === 'dir' ? <Folder size={13} /> : <File size={13} />} label="Открыть" onClick={() => {
                  if (ctxMenu.entry!.type === 'dir') enterDir(ctxMenu.entry!.path)
                  else openFile(ctxMenu.entry!.path, ctxMenu.entry!.name)
                  setCtxMenu(null)
                }} />
{ctxMenu.entry.path !== claudeMdPath && <>
                  <CtxItem icon={<Pencil size={13} />} label="Переименовать" onClick={() => { setRenamingPath(ctxMenu.entry!.path); setCtxMenu(null) }} />
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '4px 8px' }} />
                  <CtxItem icon={<Trash2 size={13} />} label="Удалить" danger onClick={() => handleDelete(ctxMenu.entry!)} />
                </>}
              </>) : (<>
                <CtxItem icon={<File size={13} />} label="Новый файл" onClick={() => { setShowNew('file'); setCtxMenu(null) }} />
                <CtxItem icon={<Folder size={13} />} label="Новая папка" onClick={() => { setShowNew('dir'); setCtxMenu(null) }} />
              </>)}
            </div>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          {isMd(activeTab) && activeViewMode === 'rendered' ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
              <div style={{ maxWidth: 720, margin: '0 auto' }}>
                {activeTab === claudeMdPath ? (() => {
                  const { user, auto } = splitClaudeMd(activeContent)
                  return <>
                    <MarkdownRenderer content={user} />
                    {auto && (
                      <div style={{ marginTop: 32, borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', overflow: 'hidden' }}>
                        <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Сгенерировано системой</span>
                        </div>
                        <div style={{ padding: '16px 20px' }}>
                          <AutoBlockRenderer content={auto} />
                        </div>
                      </div>
                    )}
                  </>
                })() : (
                  <MarkdownRenderer content={activeContent} />
                )}
              </div>
            </div>
          ) : (
            <textarea
              key={activeTab}
              defaultValue={activeTab === claudeMdPath ? splitClaudeMd(activeContent).user : activeContent}
              onChange={e => handleEdit(activeTab === claudeMdPath
                ? e.target.value + '\n\n' + VAEL_BLOCK_START + '\n' + splitClaudeMd(activeContent).auto + '\n' + VAEL_BLOCK_END
                : e.target.value
              )}
              spellCheck={false}
              style={{ flex: 1, resize: 'none', background: 'transparent', color: 'rgba(255,255,255,0.75)', fontFamily: 'monospace', fontSize: 13, padding: '24px 32px', outline: 'none', lineHeight: 1.65, border: 'none', minHeight: 0 }}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function CtxItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: danger ? '#f87171' : 'rgba(255,255,255,0.7)', textAlign: 'left' }}
      onMouseEnter={e => (e.currentTarget.style.background = danger ? 'rgba(248,113,113,0.1)' : 'rgba(255,255,255,0.06)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >
      {icon}{label}
    </button>
  )
}

const tabBtnStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6,
  fontSize: 13, cursor: 'pointer', flexShrink: 0, border: 'none',
  background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
  color: active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)',
})

const tabStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6,
  fontSize: 13, cursor: 'pointer', flexShrink: 0, userSelect: 'none',
  background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
  color: active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)',
})

const itemStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
  width: 108, padding: '12px 8px', borderRadius: 14, cursor: 'pointer', border: 'none',
  background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
  transition: 'background 0.1s',
})

const iconWrap: React.CSSProperties = {
  width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const labelStyle: React.CSSProperties = {
  fontSize: 12, color: 'rgba(255,255,255,0.6)', overflow: 'hidden',
  textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', textAlign: 'center',
}
