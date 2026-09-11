#!/usr/bin/env node
// vael — командная строка для управления Vael снаружи Electron.
//
// Зачем: Ваели живёт внутри сессии Claude Code и не может дотянуться до
// главного процесса напрямую. Зато у неё есть шелл. Команды пишут в те же
// файлы в ~/.vael, которые сторожат модули, — так она сама себе ставит
// побудки и сама отправляет сообщения в телеграм.
//
// Стралитзу это тоже доступно из любого терминала.

import fs from 'fs'
import path from 'path'
import os from 'os'

const VAEL_DIR = path.join(os.homedir(), '.vael')
const QUEUE_PATH = path.join(VAEL_DIR, 'heartbeat-queue.json')
const TG_SETTINGS = path.join(VAEL_DIR, 'tg-settings.json')
const OUTBOX_PATH = path.join(VAEL_DIR, 'tg-outbox.json')

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return fallback }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8')
}

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function die(msg) {
  console.error(msg)
  process.exit(1)
}

/** «5min», «2h», «30s», «1d» → миллисекунды. Без единицы считаем минутами. */
function parseDuration(raw) {
  const m = String(raw).trim().match(/^(\d+(?:[.,]\d+)?)\s*(s|sec|m|min|h|hour|ч|м|d|day|д)?$/i)
  if (!m) return null
  const value = parseFloat(m[1].replace(',', '.'))
  const unit = (m[2] || 'min').toLowerCase()
  const mult =
    ['s', 'sec'].includes(unit) ? 1000 :
    ['h', 'hour', 'ч'].includes(unit) ? 3600_000 :
    ['d', 'day', 'д'].includes(unit) ? 86400_000 :
    60_000
  return Math.round(value * mult)
}

/** «09:00» → epoch ms ближайшего такого времени (сегодня, иначе завтра). */
function parseClock(raw) {
  const m = String(raw).trim().match(/^(\d{1,2})[:.](\d{2})$/)
  if (!m) return null
  const [h, min] = [parseInt(m[1], 10), parseInt(m[2], 10)]
  if (h > 23 || min > 59) return null
  const d = new Date()
  d.setHours(h, min, 0, 0)
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
  return d.getTime()
}

function fmtWhen(ms) {
  const d = new Date(ms)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toTimeString().slice(0, 5)
  const when = sameDay ? time : `${d.toLocaleDateString('ru-RU')} ${time}`

  // Просрочку показываем явно: «через 0 мин» у застрявшей побудки выглядит
  // как «вот-вот сработает», хотя её никто не забирает
  const diff = ms - Date.now()
  if (diff < -60_000) return `${when} (просрочено на ${Math.round(-diff / 60000)} мин)`
  if (diff <= 0) return `${when} (вот-вот)`
  return `${when} (через ${Math.round(diff / 60000)} мин)`
}

// ─── wake ────────────────────────────────────────────────────────────────────

function cmdWake(args) {
  const sub = args[0]

  if (!sub || sub === 'help') return wakeHelp()
  if (sub === 'list') return wakeList()
  if (sub === 'cancel') return wakeCancel(args[1])
  if (sub === 'clear') return wakeClear()
  if (sub === 'every') return wakeEvery(args.slice(1))

  return wakeOne(args)
}

function collectText(args) {
  const i = args.findIndex(a => a === '--text' || a === '-t')
  if (i === -1) return undefined
  const rest = args.slice(i + 1).filter(a => !a.startsWith('-'))
  return rest.join(' ') || undefined
}

function wakeOne(args) {
  // `vael wake 5min`  |  `vael wake --at 09:00`  |  оба с `--text "..."`
  const atIdx = args.findIndex(a => a === '--at')
  let at

  if (atIdx !== -1) {
    at = parseClock(args[atIdx + 1])
    if (!at) return die(`не понял время: ${args[atIdx + 1] ?? '(пусто)'}. Формат ЧЧ:ММ, например --at 09:00`)
  } else {
    const ms = parseDuration(args[0])
    if (!ms) return die(`не понял интервал: ${args[0] ?? '(пусто)'}. Например 5min, 2h, 30s`)
    at = Date.now() + ms
  }

  const entry = {
    id: newId(),
    kind: 'one',
    at,
    text: collectText(args),
    source: 'vaeli',
    createdAt: Date.now(),
  }

  writeJson(QUEUE_PATH, [...readJson(QUEUE_PATH, []), entry])
  console.log(`побудка поставлена: ${fmtWhen(at)}${entry.text ? ` — «${entry.text}»` : ''}`)
  console.log(`id: ${entry.id}`)
}

function wakeEvery(args) {
  const ms = parseDuration(args[0])
  if (!ms) return die(`не понял интервал: ${args[0] ?? '(пусто)'}. Например: vael wake every 30min`)
  if (ms < 60_000) return die('интервал меньше минуты — слишком часто')

  const entry = {
    id: newId(),
    kind: 'every',
    intervalMs: ms,
    nextAt: Date.now() + ms,
    text: collectText(args),
    source: 'vaeli',
    createdAt: Date.now(),
  }

  writeJson(QUEUE_PATH, [...readJson(QUEUE_PATH, []), entry])
  console.log(`повторяющаяся побудка: каждые ${args[0]}, первая ${fmtWhen(entry.nextAt)}`)
  console.log(`id: ${entry.id}`)
}

function wakeList() {
  const queue = readJson(QUEUE_PATH, [])
  if (queue.length === 0) return console.log('очередь пуста')

  console.log(`в очереди ${queue.length}:`)
  for (const e of queue) {
    const when = e.kind === 'one' ? fmtWhen(e.at) : `каждые ${Math.round(e.intervalMs / 60000)} мин, следующая ${fmtWhen(e.nextAt)}`
    console.log(`  ${e.id}  ${when}${e.text ? `  — «${e.text}»` : ''}`)
  }
}

function wakeCancel(id) {
  if (!id) return die('нужен id: vael wake cancel <id>  (список — vael wake list)')
  const queue = readJson(QUEUE_PATH, [])
  const next = queue.filter(e => e.id !== id)
  if (next.length === queue.length) return die(`не нашла побудку с id ${id}`)
  writeJson(QUEUE_PATH, next)
  console.log(`отменена: ${id}`)
}

function wakeClear() {
  const n = readJson(QUEUE_PATH, []).length
  writeJson(QUEUE_PATH, [])
  console.log(`очередь очищена (было ${n})`)
}

function wakeHelp() {
  console.log(`vael wake — побудки

  vael wake 5min                  разбудить через 5 минут
  vael wake 2h --text "проверь"   с текстом
  vael wake --at 09:00            в конкретное время
  vael wake every 30min           повторяющаяся
  vael wake list                  что запланировано
  vael wake cancel <id>           отменить одну
  vael wake clear                 отменить все

Единицы: s/sec, m/min, h/hour, d/day. Без единицы — минуты.`)
}

// ─── tg ──────────────────────────────────────────────────────────────────────

async function cmdTg(args) {
  const text = args.join(' ').trim()
  if (!text) return die('нечего отправлять: vael tg "текст"')

  const s = readJson(TG_SETTINGS, null)
  if (!s?.botToken || !s?.chatId) {
    return die('телеграм не настроен — нет botToken или chatId в ~/.vael/tg-settings.json')
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${s.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: s.chatId, text }),
    })
    const data = await res.json()
    if (!data.ok) return die(`телеграм отказал: ${data.description || JSON.stringify(data)}`)
  } catch (e) {
    return die(`не отправилось: ${e.message}`)
  }

  // Лог для UI — чтобы отправленное было видно и в Vael, а не только в телеге
  const outbox = readJson(OUTBOX_PATH, [])
  outbox.push({ at: Date.now(), text })
  writeJson(OUTBOX_PATH, outbox.slice(-200))

  // Эхо полным текстом: через тул-колл ответ проходит мимо памяти, и без
  // повтора Ваели не помнит, что именно отправила.
  console.log(`отправлено в телеграм: ${text}`)
}

// ─── hb (включение/выключение и настройки) ───────────────────────────────────

const CONTROL_PATH = path.join(VAEL_DIR, 'heartbeat-control.json')
const HB_SETTINGS = path.join(VAEL_DIR, 'heartbeat-settings.json')

/**
 * Кладёт команду для работающего Vael. Просто поправить settings-файл мало:
 * модуль оттуда читает, но стартовать/останавливаться должен по сигналу.
 */
function sendControl(cmd) {
  writeJson(CONTROL_PATH, cmd)
}

function cmdHb(args) {
  const sub = args[0]

  if (!sub || sub === 'help') {
    console.log(`vael hb — управление heartbeat

  vael hb on                    включить
  vael hb on --session <uuid>   включить и привязать к сессии
  vael hb off                   выключить
  vael hb session <uuid>        сменить сессию (this — текущая)
  vael hb template "<шаблон>"   сменить шаблон фришки
  vael hb show                  показать настройки`)
    return
  }

  if (sub === 'show') {
    const s = readJson(HB_SETTINGS, {})
    console.log(`включён:  ${s.enabled ? 'да' : 'нет'}`)
    console.log(`автостарт: ${s.autostart ? 'да' : 'нет'}`)
    console.log(`сессия:   ${s.sessionId || '(последняя активная)'}`)
    console.log(`шаблон:   ${s.template || '(по умолчанию)'}`)
    console.log(`в телеграм: ${s.mirrorToTelegram ? 'да' : 'нет'}`)
    return
  }

  if (sub === 'on') {
    const i = args.indexOf('--session')
    const sessionId = i !== -1 ? resolveSession(args[i + 1]) : undefined
    sendControl({ action: 'on', ...(sessionId !== undefined && { sessionId }) })
    console.log(sessionId ? `heartbeat включён, сессия ${sessionId}` : 'heartbeat включён')
    warnIfNotPickedUp()
    return
  }

  if (sub === 'off') {
    sendControl({ action: 'off' })
    console.log('heartbeat выключен')
    warnIfNotPickedUp()
    return
  }

  if (sub === 'session') {
    const id = resolveSession(args[1])
    if (id === undefined) return die('нужен uuid сессии, или `this` — текущая')
    sendControl({ action: 'set', sessionId: id })
    console.log(`сессия: ${id || '(последняя активная)'}`)
    warnIfNotPickedUp()
    return
  }

  if (sub === 'template') {
    const tpl = args.slice(1).join(' ').trim()
    if (!tpl) return die('нужен шаблон: vael hb template "[FREE] ..."')
    sendControl({ action: 'set', template: tpl })
    console.log(`шаблон: ${tpl}`)
    warnIfNotPickedUp()
    return
  }

  die(`не знаю «hb ${sub}» — смотри vael hb help`)
}

/**
 * `this` → сессия, из которой запущена команда. Ваели живёт внутри сессии и
 * своего uuid в аргументах не имеет — зато он есть в переменных окружения.
 */
function resolveSession(raw) {
  if (raw === undefined) return undefined
  if (raw !== 'this') return raw
  const env = process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CODE_SESSION_ID
  if (env) return env
  const guess = guessSessionFromCwd()
  if (!guess) die('не смогла определить текущую сессию — укажи uuid явно')
  return guess
}

/** Последняя по времени сессия в проекте текущей папки — запасной путь. */
function guessSessionFromCwd() {
  const encoded = process.cwd().replace(/[:\\/]/g, '-')
  for (const base of [path.join(os.homedir(), '.claude'), path.join(os.homedir(), '.vael', 'sessions')]) {
    const dir = path.join(base, 'projects', encoded)
    try {
      const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)
      if (files.length) return files[0].f.replace(/\.jsonl$/, '')
    } catch { }
  }
  return null
}

/** Если файл команды остался лежать — Vael не запущен и не забрал его. */
function warnIfNotPickedUp() {
  setTimeout(() => {
    if (fs.existsSync(CONTROL_PATH)) {
      console.log('⚠ Vael не отвечает — команда применится при следующем запуске')
    }
  }, 1500)
}

// ─── status ──────────────────────────────────────────────────────────────────

function cmdStatus() {
  const queue = readJson(QUEUE_PATH, [])
  const hb = readJson(path.join(VAEL_DIR, 'heartbeat-settings.json'), null)
  const tg = readJson(TG_SETTINGS, null)

  console.log(`heartbeat: ${hb?.enabled ? 'включён' : 'выключен'}`)
  console.log(`шаблон:    ${hb?.template ?? '(по умолчанию)'}`)
  console.log(`очередь:   ${queue.length}`)
  console.log(`телеграм:  ${tg?.botToken && tg?.chatId ? 'настроен' : 'не настроен'}`)
}

// ─── main ────────────────────────────────────────────────────────────────────

function help() {
  console.log(`vael — управление Vael из терминала

  vael wake ...        побудки (vael wake help)
  vael hb ...          включить/выключить heartbeat, сессия, шаблон (vael hb help)
  vael tg "текст"      написать Стралитзу в телеграм
  vael status          что сейчас включено`)
}

const [cmd, ...rest] = process.argv.slice(2)

switch (cmd) {
  case 'wake': cmdWake(rest); break
  case 'hb':
  case 'heartbeat': cmdHb(rest); break
  case 'tg': await cmdTg(rest); break
  case 'status': cmdStatus(); break
  case undefined:
  case 'help':
  case '--help':
  case '-h': help(); break
  default:
    console.error(`не знаю команду «${cmd}»\n`)
    help()
    process.exit(1)
}
