import defaultPng from '../assets/default.png'
import punchingGif from '../assets/punching_self.gif'
import thinkingGif from '../assets/thinking.gif'
import errorGif from '../assets/vaeli-error.gif'
import compactingGif from '../assets/compacting.gif'

export interface AvatarSlot {
  id: string
  label: string
  desc: string
  tag: string
  tagColor: string
  builtinSrc: string | null
}

export const TAG_COLORS: Record<string, string> = {
  'Ожидание':    'bg-white/8 text-white/45',
  'Размышление': 'bg-violet-500/15 text-violet-400/80',
}

export const AVATAR_SLOTS: AvatarSlot[] = [
  { id: 'default',  label: 'Иконка по умолчанию',  desc: 'обычное состояние',             tag: 'Ожидание',    tagColor: TAG_COLORS['Ожидание'],    builtinSrc: defaultPng  },
  { id: 'idle',     label: 'Иконка ожидания',      desc: 'при ожидании ввода',             tag: 'Ожидание',    tagColor: TAG_COLORS['Ожидание'],    builtinSrc: null },
  { id: 'punching', label: 'Иконка размышления 1', desc: 'первые 5 секунд мышления',       tag: 'Размышление', tagColor: TAG_COLORS['Размышление'], builtinSrc: thinkingGif },
  { id: 'thinking', label: 'Иконка размышления 2', desc: 'долгое мышление (5+ сек)',        tag: 'Размышление', tagColor: TAG_COLORS['Размышление'], builtinSrc: punchingGif },
  { id: 'typing',   label: 'Иконка набора текста', desc: 'при выводе текста',              tag: '',            tagColor: '',                        builtinSrc: null },
  { id: 'tool',     label: 'Иконка инструмента',   desc: 'при использовании инструментов', tag: '',            tagColor: '',                        builtinSrc: null },
  { id: 'done',     label: 'Иконка завершения',    desc: 'после получения ответа',          tag: '',            tagColor: '',                        builtinSrc: null },
  { id: 'error',    label: 'Иконка ошибки',        desc: 'при ошибке',                     tag: '',            tagColor: '',                        builtinSrc: errorGif },
  { id: 'compacting', label: 'Иконка компакта',   desc: 'при сжатии контекста',           tag: '',            tagColor: '',                        builtinSrc: compactingGif },
]

const LS_KEY = 'vaeliAvatarSlots'

// null  = явно удалён (пустота)
// string = кастомный путь
// undefined = не задан (используется builtinSrc)
export type SlotOverrides = Record<string, string | null>

export function loadSlotOverrides(): SlotOverrides {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') }
  catch { return {} }
}

export function saveSlotOverrides(o: SlotOverrides) {
  localStorage.setItem(LS_KEY, JSON.stringify(o))
}

// Возвращает src для img (или null если пустота)
export function resolveSlotSrc(id: string, overrides: SlotOverrides): string | null {
  const slot = AVATAR_SLOTS.find(s => s.id === id)
  if (!slot) return null
  if (id in overrides) {
    return overrides[id] ? `file:///${overrides[id]!.replace(/\\/g, '/')}` : null
  }
  return slot.builtinSrc
}
