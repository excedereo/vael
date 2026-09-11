import { useEffect } from 'react'

interface Props {
  onBack: () => void
  onForward: () => void
}

/**
 * Навигация назад/вперёд. Кнопки из шапки убраны — пока не решено, где им жить;
 * остались боковые кнопки мыши, поэтому компонент ничего не рисует.
 */
export function NavControls({ onBack, onForward }: Props) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (e.button === 3) { e.preventDefault(); onBack() }
      if (e.button === 4) { e.preventDefault(); onForward() }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [onBack, onForward])

  return null
}
