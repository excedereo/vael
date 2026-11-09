import path from 'path'

// Проверки для данных, которые приходят из окна по IPC. Окно доверенное, но если
// в нём когда-нибудь выполнится чужой код, эти проверки не дадут ему дотянуться
// до шелла и файлов за пределами наших папок.

/** Корень конфигов аккаунтов — та же формула, что в AccountManager */
export const ACCOUNTS_ROOT = path.join(process.env.USERPROFILE || '', '.claude-accounts')

/**
 * Значение аргумента CLI (модель, effort, режим, id сессии). Только символы,
 * которые встречаются в настоящих значениях: при запуске через .cmd аргументы
 * разбирает cmd.exe, и `&`, `|`, кавычки превратились бы в команды.
 */
export function isSafeArg(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9._:\-[\]]{1,100}$/.test(v)
}

/** Лежит ли путь внутри папки root (сама папка не считается) */
export function isInside(p: unknown, root: string): p is string {
  if (typeof p !== 'string' || !p) return false
  const rel = path.relative(path.resolve(root), path.resolve(p))
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** Ссылки, которые можно отдавать системе: только веб и почта */
export function isExternalUrl(url: unknown): url is string {
  return typeof url === 'string' && /^(https?|mailto):/i.test(url)
}
