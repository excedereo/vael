import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { api } from '../lib/api.js'
import '@xterm/xterm/css/xterm.css'

interface Props {
  termId: string
  sessionId: string | null
  projectPath: string | null
  configDir: string | null
  visible: boolean
  spawnTrigger?: number
  model?: string
  effort?: string
  permissionMode?: string
}

export function PtyTerminalView({ termId, sessionId, projectPath, configDir, visible, spawnTrigger = 0, model, effort, permissionMode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const spawnedRef = useRef<string | null>(null)
  const visibleRef = useRef(visible)

  // Init terminal once
  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      theme: {
        background: '#0a0a0a',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#0a0a0a',
        selectionBackground: 'rgba(255,255,255,0.2)',
        black:        '#0a0a0a',
        red:          '#f38ba8',
        green:        '#a6e3a1',
        yellow:       '#f9e2af',
        blue:         '#89b4fa',
        magenta:      '#cba6f7',
        cyan:         '#89dceb',
        white:        '#cdd6f4',
        brightBlack:  '#585b70',
        brightRed:    '#f38ba8',
        brightGreen:  '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue:   '#89b4fa',
        brightMagenta:'#cba6f7',
        brightCyan:   '#89dceb',
        brightWhite:  '#ffffff',
      },
      fontFamily: '"CascadiaMono", "CascadiaCode", "Cascadia Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 16,
      lineHeight: 1.2,
      fontWeight: '400',
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'none',
      scrollback: 5000,
      allowTransparency: false,
      macOptionIsMeta: false,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 1,
      fastScrollModifier: 'shift',
      fastScrollSensitivity: 5,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())

    // Wait for font to load so xterm measures cell size correctly
    document.fonts.load('16px CascadiaMono').finally(() => {
      if (!containerRef.current) return
      term.open(containerRef.current)

      // WebGL renderer — falls back to canvas if not supported
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => webgl.dispose())
        term.loadAddon(webgl)
      } catch {
        // canvas fallback is automatic
      }

      fitAddon.fit()
    })

    termRef.current = term
    fitRef.current = fitAddon

    // Forward user input to PTY
    term.onData((data) => {
      api.ptyWrite(termId, data)
    })

    // Обработка файлов — вставляет путь или сохраняет в ~/.vael/attachments если это blob без пути
    const handleFiles = async (files: FileList | File[]) => {
      const arr = Array.from(files)
      const parts: string[] = []
      for (const f of arr) {
        const nativePath = (f as File & { path?: string }).path
        if (nativePath) {
          parts.push(`"${nativePath}"`)
        } else {
          const buf = await f.arrayBuffer()
          const ext = f.name.includes('.') ? f.name.split('.').pop() : 'png'
          const filename = `clipboard_${Date.now()}.${ext}`
          const res = await api.saveAttachment(buf, filename)
          if (res.ok) parts.push(`"${res.filePath}"`)
        }
      }
      if (parts.length > 0) api.ptyWrite(termId, parts.join(' '))
    }

    // Ctrl+V / Ctrl+М — читаем clipboard через IPC (main process, без browser permissions)
    // Ctrl+C — копирует выделение (терминал не шлёт SIGINT никогда, см. rules.md)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyC' && e.ctrlKey) {
        e.preventDefault()
        e.stopPropagation()
        const selection = term.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
          term.clearSelection()
          // clearSelection() doesn't always force a repaint with the WebGL
          // renderer — nudge it so the highlight actually disappears.
          term.refresh(0, term.rows - 1)
        }
        return
      }
      if ((e.code === 'KeyV' || e.code === 'KeyM') && e.ctrlKey) {
        e.preventDefault()
        e.stopPropagation()
        api.clipboardRead().then(async result => {
          console.log('[clipboard:read]', JSON.stringify(result))
          if (result.type === 'text') {
            api.ptyWrite(termId, result.text)
          } else if (result.type === 'file') {
            api.ptyWrite(termId, `"${result.filePath}"`)
          } else if (result.type === 'paths') {
            api.ptyWrite(termId, result.paths.map((p: string) => `"${p}"`).join(' '))
          }
        })
      }
    }
    containerRef.current.addEventListener('keydown', onKeyDown, { capture: true })

    // Paste событие (правый клик → вставить)
    containerRef.current.addEventListener('paste', (e) => {
      e.preventDefault()
      const files = e.clipboardData?.files
      if (files && files.length > 0) { handleFiles(files); return }
      const text = e.clipboardData?.getData('text')
      if (text) api.ptyWrite(termId, text)
    })

    // Drag-and-drop файлов — слушаем на document, фильтруем по visible
    const onDropPaths = (e: CustomEvent<string[]>) => {
      if (!visibleRef.current) return
      api.ptyWrite(termId, e.detail.map(p => `"${p}"`).join(' '))
    }
    const onDrop = (e: CustomEvent<FileList>) => {
      if (!visibleRef.current) return
      handleFiles(e.detail)
    }
    document.addEventListener('vaeli:dropPaths', onDropPaths as EventListener)
    document.addEventListener('vaeli:dropFiles', onDrop as EventListener)

    // Receive PTY output
    const unsubData = api.onPtyData((tid, data) => {
      if (tid === termId) term.write(data)
    })

    const unsubExit = api.onPtyExit((tid) => {
      if (tid === termId) {
        term.writeln('\r\n\x1b[90m[процесс завершён]\x1b[0m')
        spawnedRef.current = null
      }
    })

    // Resize observer
    const ro = new ResizeObserver(() => {
      fitAddon.fit()
      api.ptyResize(termId, term.cols, term.rows)
    })
    ro.observe(containerRef.current)

    return () => {
      unsubData()
      unsubExit()
      ro.disconnect()
      containerRef.current?.removeEventListener('keydown', onKeyDown, { capture: true })
      document.removeEventListener('vaeli:dropPaths', onDropPaths as EventListener)
      document.removeEventListener('vaeli:dropFiles', onDrop as EventListener)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [termId])

  // Синхронизируем visibleRef с пропом
  useEffect(() => { visibleRef.current = visible }, [visible])

  // Spawn only when spawnTrigger is set (> 0) — prevents auto-spawn on session select
  useEffect(() => {
    const term = termRef.current
    const fitAddon = fitRef.current
    const isNew = termId === '__new__'
    if (!term || (!isNew && !sessionId) || (!isNew && !projectPath)) return
    if (spawnTrigger === 0) return

    term.clear()
    term.reset()
    fitAddon?.fit()

    spawnedRef.current = sessionId
    api.ptySpawn(termId, sessionId ?? '', projectPath, configDir ?? '', term.cols, term.rows, model, effort, permissionMode)
  }, [spawnTrigger, termId])

  // Refit and focus when becoming visible
  useEffect(() => {
    if (visible) {
      setTimeout(() => {
        fitRef.current?.fit()
        const term = termRef.current
        if (term) api.ptyResize(termId, term.cols, term.rows)
        term?.focus()
      }, 50)
    }
  }, [visible, termId])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 20,
        overflow: 'hidden',
        padding: '2px',
        background: '#0a0a0a',
        boxSizing: 'border-box',
        visibility: visible ? 'visible' : 'hidden',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    />
  )
}
