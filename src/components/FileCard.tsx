import { useEffect, useState, type CSSProperties, type KeyboardEvent } from 'react'
import {
  Document, DocumentText, DocumentCode, TableDocument, PresentionChart, Gallery,
  Music, VideoPlay, Archive, Folder2,
} from 'iconsax-reactjs'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'

// Карточка файла в ответе модели. В тексте это обычная Markdown-ссылка
// [имя](file:///C:/путь/к/файлу.pdf) — чат рисует вместо неё карточку,
// по клику файл показывается в проводнике.

type Kind = { label: string; color: string; Icon: typeof Document; thumb?: boolean }

const DOC: Kind = { label: t('Документ', 'Document'), color: '#4c8dff', Icon: DocumentText }
const KINDS: [RegExp, Kind][] = [
  [/^pdf$/, { ...DOC, color: '#ff5a5f', thumb: true }],
  [/^(docx?|odt|rtf|txt|md)$/, DOC],
  [/^(xlsx?|ods|csv|tsv)$/, { label: t('Таблица', 'Spreadsheet'), color: '#3dbe6b', Icon: TableDocument }],
  [/^(pptx?|odp|key)$/, { label: t('Презентация', 'Presentation'), color: '#ff8a3d', Icon: PresentionChart }],
  [/^(png|jpe?g|gif|webp|bmp|svg|ico|tiff?|heic)$/, { label: t('Изображение', 'Image'), color: '#b07cff', Icon: Gallery, thumb: true }],
  [/^(mp3|wav|ogg|flac|m4a|aac|opus)$/, { label: t('Аудио', 'Audio'), color: '#ff6fa8', Icon: Music }],
  [/^(mp4|mov|mkv|webm|avi|m4v)$/, { label: t('Видео', 'Video'), color: '#ff6fa8', Icon: VideoPlay, thumb: true }],
  [/^(zip|rar|7z|tar|gz|bz2|xz)$/, { label: t('Архив', 'Archive'), color: '#e8b13a', Icon: Archive }],
  [/^(js|mjs|cjs|ts|tsx|jsx|py|json|html?|css|scss|sql|c|h|cpp|hpp|cs|java|kt|go|rs|rb|php|sh|bat|cmd|ps1|ya?ml|toml|xml|ini|lua)$/,
    { label: t('Код', 'Code'), color: '#2ec4b6', Icon: DocumentCode }],
]
const FILE: Kind = { label: t('Файл', 'File'), color: '#9aa0a6', Icon: Document }
const FOLDER: Kind = { label: t('Папка', 'Folder'), color: '#e8b13a', Icon: Folder2 }

function kindOf(ext: string): Kind {
  return KINDS.find(([re]) => re.test(ext))?.[1] ?? FILE
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${t('Б', 'B')}`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ${t('кБ', 'KB')}`
  const mb = bytes / 1024 / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} ${t('МБ', 'MB')}`
}

function nameFromUrl(href: string): string {
  let p = href
  try { p = decodeURIComponent(href) } catch { /* битый %-код — покажем как есть */ }
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}

type Info = Awaited<ReturnType<typeof api.fileInfo>>
// Превью и размеры живут дольше одной карточки: при перерисовке ленты не дёргаем Windows заново
const cache = new Map<string, { info: Info; thumb: string | null }>()

/** card — отдельной строкой; chip — плашка внутри фразы, чтобы не рвать текст */
export function FileCard({ href, variant = 'card' }: { href: string; variant?: 'card' | 'chip' }) {
  const [state, setState] = useState(() => cache.get(href) ?? null)

  useEffect(() => {
    if (cache.has(href)) return
    let alive = true
    ;(async () => {
      const info = await api.fileInfo(href).catch(() => null)
      const ext = nameFromUrl(href).split('.').pop()?.toLowerCase() ?? ''
      const thumb = info?.exists && !info.isDir && kindOf(ext).thumb
        ? await api.fileThumb(href, 160).catch(() => null)
        : null
      const v = { info, thumb }
      cache.set(href, v)
      if (alive) setState(v)
    })()
    return () => { alive = false }
  }, [href])

  const full = nameFromUrl(href)
  const dot = full.lastIndexOf('.')
  const isDir = !!state?.info?.isDir
  const ext = !isDir && dot > 0 ? full.slice(dot + 1) : ''
  const base = ext ? full.slice(0, dot) : full
  const kind = isDir ? FOLDER : kindOf(ext.toLowerCase())
  const missing = state !== null && !state.info?.exists

  const meta = missing
    ? t('Не найден', 'Not found')
    : [kind.label, ext.toUpperCase(), state?.info && !isDir ? fmtSize(state.info.size) : '']
        .filter(Boolean).join(' · ')

  const act = {
    role: 'button',
    tabIndex: 0,
    title: missing ? state?.info?.path : t('Показать в проводнике', 'Show in Explorer'),
    onClick: () => { if (!missing) void api.fileReveal(href) },
    onKeyDown: (e: KeyboardEvent) => {
      if (!missing && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); void api.fileReveal(href) }
    },
  } as const

  if (variant === 'chip') {
    return (
      <span {...act} className={'chat-file-chip' + (missing ? ' is-missing' : '')} style={{ '--tile': kind.color } as CSSProperties}>
        <kind.Icon size={14} variant="Linear" color="var(--tile)" />
        <span>{full}</span>
      </span>
    )
  }

  return (
    <span {...act} className={'chat-file-card' + (missing ? ' is-missing' : '')}>
      <span
        className={'chat-file-card-tile' + (state?.thumb ? ' has-thumb' : '')}
        style={{ '--tile': kind.color } as CSSProperties}
      >
        {state?.thumb
          ? <img src={state.thumb} alt="" draggable={false} />
          : <kind.Icon size={22} variant="Linear" color="var(--tile)" />}
      </span>
      <span className="chat-file-card-text">
        <span className="chat-file-card-name">{base}</span>
        <span className="chat-file-card-meta">{meta}</span>
      </span>
    </span>
  )
}
