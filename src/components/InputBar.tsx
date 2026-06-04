import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { cn } from '../lib/utils.js'
import { CornerDownLeft, Square, Terminal } from 'lucide-react'
// InputBarToolbar — model/effort/permission/PTY popups extracted to separate component
import { AttachedFiles, AttachedFile } from './AttachedFiles.js'
import { InputBarToolbar } from './InputBarToolbar.js'
import { api } from '../lib/api.js'

export type CommandName = 'usage' | 'context' | 'compact'

const COMMANDS: { name: CommandName; description: string }[] = [
  { name: 'usage',   description: 'Show token usage' },
  { name: 'context', description: 'Show context window' },
  { name: 'compact', description: 'Compact session · optional instructions' },
]

function parseCommand(text: string): CommandName | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  const word = trimmed.slice(1).split(/\s/)[0].toLowerCase()
  const rest = trimmed.slice(1 + word.length)
  if ((rest === '' || rest.startsWith(' ')) && COMMANDS.find(c => c.name === word)) {
    return word as CommandName
  }
  return null
}

function getCommandSuggestions(text: string): typeof COMMANDS {
  if (!text.startsWith('/')) return []
  const query = text.slice(1).toLowerCase()
  return COMMANDS.filter(c => c.name.startsWith(query))
}

export type KnownModelId = 'claude-opus-4-8' | 'claude-sonnet-4-6' | 'claude-haiku-4-5'
export type ModelId = KnownModelId | string
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type PermissionMode = 'bypassPermissions' | 'plan'

export function getMaxEffort(model: ModelId): EffortLevel | null {
  const KNOWN: Record<string, EffortLevel[]> = {
    'claude-opus-4-8':   ['low', 'medium', 'high', 'xhigh', 'max'],
    'claude-sonnet-4-6': ['low', 'medium', 'high'],
    'claude-haiku-4-5':  [],
  }
  const efforts = KNOWN[model] ?? []
  return efforts.length ? efforts[efforts.length - 1] : null
}

export interface InputBarHandle {
  addFiles: (files: FileList | File[]) => void
  injectAndSend: (text: string) => void
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
  onKillPtyRequest?: () => void
  ptyAlive?: boolean
  ptyStarting?: boolean
  onCommand: (name: CommandName, fullText: string) => void
  isLocked: boolean
  isRunning: boolean
  hasSession: boolean
  sessionId: string | null
}

interface DraftState {
  html: string
  files: AttachedFile[]
}

const drafts = new Map<string, DraftState>()

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
  onKillPtyRequest,
  ptyAlive,
  ptyStarting,
  onCommand,
  isLocked,
  isRunning,
  hasSession,
  sessionId,
}, ref) {
  const prevSessionIdRef = useRef<string | null>(null)
  const [pendingText, setPendingText] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)
  const [isEmpty, setIsEmpty] = useState(true)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [cmdSuggestions, setCmdSuggestions] = useState<typeof COMMANDS>([])
  const [cmdSelectedIdx, setCmdSelectedIdx] = useState(0)
  const [currentText, setCurrentText] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const editRef = useRef<HTMLDivElement>(null)
  const suppressObserverRef = useRef(false)



  useEffect(() => {
    const el = editRef.current
    if (!el) return
    const prev = prevSessionIdRef.current
    const next = sessionId

    if (prev === next) return

    // Save draft for previous session
    if (prev !== null && hasContent(el)) {
      drafts.set(prev, { html: el.innerHTML, files: attachedFiles })
    } else if (prev !== null) {
      drafts.delete(prev)
    }

    // Restore draft for new session
    const draft = next ? drafts.get(next) : undefined
    suppressObserverRef.current = true
    el.innerHTML = draft?.html ?? ''
    suppressObserverRef.current = false
    setAttachedFiles(draft?.files ?? [])
    setIsEmpty(!hasContent(el))

    prevSessionIdRef.current = next
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateEmpty = useCallback(() => {
    const el = editRef.current
    if (!el) return
    setIsEmpty(!hasContent(el))
    // Sync attachedFiles with chips actually present in DOM
    const presentIds = new Set(
      Array.from(el.querySelectorAll('[data-fileid]')).map(n => (n as HTMLElement).dataset.fileid!)
    )
    setAttachedFiles(prev => prev.filter(f => presentIds.has(f.id)))
    // Update command suggestions based on current text
    const text = extractText(el).trim()
    setCurrentText(text)
    const suggestions = getCommandSuggestions(text)
    setCmdSuggestions(suggestions)
    setCmdSelectedIdx(0)
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

    // Check if it's a command
    const cmd = parseCommand(text)
    if (cmd) {
      clearEditor()
      setAttachedFiles([])
      setCmdSuggestions([])
      setCurrentText('')
      onCommand(cmd, text)
      return
    }

    clearEditor()
    setAttachedFiles([])
    setCmdSuggestions([])
    setCurrentText('')
    setPendingText(text)
    setCountdown(2)

    intervalRef.current = setInterval(() => setCountdown(c => c - 1), 1000)
    timerRef.current = setTimeout(() => {
      clearInterval(intervalRef.current!)
      setPendingText(null)
      setCountdown(0)
      onSend(text)
    }, 2000)
  }, [isLocked, pendingText, clearEditor, onSend, onCommand])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Command dropdown navigation
    if (cmdSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCmdSelectedIdx(i => Math.min(i + 1, cmdSuggestions.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCmdSelectedIdx(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        const selected = cmdSuggestions[cmdSelectedIdx]
        if (selected) {
          // Fill the command into editor
          const el = editRef.current
          if (el) {
            suppressObserverRef.current = true
            el.textContent = '/' + selected.name
            suppressObserverRef.current = false
            // Move cursor to end
            const sel = window.getSelection()
            if (sel) {
              const range = document.createRange()
              range.selectNodeContents(el)
              range.collapse(false)
              sel.removeAllRanges()
              sel.addRange(range)
            }
            setCurrentText('/' + selected.name)
            setCmdSuggestions([])
          }
        }
        return
      }
      if (e.key === 'Escape') {
        setCmdSuggestions([])
        return
      }
    }

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
  }, [handleSend, cancelSend, pendingText, updateEmpty, cmdSuggestions, cmdSelectedIdx])

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
    injectAndSend: (text: string) => {
      const el = editRef.current
      if (!el || isLocked) return
      suppressObserverRef.current = true
      el.textContent = text
      suppressObserverRef.current = false
      setIsEmpty(false)
      // fire send on next tick so state settles
      setTimeout(() => {
        const trimmed = extractText(el).trim()
        if (!trimmed) return
        el.innerHTML = ''
        setIsEmpty(true)
        setAttachedFiles([])
        setCmdSuggestions([])
        setCurrentText('')
        onSend(trimmed)
      }, 0)
    },
  }), [processFile, isLocked, onSend])

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
      'pt-0 pb-2',
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

        {/* Command dropdown */}
        {cmdSuggestions.length > 0 && (
          <div className="absolute bottom-full left-0 mb-1.5 bg-bg-elevated border border-border-default rounded-xl shadow-2xl z-50 min-w-[200px] overflow-hidden py-1">
            {cmdSuggestions.map((cmd, i) => (
              <button
                key={cmd.name}
                onMouseDown={(e) => {
                  e.preventDefault()
                  const el = editRef.current
                  if (el) {
                    suppressObserverRef.current = true
                    el.textContent = '/' + cmd.name
                    suppressObserverRef.current = false
                    setCurrentText('/' + cmd.name)
                    setCmdSuggestions([])
                    el.focus()
                    const sel = window.getSelection()
                    if (sel) {
                      const range = document.createRange()
                      range.selectNodeContents(el)
                      range.collapse(false)
                      sel.removeAllRanges()
                      sel.addRange(range)
                    }
                  }
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left transition-colors',
                  i === cmdSelectedIdx ? 'bg-surface-selected text-text-primary' : 'text-text-secondary hover:bg-surface-hover',
                )}
              >
                <Terminal size={12} className="shrink-0 text-text-muted" />
                <span className="font-medium">/{cmd.name}</span>
                <span className="text-text-muted text-[12px]">{cmd.description}</span>
              </button>
            ))}
          </div>
        )}

        {/* Placeholder */}
        {isEmpty && !pendingText && (
          <div className="absolute top-0 left-0 right-12 px-3.5 py-2.5 text-base text-text-ghost pointer-events-none select-none flex items-center h-full">
            Type / for commands
          </div>
        )}

        {/* Accent overlay when full command is typed */}
        {parseCommand(currentText) && !isEmpty && (
          <div
            className="absolute top-0 left-0 px-4 py-3.5 text-base pointer-events-none select-none whitespace-pre-wrap break-words pr-14"
            style={{ color: 'color-mix(in srgb, var(--accent) 80%, white 20%)' }}
          >
            {currentText}
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
            'w-full bg-surface-hover rounded-xl px-3.5 py-2.5 pr-12',
            'text-base',
            'border border-border-default focus:border-border-strong focus:outline-none',
            'transition-[height,border-color] duration-150 ease-out',
            'min-h-[44px] max-h-[200px] overflow-y-auto',
            'whitespace-pre-wrap break-words',
            'shadow-[0_2px_12px_rgba(0,0,0,0.35)]',
            parseCommand(currentText) && !isEmpty ? 'text-transparent caret-text-primary' : 'text-text-primary',
          )}
          style={{ wordBreak: 'break-word', overflowAnchor: 'none', fieldSizing: 'content' } as React.CSSProperties}
        />

        <button
          onClick={handleButtonClick}
          disabled={buttonDisabled}
          className={cn(
            'absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center pointer-events-auto',
            'transition-all duration-150 active:scale-90',
            isRunning || pendingText
              ? 'text-red-400 hover:text-red-300 hover:bg-red-400/10 active:bg-red-400/20'
              : !isEmpty && !isLocked
                ? 'text-text-secondary hover:text-text-primary hover:bg-surface-hover active:bg-surface-active'
                : 'text-text-ghost cursor-default',
          )}
        >
          {pendingText ? (
            <span className="relative flex items-center justify-center w-5 h-5">
              <Square size={20} className="absolute" />
              <span className="text-[11px] font-bold leading-none z-10">{countdown}</span>
            </span>
          ) : isRunning ? (
            <Square size={18} />
          ) : (
            <CornerDownLeft size={18} />
          )}
        </button>
      </div>

      <InputBarToolbar
        activeModel={activeModel}
        onModelChange={onModelChange}
        activeEffort={activeEffort}
        onEffortChange={onEffortChange}
        activePermission={activePermission}
        onPermissionChange={onPermissionChange}
        ptyAlive={ptyAlive}
        ptyStarting={ptyStarting}
        onKillPtyRequest={onKillPtyRequest}
      />
    </div>
  )
})

