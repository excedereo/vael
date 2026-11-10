import { useState, useEffect } from 'react'
import { Zap } from 'lucide-react'
import { PyrePage } from '../components/PyrePage.js'
import type { VaeliPanel } from '../types/panel.js'
import { useActiveModule } from '../lib/activeModule.js'
import { api, type ModuleListItem } from '../lib/api.js'
import type { Session } from '../types/index.js'

function PyreWrapper() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [modules, setModules] = useState<ModuleListItem[]>([])
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

  // Страницы модулей берутся из папки — список перечитываем, когда она меняется
  useEffect(() => {
    const load = () => { api.modulesList().then(setModules).catch(() => {}) }
    load()
    return api.onModulesChanged?.(load)
  }, [])

  return (
    <PyrePage
      sessions={sessions}
      modules={modules}
      activeModuleId={activeModuleId}
      onModulesChange={setModules}
    />
  )
}

export const pyrePanel: VaeliPanel = {
  id: 'pyre',
  label: 'Modules',
  icon: <Zap size={16} />,
  render() {
    return <PyreWrapper />
  },
}
