import { Messages, Data, Flash, Code1, Profile, Setting2 } from 'iconsax-reactjs'
import type { Icon } from 'iconsax-reactjs'
import { cn } from '../lib/utils.js'

export type Section = 'sessions' | 'memory' | 'pyre' | 'dev' | 'accounts' | 'settings'

interface NavItem {
  id: Section
  label: string
  icon: Icon
}

// Верхняя группа — работа, нижняя — контекст (аккаунт/настройки)
const WORK: NavItem[] = [
  { id: 'sessions', label: 'Sessions', icon: Messages },
  { id: 'pyre',     label: 'Pyre',     icon: Flash },
]
const MEMORY: NavItem = { id: 'memory', label: 'Memory', icon: Data }
const DEV: NavItem = { id: 'dev', label: 'Dev', icon: Code1 }
const CONTEXT: NavItem[] = [
  { id: 'accounts', label: 'Accounts', icon: Profile },
  { id: 'settings', label: 'Settings', icon: Setting2 },
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
      className={cn(
        'relative w-9 h-9 rounded-[10px] flex items-center justify-center transition-colors',
        active ? 'text-accent bg-accent-wash' : 'text-text-faint hover:text-text-secondary hover:bg-surface-hover',
      )}
    >
      {/* рельс активного раздела */}
      {active && (
        <span className="absolute -left-[7px] top-2 bottom-2 w-0.5 rounded-full bg-accent" />
      )}
      {/* бейдж живой работы в неоткрытом разделе */}
      {busy && !active && (
        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[var(--color-success)] shadow-[0_0_5px_rgba(74,222,128,0.8)]" />
      )}
      <Icon size={22} variant={active ? 'Bold' : 'Linear'} color="currentColor" />
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
    <div className="w-[46px] shrink-0 flex flex-col items-center pt-[38px] pb-2.5 gap-[3px] bg-bg-base border-r border-border-subtle">
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
