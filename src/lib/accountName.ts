// Имя аккаунта = имя его папки: AccountManager пропускает только латиницу, цифры и . _ - @,
// остальное молча заменяет на «_». Поэтому кириллицу переводим в латиницу прямо при вводе

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

/** Нормализует ввод имени аккаунта: кириллица → латиница, пробел → «-», прочее выкидываем */
export function cleanAccountName(raw: string): string {
  return raw
    .replace(/[а-яё]/gi, ch => {
      const t = TRANSLIT[ch.toLowerCase()] ?? ''
      return ch === ch.toLowerCase() ? t : t.charAt(0).toUpperCase() + t.slice(1)
    })
    .replace(/ /g, '-')
    .replace(/[^a-zA-Z0-9._\-@]/g, '')
}
