import { Heart, Flash } from 'iconsax-reactjs'
import { cn } from '../lib/utils.js'

// Иконка модуля Pyre по ключу, который модуль отдаёт в поле `icon`.
//
// Иконки iconsax в цвете темы. Держим в одном месте, чтобы сайдбар и панели
// не разъезжались, когда появится новый модуль.

interface Props {
  icon?: string
  size?: number
  /** Приглушить — для неактивной строки в списке */
  dimmed?: boolean
}

export function ModuleIcon({ icon, size = 18, dimmed }: Props) {
  const color = dimmed ? 'var(--text-faint)' : 'var(--accent)'

  if (icon === 'heart') {
    return <Heart size={size} variant="Bold" color={color} />
  }

  return <Flash size={size} variant="Bold" color={color} />
}
