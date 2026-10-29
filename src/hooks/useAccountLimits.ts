// Лимиты плана аккаунта: последнее, что CLI прислал в потоке любого чата.
// Отдельных запросов нет — main сохраняет rate_limit_event и рассылает его сюда.
import { useEffect, useState } from 'react'
import { api, type AccountLimits, type RateLimitWindow } from '../lib/api.js'

export interface LimitWindowView {
  pct: number
  /** время сброса уже прошло — окно пустое, хоть данные и старые */
  passed: boolean
  resetsAt: number
}

export interface AccountLimitsView {
  fiveHour: LimitWindowView | null
  weekly: LimitWindowView | null
  /** сколько мс назад пришли цифры */
  age: number
}

function view(w: RateLimitWindow | undefined, now: number): LimitWindowView | null {
  if (!w) return null
  const resetsAt = w.resetsAt * 1000
  const passed = resetsAt <= now
  return { pct: passed ? 0 : Math.round(w.utilization * 100), passed, resetsAt }
}

export function useAccountLimits(configDir: string | null | undefined): AccountLimitsView | null {
  const [value, setValue] = useState<AccountLimits | null>(null)
  // Тик раз в минуту: «N мин назад» и сброс окна должны обновляться и без новых событий
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    setValue(null)
    if (configDir === undefined || !api.limitsGet) return
    const key = configDir ?? 'default'
    api.limitsGet(configDir).then(v => { if (v) setValue(v) }).catch(() => {})
    const off = api.onLimitsUpdate((dir, v) => { if (dir === key) setValue(v) })
    return off
  }, [configDir])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const w = value?.info.unifiedWindows
  if (!value || !w || (!w.five_hour && !w.seven_day)) return null
  return { fiveHour: view(w.five_hour, now), weekly: view(w.seven_day, now), age: now - value.at }
}
