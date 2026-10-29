import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { Element3, Category } from 'iconsax-reactjs'
import { MemoryPage } from '../components/MemoryPage.js'
import { MemoryGraph } from '../components/MemoryGraph.js'
import type { VaeliPanel } from '../types/panel.js'
import { cn } from '../lib/utils.js'
import { t } from '../lib/i18n.js'

function MemoryWrapper() {
  const [view, setView] = useState<'list' | 'graph'>('list')

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {/* Переключатель вида — поверх содержимого, чтобы не отнимать высоту */}
      <div
        className={cn(
          'absolute top-3 right-4 z-40 flex gap-0.5 p-0.5 rounded-lg',
          'backdrop-blur-md border',
          view === 'graph'
            ? 'bg-black/45 border-white/12'
            : 'bg-surface-hover border-border-default',
        )}
      >
        {([
          ['list', Category, t("Список", "List")],
          ['graph', Element3, t("Граф", "Graph")],
        ] as const).map(([id, Icon, title]) => (
          <button
            key={id}
            onClick={() => setView(id)}
            title={title}
            className={cn(
              'w-7 h-7 rounded-md flex items-center justify-center transition-colors',
              view === id
                ? view === 'graph' ? 'bg-white/15' : 'bg-surface-active'
                : 'hover:bg-white/8',
            )}
          >
            <Icon
              size={15}
              variant={view === id ? 'Bold' : 'Linear'}
              color={view === id
                ? (view === 'graph' ? 'rgba(255,255,255,.9)' : 'var(--accent)')
                : (view === 'graph' ? 'rgba(255,255,255,.45)' : 'var(--text-faint)')}
            />
          </button>
        ))}
      </div>

      {view === 'list' ? <MemoryPage onBack={() => {}} /> : <MemoryGraph />}
    </div>
  )
}

export const memoryPanel: VaeliPanel = {
  id: 'memory',
  label: t("Память", "Memory"),
  icon: <BookOpen size={16} />,
  render() {
    return <MemoryWrapper />
  },
}
