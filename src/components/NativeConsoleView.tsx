import { useEffect, useRef, useCallback } from 'react'
import { api } from '../lib/api.js'

interface Props {
  sessionPath: string | null  // project directory path for claude --resume
  visible: boolean
}

export function NativeConsoleView({ sessionPath, visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const spawnedPath = useRef<string | null>(null)
  const animFrameRef = useRef<number>(0)

  const syncBounds = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // Convert CSS pixels to physical pixels (DPR scaling)
    const dpr = window.devicePixelRatio || 1
    api.nconMove(
      Math.round(rect.left * dpr),
      Math.round(rect.top * dpr),
      Math.round(rect.width * dpr),
      Math.round(rect.height * dpr),
    )
  }, [])

  // Spawn or re-spawn when sessionPath changes
  useEffect(() => {
    if (!sessionPath) {
      api.nconSetVisible(false)
      return
    }

    const el = containerRef.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1

    api.nconSpawn(
      sessionPath,
      Math.round(rect.left * dpr),
      Math.round(rect.top * dpr),
      Math.round(rect.width * dpr),
      Math.round(rect.height * dpr),
    ).then(({ ok }) => {
      if (ok) {
        spawnedPath.current = sessionPath
        api.nconSetVisible(visible)
      } else {
        console.error('[NativeConsoleView] spawn failed')
      }
    })
  }, [sessionPath])

  // Show/hide on visibility change
  useEffect(() => {
    if (!spawnedPath.current) return
    api.nconSetVisible(visible)
  }, [visible])

  // Sync bounds on resize via ResizeObserver
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = requestAnimationFrame(syncBounds)
    })
    ro.observe(el)

    // Also sync on window resize (DPR changes, zoom)
    window.addEventListener('resize', syncBounds)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', syncBounds)
      cancelAnimationFrame(animFrameRef.current)
    }
  }, [syncBounds])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      api.nconKill()
      spawnedPath.current = null
    }
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        // Transparent placeholder — native window sits on top
        background: '#0a0a0a',
        display: visible ? 'block' : 'none',
      }}
    />
  )
}
