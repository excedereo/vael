import { useEffect, useRef } from 'react'
import confetti from 'canvas-confetti'

interface Props {
  active: boolean
  onDone: () => void
  originRect?: DOMRect
}

export function ConfettiCanvas({ active, onDone, originRect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    if (!canvas) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const fire = confetti.create(canvas, { resize: true, useWorker: false })

    const canvasRect = canvas.getBoundingClientRect()
    const originX = originRect
      ? (originRect.left + originRect.width / 2) / canvasRect.width
      : 0.5
    const originY = originRect
      ? (originRect.top + originRect.height / 2) / canvasRect.height
      : 0.5

    fire({
      particleCount: 60,
      spread: 80,
      startVelocity: 18,
      scalar: 0.7,
      ticks: 60,
      origin: { x: originX, y: originY },
      colors: ['#22c55e', '#86efac', '#4ade80', '#bbf7d0'],
      shapes: ['square'],
      gravity: 0.4,
      drift: 0,
    }).then(() => onDone())

  }, [active])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    />
  )
}
