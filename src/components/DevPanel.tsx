import { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import { useSessionContext, type SessionStatus } from '../context/SessionContext.js'
import { statusLog } from '../lib/statusLog.js'

interface TestResult {
  label: string
  ok: boolean
  message: string
  ts: number
}

export function DevPanel() {
  const session = useSessionContext()
  const [results, setResults] = useState<TestResult[]>([])
  // draft — что набрано в поле, target — что реально применено (по кнопке).
  // Тесты и статус всегда смотрят на target, чтобы недонабранный uuid
  // не считался «выбранной сессией».
  const [targetSessionId, setTargetSessionId] = useState(() => localStorage.getItem('devPanel:sessionId') ?? '')
  const [draftSessionId, setDraftSessionId] = useState(targetSessionId)
  const [messageText, setMessageText] = useState(() => localStorage.getItem('devPanel:messageText') ?? 'привет')

  const isDirty = draftSessionId.trim() !== targetSessionId

  function applySessionId() {
    const id = draftSessionId.trim()
    setTargetSessionId(id)
    localStorage.setItem('devPanel:sessionId', id)
    log('target', true, id ? `сессия применена: ${id}` : 'target очищен')
  }

  const logRef = useRef<typeof log | null>(null)

  function log(label: string, ok: boolean, message: string) {
    setResults(prev => [{ label, ok, message, ts: Date.now() }, ...prev])
  }

  logRef.current = log

  // Авто-лог когда приходит reply для таргет-сессии
  useEffect(() => {
    const id = targetSessionId.trim()
    if (!id) return
    const text = session.sessionReplies[id]
    if (!text) return
    logRef.current?.('reply', true, `${id.slice(0, 8)}…:\n${text.slice(0, 300)}${text.length > 300 ? '…' : ''}`)
  }, [session.sessionReplies, targetSessionId])

  // ── Тесты ──────────────────────────────────────────────────────

  function testSpawnedSessions() {
    const spawned = Object.entries(session.spawnedSessions)
    if (spawned.length === 0) {
      log('spawnedSessions', false, 'нет запущенных сессий')
    } else {
      log('spawnedSessions', true, spawned.map(([t, _]) => {
        const sid = session.termToSession[t] ?? t
        return `${t} → ${sid}`
      }).join('\n'))
    }
  }

  function testSessionStatuses() {
    const entries = Object.entries(session.sessionStatuses)
    if (entries.length === 0) {
      log('sessionStatuses', false, 'статусов нет (нет активных сессий)')
    } else {
      log('sessionStatuses', true, entries.map(([id, s]) => `${id.slice(0, 8)}… → ${s}`).join('\n'))
    }
  }

  function testSessionReplies() {
    const entries = Object.entries(session.sessionReplies)
    if (entries.length === 0) {
      log('sessionReplies', false, 'ответов нет')
    } else {
      log('sessionReplies', true, entries.map(([id, text]) => `${id.slice(0, 8)}…:\n${text.slice(0, 200)}${text.length > 200 ? '…' : ''}`).join('\n\n'))
    }
  }

  function testResolveTermId() {
    const id = targetSessionId.trim()
    if (!id) { log('resolveTermId', false, 'введи sessionId'); return }
    const termId = session.resolveTermId(id)
    if (termId) {
      log('resolveTermId', true, `${id.slice(0, 8)}… → termId: ${termId}`)
    } else {
      log('resolveTermId', false, `termId не найден для ${id.slice(0, 8)}…`)
    }
  }

  function testIsAlive() {
    const id = targetSessionId.trim()
    if (!id) { log('isAlive', false, 'введи sessionId'); return }
    const alive = session.isAlive(id)
    log('isAlive', alive, alive ? 'PTY живой' : 'PTY мёртв или не запущен')
  }

  async function testSendMessage() {
    const id = targetSessionId.trim()
    const text = messageText.trim()
    if (!id) { log('sendMessage', false, 'введи sessionId'); return }
    if (!text) { log('sendMessage', false, 'введи текст'); return }
    try {
      session.sendMessage(id, text)
      log('sendMessage', true, `отправлено в ${id.slice(0, 8)}…: "${text}"`)
    } catch (e) {
      log('sendMessage', false, String(e))
    }
  }

  // ── UI ────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full text-[13px] text-text-primary font-mono overflow-hidden">
      <div className="px-3 py-2 border-b border-border-subtle text-[11px] text-text-faint uppercase tracking-widest shrink-0">
        Dev Panel
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-4 p-3">

        {/* Крупный статус выбранной сессии */}
        <TargetStatus sessionId={targetSessionId} />

        {/* Диагностика: все переходы статуса от watcher'а */}
        <StatusTransitionLog />



        {/* Target session */}
        <div className="flex flex-col gap-1">
          <span className="text-text-faint text-[11px]">sessionId (target)</span>
          <div className="flex gap-1.5">
            <input
              value={draftSessionId}
              onChange={e => setDraftSessionId(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applySessionId() } }}
              placeholder="uuid или оставь пустым"
              className={`flex-1 min-w-0 bg-bg-surface border rounded px-2 py-1 text-[12px] outline-none text-text-primary placeholder:text-text-ghost transition-colors ${
                isDirty ? 'border-amber-500/60 focus:border-amber-400' : 'border-border-default focus:border-accent'
              }`}
            />
            <button
              onClick={applySessionId}
              disabled={!isDirty}
              className={`px-2.5 py-1 rounded border text-[11px] shrink-0 transition-colors ${
                isDirty
                  ? 'border-amber-500/60 text-amber-400 hover:bg-amber-500/10'
                  : 'border-border-subtle text-text-ghost cursor-default'
              }`}
            >
              {isDirty ? 'применить' : 'применено'}
            </button>
          </div>
          <span className="text-[10px] text-text-ghost">
            {targetSessionId
              ? <>используется: <span className="text-text-secondary">{targetSessionId}</span></>
              : 'target не задан — тесты по сессии работать не будут'}
          </span>
        </div>

        {/* Остальные сессии — компактным списком */}
        <LiveStatuses exceptId={targetSessionId} onPick={id => { setDraftSessionId(id); setTargetSessionId(id); localStorage.setItem('devPanel:sessionId', id) }} />

        {/* Тесты состояния */}
        <div className="flex flex-col gap-1">
          <span className="text-text-faint text-[11px]">состояние</span>
          <div className="flex flex-wrap gap-1.5">
            <TestButton onClick={testSpawnedSessions}>spawnedSessions</TestButton>
            <TestButton onClick={testSessionStatuses}>sessionStatuses</TestButton>
            <TestButton onClick={testSessionReplies}>sessionReplies</TestButton>
            <TestButton onClick={testResolveTermId}>resolveTermId</TestButton>
            <TestButton onClick={testIsAlive}>isAlive</TestButton>
          </div>
        </div>

        {/* sendMessage */}
        <div className="flex flex-col gap-1">
          <span className="text-text-faint text-[11px]">sendMessage (Shift+Enter — перенос, Enter — отправить)</span>
          <textarea
            value={messageText}
            onChange={e => { setMessageText(e.target.value); localStorage.setItem('devPanel:messageText', e.target.value) }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); testSendMessage() } }}
            placeholder="текст сообщения"
            rows={1}
            style={{ resize: 'none', overflow: 'hidden', fieldSizing: 'content' } as React.CSSProperties}
            className="bg-bg-surface border border-border-default rounded px-2 py-1 text-[12px] outline-none focus:border-accent text-text-primary placeholder:text-text-ghost min-h-[28px]"
          />
          <TestButton onClick={testSendMessage}>отправить</TestButton>
        </div>

        {/* Результаты */}
        {results.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-text-faint text-[11px]">результаты</span>
              <button onClick={() => setResults([])} className="text-[11px] text-text-ghost hover:text-text-secondary transition-colors">
                очистить
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {results.map((r, i) => (
                <div key={i} className={`rounded px-2 py-1.5 text-[11px] whitespace-pre-wrap border ${r.ok ? 'border-emerald-500/30 bg-emerald-500/5 text-[var(--color-success)]' : 'border-red-500/30 bg-red-500/5 text-red-400'}`}>
                  <span className="opacity-60">{r.label}: </span>{r.message}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

const STATUS_STYLE: Record<SessionStatus, { label: string; dot: string; text: string }> = {
  idle:      { label: 'простаивает',   dot: 'bg-text-ghost',    text: 'text-text-faint' },
  thinking:  { label: 'думает',        dot: 'bg-amber-400',     text: 'text-amber-400' },
  streaming: { label: 'отвечает',      dot: 'bg-[var(--color-success)]', text: 'text-[var(--color-success)]' },
  tool:      { label: 'инструмент',    dot: 'bg-sky-400',       text: 'text-sky-400' },
  asking:    { label: 'ждёт ответа',   dot: 'bg-accent',        text: 'text-accent' },
}

/**
 * Диагностика детекта статусов: показывает КАЖДОЕ срабатывание watcher'а/поллера
 * с переходом prev → next. Если промежуточные состояния (например asking) не
 * появляются здесь — значит их не наблюдает слежение, а не логика детекта врёт.
 *
 * История копится в statusLog (вне React) — панель рендерится условно и при
 * переключении вкладок размонтируется, локальный стейт терял бы записи.
 */
function StatusTransitionLog() {
  const log = useSyncExternalStore(statusLog.subscribe, statusLog.getSnapshot)

  if (log.length === 0) return null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-text-faint text-[11px]">переходы статуса (watcher)</span>
        <button onClick={() => statusLog.clear()} className="text-[11px] text-text-ghost hover:text-text-secondary transition-colors">
          очистить
        </button>
      </div>
      <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto">
        {log.map((e, i) => (
          <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
            <span className="text-text-ghost shrink-0">{new Date(e.ts).toLocaleTimeString('ru-RU', { hour12: false })}</span>
            <span className="text-text-ghost shrink-0">{e.id.slice(0, 8)}</span>
            <span className={e.transition.includes('asking') ? 'text-accent' : 'text-text-secondary'}>{e.transition}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Крупный индикатор состояния выбранной (применённой) сессии. */
function TargetStatus({ sessionId }: { sessionId: string }) {
  const session = useSessionContext()

  if (!sessionId) {
    return (
      <div className="rounded border border-border-subtle bg-bg-surface px-3 py-3 flex items-center gap-2.5">
        <span className="w-2.5 h-2.5 rounded-full bg-text-ghost shrink-0" />
        <span className="text-[12px] text-text-ghost">сессия не выбрана</span>
      </div>
    )
  }

  const status = session.sessionStatuses[sessionId]
  const tracked = status !== undefined
  const style = STATUS_STYLE[status ?? 'idle']
  const alive = session.isAlive(sessionId)
  const reply = session.sessionReplies[sessionId]

  return (
    <div className={`rounded border px-3 py-3 flex flex-col gap-1.5 ${tracked ? 'border-border-default bg-bg-surface' : 'border-border-subtle bg-bg-surface'}`}>
      <div className="flex items-center gap-2.5">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${tracked ? style.dot : 'bg-text-ghost'} ${tracked && status !== 'idle' ? 'animate-pulse' : ''}`} />
        <span className={`text-[15px] ${tracked ? style.text : 'text-text-ghost'}`}>
          {tracked ? style.label : 'не отслеживается'}
        </span>
        {tracked && (
          <span className={`text-[10px] ml-auto ${alive ? 'text-[var(--color-success)]' : 'text-text-ghost'}`}>
            {alive ? 'PTY жив' : 'PTY мёртв'}
          </span>
        )}
      </div>
      <span className="text-[10px] text-text-ghost">{sessionId}</span>
      {reply && (
        <span className="text-[10px] text-text-faint line-clamp-2">
          последний ответ: {reply.slice(0, 120)}{reply.length > 120 ? '…' : ''}
        </span>
      )}
    </div>
  )
}

/** Живой список остальных сессий — клик выбирает сессию как target. */
function LiveStatuses({ exceptId, onPick }: { exceptId: string; onPick: (id: string) => void }) {
  const session = useSessionContext()
  const entries = Object.entries(session.sessionStatuses).filter(([id]) => id !== exceptId)

  if (entries.length === 0) return null

  return (
    <div className="flex flex-col gap-1">
      <span className="text-text-faint text-[11px]">другие сессии (клик — выбрать)</span>
      <div className="flex flex-col gap-0.5">
        {entries.map(([id, status]) => {
          const style = STATUS_STYLE[status] ?? STATUS_STYLE.idle
          const alive = session.isAlive(id)
          return (
            <button
              key={id}
              onClick={() => onPick(id)}
              className="flex items-center gap-2 rounded px-2 py-1 border border-border-subtle bg-bg-surface hover:border-border-strong transition-colors text-left"
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot} ${status !== 'idle' ? 'animate-pulse' : ''}`} />
              <span className="text-[11px] text-text-secondary shrink-0">{id.slice(0, 8)}…</span>
              <span className={`text-[11px] ${style.text}`}>{style.label}</span>
              <span className={`text-[10px] ml-auto ${alive ? 'text-[var(--color-success)]' : 'text-text-ghost'}`}>
                {alive ? 'PTY жив' : 'PTY мёртв'}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TestButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-1 rounded border border-border-default text-[11px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors"
    >
      {children}
    </button>
  )
}
