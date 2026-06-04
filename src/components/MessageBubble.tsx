import { JsonlEntry, ContentBlock } from '../types/index'
import { cn } from '../lib/utils.js'
import { toolHeading } from '../lib/toolLabel.js'
import { ChevronDown, ChevronRight, Copy, Check, Bot } from 'lucide-react'
import { useState, useMemo, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { diffLines } from 'diff'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeHighlight from 'rehype-highlight'
import hljs from 'highlight.js'

interface Props {
  entry: JsonlEntry
  showMeta?: boolean
}

function relativeTime(ts: string | undefined): string | null {
  if (!ts) return null
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (diff < 10) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function preserveEmptyLines(text: string): string {
  // Replace empty lines outside code blocks with a non-breaking space
  // so remark renders them as visible blank paragraphs
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (i % 2 === 1) return part // inside code block — don't touch
    return part.replace(/\n\n/g, '\n\n \n\n')
  }).join('')
}

function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(getText()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded text-text-ghost hover:text-text-muted transition-colors"
      title="Copy"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

function looksLikeAsciiArt(text: string): boolean {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return false
  // если больше половины строк состоят только из одного повторяющегося символа
  const artLines = lines.filter(l => /^([*#@+\-=|/\\^~<>]{1,3})\1*$/.test(l.trim()))
  return artLines.length >= Math.ceil(lines.length * 0.5)
}

function TextContent({ text, plain }: { text: string; plain?: boolean }) {
  if (plain) {
    return <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{text}</pre>
  }
  // wrap ascii-art in code block so markdown doesn't mangle it
  const safeText = looksLikeAsciiArt(text) ? `\`\`\`\n${text}\n\`\`\`` : text
  return (
    <div className="prose prose-sm max-w-none
        prose-p:!mt-0 prose-p:!mb-1 prose-p:leading-relaxed
        prose-headings:text-text-primary prose-headings:font-semibold prose-headings:!mt-2 prose-headings:!mb-0.5
        prose-h1:text-lg prose-h2:text-base prose-h3:text-sm
        prose-code:bg-[var(--border-default)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:text-text-primary prose-code:before:content-none prose-code:after:content-none
        prose-pre:!bg-transparent prose-pre:!p-0 prose-pre:border-0 prose-pre:rounded-none prose-pre:text-xs
        [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit [&_pre_code]:rounded-none
        prose-ul:!my-1 prose-ul:list-disc prose-ul:pl-5
        prose-ol:!my-1 prose-ol:list-decimal prose-ol:pl-5
        prose-li:!my-0 prose-li:!mt-0 prose-li:!mb-0
        prose-table:text-xs prose-table:border-collapse
        [&_table]:!my-1 [&_figure]:!my-1
        prose-th:text-text-secondary prose-th:border prose-th:border-border-default prose-th:px-2 prose-th:py-1
        prose-td:text-text-secondary prose-td:border prose-td:border-border-default prose-td:px-2 prose-td:py-1
        prose-blockquote:border-l-2 prose-blockquote:border-border-strong prose-blockquote:text-text-muted prose-blockquote:pl-3 prose-blockquote:italic prose-blockquote:my-1
        prose-strong:text-text-primary prose-em:text-text-secondary
        prose-a:text-[var(--accent)] prose-a:no-underline hover:prose-a:underline
        prose-hr:border-border-default prose-hr:my-2
        text-text-primary text-sm">
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        pre({ children, ...props }) {
          const getTextContent = () => {
            const el = document.createElement('div')
            // children rendered as string via innerText trick isn't possible here,
            // so we extract from the code element's props
            const codeEl = (children as React.ReactElement)
            if (codeEl && typeof codeEl === 'object' && 'props' in codeEl) {
              const extractText = (node: unknown): string => {
                if (typeof node === 'string') return node
                if (Array.isArray(node)) return node.map(extractText).join('')
                if (node && typeof node === 'object' && 'props' in (node as object)) {
                  return extractText((node as { props: { children: unknown } }).props.children)
                }
                return ''
              }
              return extractText(codeEl.props.children)
            }
            return ''
          }
          return (
            <div className="relative rounded-lg border border-border-default overflow-hidden my-2">
              <pre {...props} className="!m-0 !rounded-none !border-0">{children}</pre>
              <CopyButton getText={getTextContent} />
            </div>
          )
        },
      }}
    >
      {preserveEmptyLines(safeText)}
    </ReactMarkdown>
    </div>
  )
}

const shortPath = (p: unknown) => {
  const s = String(p || '')
  return s.replace(/\\/g, '/').split('/').pop() || s
}

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin',
  cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c', rb: 'ruby', php: 'php',
  swift: 'swift', sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml',
  html: 'html', css: 'css', scss: 'scss', md: 'markdown', sql: 'sql',
}

function getLangFromPath(filePath: unknown): string {
  const ext = String(filePath || '').split('.').pop()?.toLowerCase() || ''
  return EXT_LANG[ext] || 'plaintext'
}

function highlightCode(code: string, lang: string): string[] {
  try {
    const result = hljs.highlight(code, { language: lang, ignoreIllegals: true })
    return result.value.split('\n')
  } catch {
    return code.split('\n').map(l => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
  }
}

// Compute +added / -removed line counts using real diff
function diffStats(name: string, input: Record<string, unknown>): { added: number; removed: number } | null {
  if (name === 'Edit' || name === 'Update') {
    const chunks = diffLines(String(input.old_string || ''), String(input.new_string || ''))
    let added = 0, removed = 0
    for (const c of chunks) {
      const lines = (c.value.match(/\n/g) || []).length || 1
      if (c.added)   added   += lines
      if (c.removed) removed += lines
    }
    return { added, removed }
  }
  if (name === 'Write') {
    const added = String(input.content || '').split('\n').length
    return { added, removed: 0 }
  }
  return null
}

// Human-readable verb + subject

// Expandable content depending on tool type
function ToolDetail({ name, input }: { name: string; input: Record<string, unknown> }) {
  if (name === 'Edit' || name === 'Update') {
    const lang = getLangFromPath(input.file_path)
    const oldCode = String(input.old_string || '')
    const newCode = String(input.new_string || '')
    // Highlight full old and new separately, then map lines to diff
    const oldHighlighted = useMemo(() => highlightCode(oldCode, lang), [oldCode, lang])
    const newHighlighted  = useMemo(() => highlightCode(newCode, lang), [newCode, lang])

    const chunks = diffLines(oldCode, newCode)
    type DiffLine = { html: string; added: boolean; removed: boolean; lineNum: number }
    const lines: DiffLine[] = []
    let oldNum = 0, newNum = 0
    for (const chunk of chunks) {
      const chunkLines = chunk.value.split('\n')
      if (chunkLines[chunkLines.length - 1] === '') chunkLines.pop()
      for (const _ of chunkLines) {
        if (chunk.added) {
          lines.push({ html: newHighlighted[newNum] ?? '', added: true, removed: false, lineNum: newNum + 1 })
          newNum++
        } else if (chunk.removed) {
          lines.push({ html: oldHighlighted[oldNum] ?? '', added: false, removed: true, lineNum: oldNum + 1 })
          oldNum++
        } else {
          lines.push({ html: newHighlighted[newNum] ?? '', added: false, removed: false, lineNum: newNum + 1 })
          oldNum++; newNum++
        }
      }
    }

    return (
      <div className="font-mono text-[12px] leading-[1.6] overflow-x-auto py-1">
        {lines.map((l, i) => (
          <div key={i} className={cn('flex py-[1px]', l.added ? 'bg-emerald-500/10' : l.removed ? 'bg-red-500/10' : '')}>
            <span className={cn('select-none shrink-0 text-right pr-2 pl-3 min-w-[2.8rem]',
              l.added ? 'text-emerald-400/40' : l.removed ? 'text-red-400/35' : 'text-text-ghost',
            )}>{l.lineNum}</span>
            <span className="shrink-0 w-[2px] self-stretch mr-2" style={{ background: 'var(--border-default)' }} />
            <span className={cn('select-none w-3 shrink-0 text-center mr-1',
              l.added ? 'text-emerald-400/60' : l.removed ? 'text-red-400/50' : 'text-text-ghost',
            )}>{l.added ? '+' : l.removed ? '-' : ' '}</span>
            <span className="pr-3 whitespace-pre" dangerouslySetInnerHTML={{ __html: l.html }} />
          </div>
        ))}
      </div>
    )
  }
  if (name === 'Write') {
    const lang = getLangFromPath(input.file_path)
    const highlighted = useMemo(() => highlightCode(String(input.content || ''), lang), [input.content, lang])
    return (
      <div className="font-mono text-[12px] leading-[1.6] overflow-x-auto py-1">
        {highlighted.map((html, i) => (
          <div key={i} className="flex gap-2 px-3 py-[1px] bg-emerald-500/10">
            <span className="text-emerald-400/60 select-none w-3 shrink-0 text-center">+</span>
            <span className="whitespace-pre" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        ))}
      </div>
    )
  }
  // Generic fallback
  return (
    <pre className="px-3 py-2 text-[12px] text-text-faint font-mono overflow-x-auto leading-relaxed">
      {JSON.stringify(input, null, 2)}
    </pre>
  )
}

export function AgentBlock({ input, done }: { input: Record<string, unknown>; done?: boolean }) {
  const type = String(input.subagent_type || 'agent')
  const desc = String(input.description || input.prompt || '')
  const short = desc.length > 80 ? desc.slice(0, 80) + '…' : desc

  return (
    <div className={cn(
      'flex items-start gap-3 px-3.5 py-2.5 rounded-xl border transition-colors',
      done
        ? 'bg-surface-hover border-border-default'
        : 'bg-surface-hover border-border-default',
    )}>
      <div className={cn(
        'mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center',
        done ? 'bg-accent/20' : 'bg-accent/20',
      )}>
        <Bot size={11} className={cn(done ? 'text-accent' : 'text-accent', !done && 'animate-pulse')} />
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[12px] font-medium text-text-muted">
          {done ? 'Agent · ' : 'Agent running · '}
          <span className="text-text-faint font-normal">{type}</span>
        </span>
        {short && (
          <span className="text-[12px] text-text-ghost leading-snug truncate">{short}</span>
        )}
      </div>
    </div>
  )
}

function ToolBlock({ name, input }: { name: string; input: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  const { verb, subject } = toolHeading(name, input)
  const stats = diffStats(name, input)

  return (
    <div className="text-[13px]">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-baseline gap-1.5 hover:opacity-80 transition-opacity text-left font-mono text-[13px]"
      >
        <span className="text-text-muted font-medium not-italic">{verb}</span>
        <span className="text-text-secondary">{subject}</span>
        {stats && (
          <span className="flex items-baseline gap-1">
            {stats.added   > 0 && <span className="text-emerald-400/80">+{stats.added}</span>}
            {stats.removed > 0 && <span className="text-red-400/70">-{stats.removed}</span>}
          </span>
        )}
        <ChevronDown
          size={12}
          className={cn('text-text-faint transition-transform duration-200', open ? 'rotate-0' : '-rotate-90')}
        />
      </button>
      <div className={cn(
        'grid transition-[grid-template-rows,opacity] duration-150 ease-out',
        open ? 'grid-rows-[1fr] opacity-100 mt-1.5' : 'grid-rows-[0fr] opacity-0 mt-0',
      )}>
        <div className="overflow-hidden">
          <div className="rounded-lg border border-border-default overflow-hidden">
            <ToolDetail name={name} input={input} />
          </div>
        </div>
      </div>
    </div>
  )
}

const COLLAPSE_THRESHOLD = 320

function CollapsibleContent({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(true)
  const [needsCollapse, setNeedsCollapse] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (contentRef.current && contentRef.current.scrollHeight > COLLAPSE_THRESHOLD) {
      setNeedsCollapse(true)
    }
  }, [])

  return (
    <>
      <div
        ref={contentRef}
        style={needsCollapse && collapsed
          ? { maxHeight: `${COLLAPSE_THRESHOLD}px`, overflow: 'hidden', position: 'relative',
              maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)' }
          : undefined}
      >
        {children}
      </div>
      {needsCollapse && (
        <button
          onClick={() => setCollapsed(v => !v)}
          className="text-[12px] text-text-muted hover:text-text-secondary transition-colors mt-1"
        >
          {collapsed ? 'Show more' : 'Show less'}
        </button>
      )}
    </>
  )
}

function MetaRow({ entry, onCopy }: { entry: JsonlEntry; onCopy: () => string }) {
  const [copied, setCopied] = useState(false)
  const time = relativeTime(entry.timestamp)
  const handleCopy = () => {
    navigator.clipboard.writeText(onCopy()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="flex items-center gap-2 mt-1.5 px-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
      <button onClick={handleCopy} className="flex items-center justify-center w-4 h-4 text-text-ghost hover:text-text-muted transition-colors">
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
      {time && <span className="text-[11px] text-text-ghost font-mono">{time}</span>}
    </div>
  )
}

export function MessageBubble({ entry, showMeta }: Props) {
  if (entry.type === 'user') {
    const content = typeof entry.message.content === 'string'
      ? entry.message.content
      : (entry.message.content as ContentBlock[])
          .filter(b => b.type === 'text')
          .map(b => b.text || '')
          .join('')
    const cleaned = content.replace(/^-\r?\n/, '')
    if (!cleaned.trim()) return null
    return (
      <div className="py-0.5 my-5 group">
        <div className="block w-full rounded-2xl rounded-tl-sm bg-surface-hover border border-border-default px-4 py-3 text-sm text-text-primary">
          <CollapsibleContent>
            <TextContent text={cleaned} plain />
          </CollapsibleContent>
        </div>
        {showMeta && <MetaRow entry={entry} onCopy={() => cleaned} />}
      </div>
    )
  }

  if (entry.type === 'assistant') {
    const blocks = Array.isArray(entry.message.content)
      ? entry.message.content as ContentBlock[]
      : []
    const rendered = blocks.filter(b =>
      (b.type === 'text' && b.text) || (b.type === 'tool_use' && b.name)
    )
    if (rendered.length === 0) return null
    const textBlocks = rendered.filter(b => b.type === 'text' && b.text)
    const fullText = textBlocks.map(b => b.text || '').join('\n\n')
    return (
      <div className="py-0.5 space-y-2 group">
        {rendered.map((block, i) => {
          if (block.type === 'text' && block.text) {
            return (
              <div key={i} className="text-sm text-text-primary leading-relaxed">
                <TextContent text={block.text} />
              </div>
            )
          }
          if (block.type === 'tool_use' && block.name) {
            if (block.name === 'Agent') {
              return <AgentBlock key={i} input={block.input || {}} done />
            }
            return (
              <ToolBlock key={i} name={block.name} input={block.input || {}} />
            )
          }
          return null
        })}
        {showMeta && textBlocks.length > 0 && <MetaRow entry={entry} onCopy={() => fullText} />}
      </div>
    )
  }

  if (entry.type === 'tool_use') {
    return (
      <div className="py-1">
        <ToolBlock name={(entry as { name: string }).name} input={(entry as { input: Record<string, unknown> }).input} />
      </div>
    )
  }

  if (entry.type === 'error_bubble') {
    const { message, known } = entry as unknown as { message: string; known: boolean }
    const title = known ? message : 'Непредвиденная ошибка'
    const detail = known ? null : message
    return (
      <div className="py-0.5 my-2 max-w-[520px]">
        <div className="rounded-xl px-4 py-3 flex flex-col gap-1"
          style={{
            background: 'var(--error-bg)',
            border: '1px solid var(--error-border)',
          }}
        >
          <div className="flex items-center gap-2">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="shrink-0 mt-px">
              <path d="M8 1.5L14.5 13H1.5L8 1.5Z" stroke="rgba(239,68,68,0.8)" strokeWidth="1.4" fill="rgba(239,68,68,0.15)" strokeLinejoin="round"/>
              <rect x="7.3" y="6" width="1.4" height="4" rx="0.7" fill="rgba(239,68,68,0.85)"/>
              <rect x="7.3" y="11" width="1.4" height="1.4" rx="0.7" fill="rgba(239,68,68,0.85)"/>
            </svg>
            <span className="text-[13px] font-semibold" style={{ color: 'var(--error-text)' }}>{title}</span>
          </div>
          {detail && (
            <div className="text-[12px] leading-relaxed pl-[23px]" style={{ color: 'rgba(255,180,180,0.55)' }}>
              {detail}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (entry.type === 'result') {
    const result = entry as { usage?: { input_tokens: number; output_tokens: number } }
    if (!result.usage) return null
    return (
      <div className="py-1">
        <span className="text-[11px] text-text-ghost font-mono">
          in: {result.usage.input_tokens} · out: {result.usage.output_tokens}
        </span>
      </div>
    )
  }

  return null
}
