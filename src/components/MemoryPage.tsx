import { useState, useEffect, useCallback, useRef } from 'react'
import { File, Folder, Pin, Plus, Trash2, ChevronRight, X, Eye, Code2 } from 'lucide-react'
import { api, FsEntry } from '../lib/api.js'
import { cn } from '../lib/utils.js'

interface Props {
  onBack: () => void
}

interface OpenTab {
  path: string
  name: string
  pinned?: boolean
}

interface DirState {
  path: string
  entries: FsEntry[]
}

// Simple markdown renderer (headings, bold, italic, code blocks, lists)
function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      elements.push(
        <pre key={i} className="bg-bg-elevated rounded-lg px-4 py-3 my-2 overflow-x-auto text-[13px] text-text-secondary font-mono">
          {lang && <div className="text-[11px] text-text-faint mb-1">{lang}</div>}
          <code>{codeLines.join('\n')}</code>
        </pre>
      )
      i++
      continue
    }

    // Headings
    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-[15px] font-semibold text-text-primary mt-4 mb-1">{line.slice(4)}</h3>)
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-[17px] font-semibold text-text-primary mt-5 mb-1.5 border-b border-border-subtle pb-1">{line.slice(3)}</h2>)
    } else if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-[20px] font-bold text-text-primary mt-2 mb-2">{line.slice(2)}</h1>)
    }
    // Horizontal rule
    else if (line.match(/^[-*_]{3,}$/)) {
      elements.push(<hr key={i} className="border-border-subtle my-3" />)
    }
    // List item
    else if (line.match(/^[-*+] /)) {
      elements.push(
        <div key={i} className="flex gap-2 text-[14px] text-text-secondary my-0.5">
          <span className="text-text-faint shrink-0 mt-0.5">•</span>
          <span dangerouslySetInnerHTML={{ __html: inlineFormat(line.slice(2)) }} />
        </div>
      )
    }
    // Empty line
    else if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />)
    }
    // Normal paragraph
    else {
      elements.push(
        <p key={i} className="text-[14px] text-text-secondary leading-relaxed"
          dangerouslySetInnerHTML={{ __html: inlineFormat(line) }} />
      )
    }
    i++
  }

  return <div className="space-y-0.5">{elements}</div>
}

function inlineFormat(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code class="bg-bg-elevated px-1.5 py-0.5 rounded text-[13px] text-text-primary font-mono">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-text-primary font-semibold">$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em class="text-text-secondary">$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="text-accent underline cursor-pointer">$1</span>')
}

export function MemoryPage({ onBack }: Props) {
  const [memoryDir, setMemoryDir] = useState<string>('')
  const [claudeMdPath, setClaudeMdPath] = useState<string>('')
  const [dirStack, setDirStack] = useState<DirState[]>([])
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<Record<string, string>>({})
  const [editContent, setEditContent] = useState<Record<string, string>>({})
  const [viewMode, setViewMode] = useState<'rendered' | 'raw'>('rendered')
  const [saving, setSaving] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [showNewFile, setShowNewFile] = useState<'file' | 'dir' | null>(null)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry?: FsEntry } | null>(null)
  const ctxRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const currentDir = dirStack[dirStack.length - 1]

  const loadDir = useCallback(async (dirPath?: string) => {
    const r = await api.memoryListDir(dirPath)
    if (r.ok) {
      const state: DirState = { path: r.rootDir, entries: r.entries as FsEntry[] }
      setDirStack(prev => dirPath ? [...prev, state] : [state])
    }
  }, [])

  useEffect(() => {
    Promise.all([api.memoryGetDir(), api.memoryGetClaudeMd()]).then(([dir, cm]) => {
      setMemoryDir(dir)
      setClaudeMdPath(cm.path)
      // Pre-load CLAUDE.md content
      if (cm.ok) {
        setFileContent(prev => ({ ...prev, [cm.path]: cm.content }))
        setEditContent(prev => ({ ...prev, [cm.path]: cm.content }))
      }
      loadDir()
    })
  }, [loadDir])

  const openFile = async (entry: { path: string; name: string; pinned?: boolean }) => {
    if (!openTabs.find(t => t.path === entry.path)) {
      setOpenTabs(prev => [...prev, { path: entry.path, name: entry.name, pinned: entry.pinned }])
    }
    setActiveTab(entry.path)
    if (!fileContent[entry.path]) {
      const r = await api.memoryReadFile(entry.path)
      if (r.ok) {
        setFileContent(prev => ({ ...prev, [entry.path]: r.content }))
        setEditContent(prev => ({ ...prev, [entry.path]: r.content }))
      }
    }
  }

  const closeTab = (tabPath: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setOpenTabs(prev => {
      const next = prev.filter(t => t.path !== tabPath)
      if (activeTab === tabPath) setActiveTab(next.length > 0 ? next[next.length - 1].path : null)
      return next
    })
  }

  const handleEdit = (content: string) => {
    if (!activeTab) return
    setEditContent(prev => ({ ...prev, [activeTab]: content }))
    setDirty(prev => new Set(prev).add(activeTab))
    // Autosave after 1s
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    saveTimeout.current = setTimeout(() => saveFile(activeTab, content), 1000)
  }

  const saveFile = async (filePath: string, content: string) => {
    setSaving(true)
    await api.memoryWriteFile(filePath, content)
    setFileContent(prev => ({ ...prev, [filePath]: content }))
    setDirty(prev => { const s = new Set(prev); s.delete(filePath); return s })
    setSaving(false)
  }

  const handleCreate = async () => {
    const name = newFileName.trim()
    if (!name) return
    if (showNewFile === 'file') {
      const finalName = name.endsWith('.md') ? name : name + '.md'
      const r = await api.memoryCreateFile(finalName, currentDir?.path)
      if (r.ok && r.path) {
        await loadDir(currentDir?.path === memoryDir ? undefined : currentDir?.path)
        setNewFileName('')
        setShowNewFile(null)
        openFile({ path: r.path, name: finalName })
      }
    } else if (showNewFile === 'dir') {
      const r = await api.memoryCreateDir(name, currentDir?.path)
      if (r.ok) {
        await loadDir(currentDir?.path === memoryDir ? undefined : currentDir?.path)
        setNewFileName('')
        setShowNewFile(null)
      }
    }
  }

  // Close ctx menu on outside click
  useEffect(() => {
    if (!ctxMenu) return
    const handler = () => setCtxMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [ctxMenu])

  const handleDelete = async (entry: FsEntry, e: React.MouseEvent) => {
    e.stopPropagation()
    await api.memoryDeleteFile(entry.path)
    if (entry.type === 'file') {
      setOpenTabs(prev => prev.filter(t => t.path !== entry.path))
      if (activeTab === entry.path) setActiveTab(null)
    }
    await loadDir(currentDir?.path === memoryDir ? undefined : currentDir?.path)
  }

  const goUpDir = () => {
    if (dirStack.length > 1) setDirStack(prev => prev.slice(0, -1))
  }

  const isMarkdown = (p: string | null) => !!p && (p.endsWith('.md') || p.endsWith('.MD'))
  const activeContent = activeTab ? (editContent[activeTab] ?? '') : ''
  const activeTabInfo = openTabs.find(t => t.path === activeTab)

  return (
    <div className="flex flex-col" style={{ height: '100%' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 border-b border-border-subtle shrink-0 h-10">
        {/* Breadcrumb tabs */}
        <div className="flex items-center gap-0.5 flex-1 overflow-x-auto no-drag">
          {/* Root tab */}
          <button
            onClick={() => setActiveTab(null)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-md text-[13px] shrink-0 transition-colors',
              activeTab === null
                ? 'text-text-primary bg-surface-selected'
                : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover'
            )}
          >
            <Folder size={12} />
            memory
          </button>

          {openTabs.map(tab => (
            <div
              key={tab.path}
              onClick={() => setActiveTab(tab.path)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-md text-[13px] shrink-0 cursor-pointer transition-colors group',
                activeTab === tab.path
                  ? 'text-text-primary bg-surface-selected'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover'
              )}
            >
              {tab.pinned ? <Pin size={11} className="text-accent shrink-0" /> : <File size={11} className="shrink-0" />}
              <span>{tab.name}</span>
              {dirty.has(tab.path) && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
              {!tab.pinned && (
                <button
                  onClick={e => closeTab(tab.path, e)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-text-primary ml-0.5"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* View mode toggle (only for markdown files) */}
        {activeTab && isMarkdown(activeTab) && (
          <div className="flex items-center gap-0.5 no-drag bg-bg-elevated rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('rendered')}
              className={cn('p-1.5 rounded-md transition-colors', viewMode === 'rendered' ? 'bg-surface-active text-text-primary' : 'text-text-faint hover:text-text-secondary')}
              title="Rendered"
            >
              <Eye size={13} />
            </button>
            <button
              onClick={() => setViewMode('raw')}
              className={cn('p-1.5 rounded-md transition-colors', viewMode === 'raw' ? 'bg-surface-active text-text-primary' : 'text-text-faint hover:text-text-secondary')}
              title="Raw"
            >
              <Code2 size={13} />
            </button>
          </div>
        )}

        {saving && <span className="text-[12px] text-text-faint">Saving...</span>}
      </div>

      {/* Body */}
      {activeTab === null ? (
        // ── Explorer grid view ──
        <div
          className="flex-1 overflow-y-auto p-6 relative"
          onClick={() => { setSelected(null); setCtxMenu(null) }}
          onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }) }}
        >
          {/* Context menu */}
          {ctxMenu && (
            <div
              ref={ctxRef}
              className="fixed z-50 bg-bg-elevated border border-border-default rounded-xl shadow-2xl py-1 min-w-40"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              onClick={e => e.stopPropagation()}
            >
              {ctxMenu.entry ? (
                // ── File/dir context menu ──
                <>
                  <button
                    onClick={() => { ctxMenu.entry!.type === 'file' ? openFile(ctxMenu.entry!) : loadDir(ctxMenu.entry!.path); setCtxMenu(null) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-text-secondary hover:bg-surface-hover transition-colors"
                  >
                    {ctxMenu.entry.type === 'file' ? <File size={13} className="text-text-faint" /> : <Folder size={13} className="text-amber-400/70" />}
                    Открыть
                  </button>
                  {ctxMenu.entry.path !== claudeMdPath && (
                    <>
                      <div className="border-t border-border-subtle mx-2 my-1" />
                      <button
                        onClick={() => { handleDelete(ctxMenu.entry!, { stopPropagation: () => {} } as React.MouseEvent); setCtxMenu(null) }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-red-400 hover:bg-red-400/10 transition-colors"
                      >
                        <Trash2 size={13} />
                        Удалить
                      </button>
                    </>
                  )}
                </>
              ) : (
                // ── Empty area context menu ──
                <>
                  <button
                    onClick={() => { setShowNewFile('file'); setCtxMenu(null) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-text-secondary hover:bg-surface-hover transition-colors"
                  >
                    <File size={13} className="text-text-faint" />
                    Новый файл
                  </button>
                  <button
                    onClick={() => { setShowNewFile('dir'); setCtxMenu(null) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-text-secondary hover:bg-surface-hover transition-colors"
                  >
                    <Folder size={13} className="text-amber-400/70" />
                    Новая папка
                  </button>
                </>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-4">
            {/* Back dir */}
            {dirStack.length > 1 && (
              <button
                onDoubleClick={goUpDir}
                className="flex flex-col items-center gap-2 w-24 p-3 rounded-xl hover:bg-surface-hover transition-colors text-center"
              >
                <div className="w-14 h-14 flex items-center justify-center">
                  <Folder size={48} className="text-text-faint" />
                </div>
                <span className="text-[12px] text-text-muted truncate w-full text-center">..</span>
              </button>
            )}

            {/* Pinned CLAUDE.md */}
            {dirStack.length <= 1 && (
              <button
                onClick={e => { e.stopPropagation(); setSelected(claudeMdPath) }}
                onDoubleClick={() => openFile({ path: claudeMdPath, name: 'CLAUDE.md', pinned: true })}
                onContextMenu={e => { e.stopPropagation(); e.preventDefault(); setSelected(claudeMdPath); setCtxMenu({ x: e.clientX, y: e.clientY, entry: { name: 'CLAUDE.md', path: claudeMdPath, type: 'file' } }) }}
                className={cn("flex flex-col items-center gap-2 w-24 p-3 rounded-xl transition-colors relative", selected === claudeMdPath ? 'bg-surface-selected' : 'hover:bg-surface-hover')}
              >
                <div className="w-14 h-14 rounded-xl flex items-center justify-center relative"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}>
                  <File size={28} style={{ color: 'var(--accent)' }} />
                  <Pin size={11} className="absolute -top-1 -right-1 text-accent" />
                </div>
                <span className="text-[12px] text-text-secondary truncate w-full text-center">CLAUDE.md</span>
              </button>
            )}

            {/* Entries */}
            {currentDir?.entries.map(entry => (
              <button
                key={entry.path}
                onClick={e => { e.stopPropagation(); setSelected(entry.path) }}
                onDoubleClick={() => { setSelected(null); entry.type === 'dir' ? loadDir(entry.path) : openFile(entry) }}
                onContextMenu={e => { e.stopPropagation(); e.preventDefault(); setSelected(entry.path); setCtxMenu({ x: e.clientX, y: e.clientY, entry }) }}
                className={cn("flex flex-col items-center gap-2 w-24 p-3 rounded-xl transition-colors group relative", selected === entry.path ? 'bg-surface-selected' : 'hover:bg-surface-hover')}
              >
                <div className="w-14 h-14 rounded-xl flex items-center justify-center">
                  {entry.type === 'dir'
                    ? <Folder size={48} className="text-amber-400/80" />
                    : <File size={36} className="text-text-faint" />
                  }
                </div>
                <span className="text-[12px] text-text-secondary truncate w-full text-center">{entry.name}</span>
                {entry.type === 'file' && (
                  <button
                    onClick={e => handleDelete(entry, e)}
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 rounded transition-colors text-text-ghost hover:text-red-400 hover:bg-red-400/10"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </button>
            ))}

            {/* Empty state */}
            {currentDir?.entries.length === 0 && dirStack.length <= 1 && (
              <p className="text-[13px] text-text-ghost py-8 w-full">Папка пустая</p>
            )}

            {/* New file button as grid item */}
            {showNewFile ? (
              <div className="flex flex-col items-center gap-1 w-24 p-3">
                <input
                  autoFocus
                  value={newFileName}
                  onChange={e => setNewFileName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowNewFile(null) }}
                  placeholder={showNewFile === 'file' ? 'name.md' : 'folder'}
                  className="w-full bg-surface-hover border border-border-default rounded-lg px-2 py-1 text-[12px] text-text-primary placeholder:text-text-ghost outline-none text-center"
                  onFocus={e => (e.target.style.borderColor = 'color-mix(in srgb, var(--accent) 40%, transparent)')}
                  onBlur={e => (e.target.style.borderColor = '')}
                />
                <div className="flex gap-1">
                  <button onClick={handleCreate} className="px-2 py-0.5 rounded text-[11px] text-white" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 70%, transparent)' }}>ок</button>
                  <button onClick={() => setShowNewFile(null)} className="px-2 py-0.5 rounded text-[11px] text-text-faint hover:bg-surface-hover">✕</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : (

        // ── File view ──
        <div className="flex-1 min-h-0" style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
          {isMarkdown(activeTab) && viewMode === 'rendered' ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
              <div style={{ maxWidth: 720, margin: '0 auto' }}>
                <MarkdownRenderer content={activeContent} />
              </div>
            </div>
          ) : (
            <textarea
              value={activeContent}
              onChange={e => handleEdit(e.target.value)}
              spellCheck={false}
              style={{ flex: 1, resize: 'none', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace', fontSize: 13, padding: '24px 32px', outline: 'none', lineHeight: 1.6, border: 'none' }}
            />
          )}
        </div>
      )}
    </div>
  )
}
