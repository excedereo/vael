import { api } from '../lib/api.js'
import { TgPanel } from './TgPanel.js'
import { Session } from '../types/index.js'

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

  return (
    <div className="flex-1 flex items-center justify-center text-text-ghost text-sm">
      Выбери модуль
    </div>
  )
}
