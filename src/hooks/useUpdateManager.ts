import { useState, useCallback, useEffect } from 'react'
import { api } from '../lib/api.js'
import { UpdateState } from '../components/UpdateBanner.js'

export type { UpdateState }

export function useUpdateManager() {
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)

  useEffect(() => {
    const u1 = api.onUpdateAvailable(v => setUpdateState({ status: 'available', version: v }))
    const u2 = api.onUpdateProgress(p => setUpdateState({ status: 'downloading', progress: p }))
    const u3 = api.onUpdateReady(() => setUpdateState({ status: 'ready' }))
    const u4 = api.onUpdateError(msg => setUpdateState({ status: 'error', message: msg }))
    return () => { u1(); u2(); u3(); u4() }
  }, [])

  const [tempCleanupBanner, setTempCleanupBanner] = useState<{ autoDelete: string; cancelled: boolean } | null>(null)
  const [tempCleanupCountdown, setTempCleanupCountdown] = useState(0)

  useEffect(() => {
    const unsubStart = api.onTempCleanupStart((autoDelete) => {
      setTempCleanupBanner({ autoDelete, cancelled: false })
      setTempCleanupCountdown(4)
      const iv = setInterval(() => setTempCleanupCountdown(c => {
        if (c <= 1) { clearInterval(iv); return 0 }
        return c - 1
      }), 1000)
    })
    const unsubDone = api.onTempCleanupDone((_count) => {
      setTempCleanupBanner(null)
      setTempCleanupCountdown(0)
    })
    const unsubCancelled = api.onTempCleanupCancelled(() => {
      setTempCleanupBanner(null)
      setTempCleanupCountdown(0)
    })
    return () => { unsubStart(); unsubDone(); unsubCancelled() }
  }, [])

  const handleUpdateClick = useCallback(() => {
    if (!updateState) return
    if (updateState.status === 'available' || updateState.status === 'error') {
      setUpdateState({ status: 'downloading', progress: 0 })
      api.updateDownload().catch((e) => setUpdateState({ status: 'error', message: e.message }))
    } else if (updateState.status === 'ready') {
      api.updateInstall()
    }
  }, [updateState])

  return {
    updateState,
    setUpdateState,
    handleUpdateClick,
    tempCleanupBanner,
    tempCleanupCountdown,
  }
}
