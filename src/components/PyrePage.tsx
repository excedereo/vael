import { api } from '../lib/api.js'
import { TgPanel } from './TgPanel.js'
import { HeartbeatPanel } from './HeartbeatPanel.js'
import type { Session } from '../types/index.js'
import { t } from '../lib/i18n.js'

interface ModuleInfo {
  id: string
  name: string
  icon?: string
  running: boolean
}

interface Props {
  sessions: Session[]
  activeModuleId: string | null
  onModulesChange: (modules: ModuleInfo[]) => void
}

export function PyrePage({ sessions, activeModuleId, onModulesChange }: Props) {
  const refresh = () => {
    api.modulesList().then(onModulesChange)
  }

  if (activeModuleId === 'telegram') {
    return <TgPanel sessions={sessions} onStatusChange={refresh} />
  }

  if (activeModuleId === 'heartbeat') {
    return <HeartbeatPanel sessions={sessions} onStatusChange={refresh} />
  }

  return (
    <div className="flex-1 flex items-center justify-center text-text-ghost text-sm">
      {t("Выбери модуль", "Pick a module")}
    </div>
  )
}
