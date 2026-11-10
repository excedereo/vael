import { useEffect, useRef } from 'react'
import { api } from '../lib/api.js'

// Кнопки окна рисует сама Windows (titleBarOverlay в main): системный вид и
// Snap Layouts. Здесь только место под них в шапке и их цвета под текущую тему.

/** Ширина трёх системных кнопок Windows 11 (46px каждая) */
const OVERLAY_WIDTH = 138

/** Первый непрозрачный фон вверх по дереву — на нём и стоят кнопки */
function solidBackground(el: HTMLElement | null): string {
  for (let n = el; n; n = n.parentElement) {
    const bg = getComputedStyle(n).backgroundColor
    const a = bg.match(/rgba\([^)]*,\s*([\d.]+)\)/)
    if (bg !== 'transparent' && (!a || parseFloat(a[1]) >= 0.99)) return bg
  }
  return getComputedStyle(document.body).backgroundColor || '#0a0a0a'
}

export function WindowControls() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let last = ''
    const sync = () => {
      const el = ref.current
      if (!el) return
      const color = solidBackground(el.parentElement)
      const symbol = getComputedStyle(el).getPropertyValue('--text-secondary').trim() || '#cfcfcf'
      if (color + symbol === last) return
      last = color + symbol
      void api.windowSetOverlay(color, symbol)
    }
    sync()
    // Тема меняет переменные на <html>/<body> — ловим это и перекрашиваем кнопки
    const mo = new MutationObserver(() => requestAnimationFrame(sync))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] })
    mo.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] })
    return () => mo.disconnect()
  }, [])

  return <div ref={ref} aria-hidden className="shrink-0 h-11" style={{ width: OVERLAY_WIDTH }} />
}
