import { Heart, Flash } from 'iconsax-reactjs'

// Иконка модуля по ключу, который модуль отдаёт в поле `icon`.
//
// Встроенные — иконки iconsax в цвете темы. Страницы из папки modules
// приносят свою картинку (icon в module.json) — её url схемы vael-module.

interface Props {
  icon?: string
  size?: number
  /** Приглушить — для неактивной строки в списке */
  dimmed?: boolean
}

export function ModuleIcon({ icon, size = 18, dimmed }: Props) {
  const color = dimmed ? 'var(--text-faint)' : 'var(--accent)'

  if (icon?.startsWith('vael-module://')) {
    return <img src={icon} width={size} height={size} alt="" draggable={false} style={{ opacity: dimmed ? 0.6 : 1, objectFit: 'contain' }} />
  }

  if (icon === 'heart') {
    return <Heart size={size} variant="Bold" color={color} />
  }

  return <Flash size={size} variant="Bold" color={color} />
}
