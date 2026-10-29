import { MessagesSquare, GitFork, Zap, SquareTerminal, Settings } from 'lucide-react'
import logoSmall from '../assets/logo-small.svg'
import type { LucideIcon as Icon } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { t } from '../lib/i18n.js'

export type Section = 'sessions' | 'memory' | 'pyre' | 'dev' | 'accounts' | 'settings'

interface NavItem {
  id: Section
  label: string
  icon: Icon
}

// Верхняя группа — работа, нижняя — контекст (аккаунт/настройки)
const WORK: NavItem[] = [
  { id: 'sessions', label: t("Сессии", "Sessions"), icon: MessagesSquare },
  { id: 'pyre',     label: 'Pyre',     icon: Zap },
]
const MEMORY: NavItem = { id: 'memory', label: t("Память", "Memory"), icon: GitFork }
const DEV: NavItem = { id: 'dev', label: 'Dev', icon: SquareTerminal }
// Аккаунты открываются из карточки аккаунта внизу сайдбара — отдельная иконка была дублем
const CONTEXT: NavItem[] = [
  { id: 'settings', label: t("Настройки", "Settings"), icon: Settings },
]

interface Props {
  active: Section
  onSelect: (s: Section) => void
  showDev: boolean
  showMemory: boolean
  /** id разделов, где сейчас идёт живая работа (для бейджа на неактивной иконке) */
  busySections?: Section[]
}

function RailButton({ item, active, onSelect, busy }: {
  item: NavItem
  active: boolean
  onSelect: (s: Section) => void
  busy?: boolean
}) {
  const Icon = item.icon
  return (
    <button
      onClick={() => onSelect(item.id)}
      title={item.label}
      aria-label={item.label}
      aria-current={active}
      className={cn('rail-btn', active && 'is-active')}
    >
      {/* бейдж живой работы в неоткрытом разделе */}
      {busy && !active && (
        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[var(--color-success)] shadow-[0_0_5px_rgba(74,222,128,0.8)]" />
      )}
      <Icon size={17} strokeWidth={1.8} />
    </button>
  )
}

export function NavRail({ active, onSelect, showDev, showMemory, busySections = [] }: Props) {
  const top = [
    WORK[0],                          // Sessions
    ...(showMemory ? [MEMORY] : []),
    WORK[1],                          // Pyre
    ...(showDev ? [DEV] : []),
  ]
  return (
    <div className="w-[52px] shrink-0 flex flex-col items-center pb-2.5 gap-1.5 border-r border-border-subtle" style={{ background: 'var(--bg-rail, var(--bg-base))' }}>
      {/* Верхняя линия окна — как у сайдбара и шапки */}
      <div className="app-drag-region w-full h-11 shrink-0 flex items-center justify-center border-b border-border-subtle mb-1">
        <img src={logoSmall} alt="Vael" className="w-[26px] h-[26px] select-none" draggable={false} />
      </div>
      {top.map(item => (
        <RailButton
          key={item.id}
          item={item}
          active={active === item.id}
          onSelect={onSelect}
          busy={busySections.includes(item.id)}
        />
      ))}
      <span className="flex-1 min-h-[14px]" />
      {CONTEXT.map(item => (
        <RailButton
          key={item.id}
          item={item}
          active={active === item.id}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
