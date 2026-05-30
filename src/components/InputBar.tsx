import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { cn } from '../lib/utils.js'
import { CornerDownLeft, Square, Check } from 'lucide-react'
import { UsageCircles } from './UsageCircles.js'
import { AttachedFiles, AttachedFile } from './AttachedFiles.js'
import { api } from '../lib/api.js'

export type ModelId = 'claude-opus-4-5' | 'claude-sonnet-4-5' | 'claude-haiku-4-5'
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type PermissionMode = 'bypassPermissions' | 'plan'

const PERMISSION_LABELS: Record<PermissionMode, string> = {
  bypassPermissions: 'Bypass',
  plan: 'Plan',
}

const MODELS: { id: ModelId; label: string; efforts: EffortLevel[] }[] = [
  { id: 'claude-opus-4-5',   label: 'Opus 4.5',   efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5', efforts: ['low', 'medium', 'high'] },
  { id: 'claude-haiku-4-5',  label: 'Haiku 4.5',  efforts: [] },
]

export function getMaxEffort(model: ModelId): EffortLevel | null {
  const efforts = MODELS.find(m => m.id === model)?.efforts ?? []
  return efforts.length ? efforts[efforts.length - 1] : null
}

export interface InputBarHandle {
  addFiles: (files: FileList | File[]) => void
}

interface Props {
  activeModel: ModelId
  onModelChange: (m: ModelId) => void
  activeEffort: EffortLevel
  onEffortChange: (e: EffortLevel) => void
  activePermission: PermissionMode
  onPermissionChange: (p: PermissionMode) => void
  onSend: (text: string) => void
  onAbort: () => void
  isLocked: boolean
  isRunning: boolean
  hasSession: boolean
}

// Insert chip at caret, place cursor after it using ZWSP text node trick
// (works in all Chromium versions incl. old Electron)
function insertNodeAtCaret(node: Node, container: HTMLElement, suppressRef: React.MutableRefObject<boolean>) {
  const sel = window.getSelection()

  suppressRef.current = true

  // If selection is outside our container — move it to end of container first
  const selInContainer = sel && sel.rangeCount > 0 && container.contains(sel.getRangeAt(0).commonAncestorContainer)
  if (!sel || sel.rangeCount === 0 || !selInContainer) {
    container.focus()
    const r = document.createRange()
    r.selectNodeContents(container)
    r.collapse(false)
    sel?.removeAllRanges()
    sel?.addRange(r)
    container.appendChild(node)
  } else {
    const range = sel.getRangeAt(0)
    range.deleteContents()
    range.insertNode(node)
  }

  // Insert regular space right after chip — gives cursor a valid text position
  const space = document.createTextNode(' ')
  if (node.parentNode) {
    node.parentNode.insertBefore(space, node.nextSibling)
  } else {
    container.appendChild(space)
  }
  suppressRef.current = false

  // Place caret at offset 1 inside space node — cursor appears right after chip
  container.focus()
  const s = window.getSelection()
  if (s) {
    const r = document.createRange()
    try {
      r.setStart(space, 1)
      r.collapse(true)
      s.removeAllRanges()
      s.addRange(r)
    } catch {}
  }
}

// Extract text from contenteditable, replacing chip spans with their data-filepath
function extractText(el: HTMLElement): string {
  let result = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Bug 4 (extractText): replace non-breaking spaces with regular spaces
      result += (node.textContent || '').replace(/ /g, ' ')
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const elem = node as HTMLElement
      if (elem.tagName === 'BR') {
        result += '\n'
      } else if (elem.dataset.filepath) {
        result += elem.dataset.filepath
      } else if (elem.tagName === 'DIV' || elem.tagName === 'P') {
        result += '\n' + extractText(elem)
      } else {
        result += extractText(elem)
      }
    }
  }
  return result
}

// Check if contenteditable has any meaningful content
function hasContent(el: HTMLElement): boolean {
  return extractText(el).trim().length > 0
}

export const InputBar = forwardRef<InputBarHandle, Props>(function InputBar({
  activeModel,
  onModelChange,
  activeEffort,
  onEffortChange,
  activePermission,
  onPermissionChange,
  onSend,
  onAbort,
  isLocked,
  isRunning,
  hasSession,
}, ref) {
  const [popupOpen, setPopupOpen] = useState(false)
  const [pendingText, setPendingText] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)
  const [isEmpty, setIsEmpty] = useState(true)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const editRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const suppressObserverRef = useRef(false)

  const activeModelDef = MODELS.find(m => m.id === activeModel)!
  const availableEfforts = activeModelDef.efforts
  const showEffort = availableEfforts.length > 0

  const statusLabel = [
    activeModelDef.label,
    showEffort ? activeEffort.charAt(0).toUpperCase() + activeEffort.slice(1) : null,
    PERMISSION_LABELS[activePermission],
  ].filter(Boolean).join(' · ')

  useEffect(() => {
    if (!popupOpen) return
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) setPopupOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [popupOpen])


  const updateEmpty = useCallback(() => {
    const el = editRef.current
    if (!el) return
    setIsEmpty(!hasContent(el))
    // Sync attachedFiles with chips actually present in DOM
    const presentIds = new Set(
      Array.from(el.querySelectorAll('[data-fileid]')).map(n => (n as HTMLElement).dataset.fileid!)
    )
    setAttachedFiles(prev => prev.filter(f => presentIds.has(f.id)))
    // Height is managed by field-sizing: content in CSS — no JS needed
  }, [])

  const clearEditor = useCallback(() => {
    const el = editRef.current
    if (!el) return
    suppressObserverRef.current = true
    el.innerHTML = ''
    suppressObserverRef.current = false
    setIsEmpty(true)
  }, [])

  const cancelSend = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (intervalRef.current) clearInterval(intervalRef.current)
    // Restore text into editor
    if (pendingText && editRef.current) {
      editRef.current.textContent = pendingText
    }
    setPendingText(null)
    setCountdown(0)
    setIsEmpty(false)
  }, [pendingText])

  const handleSend = useCallback(() => {
    const el = editRef.current
    if (!el || isLocked || pendingText !== null) return
    const text = extractText(el).trim()
    if (!text) return

    clearEditor()
    setAttachedFiles([])
    setPendingText(text)
    setCountdown(2)

    intervalRef.current = setInterval(() => setCountdown(c => c - 1), 1000)
    timerRef.current = setTimeout(() => {
      clearInterval(intervalRef.current!)
      setPendingText(null)
      setCountdown(0)
      onSend(text)
    }, 2000)
  }, [isLocked, pendingText, clearEditor, onSend])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === 'Escape' && pendingText) {
      cancelSend()
    }
    // Backspace: if caret is right after a chip (or chip is selected), delete it
    if (e.key === 'Backspace') {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      if (!range.collapsed) return // let browser handle selection delete
      const { startContainer, startOffset } = range
      // Check node before caret
      let prev: Node | null = null
      if (startOffset > 0 && startContainer.nodeType === Node.TEXT_NODE) {
        // caret inside text node — browser handles normally
        return
      } else if (startOffset === 0) {
        prev = startContainer.nodeType === Node.ELEMENT_NODE
          ? (startContainer as Element).childNodes[startOffset - 1] ?? startContainer.previousSibling
          : startContainer.previousSibling
      } else {
        prev = startContainer.nodeType === Node.ELEMENT_NODE
          ? (startContainer as Element).childNodes[startOffset - 1]
          : null
      }
      if (prev && prev.nodeType === Node.ELEMENT_NODE && (prev as HTMLElement).dataset?.fileid) {
        e.preventDefault()
        const chipEl = prev as HTMLElement
        // Also remove trailing space before chip if any
        const next = chipEl.nextSibling
        if (next && next.nodeType === Node.TEXT_NODE && next.textContent?.startsWith(' ')) {
          const txt = next as Text
          if (txt.length === 1) txt.remove()
          else txt.deleteData(0, 1)
        }
        const chipId = chipEl.dataset.fileid
        const chipPath = chipEl.dataset.filepath
        chipEl.remove()
        if (chipId) {
          if (chipPath) api.tempDelete(chipPath)
          setAttachedFiles(prev => prev.filter(f => f.id !== chipId))
        }
        updateEmpty()
      }
    }
  }, [handleSend, cancelSend, pendingText, updateEmpty])

  const handleButtonClick = () => {
    if (isRunning) { onAbort(); return }
    if (pendingText) { cancelSend(); return }
    handleSend()
  }

  // Create a chip element for a file
  const makeChip = useCallback((id: string, filename: string, filePath: string, thumbnail: string | null, isImage: boolean, loading: boolean): HTMLSpanElement => {
    const chip = document.createElement('span')
    chip.contentEditable = 'false'
    chip.dataset.filepath = filePath
    chip.dataset.filename = filename
    chip.dataset.fileid = id
    chip.style.cssText = `
      display: inline; padding: 1px 6px; border-radius: 6px; margin: 0 1px;
      background-color: color-mix(in srgb, var(--accent) 25%, transparent);
      color: color-mix(in srgb, var(--accent) 80%, white 20%);
      font-size: 0.875em; line-height: inherit; vertical-align: baseline;
      white-space: nowrap; cursor: default; user-select: none;
    `

    const ext = filename.includes('.') ? '.' + filename.split('.').pop() : ''
    const base = filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename
    const maxBase = 8
    const label = base.length > maxBase
      ? `<span style="opacity:0.5">${base.slice(0, maxBase)}…</span>${ext}`
      : filename

    if (loading) {
      chip.innerHTML = `<span style="display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin 0.7s linear infinite;flex-shrink:0;vertical-align:middle;margin-right:3px;"></span>${label}`
    } else {
      chip.innerHTML = label
    }

    return chip
  }, [])

  const processFile = useCallback(async (file: File) => {
    const isImage = file.type.startsWith('image/')
    const filename = file.name || `file_${Date.now()}`
    const electronFile = file as File & { path?: string }
    const existingPath = electronFile.path && electronFile.path.length > 0 ? electronFile.path : null
    const fileId = crypto.randomUUID()

    // Read thumbnail synchronously before inserting chip
    let thumbnail: string | null = null
    if (isImage) {
      thumbnail = await new Promise<string>(resolve => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(file)
      })
    }

    if (existingPath) {
      // Has real path — insert immediately, no temp needed
      const chip = makeChip(fileId, filename, existingPath, thumbnail, isImage, false)
      insertNodeAtCaret(chip, editRef.current!, suppressObserverRef)
      setAttachedFiles(prev => [...prev, { id: fileId, filename, filePath: existingPath, isImage, thumbnail, loading: false }])
      updateEmpty()
    } else {
      // No path — insert loading chip immediately, upload to temp in background
      const tempId = `chip-${crypto.randomUUID()}`
      const chip = makeChip(fileId, filename, '', thumbnail, isImage, true)
      chip.id = tempId
      insertNodeAtCaret(chip, editRef.current!, suppressObserverRef)
      setAttachedFiles(prev => [...prev, { id: fileId, filename, filePath: '', isImage, thumbnail, loading: true }])
      updateEmpty()

      // Upload async — doesn't block next file insertion
      file.arrayBuffer().then(buffer => api.tempSave(buffer, filename)).then(result => {
        const el = editRef.current
        if (!el) return
        const existing = el.querySelector(`#${tempId}`) as HTMLSpanElement | null
        if (existing && result.ok) {
          suppressObserverRef.current = true
          const updated = makeChip(fileId, filename, result.filePath, thumbnail, isImage, false)
          existing.replaceWith(updated)
          suppressObserverRef.current = false
          setAttachedFiles(prev => prev.map(f => f.id === fileId ? { ...f, filePath: result.filePath, loading: false } : f))
        } else if (existing) {
          suppressObserverRef.current = true
          existing.remove()
          suppressObserverRef.current = false
          setAttachedFiles(prev => prev.filter(f => f.id !== fileId))
        }
        updateEmpty()
      })
    }
  }, [makeChip, updateEmpty])

  useImperativeHandle(ref, () => ({
    addFiles: async (files: FileList | File[]) => {
      const arr = Array.from(files)
      for (const file of arr) {
        await processFile(file)
      }
    },
  }), [processFile])

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.clipboardData.items)
    const fileItems = items.filter(i => i.kind === 'file')

    if (fileItems.length === 0) {
      // Regular paste — insert as plain text
      e.preventDefault()
      const text = e.clipboardData.getData('text/plain')
      document.execCommand('insertText', false, text)
      updateEmpty()
      return
    }

    e.preventDefault()

    for (const item of fileItems) {
      const file = item.getAsFile()
      if (!file) continue
      await processFile(file)
    }
  }, [processFile, updateEmpty])

  const buttonDisabled = isRunning ? false : (!pendingText && (isEmpty || isLocked))

  return (
    <div className={cn(
      'border-t border-border-subtle px-3 pt-2 pb-2',
      isLocked && 'opacity-60',
    )}>
      {/* Attached files preview — thumbnails above input */}
      <AttachedFiles
        files={attachedFiles}
        onRemove={id => {
          const file = attachedFiles.find(f => f.id === id)
          if (file?.filePath) api.tempDelete(file.filePath)
          setAttachedFiles(prev => prev.filter(f => f.id !== id))
          const el = editRef.current
          if (el) {
            const chip = el.querySelector(`[data-fileid="${id}"]`) as HTMLElement | null
            if (chip) {
              const next = chip.nextSibling
              if (next && next.nodeType === Node.TEXT_NODE && next.textContent === ' ') next.remove()
              chip.remove()
            }
            updateEmpty()
          }
        }}
      />

      {/* Contenteditable input */}
      <div className="relative">
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

        {/* Placeholder */}
        {isEmpty && !pendingText && (
          <div className="absolute top-0 left-0 px-3.5 py-3 text-sm text-text-ghost pointer-events-none select-none">
            Type / for commands
          </div>
        )}

        <div
          ref={editRef}
          contentEditable={(!isLocked || isRunning) && !pendingText ? 'true' : 'false'}
          onInput={updateEmpty}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          suppressContentEditableWarning
          className={cn(
            'w-full bg-surface-hover rounded-xl px-3.5 py-3 pr-12',
            'text-sm text-text-primary',
            'border border-border-default focus:border-border-strong focus:outline-none',
            'transition-[height,border-color] duration-150 ease-out',
            'min-h-[44px] max-h-[200px] overflow-y-auto',
            'whitespace-pre-wrap break-words',
          )}
          style={{ wordBreak: 'break-word', overflowAnchor: 'none', fieldSizing: 'content' } as React.CSSProperties}
        />

        <button
          onClick={handleButtonClick}
          disabled={buttonDisabled}
          className={cn(
            'absolute right-2 bottom-[14px] w-8 h-8 rounded-lg transition-colors flex items-center justify-center pointer-events-auto',
            isRunning || pendingText
              ? 'text-red-400 hover:text-red-300'
              : !isEmpty && !isLocked
                ? 'text-text-secondary hover:text-text-primary'
                : 'text-text-ghost',
          )}
        >
          {pendingText ? (
            <span className="relative flex items-center justify-center w-5 h-5">
              <Square size={22} className="absolute" />
              <span className="text-[11px] font-bold leading-none z-10">{countdown}</span>
            </span>
          ) : isRunning ? (
            <Square size={20} />
          ) : (
            <CornerDownLeft size={19} />
          )}
        </button>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-end mt-2 px-0.5">
        <div className="flex items-center gap-2">
          <UsageCircles hasSession={hasSession} />
          <div className="relative" ref={popupRef}>
            <button
              onClick={() => setPopupOpen(v => !v)}
              className="text-[12px] text-text-faint hover:text-text-secondary transition-colors"
            >
              {statusLabel}
            </button>

            {popupOpen && (
              <div className="absolute bottom-full right-0 mb-2 bg-bg-elevated border border-border-default rounded-xl shadow-2xl z-50 w-56 overflow-hidden">
                <div className="px-3 pt-2.5 pb-1">
                  <span className="text-[11px] text-text-faint font-medium uppercase tracking-wider">Models</span>
                </div>
                {MODELS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      onModelChange(m.id)
                      if (m.efforts.length > 0 && !m.efforts.includes(activeEffort)) {
                        onEffortChange(m.efforts[m.efforts.length - 1])
                      }
                      setPopupOpen(false)
                    }}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2 text-[13px] transition-colors',
                      activeModel === m.id
                        ? 'text-text-primary'
                        : 'text-text-muted hover:text-text-primary hover:bg-surface-hover',
                    )}
                  >
                    <span>{m.label}</span>
                    {activeModel === m.id && <Check size={12} className="text-text-secondary" />}
                  </button>
                ))}

                {showEffort && (
                  <>
                    <div className="mx-3 my-1.5 border-t border-border-default" />
                    <div className="px-3 pb-1">
                      <span className="text-[11px] text-text-faint font-medium uppercase tracking-wider">Effort</span>
                    </div>
                    {availableEfforts.map(e => (
                      <button
                        key={e}
                        onClick={() => { onEffortChange(e); setPopupOpen(false) }}
                        className={cn(
                          'w-full flex items-center justify-between px-3 py-2 text-[13px] capitalize transition-colors',
                          activeEffort === e
                            ? 'text-text-primary'
                            : 'text-text-muted hover:text-text-primary hover:bg-surface-hover',
                        )}
                      >
                        <span>{e}</span>
                        {activeEffort === e && <Check size={12} className="text-text-secondary" />}
                      </button>
                    ))}
                  </>
                )}

                <div className="mx-3 my-1.5 border-t border-border-default" />
                <div className="px-3 pb-1">
                  <span className="text-[11px] text-text-faint font-medium uppercase tracking-wider">Permission</span>
                </div>
                {(['bypassPermissions', 'plan'] as PermissionMode[]).map(p => (
                  <button
                    key={p}
                    onClick={() => { onPermissionChange(p); setPopupOpen(false) }}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2 text-[13px] transition-colors',
                      activePermission === p
                        ? 'text-text-primary'
                        : 'text-text-muted hover:text-text-primary hover:bg-surface-hover',
                    )}
                  >
                    <span>{PERMISSION_LABELS[p]}</span>
                    {activePermission === p && <Check size={12} className="text-text-secondary" />}
                  </button>
                ))}

                <div className="pb-1.5" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
