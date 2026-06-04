import { useState, useCallback, useEffect } from 'react'
import { api } from '../lib/api.js'

export interface DepsState {
  npm: string | null
  claude: string | null
  ready: boolean
}

export function useDependencies() {
  const [deps, setDeps] = useState<DepsState | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installLog, setInstallLog] = useState<string | null>(null)

  useEffect(() => {
    api.checkDeps().then(setDeps)
  }, [])

  const handleInstallClaude = useCallback(async () => {
    setInstalling(true)
    setInstallLog(null)
    const result = await api.installClaude()
    setInstalling(false)
    if (result.ok) {
      const newDeps = await api.checkDeps()
      setDeps(newDeps)
    } else {
      setInstallLog(result.log || 'Неизвестная ошибка')
    }
  }, [])

  return { deps, setDeps, installing, installLog, handleInstallClaude }
}
