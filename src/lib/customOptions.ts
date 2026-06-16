export interface CustomOption {
  value: string
  label: string
  sub?: string
}

export type OptionCategory = 'model' | 'effort' | 'permission'

const KEYS: Record<OptionCategory, string> = {
  model:      'vaeli:custom-options:model',
  effort:     'vaeli:custom-options:effort',
  permission: 'vaeli:custom-options:permission',
}

export function loadCustomOptions(cat: OptionCategory): CustomOption[] {
  try {
    const raw = localStorage.getItem(KEYS[cat])
    if (raw) return JSON.parse(raw) as CustomOption[]
  } catch {}
  return []
}

export function saveCustomOptions(cat: OptionCategory, opts: CustomOption[]) {
  localStorage.setItem(KEYS[cat], JSON.stringify(opts))
}

export function addCustomOption(cat: OptionCategory, opt: CustomOption) {
  const existing = loadCustomOptions(cat)
  if (existing.find(o => o.value === opt.value)) return
  saveCustomOptions(cat, [...existing, opt])
}

export function removeCustomOption(cat: OptionCategory, value: string) {
  saveCustomOptions(cat, loadCustomOptions(cat).filter(o => o.value !== value))
}
