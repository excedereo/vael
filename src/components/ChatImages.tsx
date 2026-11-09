import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, CloseCircle, GalleryRemove } from 'iconsax-reactjs'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'

// Картинки в ответе модели: ![подпись](file:///C:/…/img.png). Одна — крупно,
// несколько подряд — сеткой. По клику — крупный просмотр.
// Локальные файлы грузим через main (data URL): из dev-окна на http://
// Chromium не даёт открыть file:// напрямую.

export type ChatImg = { src: string; alt?: string }

const isFile = (src: string) => /^file:/i.test(src)
const cache = new Map<string, string | null>()

function useImage(src: string, maxSide: number): string | null | undefined {
  const key = maxSide + '|' + src
  const [url, setUrl] = useState<string | null | undefined>(() => isFile(src) ? cache.get(key) : src)
  useEffect(() => {
    if (!isFile(src)) { setUrl(src); return }
    if (cache.has(key)) { setUrl(cache.get(key)); return }
    let alive = true
    api.fileImage(src, maxSide).catch(() => null).then(u => {
      cache.set(key, u)
      if (alive) setUrl(u)
    })
    return () => { alive = false }
  }, [src, maxSide, key])
  return url  // undefined — грузится, null — не открылась
}

function Tile({ img, maxSide, onOpen }: { img: ChatImg; maxSide: number; onOpen: () => void }) {
  const url = useImage(img.src, maxSide)
  if (url === null) {
    return (
      <span className="chat-img-tile is-broken" title={img.alt}>
        <GalleryRemove size={22} variant="Linear" color="var(--text-faint)" />
      </span>
    )
  }
  return (
    <span className="chat-img-tile" role="button" tabIndex={0} title={img.alt}
      onClick={onOpen} onKeyDown={e => { if (e.key === 'Enter') onOpen() }}>
      {url ? <img src={url} alt={img.alt ?? ''} draggable={false} /> : <span className="chat-img-loading" />}
    </span>
  )
}

function Viewer({ img, onClose }: { img: ChatImg; onClose: () => void }) {
  const url = useImage(img.src, 2400)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return createPortal(
    <div className="chat-img-viewer" onClick={onClose}>
      {url && <img src={url} alt={img.alt ?? ''} onClick={e => e.stopPropagation()} draggable={false} />}
      <div className="chat-img-viewer-bar" onClick={e => e.stopPropagation()}>
        {img.alt && <span className="chat-img-viewer-alt">{img.alt}</span>}
        {isFile(img.src) && (
          <button onClick={() => void api.fileReveal(img.src)}>
            <FolderOpen size={15} variant="Linear" color="currentColor" />{t('Показать в проводнике', 'Show in Explorer')}
          </button>
        )}
        <button onClick={onClose} title={t('Закрыть', 'Close')}>
          <CloseCircle size={15} variant="Linear" color="currentColor" />
        </button>
      </div>
    </div>,
    document.body,
  )
}

export function ImageGallery({ images }: { images: ChatImg[] }) {
  const [open, setOpen] = useState<number | null>(null)
  const single = images.length === 1
  const cols = single ? 1 : images.length === 2 || images.length === 4 ? 2 : 3
  return (
    <span className={'chat-img-gallery' + (single ? ' is-single' : '')} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {images.map((img, i) => (
        <Tile key={i + img.src} img={img} maxSide={single ? 1200 : 640} onOpen={() => setOpen(i)} />
      ))}
      {open !== null && <Viewer img={images[open]} onClose={() => setOpen(null)} />}
    </span>
  )
}
