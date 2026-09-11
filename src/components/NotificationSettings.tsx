import { useEffect, useState } from 'react'
import { Notification, Setting4, VolumeHigh, Timer1, Gallery, MusicPlay } from 'iconsax-reactjs'
import { Section, ToggleRow, Row, SliderRow, CornerPicker, PageHeader } from './SettingsComponents.js'
import { api } from '../lib/api.js'
import type { NotificationSettings, NotificationCorner } from '../hooks/useSettings.js'

// Схема угла показывает выбор картинкой — название дублируем в описании строки
const CORNER_LABEL: Record<NotificationCorner, string> = {
  'top-left':     'Сверху слева',
  'top-right':    'Сверху справа',
  'bottom-left':  'Снизу слева',
  'bottom-right': 'Снизу справа',
}

const CORNERS: { id: NotificationCorner; label: string }[] =
  (Object.keys(CORNER_LABEL) as NotificationCorner[]).map(id => ({ id, label: CORNER_LABEL[id] }))

interface Props {
  settings: NotificationSettings
  onChange: (next: NotificationSettings) => void
}

export function NotificationSettingsSection({ settings, onChange }: Props) {
  // Сколько карточек влезает на экран при текущем масштабе — считает main,
  // потому что размеры рабочей области знает только он
  const [screenMax, setScreenMax] = useState(8)
  // Список звуков читает main — чтобы добавленный в sounds файл появился здесь
  // сам, без пересборки
  const [sounds, setSounds] = useState<string[]>([])

  useEffect(() => {
    api.getNotificationSounds().then(setSounds).catch(() => {})
  }, [])

  useEffect(() => {
    api.getNotificationMaxStack(settings.scale).then(max => {
      setScreenMax(max)
      // Увеличили масштаб — на экран влезает меньше карточек, подрезаем
      if (settings.maxStack > max) onChange({ ...settings, maxStack: max })
    }).catch(() => {})
  }, [settings.scale])

  const patch = (p: Partial<NotificationSettings>) => onChange({ ...settings, ...p })

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Notification}
        title="Уведомления"
        desc="Карточки поверх других окон, когда Vael свёрнут или сессия работает в фоне"
      />

      <Section label="Основное" icon={Setting4}>
        <ToggleRow
          icon={Notification}
          label="Показывать уведомления"
          desc="Без этого остальные настройки ни на что не влияют"
          value={settings.enabled}
          onChange={v => patch({ enabled: v })}
        />
      </Section>

      {settings.enabled && (
        <>
          <Section label="Вид" icon={Gallery} desc="как выглядит и где появляется">
            <Row
              icon={Gallery}
              label="Позиция"
              desc={CORNER_LABEL[settings.corner]}
            >
              <CornerPicker
                value={settings.corner}
                options={CORNERS}
                onChange={v => patch({ corner: v })}
              />
            </Row>

            <SliderRow
              label="Ширина карточки"
              value={settings.width}
              min={260}
              max={520}
              step={10}
              unit=" px"
              onChange={v => patch({ width: v })}
            />

            <SliderRow
              label="Масштаб"
              desc="Размер текста и иконок"
              value={Math.round(settings.scale * 100)}
              min={80}
              max={150}
              step={5}
              unit="%"
              onChange={v => patch({ scale: v / 100 })}
            />

            <SliderRow
              label="Максимум в стопке"
              desc={`Больше ${screenMax} на этом экране не поместится`}
              value={settings.maxStack}
              min={1}
              max={screenMax}
              step={1}
              onChange={v => patch({ maxStack: v })}
            />
          </Section>

          <Section label="Время показа" icon={Timer1} desc="когда карточка исчезает">
            <ToggleRow
              icon={Timer1}
              label="Держать до ответа"
              desc="Карточка висит, пока её не закроешь или пока не откроешь Vael"
              value={settings.holdForever}
              onChange={v => patch({ holdForever: v })}
            />

            {!settings.holdForever && (
              <SliderRow
                label="Сколько висит"
                desc="Наведение курсора ставит таймер на паузу"
                value={settings.holdSeconds}
                min={2}
                max={30}
                step={1}
                unit=" с"
                onChange={v => patch({ holdSeconds: v })}
              />
            )}
          </Section>

          <Section label="Звук" icon={VolumeHigh}>
            <ToggleRow
              icon={VolumeHigh}
              label="Звук уведомления"
              desc="Проигрывать при появлении карточки"
              value={settings.soundEnabled}
              onChange={v => patch({ soundEnabled: v })}
            />

            {settings.soundEnabled && (
              <>
                <Row
                  icon={MusicPlay}
                  label="Мелодия"
                  desc="Файлы из папки sounds — добавь свой, появится здесь"
                >
                  <SoundPicker
                    value={settings.soundFile}
                    sounds={sounds}
                    volume={settings.soundVolume}
                    onChange={v => patch({ soundFile: v })}
                  />
                </Row>

                <SliderRow
                  label="Громкость"
                  value={Math.round(settings.soundVolume * 100)}
                  min={0}
                  max={100}
                  step={5}
                  unit="%"
                  onChange={v => patch({ soundVolume: v / 100 })}
                />
              </>
            )}
          </Section>

          {/* На узком окне колонки превью нет — проверить уведомления можно
              только отсюда. На широком блок скрыт: там для этого есть
              «Типы уведомлений» с вызовом каждого по отдельности */}
          <div className="xl:hidden">
            <Section label="Проверка" icon={Notification}>
              <Row
                label="Предпросмотр"
                desc="Покажет по карточке каждого типа — с текущими настройками"
              >
                <button
                  onClick={() => api.previewNotifications()}
                  className="px-3.5 py-2 rounded-xl bg-accent-wash border border-accent/25 text-[13px] font-medium text-accent hover:bg-accent/15 transition-colors"
                >
                  Показать
                </button>
              </Row>
            </Section>
          </div>
        </>
      )}
    </div>
  )
}

/** Имя файла без расширения — в списке оно читается лучше, чем «norification.mp3» */
function soundLabel(file: string): string {
  return file.replace(/\.[^.]+$/, '')
}

function SoundPicker({ value, sounds, volume, onChange }: {
  value: string
  sounds: string[]
  volume: number
  onChange: (v: string) => void
}) {
  if (sounds.length === 0) {
    return <span className="text-[12px] text-text-ghost">папка sounds пуста</span>
  }

  // Клик по уже выбранной мелодии — проигрываем её, чтобы можно было
  // послушать не дожидаясь реального уведомления
  const preview = (file: string) => {
    try {
      const audio = new Audio(`sounds/${file}`)
      audio.volume = Math.max(0, Math.min(1, volume))
      audio.play().catch(() => {})
    } catch {}
  }

  return (
    <div className="flex gap-1.5 flex-wrap justify-end max-w-[280px]">
      {sounds.map(f => (
        <button
          key={f}
          onClick={() => { onChange(f); preview(f) }}
          title="Выбрать и прослушать"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12.5px] font-medium transition-colors ${
            value === f
              ? 'border-accent/40 bg-accent-wash text-accent'
              : 'border-border-default text-text-muted hover:text-text-secondary hover:border-border-strong'
          }`}
        >
          <MusicPlay size={13} variant={value === f ? 'Bold' : 'Linear'} color="currentColor" />
          {soundLabel(f)}
        </button>
      ))}
    </div>
  )
}
