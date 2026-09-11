import { Heart, Flash } from 'iconsax-reactjs'
import { cn } from '../lib/utils.js'
import telegramLogo from '../assets/telegram-logo.svg'

// Иконка модуля Pyre по ключу, который модуль отдаёт в поле `icon`.
//
// Телеграм — фирменный логотип (цветной, узнаётся мгновенно), остальные —
// iconsax в цвете темы. Держим в одном месте, чтобы сайдбар и панели не
// разъезжались, когда появится новый модуль.

interface Props {
  icon?: string
  size?: number
  /** Приглушить — для неактивной строки в списке */
  dimmed?: boolean
}

export function ModuleIcon({ icon, size = 18, dimmed }: Props) {
  if (icon === 'tg') {
    return (
      <img
        src={telegramLogo}
        alt=""
        width={size}
        height={size}
        className={cn('transition-opacity duration-200', dimmed && 'opacity-45')}
        draggable={false}
      />
    )
  }

  const color = dimmed ? 'var(--text-faint)' : 'var(--accent)'

  if (icon === 'heart') {
    return <Heart size={size} variant="Bold" color={color} />
  }

  return <Flash size={size} variant="Bold" color={color} />
}
