// Лента чата одной сессии: история из jsonl + живой поток stream-json.
// Поток приходит кусками по несколько токенов, поэтому лента правится в ref и
// сбрасывается в React не чаще раза за кадр — иначе длинный ответ тормозит.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type ChatStreamEvent, type ChatModelInfo, type ChatInit } from '../lib/api.js'
import type { ChatItem } from '../types/index'
import { buildUserContent, splitUserContent, type ComposedPart } from '../../shared/chatContent.js'
import { saveCliModels } from '../lib/cliModels.js'

export interface ChatCommand { name: string; description?: string; argumentHint?: string }

/** Ход в работе — как строка статуса у CLI: что делает, сколько идёт, токены */
export interface ChatProgress {
  phase: 'waiting' | 'thinking' | 'writing' | 'tool'
  toolName: string | null
  startedAt: number
  /** новый вход за ход: input + запись в кэш по всем запросам; чтение из кэша не считаем */
  inputTokens: number
  /** чтение из кэша за ход, по всем запросам — главная статья цены на длинной сессии */
  cacheTokens: number
  requests: number
  /** выход за ход: точный по завершённым сообщениям + оценка текущего */
  outputTokens: number
  lastEventAt: number
}

type ToolItem = Extract<ChatItem, { kind: 'tool' }>

const windowKey = (model: string) => `vaeli:ctx-window:${model}`

function loadWindow(model: string | null): number | null {
  if (!model) return null
  try { const v = Number(localStorage.getItem(windowKey(model))); return v > 0 ? v : null } catch { return null }
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((b: { type: string; text?: string }) => b.type === 'text' ? (b.text ?? '') : `[${b.type}]`).join('\n')
  return content == null ? '' : JSON.stringify(content)
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0).replace(/\.0$/, '') + 'M'
  return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'k'
}

function usageTotal(u: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }): number {
  return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
}

export function useChatSession(sessionId: string | null, jsonlPath: string | null, alive: boolean) {
  const [items, setItems] = useState<ChatItem[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [contextTokens, setContextTokens] = useState<number | null>(null)
  // Для карточки компакта: сколько было до сжатия — обработчик событий не видит state
  const ctxRef = useRef<number | null>(null)
  ctxRef.current = contextTokens
  const jsonlRef = useRef(jsonlPath)
  jsonlRef.current = jsonlPath
  const [model, setModel] = useState<string | null>(null)
  const [contextWindow, setContextWindow] = useState<number | null>(null)
  const [permissionMode, setPermissionMode] = useState<string | null>(null)
  const [commands, setCommands] = useState<ChatCommand[]>([])
  const [models, setModels] = useState<ChatModelInfo[]>([])
  const [account, setAccount] = useState<ChatInit['account']>(null)
  const [historyLoaded, setHistoryLoaded] = useState(false)

  const ref = useRef({
    items: [] as ChatItem[],
    index: new Map<string, number>(),   // key → позиция в items
    tools: new Map<string, string>(),   // tool_use_id → key
    json: new Map<string, string>(),    // key блока tool_use → накопленный input
    streamed: new Set<string>(),        // id сообщений, пришедших стримом
    compactKey: null as string | null,  // карточка идущего компакта
    // Свои сообщения, показанные сразу при отправке: ждут эха от CLI, потом ответа модели
    outbox: [] as { key: string; text: string; echoed: boolean }[],
    curMsg: '',
    seq: 0,
    frame: 0,
    hideNextSynthetic: false,
    // Счётчики хода живут здесь, а не в state: события идут десятками в секунду,
    // индикатор сам читает их по таймеру
    turn: {
      startedAt: 0, lastEventAt: 0, inputTokens: 0, cacheTokens: 0, requests: 0,
      outDone: 0, thinkingEst: 0, chars: 0,
      phase: 'waiting' as ChatProgress['phase'], toolName: null as string | null,
    },
  })

  const beginTurn = useCallback(() => {
    const t = ref.current.turn
    if (t.startedAt) return
    Object.assign(t, { startedAt: Date.now(), lastEventAt: Date.now(), inputTokens: 0, cacheTokens: 0, requests: 0, outDone: 0, thinkingEst: 0, chars: 0, phase: 'waiting', toolName: null })
  }, [])

  // Контекст «как в /context», но молча: нужен сразу при входе, до первого ответа
  const refreshContext = useCallback(() => {
    if (!sessionId || !api.chatContextUsage) return
    api.chatContextUsage(sessionId).then(r => {
      if (!r.ok) return
      if (r.totalTokens) setContextTokens(r.totalTokens)
      if (r.maxTokens) setContextWindow(r.maxTokens)
    }).catch(() => {})
  }, [sessionId])

  const flush = useCallback(() => {
    const r = ref.current
    if (r.frame) return
    r.frame = requestAnimationFrame(() => { r.frame = 0; setItems([...r.items]) })
  }, [])

  const push = useCallback((item: ChatItem) => {
    const r = ref.current
    r.index.set(item.key, r.items.length)
    r.items.push(item)
    flush()
  }, [flush])

  const patch = useCallback((key: string, fn: (item: ChatItem) => ChatItem) => {
    const r = ref.current
    const i = r.index.get(key)
    if (i === undefined) return
    r.items[i] = fn(r.items[i])
    flush()
  }, [flush])

  const nextKey = () => `l${ref.current.seq++}`

  const reset = useCallback((list: ChatItem[]) => {
    const r = ref.current
    r.items = [...list]
    r.index = new Map(list.map((it, i) => [it.key, i]))
    r.tools = new Map(list.filter((it): it is ToolItem => it.kind === 'tool').map(it => [it.id, it.key]))
    flush()
  }, [flush])

  // История: один раз на сессию. У нового чата jsonl появляется только после
  // первого обмена — к этому моменту вся лента уже живая, читать её второй раз нельзя
  const loadedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!sessionId || loadedFor.current === sessionId) return
    if (!jsonlPath || ref.current.items.length > 0) {
      if (ref.current.items.length > 0) loadedFor.current = sessionId
      setHistoryLoaded(true)
      return
    }
    loadedFor.current = sessionId
    setHistoryLoaded(false)
    let cancelled = false
    let done = false
    api.chatHistory(jsonlPath).then(h => {
      if (cancelled) return
      done = true
      const live = ref.current.items.filter(it => !it.key.startsWith('h'))
      reset([...h.items, ...live])
      if (h.contextTokens) setContextTokens(h.contextTokens)
      if (h.model) { setModel(h.model); setContextWindow(loadWindow(h.model)) }
      setHistoryLoaded(true)
    }).catch(() => { done = true; setHistoryLoaded(true) })
    // Отменили до ответа (StrictMode в dev запускает эффект дважды) — пометку снять,
    // иначе повторный запуск решит, что история уже загружена, и лента останется пустой
    return () => { cancelled = true; if (!done && loadedFor.current === sessionId) loadedFor.current = null }
  }, [sessionId, jsonlPath, reset])

  /** Снять «отправляется» — у дошедших до CLI или (all) у всех */
  const settleOutbox = useCallback((onlyEchoed: boolean) => {
    const r = ref.current
    r.outbox = r.outbox.filter(o => {
      if (onlyEchoed && !o.echoed) return true
      patch(o.key, it => it.kind === 'user' ? { ...it, pending: false } : it)
      return false
    })
  }, [patch])

  const handle = useCallback((ev: ChatStreamEvent) => {
    const r = ref.current
    const t = r.turn
    // Любое событие, в том числе от подагента, — знак, что процесс жив
    if (t.startedAt) t.lastEventAt = Date.now()
    // События подагентов не рисуем: у них свой контекст и своя лента
    if (ev.parent_tool_use_id) return

    switch (ev.type) {
      case 'stream_event': {
        const e = ev.event
        if (e.type === 'message_start') {
          r.curMsg = e.message.id
          // Модель начала отвечать — отправленное точно дошло
          settleOutbox(true)
          r.streamed.add(r.curMsg)
          // Поток мог начаться без нашей отправки: окно перезагрузили посреди хода
          beginTurn()
          setBusy(true)
          // Весь контекст (с кэшем) — это число под композером; здесь — что ушло нового
          const u = e.message.usage
          if (u) {
            t.inputTokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
            t.cacheTokens += u.cache_read_input_tokens ?? 0
            t.requests++
          }
          t.thinkingEst = 0
          t.chars = 0
          t.phase = 'waiting'
          return
        }
        if (e.type === 'message_delta') {
          // Точный выход за сообщение — оценку текущего можно сбросить
          if (e.usage?.output_tokens) { t.outDone += e.usage.output_tokens; t.thinkingEst = 0; t.chars = 0 }
          return
        }
        const key = `${r.curMsg}:${e.index}`
        if (e.type === 'content_block_start') {
          const cb = e.content_block
          if (cb.type === 'text') { push({ kind: 'text', key, text: '', at: Date.now() }); t.phase = 'writing' }
          else if (cb.type === 'thinking') { push({ kind: 'thinking', key, done: false }); t.phase = 'thinking' }
          else if (cb.type === 'tool_use') {
            push({ kind: 'tool', key, id: cb.id, name: cb.name, input: null, done: false })
            r.tools.set(cb.id, key)
            r.json.set(key, '')
            t.phase = 'tool'
            t.toolName = cb.name
          }
        } else if (e.type === 'content_block_delta') {
          if (e.delta.type === 'text_delta') {
            t.chars += e.delta.text.length
            patch(key, it => it.kind === 'text' ? { ...it, text: it.text + e.delta.text } : it)
          } else if (e.delta.type === 'input_json_delta') {
            t.chars += e.delta.partial_json.length
            r.json.set(key, (r.json.get(key) ?? '') + e.delta.partial_json)
          }
        } else if (e.type === 'content_block_stop') {
          patch(key, it => {
            if (it.kind === 'thinking') return { ...it, done: true }
            if (it.kind === 'tool') {
              let input: unknown = null
              try { input = JSON.parse(r.json.get(key) || '{}') } catch {}
              r.json.delete(key)
              return { ...it, input }
            }
            return it
          })
        }
        return
      }

      case 'assistant': {
        const m = ev.message
        if (m.model === '<synthetic>') {
          // Ответы локальных команд (/context, /usage): токенов не стоят, в контекст не идут
          if (r.hideNextSynthetic) { r.hideNextSynthetic = false; return }
          const text = (m.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n')
          if (text) push({ kind: 'note', key: nextKey(), text, markdown: true })
          return
        }
        if (m.usage) { const t = usageTotal(m.usage); if (t > 0) setContextTokens(t) }
        if (r.streamed.has(m.id)) return
        for (const b of m.content ?? []) {
          if (b.type === 'text' && b.text) push({ kind: 'text', key: nextKey(), text: b.text, at: Date.now() })
          else if (b.type === 'tool_use') {
            const key = nextKey()
            push({ kind: 'tool', key, id: b.id, name: b.name, input: b.input, done: false })
            r.tools.set(b.id, key)
          }
        }
        return
      }

      case 'user': {
        const c = ev.message?.content
        if (Array.isArray(c) && c.some((b: { type: string }) => b.type === 'tool_result')) {
          for (const b of c) {
            if (b.type !== 'tool_result') continue
            const key = r.tools.get(b.tool_use_id)
            if (key) patch(key, it => it.kind === 'tool' ? { ...it, result: toolResultText(b.content), isError: !!b.is_error, done: true } : it)
          }
          // Инструмент отработал — дальше ждём следующий запрос к модели
          t.phase = 'waiting'
          t.toolName = null
          return
        }
        const { text, attachments } = splitUserContent(c)
        const out = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/)
        if (out) { if (out[1].trim()) push({ kind: 'note', key: nextKey(), text: out[1].trim() }); return }
        // Эхо отправленного сообщения (--replay-user-messages) — в том числе от Heartbeat и Telegram
        if (ev.isReplay && (text.trim() || attachments.length)) {
          const mine = r.outbox.find(o => !o.echoed && o.text === text.trim())
          if (mine) { mine.echoed = true; return }
          push({ kind: 'user', key: nextKey(), text, attachments: attachments.length ? attachments : undefined, at: Date.now() })
          beginTurn()
          setBusy(true)
        }
        return
      }

      case 'system':
        if (ev.subtype === 'thinking_tokens') {
          if (typeof ev.estimated_tokens === 'number') t.thinkingEst = Math.max(t.thinkingEst, ev.estimated_tokens)
        } else if (ev.subtype === 'init') {
          if (ev.model) { setModel(ev.model); setContextWindow(w => w ?? loadWindow(ev.model)) }
          if (ev.permissionMode) setPermissionMode(ev.permissionMode)
        } else if (ev.subtype === 'compact_boundary') {
          const pre = ev.compact_metadata?.pre_tokens
          const post = ev.compact_metadata?.post_tokens
          const done = { state: 'done' as const, before: typeof pre === 'number' ? pre : ctxRef.current ?? undefined, after: typeof post === 'number' ? post : undefined }
          const ck = r.compactKey ?? nextKey()
          if (r.compactKey) patch(ck, it => it.kind === 'compact' ? { ...it, ...done } : it)
          else push({ kind: 'compact', key: ck, ...done })
          r.compactKey = null
          // Пересказ и файлы, вернувшиеся в контекст: в потоке их нет, CLI дописывает их в jsonl следом
          const path = jsonlRef.current
          if (path) {
            const load = (tries: number) => api.chatCompactTail(path, typeof pre === 'number' ? pre : undefined).then(({ files, summary }) => {
              if (files.length || summary) patch(ck, it => it.kind === 'compact' ? { ...it, files, summary: summary ?? undefined } : it)
              if (!(files.length && summary) && tries > 0) setTimeout(() => load(tries - 1), 1500)
            }).catch(() => {})
            setTimeout(() => load(3), 800)
          }
          if (typeof post === 'number') setContextTokens(post)
          setStatus('')
          refreshContext()
        } else if (ev.subtype === 'status') {
          // CLI повторяет «compacting» примерно раз в 30 с, пока идёт сжатие: карточка одна
          if (ev.status === 'compacting') {
            if (r.compactKey) return
            const key = nextKey()
            r.compactKey = key
            push({ kind: 'compact', key, state: 'running', startedAt: Date.now(), before: ctxRef.current ?? undefined })
          } else if (r.compactKey && ev.compact_result === 'failed') {
            const error = String((ev as { compact_error?: string }).compact_error ?? '')
            patch(r.compactKey, it => it.kind === 'compact' ? { ...it, state: 'failed', error } : it)
            r.compactKey = null
          }
          setStatus('')
        } else if (ev.subtype === 'api_retry') {
          setStatus(`Повтор запроса ${ev.attempt}/${ev.max_retries}${ev.error ? ' · ' + ev.error : ''}`)
        }
        return

      case 'conversation_reset':
        push({ kind: 'divider', key: nextKey(), text: 'новый разговор' })
        setContextTokens(null)
        return

      case 'result': {
        settleOutbox(false)
        setBusy(false)
        setStatus('')
        const mu = Object.entries(ev.modelUsage ?? {})[0] as [string, { contextWindow?: number }] | undefined
        if (mu?.[1]?.contextWindow) {
          setContextWindow(mu[1].contextWindow)
          try { localStorage.setItem(windowKey(mu[0]), String(mu[1].contextWindow)) } catch {}
        }
        const aborted = String(ev.terminal_reason ?? '').startsWith('aborted')
        if (aborted) push({ kind: 'meta', key: nextKey(), text: 'Остановлено' })
        else if (ev.is_error) push({ kind: 'error', key: nextKey(), text: String(ev.result || ev.subtype || 'ошибка') })
        // Итог хода как у CLI: время, вход последнего запроса, выход за весь ход
        if (!aborted && ev.num_turns > 0 && ev.duration_ms) {
          const out = ev.usage?.output_tokens ?? t.outDone
          push({ kind: 'meta', key: nextKey(), text: `${(ev.duration_ms / 1000).toFixed(1)} с · ↑ ${fmtTokens(t.inputTokens)} · ↓ ${fmtTokens(out)}`, stats: { sec: ev.duration_ms / 1000, input: t.inputTokens, cache: t.cacheTokens, output: out, requests: t.requests } })
        }
        t.startedAt = 0
        // Недописанный стрим (прервали) — закрываем висящие блоки
        for (let i = 0; i < r.items.length; i++) {
          const it = r.items[i]
          if (it.kind === 'thinking' && !it.done) r.items[i] = { ...it, done: true }
          if (it.kind === 'tool' && !it.done && ev.terminal_reason?.startsWith('aborted')) r.items[i] = { ...it, done: true }
        }
        flush()
        return
      }

      case 'vael_init':
        setCommands(ev.commands ?? [])
        setModels(ev.models ?? [])
        saveCliModels(ev.models ?? [])
        setAccount(ev.account ?? null)
        refreshContext()
        return
      case 'vael_error':
        push({ kind: 'error', key: nextKey(), text: ev.error })
        setBusy(false)
        return
    }
  }, [push, patch, flush, beginTurn, refreshContext, settleOutbox])

  useEffect(() => {
    if (!sessionId) return
    const offEvent = api.onChatEvent((sid, ev) => { if (sid === sessionId) handle(ev) })
    const offExit = api.onChatExit((sid, code) => {
      if (sid !== sessionId) return
      setBusy(false)
      ref.current.turn.startedAt = 0
      if (code) push({ kind: 'error', key: nextKey(), text: `Процесс завершился с кодом ${code}` })
    })
    return () => { offEvent(); offExit() }
  }, [sessionId, handle, push])

  // После перезагрузки окна initialize уже прошёл — берём сохранённый ответ из main
  useEffect(() => {
    if (!sessionId || !api.chatInit) return
    api.chatInit(sessionId).then(init => {
      if (!init) return
      setCommands(init.commands ?? [])
      setModels(init.models ?? [])
      saveCliModels(init.models ?? [])
      setAccount(init.account ?? null)
      refreshContext()
    }).catch(() => {})
  }, [sessionId, refreshContext])

  useEffect(() => () => { if (ref.current.frame) cancelAnimationFrame(ref.current.frame) }, [])

  const send = useCallback(async (parts: ComposedPart[]) => {
    if (!sessionId) return
    const plain = parts.every(p => typeof p === 'string') ? (parts as string[]).join('').trim() : null
    if (plain === '') return
    // Слэш-команды CLI не возвращает эхом — показываем сами
    const isCommand = plain?.startsWith('/') ?? false
    const content = isCommand ? plain! : buildUserContent(parts)
    if (isCommand) push({ kind: 'user', key: nextKey(), text: plain!, at: Date.now() })
    else {
      // Показываем сразу, полупрозрачным — эхо CLI потом не дублирует, а подтверждает
      const { text, attachments } = splitUserContent(content)
      const key = nextKey()
      push({ kind: 'user', key, text, attachments: attachments.length ? attachments : undefined, pending: true, at: Date.now() })
      ref.current.outbox.push({ key, text: text.trim(), echoed: false })
    }
    beginTurn()
    setBusy(true)
    const r = await api.chatSend(sessionId, content)
    if (!r.ok) {
      settleOutbox(false); setBusy(false); ref.current.turn.startedAt = 0; push({ kind: 'error', key: nextKey(), text: 'Процесс чата не запущен' }) }
  }, [sessionId, push, beginTurn, settleOutbox])

  const getProgress = useCallback((): ChatProgress | null => {
    const t = ref.current.turn
    if (!t.startedAt) return null
    return {
      phase: t.phase,
      toolName: t.toolName,
      startedAt: t.startedAt,
      inputTokens: t.inputTokens,
      cacheTokens: t.cacheTokens,
      requests: t.requests,
      // Текст и JSON инструментов — грубо 4 символа на токен, как оценивает и CLI
      outputTokens: t.outDone + t.thinkingEst + Math.round(t.chars / 4),
      lastEventAt: t.lastEventAt,
    }
  }, [])

  const interrupt = useCallback(() => { if (sessionId) api.chatInterrupt(sessionId) }, [sessionId])

  const changeModel = useCallback(async (value: string) => {
    if (!sessionId) return
    const r = await api.chatSetModel(sessionId, value)
    if (r.ok && r.model) { setModel(r.model); setContextWindow(loadWindow(r.model)) }
    else if (!r.ok) push({ kind: 'error', key: nextKey(), text: r.error ?? 'Не удалось сменить модель' })
  }, [sessionId, push])

  const changeMode = useCallback(async (value: string) => {
    if (!sessionId) return
    const r = await api.chatSetPermissionMode(sessionId, value)
    if (r.ok) setPermissionMode(r.mode ?? value)
    else push({ kind: 'error', key: nextKey(), text: r.error ?? 'Не удалось сменить режим' })
  }, [sessionId, push])

  // Отдельного запроса на effort у CLI нет — шлём команду и прячем её служебный ответ
  const changeEffort = useCallback(async (value: string) => {
    if (!sessionId) return
    ref.current.hideNextSynthetic = true
    await api.chatSend(sessionId, `/effort ${value}`)
  }, [sessionId])

  return {
    items, busy: busy && alive, status, contextTokens, contextWindow, model, permissionMode, commands, models, account, historyLoaded,
    send, interrupt, changeModel, changeMode, changeEffort, getProgress,
  }
}
