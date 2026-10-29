// Язык интерфейса. Русский текст остаётся в коде как есть, английский — рядом: t('Сессии', 'Sessions').
// Язык читается один раз при загрузке окна, смена перезагружает окно — поэтому
// t() можно звать где угодно, в том числе в константах модуля, без подписок и контекста

export type Lang = 'ru' | 'en'

const KEY = 'vaeli:lang'

function read(): Lang | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'ru' || v === 'en' ? v : null
  } catch { return null }
}

/** Язык системы — подсказка для экрана выбора */
export function systemLang(): Lang {
  return /^ru|^be|^uk|^kk/i.test(navigator.language || '') ? 'ru' : 'en'
}

/** Выбран ли язык явно. Если нет — на старте показывается экран выбора */
export const LANG_CHOSEN = read() !== null
export const LANG: Lang = read() ?? 'ru'
/** Локаль для дат и чисел */
export const LOCALE = LANG === 'en' ? 'en-US' : 'ru-RU'

export function t(ru: string, en: string): string {
  return LANG === 'en' ? en : ru
}

/** Сменить язык. reload: false — только записать (экран выбора перезагрузит сам) */
export function setLang(lang: Lang, reload = true) {
  try { localStorage.setItem(KEY, lang) } catch {}
  if (reload) window.location.reload()
}
