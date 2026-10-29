import type { Section } from '../components/NavRail.js'

// Человеко-читаемые названия разделов — для шапки окна и шапки сайдбара
export const SECTION_LABEL: Record<Section, string> = {
  sessions: 'Сессии',
  memory:   'Память',
  pyre:     'Pyre',
  dev:      'Dev',
  accounts: 'Аккаунты',
  settings: 'Настройки',
}
