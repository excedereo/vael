import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, ChevronDown, TerminalSquare } from 'lucide-react'
import type { ChatItem } from '../types/index'
import { api } from '../lib/api.js'
import { cn } from '../lib/utils.js'
import { t } from '../lib/i18n.js'
import { perItem } from '../lib/sessionContext.js'

// Полоска над полем ввода, как внизу TUI: фоновые задачи с таймером до
// таймаута и выводом. Артефакты и файлы — в панели справа. Всё из ленты,
// поэтому одинаково работает и вживую, и после перезагрузки из истории.

type Task = {
  id: string
  desc: string
  startedAt?: number
  timeoutMs?: number
  output?: string
  status: 'running' | 'completed' | 'failed' | 'killed'
  endedAt?: number
}

/** Таймаут Bash в фоне по умолчанию, если модель его не задала */
const BG_TIMEOUT_DEFAULT = 30 * 60_000
/** Сколько ещё держать в полоске завершённую задачу */
const KEEP_DONE_MS = 3 * 60_000

const bgId = perItem(it => it.kind === 'tool' && it.result
  ? it.result.match(/running in background with ID:\s*([\w-]+)/i)
  : null)

function deriveTasks(items: ChatItem[]): Task[] {
  const tasks = new Map<string, Task>()
  for (const it of items) {
    if (it.kind === 'tool' && it.result) {
      const m = bgId(it)
      if (!m) continue
      const input = (it.input ?? {}) as { command?: string; description?: string; timeout?: number }
      const cmd = (input.command ?? '').trim()
      tasks.set(m[1], {
        id: m[1],
        desc: input.description || (cmd.length > 60 ? cmd.slice(0, 60) + '…' : cmd) || it.name,
        startedAt: it.at,
        timeoutMs: it.name === 'Bash' ? (typeof input.timeout === 'number' ? input.timeout : BG_TIMEOUT_DEFAULT) : undefined,
        output: it.result.match(/written to:\s*(.+?\.output)/i)?.[1]?.trim(),
        status: 'running',
      })
    } else if (it.kind === 'note' && it.task) {
      const task = tasks.get(it.task.id)
      if (task) {
        const s = it.task.status
        task.status = s === 'failed' ? 'failed' : s === 'killed' ? 'killed' : 'completed'
        task.endedAt = it.task.at ?? task.startedAt
      }
    }
  }
  return [...tasks.values()].reverse()
}

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0')
}

function TaskOutput({ file, live }: { file: string; live: boolean }) {
  const [text, setText] = useState<string | null>(null)
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    let alive = true
    const load = () => api.taskTail(file, 6000).then(r => { if (alive) setText(r ? r.text : null) }).catch(() => {})
    load()
    const iv = live ? setInterval(load, 1500) : undefined
    return () => { alive = false; if (iv) clearInterval(iv) }
  }, [file, live])
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [text])
  return (
    <pre ref={ref} className="tray-output">
      {text === null ? t('Вывод недоступен', 'Output unavailable') : text.trim() || t('Пока пусто', 'Empty so far')}
    </pre>
  )
}

export function SessionTray({ items }: { items: ChatItem[] }) {
  const allTasks = useMemo(() => deriveTasks(items), [items])
  const [now, setNow] = useState(Date.now())
  const [open, setOpen] = useState(false)
  const [outFor, setOutFor] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Видимые задачи: идущие (пока не вышел таймаут с запасом) и недавно завершённые
  const tasks = allTasks.filter(tk => tk.status === 'running'
    ? !tk.startedAt || !tk.timeoutMs || now < tk.startedAt + tk.timeoutMs + 60_000
    : !!tk.endedAt && now - tk.endedAt < KEEP_DONE_MS)
  const running = tasks.filter(tk => tk.status === 'running').length

  useEffect(() => {
    if (!tasks.length) return
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [tasks.length])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!tasks.length) return null

  return (
    <div className="tray">
      {tasks.length > 0 && (
        <div ref={ref} className="relative">
          <button className={cn('tray-pill', open && 'is-open')} onClick={() => setOpen(v => !v)}>
            {running > 0 ? <span className="tray-dot is-live" /> : <Check size={12} />}
            {running > 0
              ? t(`${running} в фоне`, `${running} in background`)
              : t('фон завершён', 'background done')}
            <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
          </button>
          <AnimatePresence>
            {open && (
              <motion.div className="tray-pop" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.14 }}>
                {tasks.map(tk => {
                  const elapsed = tk.startedAt ? (tk.endedAt ?? now) - tk.startedAt : null
                  const left = tk.status === 'running' && tk.startedAt && tk.timeoutMs ? tk.startedAt + tk.timeoutMs - now : null
                  const frac = left !== null && tk.timeoutMs ? Math.max(0, Math.min(1, left / tk.timeoutMs)) : null
                  return (
                    <div key={tk.id} className="tray-task">
                      <div className="tray-task-row">
                        <span className={cn('tray-status', `is-${tk.status}`)}>
                          {tk.status === 'running' ? <span className="tray-dot is-live" /> : tk.status === 'completed' ? <Check size={13} /> : <X size={13} />}
                        </span>
                        <span className="tray-task-desc" title={tk.desc}>{tk.desc}</span>
                        {elapsed !== null && <span className="tray-task-time">{clock(elapsed)}</span>}
                        {tk.output && (
                          <button className={cn('tray-task-btn', outFor === tk.id && 'is-on')} onClick={() => setOutFor(outFor === tk.id ? null : tk.id)} title={t('Вывод', 'Output')}>
                            <TerminalSquare size={13} />
                          </button>
                        )}
                      </div>
                      {left !== null && frac !== null && (
                        // Отсчёт до таймаута: полоска тает, к концу краснеет
                        <div className={cn('tray-timeout', frac < 0.15 && 'is-low')}>
                          <span className="tray-timeout-bar"><i style={{ width: `${frac * 100}%` }} /></span>
                          <span>{left > 0 ? t(`до таймаута ${clock(left)}`, `timeout in ${clock(left)}`) : t('таймаут', 'timed out')}</span>
                        </div>
                      )}
                      {outFor === tk.id && tk.output && <TaskOutput file={tk.output} live={tk.status === 'running'} />}
                    </div>
                  )
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
