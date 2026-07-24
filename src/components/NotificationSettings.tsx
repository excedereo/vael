import { useEffect, useState } from 'react'
import { Section, ToggleRow } from './SettingsComponents.js'
import { api } from '../lib/api.js'
import type { NotificationSettings, NotificationCorner } from '../hooks/useSettings.js'

const CORNERS: { id: NotificationCorner; label: string }[] = [
  { id: 'bottom-left',  label: 'Снизу слева' },
  { id: 'bottom-right', label: 'Снизу справа' },
  { id: 'top-right',    label: 'Сверху справа' },
]

interface Props {
  settings: NotificationSettings
  onChange: (next: NotificationSettings) => void
}

export function NotificationSettingsSection({ settings, onChange }: Props) {
  // Сколько карточек влезает на экран при текущем масштабе — считает main,
  // потому что размеры рабочей области знает только он
  const [screenMax, setScreenMax] = useState(8)

  useEffect(() => {
    api.getNotificationMaxStack(settings.scale).then(max => {
      setScreenMax(max)
      // Увеличили масштаб — на экран влезает меньше карточек, подрезаем
      if (settings.maxStack > max) onChange({ ...settings, maxStack: max })
    }).catch(() => {})
  }, [settings.scale])

  const patch = (p: Partial<NotificationSettings>) => onChange({ ...settings, ...p })

  return (
    <Section label="Уведомления">
      <ToggleRow
        label="Показывать уведомления"
        desc="Поверх других окон, когда Vael свёрнут или сессия в фоне"
        value={settings.enabled}
        onChange={v => patch({ enabled: v })}
      />

      {settings.enabled && (
        <>
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-text-primary">Позиция</span>
              <span className="text-xs text-text-muted">Угол экрана, где появляются карточки</span>
            </div>
            <CornerPicker value={settings.corner} onChange={v => patch({ corner: v })} />
          </div>

          <NumberRow
            label="Ширина"
            desc="Ширина карточки"
            value={settings.width}
            min={260}
            max={520}
            step={10}
            unit="px"
            onChange={v => patch({ width: v })}
          />

          <NumberRow
            label="Масштаб"
            desc="Размер текста и иконок"
            value={Math.round(settings.scale * 100)}
            min={80}
            max={150}
            step={5}
            unit="%"
            onChange={v => patch({ scale: v / 100 })}
          />

          <NumberRow
            label="Максимум в стопке"
            desc={`Больше ${screenMax} не поместится на этом экране`}
            value={settings.maxStack}
            min={1}
            max={screenMax}
            step={1}
            onChange={v => patch({ maxStack: v })}
          />

          <NumberRow
            label="Время показа"
            desc="Сколько висит без наведения"
            value={settings.holdSeconds}
            min={2}
            max={30}
            step={1}
            unit="с"
            onChange={v => patch({ holdSeconds: v })}
          />

          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-text-primary">Предпросмотр</span>
              <span className="text-xs text-text-muted">Показать пример каждого типа</span>
            </div>
            <button
              onClick={() => api.previewNotifications()}
              className="px-3 py-1.5 rounded-lg border border-border-default text-[13px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors"
            >
              Показать
            </button>
          </div>
        </>
      )}
    </Section>
  )
}

function CornerPicker({ value, onChange }: { value: NotificationCorner; onChange: (v: NotificationCorner) => void }) {
  return (
    <div className="flex gap-1">
      {CORNERS.map(c => (
        <button
          key={c.id}
          onClick={() => onChange(c.id)}
          className={`px-2.5 py-1.5 rounded-lg border text-[12px] transition-colors ${
            value === c.id
              ? 'border-border-strong bg-bg-elevated text-text-primary'
              : 'border-border-default text-text-muted hover:text-text-secondary'
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}

function NumberRow({ label, desc, value, min, max, step, unit, onChange }: {
  label: string
  desc?: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v))

  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm text-text-primary">{label}</span>
        {desc && <span className="text-xs text-text-muted">{desc}</span>}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.min(value, max)}
          onChange={e => onChange(clamp(Number(e.target.value)))}
          className="w-28 accent-[var(--accent,#a78bfa)]"
        />
        <span className="text-sm text-text-primary tabular-nums w-12 text-right">
          {value}{unit ?? ''}
        </span>
      </div>
    </div>
  )
}
