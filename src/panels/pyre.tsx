import { useState, useEffect } from 'react'
import { Zap } from 'lucide-react'
import { PyrePage } from '../components/PyrePage.js'
import { VaeliPanel } from '../types/panel.js'
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
  const [modules, setModules] = useState<ModuleInfo[]>([])
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null)

  useEffect(() => {
    api.modulesList().then(list => {
      setModules(list)
      if (list.length > 0) setActiveModuleId(list[0].id)
    })
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
