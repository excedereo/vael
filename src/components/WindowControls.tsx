import { useState, useEffect } from 'react'
import { Minus, Square, X } from 'lucide-react'
import { api } from '../lib/api.js'
import { cn } from '../lib/utils.js'

export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    api.windowIsMaximized().then(setMaximized)
    // Poll for maximize state changes (window resize by dragging)
    const iv = setInterval(() => {
      api.windowIsMaximized().then(setMaximized)
    }, 500)
    return () => clearInterval(iv)
  }, [])

  const btn = 'no-drag w-[46px] h-10 flex items-center justify-center transition-colors'

  return (
    <div className="no-drag flex items-center shrink-0 h-10">
      <button
        onClick={() => api.windowMinimize()}
        className={cn(btn, 'text-text-ghost hover:text-text-muted hover:bg-surface-hover')}
        title="Свернуть"
      >
        <Minus size={12} strokeWidth={1.5} />
      </button>
      <button
        onClick={() => api.windowMaximize().then(() => api.windowIsMaximized().then(setMaximized))}
        className={cn(btn, 'text-text-ghost hover:text-text-muted hover:bg-surface-hover')}
        title={maximized ? 'Восстановить' : 'Развернуть'}
      >
        {maximized
          ? <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><rect x="3" y="0.5" width="7" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.2"/><rect x="0.5" y="3" width="7" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.2" fill="var(--bg-sidebar)"/></svg>
          : <Square size={11} strokeWidth={1.5} />
        }
      </button>
      <button
        onClick={() => api.windowClose()}
        className={cn(btn, 'text-text-ghost hover:text-white hover:bg-red-500/70')}
        title="Закрыть"
      >
        <X size={13} strokeWidth={1.5} />
      </button>
    </div>
  )
}
