import { useEffect, useState } from 'react'
import { setLang, systemLang, type Lang } from '../lib/i18n.js'
import { WindowControls } from './WindowControls.js'
import logo from '../assets/logo.svg'

const OPTIONS: { id: Lang; label: string; hint: string }[] = [
  { id: 'en', label: 'English', hint: 'Interface in English' },
  { id: 'ru', label: 'Русский', hint: 'Интерфейс на русском' },
]

/** Самый первый экран: выбор языка. Потом его можно сменить в настройках */
export function LanguageScreen() {
  const [pick, setPick] = useState<Lang>(systemLang())

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Enter') setLang(pick)
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') setPick(p => (p === 'en' ? 'ru' : 'en'))
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [pick])

  return (
    <div className="fixed inset-0 bg-bg-base flex flex-col">
      <div className="h-11 shrink-0 flex items-stretch">
        <div className="flex-1 app-drag-region" />
        <WindowControls />
      </div>

      <div className="flex-1 flex items-center justify-center px-6 pb-11">
        <div className="w-[360px] max-w-full flex flex-col items-center text-center">
          <img src={logo} alt="" width={64} height={64} draggable={false} className="select-none" />
          <h1 className="mt-5 text-[22px] font-medium text-text-primary">Vael</h1>
          <p className="mt-1.5 text-[13.5px] text-text-muted">Choose your language · Выберите язык</p>

          <div className="mt-6 w-full flex flex-col gap-2">
            {OPTIONS.map(o => (
              <button
                key={o.id}
                onClick={() => setLang(o.id)}
                onMouseEnter={() => setPick(o.id)}
                className="acc-card !flex-row items-center !py-3 !px-4 text-left transition-colors"
                style={pick === o.id ? { borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)' } : undefined}
              >
                <div className="flex-1">
                  <div className="text-[14.5px] font-medium text-text-primary">{o.label}</div>
                  <div className="text-[12.5px] text-text-muted">{o.hint}</div>
                </div>
                {pick === o.id && <kbd className="text-[11px] text-text-faint border border-border-strong rounded-md px-1.5">Enter</kbd>}
              </button>
            ))}
          </div>
          <p className="mt-4 text-[12px] text-text-faint">You can change it later in Settings · Можно сменить в настройках</p>
        </div>
      </div>
    </div>
  )
}
