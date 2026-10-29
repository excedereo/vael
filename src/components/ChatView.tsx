import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { ArrowUp, Square, ChevronDown, ChevronRight, ChevronLeft, Check, Plus, Paperclip, Copy, ArrowDown } from 'lucide-react'
import type { ComposedPart } from '../../shared/chatContent.js'
import { useChatSession, fmtTokens, type ChatCommand, type ChatProgress } from '../hooks/useChatSession.js'
import { toolHeading } from '../lib/toolLabel.js'
import { loadCustomOptions } from '../lib/customOptions.js'
import { api, type ChatModelInfo } from '../lib/api.js'
import type { ChatItem, ChatAttachment, TurnStats } from '../types/index'
import { cn } from '../lib/utils.js'
import logo from '../assets/logo.svg'
import logoSmall from '../assets/logo-small.svg'

interface Props {
  sessionId: string | null
  jsonlPath: string | null
  alive: boolean
  visible: boolean
  /** параметры, с которыми процесс запущен: effort из потока не узнать */
  effort?: string
}

interface Option { value: string; label: string; sub?: string }

// Пока CLI не прислал список моделей (процесс ещё стартует) — показываем алиасы
const FALLBACK_MODELS: ChatModelInfo[] = [
  { value: 'fable', displayName: 'Fable', description: 'последняя Fable' },
  { value: 'opus', displayName: 'Opus', description: 'последняя Opus' },
  { value: 'sonnet', displayName: 'Sonnet', description: 'последняя Sonnet' },
  { value: 'haiku', displayName: 'Haiku', description: 'последняя Haiku' },
]
// Порядок основных — как на claude.ai: от самой сильной к самой быстрой
const MAIN_ALIASES = ['fable', 'opus', 'sonnet', 'haiku']
const EFFORT_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'X-High', max: 'Max' }
const ALL_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const MODES: Option[] = [
  { value: 'bypassPermissions', label: 'Bypass', sub: 'без проверок' },
  { value: 'auto', label: 'Auto', sub: 'решает классификатор' },
  { value: 'acceptEdits', label: 'Accept Edits', sub: 'правки без вопросов' },
  { value: 'default', label: 'Manual', sub: 'спрашивать — в чате вопросов нет, отклонит' },
  { value: 'plan', label: 'Plan', sub: 'только планировать' },
]

// claude-opus-5-5 → Opus 5.5
function prettyModel(id: string | null): string {
  if (!id) return 'Модель'
  const m = id.replace(/\[.*\]$/, '').match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/)
  if (!m) return id
  return m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + (m[3] ? '.' + m[3] : '')
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Не спится, Стралитз?'
  if (h < 12) return 'Доброе утро, Стралитз'
  if (h < 18) return 'Добрый день, Стралитз'
  return 'Добрый вечер, Стралитз'
}

const fmt = (n: number) => n.toLocaleString('ru-RU')

/** Искра Claude — в строке «модель работает»: там речь о модели, а не о приложении */
function ClaudeSpark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0 chat-spark-spin" style={{ color: 'var(--accent)' }}>
      {[0, 30, 60, 90, 120, 150].map(a => (
        <rect key={a} x="11" y="2" width="2" height="20" rx="1" fill="currentColor" transform={`rotate(${a} 12 12)`} />
      ))}
    </svg>
  )
}

/** Логотип Vael. До 24px — упрощённый рисунок: полный на таком размере сливается в пятно */
function Spark({ spinning = false, size = 22 }: { spinning?: boolean; size?: number }) {
  return (
    <img
      src={size <= 24 ? logoSmall : logo}
      width={size}
      height={size}
      alt=""
      draggable={false}
      className={cn('shrink-0 select-none', spinning && 'chat-logo-pulse')}
    />
  )
}

/**
 * Плавное появление текста: сеть отдаёт его рывками, а показанная часть
 * догоняет пришедшую равномерно. Чем больше отставание, тем быстрее догоняет.
 * ~30 шагов в секунду — markdown перепарсивается не на каждом кадре
 */
function useSmoothText(text: string, live: boolean): number {
  const [shown, setShown] = useState(() => live ? 0 : text.length)
  const target = useRef(text)
  target.current = text
  const pos = useRef(shown)
  // Скорость печати (симв/с) и дробный остаток — переживают приход новых кусков
  const speed = useRef(25)
  const acc = useRef(0)
  useEffect(() => {
    if (pos.current >= text.length) {
      if (pos.current > text.length) { pos.current = text.length; setShown(text.length) }
      return
    }
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const len = target.current.length
      const left = len - pos.current
      if (left <= 0) return
      // Желаемая скорость растёт с отставанием, а реальная тянется к ней
      // плавно (~0.2 с): кусок пришёл рывком — разгоняемся, догнали — тормозим
      const want = live ? Math.min(600, 25 + left * 4) : Math.min(2500, 80 + left * 8)
      speed.current += (want - speed.current) * Math.min(1, dt * 5)
      acc.current += speed.current * dt
      const step = Math.min(left, Math.floor(acc.current))
      if (step > 0) {
        acc.current -= step
        pos.current += step
        setShown(pos.current)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [text, live])
  return shown
}

type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] }

/**
 * rehype-плагин для печатающегося хвоста: каждая буква — свой span, CSS
 * анимирует только только что появившиеся (React не пересоздаёт старые).
 * Слова держим целиком, иначе перенос строки резал бы их посередине.
 * Код не трогаем — сломалась бы подсветка
 */
function rehypeTypeChars() {
  const walk = (node: HastNode) => {
    if (!node.children) return
    if (node.type === 'element' && (node.tagName === 'pre' || node.tagName === 'code')) return
    const out: HastNode[] = []
    for (const ch of node.children) {
      if (ch.type !== 'text') { walk(ch); out.push(ch); continue }
      for (const part of (ch.value ?? '').split(/(\s+)/)) {
        if (!part) continue
        if (/^\s+$/.test(part)) { out.push({ type: 'text', value: part }); continue }
        out.push({
          type: 'element', tagName: 'span', properties: { className: ['tw'] },
          children: [...part].map(c => ({ type: 'element', tagName: 'span', properties: { className: ['tc'] }, children: [{ type: 'text', value: c }] })),
        })
      }
    }
    node.children = out
  }
  return (tree: HastNode) => walk(tree)
}

/**
 * Где можно разрезать текст на «готовое» и «печатается»: последний пустой
 * перенос вне блока кода. Готовое рендерится один раз, каждый кадр — только хвост
 */
function stableSplit(text: string): number {
  let at = text.lastIndexOf('\n\n')
  while (at > 0) {
    const fences = (text.slice(0, at).match(/```/g) ?? []).length
    if (fences % 2 === 0) return at
    at = text.lastIndexOf('\n\n', at - 1)
  }
  return 0
}

/** Блок кода: сверху язык и «копировать» */
function CodeBlock({ children, ...rest }: React.HTMLAttributes<HTMLPreElement>) {
  const ref = useRef<HTMLPreElement>(null)
  const [done, setDone] = useState(false)
  const child = (Array.isArray(children) ? children[0] : children) as React.ReactElement<{ className?: string }> | undefined
  const lang = /language-([\w+#-]+)/.exec(child?.props?.className ?? '')?.[1]
  const copy = () => {
    navigator.clipboard.writeText(ref.current?.innerText ?? '').then(() => { setDone(true); setTimeout(() => setDone(false), 1200) }).catch(() => {})
  }
  return (
    <div className="chat-codeblock">
      <div className="chat-codeblock-head">
        <span>{lang ?? 'код'}</span>
        <button onClick={copy} title="Копировать">{done ? <Check size={13} /> : <Copy size={13} />}{done ? 'Скопировано' : 'Копировать'}</button>
      </div>
      <pre ref={ref} {...rest}>{children}</pre>
    </div>
  )
}

export const MdBlock = memo(function MdBlock({ text, typing = false }: { text: string; typing?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={typing ? [[rehypeHighlight, { ignoreMissing: true }], rehypeTypeChars] : [[rehypeHighlight, { ignoreMissing: true }]]}
      components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>, pre: ({ node: _n, ...p }) => <CodeBlock {...p} /> }}
    >
      {text}
    </ReactMarkdown>
  )
})

// Ключ текстового блока, который сейчас пишется: только он проявляется плавно
const LiveKeyContext = createContext<string | null>(null)

function LiveMarkdown({ itemKey, text }: { itemKey: string; text: string }) {
  const live = useContext(LiveKeyContext) === itemKey
  return <Markdown text={text} live={live} />
}

const Markdown = memo(function Markdown({ text: fullText, live = false }: { text: string; live?: boolean }) {
  const shown = useSmoothText(fullText, live)
  // Допечатано — обычный markdown целиком, без курсора и разрезов
  if (shown >= fullText.length && !live) return <div className="chat-md"><MdBlock text={fullText} /></div>
  const text = fullText.slice(0, shown)
  const cut = stableSplit(text)
  return (
    <div className="chat-md">
      {cut > 0 && <MdBlock text={text.slice(0, cut)} />}
      <MdBlock text={text.slice(cut)} typing />
    </div>
  )
})

type ToolItem = Extract<ChatItem, { kind: 'tool' }>

// C:/Users/.../src/hooks/useChatSession.ts → hooks/useChatSession.ts: полный путь — в подсказке
function shortSubject(subject: string): string {
  if (!/[\\/]/.test(subject) || /\s/.test(subject.trim())) return subject
  const parts = subject.split(/[\\/]/).filter(Boolean)
  return parts.length > 2 ? parts.slice(-2).join('/') : subject
}

function toolHead(item: ToolItem) {
  const input = (item.input && typeof item.input === 'object' ? item.input : {}) as Record<string, unknown>
  return toolHeading(item.name, input)
}

type DiffLine = { t: ' ' | '+' | '-'; s: string }

/** Построчный дифф через LCS. Большие правки не сравниваем — просто «было / стало» */
function lineDiff(a: string, b: string): DiffLine[] {
  const A = a.split('\n'), B = b.split('\n')
  // Общие края отрезаем сразу: правка обычно трогает пару строк в середине
  let pre = 0
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++
  let suf = 0
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++
  const a2 = A.slice(pre, A.length - suf), b2 = B.slice(pre, B.length - suf)
  const mid: DiffLine[] = []
  if (a2.length * b2.length > 250_000) {
    for (const s of a2) mid.push({ t: '-', s })
    for (const s of b2) mid.push({ t: '+', s })
  } else {
    const n = a2.length, m = b2.length
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
    let i = 0, j = 0
    while (i < n || j < m) {
      if (i < n && j < m && a2[i] === b2[j]) { mid.push({ t: ' ', s: a2[i] }); i++; j++ }
      else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) mid.push({ t: '+', s: b2[j++] })
      else mid.push({ t: '-', s: a2[i++] })
    }
  }
  // Контекст — до двух строк с каждой стороны, как в обычном диффе
  return [
    ...A.slice(Math.max(0, pre - 2), pre).map(s => ({ t: ' ' as const, s })),
    ...mid,
    ...A.slice(A.length - suf, A.length - suf + 2).map(s => ({ t: ' ' as const, s })),
  ]
}

type EditPair = { old: string; new: string }

function editPairs(item: ToolItem): EditPair[] | null {
  const inp = (item.input ?? {}) as Record<string, unknown>
  if ((item.name === 'Edit' || item.name === 'Update') && typeof inp.old_string === 'string' && typeof inp.new_string === 'string')
    return [{ old: inp.old_string, new: inp.new_string }]
  if (item.name === 'MultiEdit' && Array.isArray(inp.edits))
    return (inp.edits as Record<string, unknown>[]).map(e => ({ old: String(e.old_string ?? ''), new: String(e.new_string ?? '') }))
  return null
}

/** +N −M для заголовка правки / нового файла */
function toolDelta(item: ToolItem): { add: number; del: number } | null {
  const pairs = editPairs(item)
  if (pairs) {
    let add = 0, del = 0
    for (const p of pairs) for (const l of lineDiff(p.old, p.new)) { if (l.t === '+') add++; else if (l.t === '-') del++ }
    return { add, del }
  }
  const inp = (item.input ?? {}) as Record<string, unknown>
  if (item.name === 'Write' && typeof inp.content === 'string') return { add: inp.content.replace(/\n$/, '').split('\n').length, del: 0 }
  return null
}

const clip = (s: string, n = 20000) => s.length > n ? s.slice(0, n) + '\n…' : s

function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="chat-code chat-diff">
      {lines.map((l, i) => (
        <div key={i} className={cn('chat-code-line', l.t === '+' && 'is-add', l.t === '-' && 'is-del')}>
          <span className="chat-code-gutter">{l.t === ' ' ? '' : l.t === '+' ? '+' : '−'}</span>
          <span className="chat-code-text">{l.s || ' '}</span>
        </div>
      ))}
    </div>
  )
}

function NumberedView({ text, add }: { text: string; add?: boolean }) {
  const lines = clip(text).replace(/\n$/, '').split('\n')
  return (
    <div className={cn('chat-code', add && 'is-new')}>
      {lines.map((s, i) => (
        <div key={i} className="chat-code-line">
          <span className="chat-code-gutter">{i + 1}</span>
          <span className="chat-code-text">{s || ' '}</span>
        </div>
      ))}
    </div>
  )
}

/** Что внутри вызова: для частых инструментов — по-человечески, для прочих — JSON */
function ToolBody({ item }: { item: ToolItem }) {
  const inp = (item.input ?? {}) as Record<string, unknown>
  const err = item.isError && item.result != null ? <pre className="is-error">{clip(item.result)}</pre> : null
  const pairs = editPairs(item)
  if (pairs) return <div className="chat-tool-body">{pairs.map((p, i) => <DiffView key={i} lines={lineDiff(p.old, p.new)} />)}{err}</div>
  if (item.name === 'Write' && typeof inp.content === 'string') return <div className="chat-tool-body"><NumberedView text={inp.content} add />{err}</div>
  if (item.name === 'Bash' || item.name === 'PowerShell') {
    return (
      <div className="chat-tool-body">
        <pre className="chat-tool-cmd">{String(inp.command ?? '')}</pre>
        {item.result != null && <pre className={cn(item.isError && 'is-error')}>{clip(item.result) || 'нет вывода'}</pre>}
      </div>
    )
  }
  // Read, Grep, Glob, Web*: аргументы уже в заголовке — показываем только ответ
  if (['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'].includes(item.name))
    return <div className="chat-tool-body">{item.result != null && <pre className={cn(item.isError && 'is-error')}>{clip(item.result)}</pre>}</div>
  return (
    <div className="chat-tool-body">
      {item.input != null && <pre>{JSON.stringify(item.input, null, 2)}</pre>}
      {item.result != null && <pre className={cn(item.isError && 'is-error')}>{clip(item.result)}</pre>}
    </div>
  )
}

function Delta({ d }: { d: { add: number; del: number } | null }) {
  if (!d) return null
  return (
    <span className="chat-tool-delta" title="Строк добавлено / удалено">
      {d.add > 0 && <span className="is-add">+{d.add}</span>}
      {d.del > 0 && <span className="is-del">−{d.del}</span>}
    </span>
  )
}

const ToolRow = memo(function ToolRow({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false)
  const { verb, subject } = toolHead(item)
  const delta = useMemo(() => toolDelta(item), [item])
  return (
    <div className={cn('chat-tool', open && 'is-open')}>
      <button className="chat-tool-head" onClick={() => setOpen(o => !o)} title={subject}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="chat-tool-verb">{verb}</span>
        <span className="chat-tool-subject">{shortSubject(subject)}</span>
        <Delta d={delta} />
        <span className={cn('chat-tool-state', item.isError && 'is-error')}>
          {!item.done ? 'работает…' : item.isError ? 'ошибка' : ''}
        </span>
      </button>
      {open && <ToolBody item={item} />}
    </div>
  )
})

/** Подряд идущие вызовы инструментов — одной строкой, как сворачивает CLI */
const ToolGroup = memo(function ToolGroup({ items }: { items: ToolItem[] }) {
  const [open, setOpen] = useState(false)
  const heads = items.map(toolHead)
  const same = heads.every(h => h.verb === heads[0].verb && h.subject === heads[0].subject)
  let title: React.ReactNode
  if (same) {
    title = <><span className="chat-tool-verb">{heads[0].verb}</span><span className="chat-tool-subject">{shortSubject(heads[0].subject)}</span></>
  } else {
    // Разные действия: «Edit ×3, Bash ×2»
    const counts = new Map<string, number>()
    for (const it of items) counts.set(it.name, (counts.get(it.name) ?? 0) + 1)
    title = <span className="chat-tool-verb">{[...counts].map(([n, c]) => c > 1 ? `${n} ×${c}` : n).join(', ')}</span>
  }
  const running = items.some(it => !it.done)
  const errors = items.filter(it => it.isError).length
  return (
    <div className="chat-tool">
      <button className="chat-tool-head" onClick={() => setOpen(o => !o)} title={same ? heads[0].subject : undefined}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {title}
        <span className={cn('chat-tool-state', errors > 0 && 'is-error')}>
          {running ? 'работает…' : errors > 0 ? `ошибок: ${errors}` : ''}
          <span className="chat-tool-count">×{items.length}</span>
        </span>
      </button>
      {open && <div className="chat-tool-group">{items.map(it => <ToolRow key={it.key} item={it} />)}</div>}
    </div>
  )
})

type Row =
  | { kind: 'item'; item: ChatItem }
  | { kind: 'tools'; key: string; items: ToolItem[] }
  | { kind: 'steps'; key: string; rows: Row[]; tools: ToolItem[] }

/**
 * Лента по ходам: всё, что модель делала до итогового ответа (пояснения +
 * инструменты), сворачивается в один блок «шаги», как на claude.ai.
 * Ход, который ещё идёт, не сворачиваем — там видно, чем занята модель.
 */
function buildRows(items: ChatItem[], liveTurn: boolean): Row[] {
  const rows: Row[] = []
  let seg: ChatItem[] = []
  const flushSeg = (isLast: boolean) => {
    if (seg.length === 0) return
    const visible = seg.filter(it => it.kind !== 'thinking')
    let lastText = -1
    for (let i = visible.length - 1; i >= 0; i--) {
      const it = visible[i]
      if (it.kind === 'text' && it.text.trim()) { lastText = i; break }
    }
    const before = lastText > 0 ? visible.slice(0, lastText) : []
    const tools = before.filter((it): it is ToolItem => it.kind === 'tool')
    // Сворачиваем только законченный ход, где до ответа была работа с инструментами
    if (!(isLast && liveTurn) && tools.length > 0 && before.every(it => it.kind === 'text' || it.kind === 'tool')) {
      rows.push({ kind: 'steps', key: 'steps:' + before[0].key, rows: groupRows(before, false), tools })
      rows.push(...groupRows(visible.slice(lastText)))
    } else {
      rows.push(...groupRows(visible))
    }
    seg = []
  }
  for (const it of items) {
    if (it.kind === 'user') { flushSeg(false); rows.push({ kind: 'item', item: it }); continue }
    seg.push(it)
  }
  flushSeg(true)
  return rows
}

// Внутри свёрнутых шагов не группируем: там и так одна рамка, вторая — лишняя
function groupRows(items: ChatItem[], group = true): Row[] {
  const rows: Row[] = []
  for (const it of items) {
    // Невидимые блоки не должны рвать группу инструментов
    if (it.kind === 'thinking') continue
    const prev = rows[rows.length - 1]
    if (it.kind === 'tool' && group) {
      if (prev?.kind === 'tools') { prev.items.push(it); continue }
      if (prev?.kind === 'item' && prev.item.kind === 'tool') {
        rows[rows.length - 1] = { kind: 'tools', key: prev.item.key, items: [prev.item, it] }
        continue
      }
    }
    rows.push({ kind: 'item', item: it })
  }
  return rows
}

function RowView({ row }: { row: Row }) {
  if (row.kind === 'tools') return <ToolGroup items={row.items} />
  if (row.kind === 'steps') return <StepsGroup row={row} />
  return <ItemView item={row.item} />
}

/** Свёрнутая работа хода: «▸ 7 шагов · Read, Grep ×3, Bash» */
const StepsGroup = memo(function StepsGroup({ row }: { row: Extract<Row, { kind: 'steps' }> }) {
  const [open, setOpen] = useState(false)
  const counts = new Map<string, number>()
  for (const t of row.tools) counts.set(t.name, (counts.get(t.name) ?? 0) + 1)
  const summary = [...counts].map(([n, c]) => c > 1 ? `${n} ×${c}` : n).join(', ')
  const errors = row.tools.filter(t => t.isError).length
  const n = row.tools.length
  // 1 шаг, 2 шага, 5 шагов
  const word = n % 10 === 1 && n % 100 !== 11 ? 'шаг' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'шага' : 'шагов'
  return (
    <div className={cn('chat-steps', open && 'is-open')}>
      <button className="chat-steps-head" onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{n} {word}</span>
        <span className="chat-steps-summary">· {summary}</span>
        {errors > 0 && <span className="chat-steps-err">· ошибок: {errors}</span>}
      </button>
      {open && <div className="chat-steps-body">{row.rows.map(r => <RowView key={r.kind === 'item' ? r.item.key : r.key} row={r} />)}</div>}
    </div>
  )
})

/** Текст сообщения, где ссылки [имя] на вложения — чипы на своих местах */
function UserText({ text, attachments }: { text: string; attachments?: string[] }) {
  if (!attachments?.length) return <>{text}</>
  const names = new Set(attachments)
  const out: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(/\[([^\]\n]+)\]/g)) {
    if (!names.has(m[1])) continue
    out.push(text.slice(last, m.index))
    out.push(<span key={m.index} className="chat-inline-chip" title={m[1]}><Paperclip size={12} /><span className="chat-inline-chip-name" ref={el => { if (el) markOverflow(el) }}>{m[1]}</span></span>)
    last = m.index! + m[0].length
  }
  out.push(text.slice(last))
  return <>{out}</>
}

// 14:05, а если не сегодня — 25.10 14:05
function fmtTime(at: number): string {
  const d = new Date(at)
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? hm : `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${hm}`
}

/** Время и «копировать» — проявляются при наведении на сообщение */
function MsgActions({ text, at }: { text: string; at?: number }) {
  const [done, setDone] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200) }).catch(() => {})
  }
  return (
    <div className="chat-msg-actions">
      <button onClick={copy} title="Копировать">{done ? <Check size={13} /> : <Copy size={13} />}</button>
      {at && <span title={new Date(at).toLocaleString('ru-RU')}>{fmtTime(at)}</span>}
    </div>
  )
}

function AnswerView({ item }: { item: Extract<ChatItem, { kind: 'text' }> }) {
  const live = useContext(LiveKeyContext) === item.key
  return (
    <div className="chat-msg chat-answer">
      <LiveMarkdown itemKey={item.key} text={item.text} />
      {!live && <MsgActions text={item.text} at={item.at} />}
    </div>
  )
}

// Причины отказа CLI — по-человечески
function compactError(e?: string): string {
  if (!e) return 'Причина неизвестна'
  if (/not enough messages/i.test(e)) return 'Мало сообщений для сжатия — сжимается только разговор длиннее нескольких ходов'
  if (/not logged in|login/i.test(e)) return 'Процесс не авторизован — нужен повторный вход'
  return e.replace(/^Error during compaction:\s*/i, '')
}

/**
 * Компакт в ленте. Настоящего процента нет: это один запрос, длина пересказа
 * заранее неизвестна — поэтому пока идёт, бежит блик и тикает таймер.
 * В конце полоса ужимается от «было» к «стало».
 */
// Папка файла: две последние, остальное многоточием
function shortDir(dir: string): string {
  const parts = dir.split(/[\\/]+/).filter(Boolean)
  return parts.length > 2 ? "…\\" + parts.slice(-2).join("\\") : parts.join("\\")
}

function CompactCard({ item }: { item: Extract<ChatItem, { kind: 'compact' }> }) {
  const [now, setNow] = useState(Date.now())
  // Анимируем сжатие, только если видели карточку живой; из истории — сразу итог
  const sawRunning = useRef(item.state === 'running')
  const [shrunk, setShrunk] = useState(!sawRunning.current)
  const [openSummary, setOpenSummary] = useState(false)
  useEffect(() => {
    if (item.state !== 'running') return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [item.state])
  useEffect(() => {
    if (item.state !== 'done' || shrunk) return
    const t = requestAnimationFrame(() => requestAnimationFrame(() => setShrunk(true)))
    return () => cancelAnimationFrame(t)
  }, [item.state, shrunk])

  const { before, after } = item
  const ratio = before && after != null ? Math.max(0.01, Math.min(1, after / before)) : null
  const fill = item.state === 'done' && shrunk && ratio != null ? ratio * 100 : 100
  return (
    <div className="chat-compact-wrap">
      <div className={cn('chat-compact', 'is-' + item.state)}>
        <div className="chat-compact-head">
          <div>
            <div className="chat-compact-title">
              {item.state === 'running' ? 'Сжимаю контекст' : item.state === 'done' ? 'Контекст сжат' : 'Не получилось сжать'}
            </div>
            <div className="chat-compact-sub">
              {item.state === 'running' ? 'модель пересказывает разговор' : item.state === 'done' ? 'дальше модель помнит прошлое только пересказом' : 'контекст остался как был'}
            </div>
          </div>
          {item.state === 'running' && item.startedAt && <span className="chat-compact-time">{Math.floor((now - item.startedAt) / 1000)} с</span>}
          {item.state === 'done' && ratio != null && <span className="chat-compact-save">−{Math.round((1 - ratio) * 100)}%</span>}
        </div>
        {item.state !== 'failed' && (
          <>
            <div className="chat-compact-track">
              {item.state === 'done' && <div className={cn('ghost', shrunk && 'is-gone')} />}
              <div className="fill" style={{ width: fill + '%' }} />
              {item.state === 'running' && <div className="shimmer" />}
            </div>
            <div className="chat-compact-scale">
              {item.state === 'done' && before && after != null
                ? <><span className="from">{fmtTokens(before)}</span><span className="arrow">→</span><span className="to">{fmtTokens(after)}</span></>
                : <span>{before ? `контекст · ${fmtTokens(before)}` : 'контекст'}</span>}
            </div>
          </>
        )}
        {item.state === 'done' && item.files && item.files.length > 0 && (
          <div className="chat-compact-files">
            <div className="chat-compact-files-title">Вернулось в контекст</div>
            {item.files.map(f => {
              const cut = f.path.replace(/[\\/]+$/, '').search(/[^\\/]+$/)
              return (
                <div key={f.path} className={cn('chat-compact-file', f.ref && 'is-ref')} title={f.path}>
                  <span className="name">{f.path.slice(cut)}</span>
                  <span className="dir">{shortDir(f.path.slice(0, cut))}</span>
                  <span className="meta">{f.ref ? 'только имя' : f.lines != null ? `${f.lines} строк` : 'целиком'}</span>
                </div>
              )
            })}
          </div>
        )}
        {item.state === 'done' && item.summary && (
          <div className="chat-compact-summary">
            <button className="chat-compact-summary-toggle" onClick={() => setOpenSummary(o => !o)}>
              {openSummary ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Пересказ
              <span className="meta">{fmtTokens(Math.round(item.summary.length / 3.5))} токенов · примерно</span>
            </button>
            {openSummary && <div className="chat-compact-summary-body thin-scroll"><MdBlock text={item.summary} /></div>}
          </div>
        )}
        {item.state === 'failed' && <div className="chat-compact-err">{compactError(item.error)}</div>}
      </div>
      {item.state === 'done' && <div className="chat-divider">выше — до сжатия</div>}
    </div>
  )
}

const ItemView = memo(function ItemView({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user': return (
      <div className="chat-msg chat-msg-user">
        <div className={cn('chat-user', item.pending && 'is-pending')}><UserText text={item.text} attachments={item.attachments} /></div>
        {!item.pending && <MsgActions text={item.text} at={item.at} />}
      </div>
    )
    case 'text': return item.text ? <AnswerView item={item} /> : null
    // Текст thinking CLI не отдаёт — строка была бы пустой. Что модель думает, видно в статусе
    case 'thinking': return null
    case 'tool': return <ToolRow item={item} />
    case 'note': return <div className="chat-note">{item.markdown ? <Markdown text={item.text} /> : item.text}</div>
    case 'divider': return <div className="chat-divider">{item.text}</div>
    case 'compact': return <CompactCard item={item} />
    case 'meta': return <div className="chat-meta">{item.stats ? <TurnStatsLine s={item.stats} /> : item.text}</div>
    case 'error': return <div className="chat-error">{item.text}</div>
  }
})

const PHASE_LABEL: Record<ChatProgress['phase'], string> = {
  waiting: 'Жду модель',
  thinking: 'Думаю',
  writing: 'Пишу',
  tool: 'Работаю',
}

// После такой паузы без единого события стоит насторожиться
const STALL_MS = 30_000

const TIP = {
  sec: 'Сколько идёт ход',
  input: 'Новый вход: твоё сообщение, результаты инструментов и запись в кэш. Запись стоит дороже обычного входа',
  cache: 'Чтение из кэша: каждый запрос хода заново читает весь контекст. Стоит 10% от обычного входа, но на длинной сессии это главная часть расхода лимитов',
  output: 'Выход: что сгенерировала модель, включая размышления и вызовы инструментов',
}

/** ↑ новое (+кэш) · ↓ выход — у каждой части своя подсказка */
function TokenParts({ input, cache, output, requests }: { input: number; cache: number; output: number; requests: number }) {
  const per = requests > 1 ? `

Запросов за ход: ${requests}, в среднем ${fmtTokens(Math.round(cache / requests))} на запрос` : ''
  return (
    <>
      {input > 0 && <> · <span title={TIP.input}>↑ {fmtTokens(input)}</span></>}
      {cache > 0 && <> <span className="chat-stat-cache" title={TIP.cache + per}>(+{fmtTokens(cache)} кэш)</span></>}
      {' · '}<span title={TIP.output}>↓ {fmtTokens(output)}</span>
    </>
  )
}

function TurnStatsLine({ s }: { s: TurnStats }) {
  return (
    <>
      <span title="Длительность хода">{s.sec.toFixed(1)} с</span>
      <TokenParts input={s.input} cache={s.cache} output={s.output} requests={s.requests} />
    </>
  )
}

/** Как строка статуса у CLI: что делает, сколько идёт, токены туда и обратно */
function ProgressLine({ getProgress }: { getProgress: () => ChatProgress | null }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 500)
    return () => clearInterval(id)
  }, [])
  const p = getProgress()
  const now = Date.now()
  const sec = p ? Math.floor((now - p.startedAt) / 1000) : 0
  const silent = p ? now - p.lastEventAt : 0
  const label = !p ? 'Жду модель' : p.phase === 'tool' && p.toolName ? `${PHASE_LABEL.tool}: ${p.toolName}` : PHASE_LABEL[p.phase]
  return (
    <div className="chat-progress">
      <ClaudeSpark size={18} />
      <span className="chat-progress-label">{label}</span>
      {p && (
        <span className="chat-progress-stats">
          <span title={TIP.sec}>{sec} с</span>
          <TokenParts input={p.inputTokens} cache={p.cacheTokens} output={p.outputTokens} requests={p.requests} />
          {silent > STALL_MS && <span className="chat-progress-stall"> · тишина {Math.floor(silent / 1000)} с</span>}
        </span>
      )}
    </div>
  )
}

function Menu({ value, label, options, onPick, accent }: { value: string | null; label: React.ReactNode; options: Option[]; onPick: (v: string) => void; accent?: boolean }) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const fn = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])
  return (
    <div className="relative" ref={boxRef}>
      <button className={cn('chat-pill', accent && 'is-strong')} onClick={() => setOpen(o => !o)}>
        {label}<ChevronDown size={12} />
      </button>
      {open && (
        <div className="chat-menu">
          {options.map(o => (
            <button key={o.value} className="chat-menu-item" onClick={() => { onPick(o.value); setOpen(false) }}>
              <span className="flex flex-col items-start">
                <span>{o.label}</span>
                {o.sub && <span className="chat-menu-sub">{o.sub}</span>}
              </span>
              {o.value === value && <Check size={13} style={{ color: 'var(--accent)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const baseModel = (id: string | null) => id?.replace(/\[.*\]$/, '') ?? null

/** Модель, которую показывать для id из потока: алиас («Opus 5.5») важнее конкретной версии */
function findModel(models: ChatModelInfo[], id: string | null): ChatModelInfo | undefined {
  const b = baseModel(id)
  if (!b) return undefined
  return models.find(m => MAIN_ALIASES.includes(m.value) && m.resolvedModel === b)
    ?? models.find(m => m.value !== 'default' && (m.resolvedModel === b || m.value === b))
}

/** Выбор модели в духе claude.ai: основные, внутри — Effort и «Ещё модели» */
function ModelMenu({ models, model, effort, onModel, onEffort }: {
  models: ChatModelInfo[]
  model: string | null
  effort: string | null
  onModel: (value: string) => void
  onEffort: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'main' | 'effort' | 'more'>('main')
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) { setView('main'); return }
    const fn = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])

  const list = models.length ? models : FALLBACK_MODELS
  const main = MAIN_ALIASES.map(a => list.find(m => m.value === a)).filter(Boolean) as ChatModelInfo[]
  const custom = loadCustomOptions('model').map(o => ({ value: o.value, displayName: o.label, description: o.sub }))
  const more = [...list.filter(m => m.value !== 'default' && !MAIN_ALIASES.includes(m.value)), ...custom]
  const current = findModel(list, model)
  const efforts = current?.supportedEffortLevels ?? ALL_EFFORTS
  const isCurrent = (m: ChatModelInfo) => !!model && (m.resolvedModel === baseModel(model) || m.value === baseModel(model))

  const pick = (v: string) => { onModel(v); setOpen(false) }
  const row = (m: ChatModelInfo) => (
    <button key={m.value} className="chat-menu-item" onClick={() => pick(m.value)}>
      <span className="flex flex-col items-start">
        <span>{m.displayName}</span>
        {m.description && <span className="chat-menu-sub">{m.description}</span>}
      </span>
      {isCurrent(m) && <Check size={14} style={{ color: 'var(--accent)' }} />}
    </button>
  )

  return (
    <div className="relative" ref={boxRef}>
      <button className="chat-pill is-strong" onClick={() => setOpen(o => !o)}>
        {current?.displayName ?? prettyModel(model)}
        {effort && <span className="chat-pill-sub">{EFFORT_LABEL[effort] ?? effort}</span>}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="chat-menu chat-model-menu">
          {view === 'main' && <>
            {main.map(row)}
            <div className="chat-menu-sep" />
            <button className="chat-menu-item" onClick={() => setView('effort')}>
              <span>Мышление</span>
              <span className="chat-menu-side">{effort ? EFFORT_LABEL[effort] ?? effort : 'по умолчанию'}<ChevronRight size={14} /></span>
            </button>
            {more.length > 0 && (
              <button className="chat-menu-item" onClick={() => setView('more')}>
                <span>Ещё модели</span>
                <span className="chat-menu-side"><ChevronRight size={14} /></span>
              </button>
            )}
          </>}
          {view !== 'main' && (
            <button className="chat-menu-item chat-menu-back" onClick={() => setView('main')}>
              <span className="flex items-center gap-1"><ChevronLeft size={14} />{view === 'effort' ? 'Effort' : 'Ещё модели'}</span>
            </button>
          )}
          {view === 'effort' && efforts.map(e => (
            <button key={e} className="chat-menu-item" onClick={() => { onEffort(e); setOpen(false) }}>
              <span>{EFFORT_LABEL[e] ?? e}</span>
              {e === effort && <Check size={14} style={{ color: 'var(--accent)' }} />}
            </button>
          ))}
          {view === 'more' && <div className="chat-menu-scroll">{more.map(row)}</div>}
        </div>
      )}
    </div>
  )
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const IMAGE_MAX = 5 * 1024 * 1024
const PDF_MAX = 20 * 1024 * 1024
const TEXT_MAX = 256 * 1024

function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

/**
 * Вставка из буфера: у File нет пути, поэтому читаем прямо здесь, по тем же
 * правилам, что main для перетащенных файлов (electron/services/ChatAttachments.ts)
 */
async function fileToAttachment(file: File): Promise<ChatAttachment | null> {
  const name = file.name || 'вставка.png'
  if (IMAGE_TYPES.includes(file.type)) {
    if (file.size > IMAGE_MAX) return null
    return { kind: 'image', name, size: file.size, mediaType: file.type, data: await readAsBase64(file) }
  }
  if (file.type === 'application/pdf') {
    if (file.size > PDF_MAX) return null
    return { kind: 'pdf', name, size: file.size, data: await readAsBase64(file) }
  }
  if (file.size > TEXT_MAX) return null
  const text = await file.text()
  if (text.includes('\u0000')) return null
  return { kind: 'text', name, size: file.size, text }
}

// ── Композер с чипами прямо в тексте ────────────────────────────────────────
// textarea чипы внутри текста не рисует, поэтому поле — contenteditable.
// В DOM стоит только чип с id, само вложение ждёт в Map: удалил чип
// Backspace'ом — вложение не уйдёт.

const ICON_FILE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>'
const ICON_LINK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>'

function attachHint(a: ChatAttachment): string {
  if (a.kind === 'path') return `${a.path}\nОтправится путём: ${a.reason}`
  if (a.kind === 'image') return `${a.name}\nКартинка уйдёт в сообщении`
  if (a.kind === 'pdf') return `${a.name}\nPDF уйдёт в сообщении`
  return `${a.name}\nТекст файла уйдёт в сообщении`
}

function makeChip(id: number, a: ChatAttachment): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.className = 'chat-inline-chip' + (a.kind === 'path' ? ' is-path' : '')
  chip.contentEditable = 'false'
  chip.dataset.attachId = String(id)
  chip.title = attachHint(a)
  if (a.kind === 'image') {
    const img = document.createElement('img')
    img.src = `data:${a.mediaType};base64,${a.data}`
    img.alt = ''
    chip.appendChild(img)
  } else {
    const icon = document.createElement('span')
    icon.className = 'chat-inline-chip-icon'
    icon.innerHTML = a.kind === 'path' ? ICON_LINK : ICON_FILE
    chip.appendChild(icon)
  }
  const name = document.createElement('span')
  name.className = 'chat-inline-chip-name'
  name.textContent = a.kind === 'path' ? a.path : a.name
  chip.appendChild(name)
  // Фейд — только если имя правда не влезло: замер после вставки в DOM
  requestAnimationFrame(() => markOverflow(name))
  return chip
}

function markOverflow(el: HTMLElement) {
  el.classList.toggle('is-long', el.scrollWidth > el.clientWidth + 1)
}

/** Содержимое поля → текст вперемешку с вложениями, в порядке ввода */
function serialize(root: HTMLElement, store: Map<number, ChatAttachment>): ComposedPart[] {
  const parts: ComposedPart[] = []
  const pushText = (t: string) => {
    if (!t) return
    const last = parts[parts.length - 1]
    if (typeof last === 'string') parts[parts.length - 1] = last + t
    else parts.push(t)
  }
  const walk = (node: Node, isFirstBlock: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) { pushText((node.textContent ?? '').replace(/ /g, ' ')); return }
    if (!(node instanceof HTMLElement)) return
    const id = node.dataset.attachId
    if (id) { const a = store.get(Number(id)); if (a) parts.push(a); return }
    if (node.tagName === 'BR') { pushText('\n'); return }
    // Chromium заворачивает новые строки в div — это перенос
    if ((node.tagName === 'DIV' || node.tagName === 'P') && !isFirstBlock) pushText('\n')
    node.childNodes.forEach((c, i) => walk(c, i === 0))
  }
  root.childNodes.forEach((c, i) => walk(c, i === 0))
  // Хвостовые пробелы и переносы не нужны
  const last = parts[parts.length - 1]
  if (typeof last === 'string') { const t = last.replace(/\s+$/, ''); if (t) parts[parts.length - 1] = t; else parts.pop() }
  if (typeof parts[0] === 'string') { const t = (parts[0] as string).replace(/^\s+/, ''); if (t) parts[0] = t; else parts.shift() }
  return parts
}

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

function Composer({ disabled, busy, onSend, onStop, commands, visible, footer }: {
  disabled: boolean
  busy: boolean
  onSend: (parts: ComposedPart[]) => void
  onStop: () => void
  commands: ChatCommand[]
  visible: boolean
  footer: React.ReactNode
}) {
  const edRef = useRef<HTMLDivElement>(null)
  const store = useRef(new Map<number, ChatAttachment>())
  const seq = useRef(0)
  // Где стоял курсор, когда начали читать файл: чтение асинхронное, фокус к тому времени может уйти
  const savedRange = useRef<Range | null>(null)
  const [version, setVersion] = useState(0)
  const [sel, setSel] = useState(0)

  const bump = () => setVersion(v => v + 1)

  useEffect(() => { if (visible && !disabled) edRef.current?.focus() }, [visible, disabled])

  const parts = useMemo(() => edRef.current ? serialize(edRef.current, store.current) : [], [version])
  const plain = parts.every(p => typeof p === 'string') ? (parts as string[]).join('') : null
  const isEmpty = parts.length === 0

  const rememberCaret = () => {
    const s = window.getSelection()
    const ed = edRef.current
    if (ed && s && s.rangeCount && ed.contains(s.anchorNode)) savedRange.current = s.getRangeAt(0).cloneRange()
  }

  const insertAttachments = (list: (ChatAttachment | null)[]) => {
    const ed = edRef.current
    if (!ed) return
    const ok = list.filter(Boolean) as ChatAttachment[]
    if (!ok.length) return
    ed.focus()
    let range = savedRange.current && ed.contains(savedRange.current.startContainer) ? savedRange.current : null
    if (!range) { placeCaretAtEnd(ed); range = window.getSelection()!.getRangeAt(0) }
    range.deleteContents()
    for (const a of ok) {
      const id = ++seq.current
      store.current.set(id, a)
      const chip = makeChip(id, a)
      const space = document.createTextNode(' ')
      range.insertNode(space)
      range.insertNode(chip)
      range.setStartAfter(space)
      range.collapse(true)
    }
    const s = window.getSelection()
    s?.removeAllRanges()
    s?.addRange(range)
    savedRange.current = null
    bump()
  }

  const attachPaths = async (paths: string[]) => {
    if (!paths.length || !api.chatReadAttachments) return
    insertAttachments(await api.chatReadAttachments(paths))
  }

  // Перетащенные в окно файлы — чипами туда, где стоит курсор
  useEffect(() => {
    if (!visible) return
    const onPaths = (e: Event) => { rememberCaret(); attachPaths((e as CustomEvent<string[]>).detail) }
    // Electron давно не отдаёт File.path — тогда App шлёт сами файлы
    const onFiles = async (e: Event) => {
      rememberCaret()
      const files = Array.from((e as CustomEvent<FileList>).detail ?? [])
      insertAttachments(await Promise.all(files.map(f => fileToAttachment(f).catch(() => null))))
    }
    document.addEventListener('vaeli:dropPaths', onPaths)
    document.addEventListener('vaeli:dropFiles', onFiles)
    return () => {
      document.removeEventListener('vaeli:dropPaths', onPaths)
      document.removeEventListener('vaeli:dropFiles', onFiles)
    }
  }, [visible])

  const onPaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    const files = Array.from(e.clipboardData.files)
    if (files.length > 0) {
      rememberCaret()
      insertAttachments(await Promise.all(files.map(f => fileToAttachment(f).catch(() => null))))
      return
    }
    // Только текст, без чужого форматирования
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
  }

  const pickFiles = async () => {
    if (!api.chatPickFiles) return
    rememberCaret()
    attachPaths(await api.chatPickFiles())
  }

  const setPlain = (text: string) => {
    const ed = edRef.current
    if (!ed) return
    ed.textContent = text
    store.current.clear()
    ed.focus()
    placeCaretAtEnd(ed)
    bump()
  }

  // Подсказки команд: пока вводится первое слово после "/"
  const suggestions = useMemo(() => {
    const m = plain?.match(/^\/(\S*)$/)
    if (!m) return []
    const q = m[1].toLowerCase()
    return commands.filter(c => c.name.toLowerCase().startsWith(q)).slice(0, 8)
  }, [plain, commands])
  useEffect(() => setSel(0), [suggestions.length])

  const canSend = !isEmpty && !disabled && !busy

  const submit = () => {
    if (!canSend) return
    onSend(parts)
    setPlain('')
    edRef.current?.replaceChildren()
    bump()
  }

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => (s + 1) % suggestions.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => (s - 1 + suggestions.length) % suggestions.length); return }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && plain !== '/' + suggestions[sel].name)) {
        e.preventDefault()
        setPlain('/' + suggestions[sel].name + ' ')
        return
      }
    }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (e.shiftKey) { document.execCommand('insertLineBreak'); bump() }
      else submit()
    }
  }

  return (
    <div className="chat-composer-wrap">
      {suggestions.length > 0 && (
        <div className="chat-suggest">
          {suggestions.map((c, i) => (
            <button key={c.name} className={cn('chat-suggest-item', i === sel && 'is-sel')} onMouseDown={e => { e.preventDefault(); setPlain('/' + c.name + ' ') }}>
              <span className="chat-suggest-name">/{c.name}{c.argumentHint ? <span className="chat-menu-sub"> {c.argumentHint}</span> : null}</span>
              {c.description && <span className="chat-suggest-desc">{c.description}</span>}
            </button>
          ))}
        </div>
      )}
      <div className={cn('chat-composer', disabled && 'is-disabled')}>
        <div
          ref={edRef}
          className={cn('chat-editor', isEmpty && 'is-empty')}
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          data-placeholder={disabled ? 'Процесс чата не запущен' : 'Чем помочь?'}
          onInput={bump}
          onKeyDown={onKey}
          onPaste={onPaste}
          onBlur={rememberCaret}
        />
        <div className="chat-composer-row">
          <div className="flex items-center gap-2 min-w-0">
            <button className="chat-plus" onMouseDown={e => e.preventDefault()} onClick={pickFiles} disabled={disabled} title="Прикрепить файлы"><Plus size={17} /></button>
          </div>
          {busy ? (
            <button className="chat-send" onClick={onStop} title="Остановить"><Square size={13} fill="currentColor" /></button>
          ) : (
            <button className="chat-send" onClick={submit} disabled={!canSend} title="Отправить"><ArrowUp size={17} /></button>
          )}
        </div>
      </div>
      {footer}
    </div>
  )
}

export function ChatView({ sessionId, jsonlPath, alive, visible, effort: initialEffort }: Props) {
  const chat = useChatSession(sessionId, jsonlPath, alive)
  const [effort, setEffort] = useState(initialEffort ?? null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [away, setAway] = useState(false)
  const [ctxFull, setCtxFull] = useState(() => { try { return localStorage.getItem('vaeli:ctx-full') === '1' } catch { return false } })
  const toggleCtx = () => setCtxFull(v => { try { localStorage.setItem('vaeli:ctx-full', v ? '0' : '1') } catch {} return !v })

  const colRef = useRef<HTMLDivElement>(null)

  // Прилипаем к низу, пока пользователь сам не отмотал вверх. Следим за высотой
  // ленты, а не за items: текст проявляется плавно и растёт между событиями
  const hasItems = chat.items.length > 0
  useEffect(() => {
    const el = scrollRef.current
    const col = colRef.current
    if (!el || !col) return
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight })
    ro.observe(col)
    return () => ro.disconnect()
  }, [visible, hasItems])

  const liveKey = useMemo(() => {
    if (!chat.busy) return null
    for (let i = chat.items.length - 1; i >= 0; i--) {
      const it = chat.items[i]
      if (it.kind === 'text') return it.key
      if (it.kind === 'user') return null
    }
    return null
  }, [chat.items, chat.busy])

  // Отправил — тянем вниз, даже если до этого отматывал наверх
  const sendAndFollow = (parts: ComposedPart[]) => {
    stick.current = true
    const el = scrollRef.current
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    chat.send(parts)
  }

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    stick.current = gap < 120
    setAway(gap > 400)
  }

  const toBottom = () => {
    stick.current = true
    const el = scrollRef.current
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  const empty = chat.historyLoaded && chat.items.length === 0
  const rows = useMemo(() => buildRows(chat.items, chat.busy), [chat.items, chat.busy])

  const pct = chat.contextTokens != null && chat.contextWindow ? chat.contextTokens / chat.contextWindow * 100 : null

  const footer = (
    <div className="chat-footer">
      <button
        className="chat-ctx"
        onClick={toggleCtx}
        title={(chat.contextTokens != null ? `Контекст: ${fmt(chat.contextTokens)}${chat.contextWindow ? ` из ${fmt(chat.contextWindow)}` : ''} токенов\n` : '') + 'input + чтение и запись кэша последнего запроса\nКлик — переключить вид'}
      >
        {chat.contextTokens == null ? 'контекст —' : !ctxFull ? (
          <>
            <span className="chat-ctx-num">{fmtTokens(chat.contextTokens)}</span>
            {chat.contextWindow ? <span> / {fmtTokens(chat.contextWindow)}</span> : null}
            {pct != null && <span className="chat-ctx-bar"><i style={{ width: Math.min(100, pct) + '%' }} /></span>}
          </>
        ) : (
          <>
            <span className="chat-ctx-num">{fmt(chat.contextTokens)}</span>
            {chat.contextWindow ? <span> / {fmt(chat.contextWindow)} · {pct!.toFixed(1)}%</span> : <span> токенов</span>}
            {pct != null && <span className="chat-ctx-bar"><i style={{ width: Math.min(100, pct) + '%' }} /></span>}
          </>
        )}
      </button>
      <div className="flex items-center gap-1">
        <ModelMenu
          models={chat.models}
          model={chat.model}
          effort={effort}
          onModel={v => chat.changeModel(v)}
          onEffort={v => { setEffort(v); chat.changeEffort(v) }}
        />
        <Menu
          value={chat.permissionMode}
          label={MODES.find(m => m.value === chat.permissionMode)?.label ?? 'Режим'}
          options={MODES}
          onPick={v => chat.changeMode(v)}
          accent
        />
      </div>
    </div>
  )

  const composer = (
    <Composer
      disabled={!alive}
      busy={chat.busy}
      onSend={sendAndFollow}
      onStop={chat.interrupt}
      commands={chat.commands}
      visible={visible}
      footer={footer}
    />
  )

  return (
    <div className="chat-root" style={{ display: visible ? 'flex' : 'none' }}>
      {empty ? (
        <div className="chat-empty">
          <h1 className="chat-greeting"><Spark size={34} />{greeting()}</h1>
          {composer}
        </div>
      ) : (
        <>
          <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
            <div className="chat-col" ref={colRef}>
              <LiveKeyContext.Provider value={liveKey}>
                {rows.map(r => <RowView key={r.kind === 'item' ? r.item.key : r.key} row={r} />)}
              </LiveKeyContext.Provider>
              {chat.busy && <ProgressLine getProgress={chat.getProgress} />}
            </div>
          </div>
          <div className="chat-bottom">
            {away && <button className="chat-to-bottom" onClick={toBottom} title="Вниз"><ArrowDown size={16} /></button>}
            {chat.status && <div className="chat-status">{chat.status}</div>}
            {composer}
          </div>
        </>
      )}
    </div>
  )
}
