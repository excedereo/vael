import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '../lib/utils.js'

interface Props {
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  collapsed: boolean
  onToggleCollapse: () => void
}

export function NavControls({ canGoBack, canGoForward, onBack, onForward, collapsed, onToggleCollapse }: Props) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (e.button === 3) { e.preventDefault(); onBack() }
      if (e.button === 4) { e.preventDefault(); onForward() }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [onBack, onForward])

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <button
        onClick={onToggleCollapse}
        className="p-1.5 rounded-md text-text-faint hover:text-text-secondary hover:bg-surface-hover transition-colors"
        title={collapsed ? 'Show sidebar' : 'Hide sidebar'}
      >
        {collapsed
          ? <PanelLeftOpen size={15} />
          : <PanelLeftClose size={15} />
        }
      </button>
      <button
        onClick={onBack}
        disabled={!canGoBack}
        className={cn(
          'p-1.5 rounded-md transition-colors',
          canGoBack
            ? 'text-text-faint hover:text-text-secondary hover:bg-surface-hover'
            : 'text-text-ghost cursor-default',
        )}
        title="Go back"
      >
        <ChevronLeft size={15} />
      </button>
      <button
        onClick={onForward}
        disabled={!canGoForward}
        className={cn(
          'p-1.5 rounded-md transition-colors',
          canGoForward
            ? 'text-text-faint hover:text-text-secondary hover:bg-surface-hover'
            : 'text-text-ghost cursor-default',
        )}
        title="Go forward"
      >
        <ChevronRight size={15} />
      </button>
    </div>
  )
}
