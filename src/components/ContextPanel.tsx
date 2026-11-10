import { useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, Paperclip } from 'lucide-react'
import type { ChatItem } from '../types/index'
import { api } from '../lib/api.js'
import { cn } from '../lib/utils.js'
import { t } from '../lib/i18n.js'
import { deriveArtifacts, deriveContextFiles, fileUrl } from '../lib/sessionContext.js'

// Панель справа от ленты: артефакты сессии и что сейчас в контексте.
// На широком окне стоит у правого края, на узком сворачивается в полоску
// иконок со счётчиками и раскрывается поверх ленты.

/** Звёзды артефакта (Bootstrap Icons «stars», MIT): большая и две малые.
 *  Малые отдельными путями — при наведении мерцают сами по себе */
function ArtifactIcon({ size = 16 }: { size?: number }) {
  return (
    <span className="cp-icon cp-star" aria-hidden>
      <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor">
        <path className="cp-st-big" d="M7.657 6.247c.11-.33.576-.33.686 0l.645 1.937a2.89 2.89 0 0 0 1.829 1.828l1.936.645c.33.11.33.576 0 .686l-1.937.645a2.89 2.89 0 0 0-1.828 1.829l-.645 1.936a.361.361 0 0 1-.686 0l-.645-1.937a2.89 2.89 0 0 0-1.828-1.828l-1.937-.645a.361.361 0 0 1 0-.686l1.937-.645a2.89 2.89 0 0 0 1.828-1.828l.645-1.937z" />
        <path className="cp-st-a" d="M3.794 1.148a.217.217 0 0 1 .412 0l.387 1.162c.173.518.579.924 1.097 1.097l1.162.387a.217.217 0 0 1 0 .412l-1.162.387A1.734 1.734 0 0 0 4.593 5.69l-.387 1.162a.217.217 0 0 1-.412 0L3.407 5.69A1.734 1.734 0 0 0 2.31 4.593l-1.162-.387a.217.217 0 0 1 0-.412l1.162-.387A1.734 1.734 0 0 0 3.407 2.31l.387-1.162z" />
        <path className="cp-st-b" d="M10.863.099a.145.145 0 0 1 .274 0l.258.774c.115.346.386.617.732.732l.774.258a.145.145 0 0 1 0 .274l-.774.258a1.156 1.156 0 0 0-.732.732l-.258.774a.145.145 0 0 1-.274 0l-.258-.774a1.156 1.156 0 0 0-.732-.732L9.1 2.137a.145.145 0 0 1 0-.274l.774-.258c.346-.115.617-.386.732-.732L10.863.1z" />
      </svg>
    </span>
  )
}

/** Листок с загнутым уголком: при наведении уголок разгибается, проступают строки */
function FileIcon({ size = 16 }: { size?: number }) {
  return (
    <span className="cp-icon cp-paper" aria-hidden>
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path className="cp-paper-body" d="M6 3h8l4 4v14H6z" />
        {/* развёрнутый лист: проявляется, пока уголок разгибается */}
        <path className="cp-paper-full" d="M6 3h12v18H6z" />
        <path className="cp-paper-fold" d="M14 3v4h4" />
        <path className="cp-paper-lines" d="M9 12h6M9 15.5h6M9 19h3.5" strokeLinecap="round" />
      </svg>
    </span>
  )
}

function Group({ title, count, children, defaultOpen = true }: { title: string; count: number; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="cp-group">
      <button className="cp-group-head" onClick={() => setOpen(v => !v)}>
        <ChevronRight size={12} className={cn('transition-transform', open && 'rotate-90')} />
        <span>{title}</span>
        <span className="cp-count">{count}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="cp-list" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

type Kind = 'artifacts' | 'files' | 'attachments'

/** Порядковый номер строки для «лесенки» появления; дальше 14-й — без задержки */
const stagger = (i: number) => ({ '--i': Math.min(i, 14) }) as CSSProperties

const baseName = (p: string) => p.split(/[\\/]/).pop() || p
const dirName = (p: string) => { const parts = p.split(/[\\/]/); parts.pop(); return parts.slice(-2).join('/') }

export function ContextPanel({ items }: { items: ChatItem[] }) {
  const artifacts = useMemo(() => deriveArtifacts(items), [items])
  const { files, attachments } = useMemo(() => deriveContextFiles(items), [items])
  // Узкий режим: какая группа раскрыта поверх ленты (null — ничего)
  const [focus, setFocus] = useState<Kind | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Раскрытая группа закрывается кликом мимо
  useEffect(() => {
    if (!focus) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setFocus(null) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [focus])

  if (!artifacts.length && !files.length && !attachments.length) return null

  const rail: { kind: Kind; n: number; label: string; icon: ReactNode }[] = [
    { kind: 'artifacts', n: artifacts.length, label: t('Артефакты', 'Artifacts'), icon: <ArtifactIcon size={18} /> },
    { kind: 'files', n: files.length, label: t('Файлы в контексте', 'Files in context'), icon: <FileIcon size={18} /> },
    { kind: 'attachments', n: attachments.length, label: t('Вложения', 'Attachments'), icon: <span className="cp-icon"><Paperclip size={17} /></span> },
  ]
  // В узком режиме видна только выбранная группа, на широком — все
  const show = (k: Kind) => !focus || focus === k

  return (
    <div ref={ref} className={cn('cp', focus && 'is-floating')}>
      {/* Узкое окно: отдельная плитка на каждую группу, число в углу «вырезает» иконку */}
      <div className="cp-rail">
        {rail.filter(r => r.n > 0).map(r => (
          // Закладка из правого края: при наведении выдвигается ровно на длину подписи
          <button key={r.kind} className={cn('cp-tab', focus === r.kind && 'is-on')}
            onClick={() => setFocus(f => f === r.kind ? null : r.kind)}>
            <span className="cp-tab-icon">
              {r.icon}
              <span className="cp-badge">{r.n > 99 ? '99+' : r.n}</span>
            </span>
            <span className="cp-tab-label"><span>{r.label}</span></span>
          </button>
        ))}
      </div>

      <div className="cp-body">
        {artifacts.length > 0 && show('artifacts') && (
          <Group title={t('Артефакты', 'Artifacts')} count={artifacts.length}>
            {artifacts.map((a, i) => (
              <button key={a.url} className="cp-item" style={stagger(i)} onClick={() => void api.openExternal(a.url)} title={a.url}>
                <ArtifactIcon />
                <span className="cp-item-name">{a.title}</span>
              </button>
            ))}
          </Group>
        )}
        {files.length > 0 && show('files') && (
          <Group title={t('Файлы в контексте', 'Files in context')} count={files.length}>
            {files.map((f, i) => (
              <button key={f.path} className="cp-item" style={stagger(i)} onClick={() => void api.fileReveal(fileUrl(f.path))}
                title={f.path + (f.from === 'compact' ? t(' · вернулся после сжатия', ' · restored after compaction') : '')}>
                <FileIcon />
                <span className="cp-item-text">
                  <span className="cp-item-name">{baseName(f.path)}</span>
                  <span className="cp-item-sub">{dirName(f.path)}</span>
                </span>
              </button>
            ))}
          </Group>
        )}
        {attachments.length > 0 && show('attachments') && (
          <Group title={t('Вложения', 'Attachments')} count={attachments.length}>
            {attachments.map((a, i) => (
              <div key={a} className="cp-item is-static" style={stagger(i)} title={a}>
                <span className="cp-icon"><Paperclip size={14} /></span>
                <span className="cp-item-name">{a}</span>
              </div>
            ))}
          </Group>
        )}
      </div>
    </div>
  )
}
