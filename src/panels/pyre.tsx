import { useState, useEffect } from 'react'
import { Zap } from 'lucide-react'
import { PyrePage } from '../components/PyrePage.js'
import { VaeliPanel } from '../types/panel.js'
import { useActiveModule } from '../lib/activeModule.js'
import { api } from '../lib/api.js'
import { Session } from '../types/index.js'

interface ModuleInfo {
  id: string
  name: string
  icon?: string
  running: boolean
}

function PyreWrapper() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [, setModules] = useState<ModuleInfo[]>([])
  // Выбранный модуль общий с сайдбаром — см. lib/activeModule.ts
  const activeModuleId = useActiveModule()

  // Сессии нужны панелям только чтобы подписать выбранный uuid человеческим
  // именем. Без них подпись просто короче, поэтому ошибки глотаем молча.
  useEffect(() => {
    api.getSettings()
      .then(s => {
        const id = s.activeAccountId
        return typeof id === 'string' && id ? api.getSessions(id) : []
      })
      .then(setSessions)
      .catch(() => {})
  }, [])

  return (
    <PyrePage
      sessions={sessions}
      activeModuleId={activeModuleId}
      onModulesChange={setModules}
    />
  )
}

export const pyrePanel: VaeliPanel = {
  id: 'pyre',
  label: 'Pyre',
  icon: <Zap size={16} />,
  render() {
    return <PyreWrapper />
  },
}
