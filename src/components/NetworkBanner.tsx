import { useEffect, useState } from 'react'
import { ShieldCross, Global, Refresh2 } from 'iconsax-reactjs'
import { api, type NetworkInfo } from '../lib/api.js'
import { loadVpnCheck } from '../hooks/useSettings.js'

/**
 * Предупреждение, что запросы уходят без VPN.
 *
 * Страну спрашиваем у самого api.anthropic.com — списки IP-адресов Anthropic
 * для этого не нужны и не помогли бы: сервисы за Cloudflare, диапазоны
 * меняются, а адрес чужого сервера ничего не говорит о нашем выходе в сеть.
 */

const COUNTRY_NAME: Record<string, string> = {
  RU: 'России', BY: 'Беларуси', UA: 'Украины', KZ: 'Казахстана',
}

function countryLabel(code: string): string {
  return COUNTRY_NAME[code] ?? code
}

export function NetworkBanner() {
  const [info, setInfo] = useState<NetworkInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [checking, setChecking] = useState(false)
  const settings = loadVpnCheck()

  const check = async () => {
    setChecking(true)
    try { setInfo(await api.checkNetwork()) } catch {}
    setChecking(false)
  }

  useEffect(() => {
    if (!settings.enabled) return
    check()
    // Перепроверяем нечасто: запрос лёгкий (~270мс), но и смысла спамить нет —
    // VPN включают руками, а не каждую минуту
    const t = setInterval(check, 5 * 60_000)
    return () => clearInterval(t)
  }, [settings.enabled])

  if (!settings.enabled || dismissed || !info) return null
  // Сеть недоступна — про страну judge выносить нельзя, молчим
  if (info.offline || !info.country) return null
  if (!settings.warnCountries.includes(info.country)) return null

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 rounded-2xl border"
      style={{
        borderColor: 'color-mix(in srgb, var(--color-error) 28%, transparent)',
        backgroundColor: 'color-mix(in srgb, var(--color-error) 8%, transparent)',
      }}
    >
      <ShieldCross size={18} variant="Bold" color="var(--color-error)" className="shrink-0 mt-0.5" />

      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-text-primary">
          VPN выключен
        </div>
        <div className="text-[12.5px] text-text-muted mt-0.5 leading-snug">
          Anthropic видит запросы из {countryLabel(info.country)}
          {info.ip && <span className="text-text-faint"> · {info.ip}</span>}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={check}
          disabled={checking}
          title="Проверить снова"
          className="w-8 h-8 rounded-lg grid place-items-center text-text-faint hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          <Refresh2 size={15} variant="Linear" color="currentColor" className={checking ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="px-2.5 h-8 rounded-lg text-[12.5px] text-text-faint hover:text-text-secondary hover:bg-surface-hover transition-colors"
        >
          Скрыть
        </button>
      </div>
    </div>
  )
}

/** Строка состояния сети для настроек — показывает страну всегда, без оценок */
export function NetworkStatusRow() {
  const [info, setInfo] = useState<NetworkInfo | null>(null)
  const [checking, setChecking] = useState(false)

  const check = async () => {
    setChecking(true)
    try { setInfo(await api.checkNetwork()) } catch {}
    setChecking(false)
  }

  useEffect(() => { check() }, [])

  return (
    <div className="flex items-center gap-2.5">
      <Global size={15} variant="Linear" color="var(--text-faint)" className="shrink-0" />
      <span className="text-[12.5px] text-text-muted tabular-nums">
        {checking && !info ? 'проверка…'
          : !info || info.offline ? 'сеть недоступна'
          : `${info.country ?? '—'}${info.ip ? ' · ' + info.ip : ''}`}
      </span>
      <button
        onClick={check}
        disabled={checking}
        title="Проверить снова"
        className="w-7 h-7 rounded-lg grid place-items-center text-text-faint hover:text-text-primary hover:bg-surface-hover transition-colors"
      >
        <Refresh2 size={14} variant="Linear" color="currentColor" className={checking ? 'animate-spin' : ''} />
      </button>
    </div>
  )
}
