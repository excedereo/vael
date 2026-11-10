// Модель в настройках храним алиасом (fable, opus, sonnet, haiku): CLI сам
// разворачивает его в самую свежую версию, и при выходе новой модели Vael
// обновлять не нужно.
//
// Старые версии Vael записывали в настройки закреплённые id прошлого поколения
// (claude-opus-5, claude-fable-5…) и даже переписывали алиасы в них — такие
// значения переводим обратно в алиас. Конкретную версию, выбранную руками
// в «Ещё модели» (claude-fable-5-1 и т. п.), не трогаем: её закрепили намеренно

const LEGACY: Record<string, string> = {
  'claude-fable-5':            'fable',
  'claude-opus-5':             'opus',
  'claude-sonnet-5':           'sonnet',
  'claude-haiku-4-5-20251001': 'haiku',
  'claude-sonnet-4-6':         'sonnet',
  'claude-opus-4-8':           'opus',
}

export const DEFAULT_MODEL = 'sonnet'

/** Старый закреплённый id → алиас; всё остальное как есть */
export function toAlias(model: string | undefined): string | undefined {
  return model ? (LEGACY[model] ?? model) : model
}
