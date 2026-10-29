import type { Section } from '../components/NavRail.js'
import { t } from './i18n.js'

// Человеко-читаемые названия разделов — для шапки окна и шапки сайдбара
export const SECTION_LABEL: Record<Section, string> = {
  sessions: t("Сессии", "Sessions"),
  memory:   t("Память", "Memory"),
  pyre:     'Pyre',
  dev:      'Dev',
  accounts: t("Аккаунты", "Accounts"),
  settings: t("Настройки", "Settings"),
}
