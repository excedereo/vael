import { useEffect, useState } from 'react'
import { Notification, Setting4, VolumeHigh, Timer1, Gallery, MusicPlay } from 'iconsax-reactjs'
import { Section, ToggleRow, Row, SliderRow, CornerPicker, PageHeader } from './SettingsComponents.js'
import { api } from '../lib/api.js'
import type { NotificationSettings, NotificationCorner } from '../hooks/useSettings.js'
import { t } from '../lib/i18n.js'

// Схема угла показывает выбор картинкой — название дублируем в описании строки
const CORNER_LABEL: Record<NotificationCorner, string> = {
  'top-left':     t("Сверху слева", "Top left"),
  'top-right':    t("Сверху справа", "Top right"),
  'bottom-left':  t("Снизу слева", "Bottom left"),
  'bottom-right': t("Снизу справа", "Bottom right"),
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
        title={t("Уведомления", "Notifications")}
        desc={t("Карточки поверх других окон, когда Vael свёрнут или сессия работает в фоне", "Cards on top of other windows when Vael is minimized or a session runs in the background")}
      />

      <Section label={t("Основное", "General")} icon={Setting4}>
        <ToggleRow
          icon={Notification}
          label={t("Показывать уведомления", "Show notifications")}
          desc={t("Без этого остальные настройки ни на что не влияют", "Without this the other settings have no effect")}
          value={settings.enabled}
          onChange={v => patch({ enabled: v })}
        />
      </Section>

      {settings.enabled && (
        <>
          <Section label={t("Вид", "Look")} icon={Gallery} desc={t("как выглядит и где появляется", "how it looks and where it appears")}>
            <Row
              icon={Gallery}
              label={t("Позиция", "Position")}
              desc={CORNER_LABEL[settings.corner]}
            >
              <CornerPicker
                value={settings.corner}
                options={CORNERS}
                onChange={v => patch({ corner: v })}
              />
            </Row>

            <SliderRow
              label={t("Ширина карточки", "Card width")}
              value={settings.width}
              min={260}
              max={520}
              step={10}
              unit=" px"
              onChange={v => patch({ width: v })}
            />

            <SliderRow
              label={t("Масштаб", "Scale")}
              desc={t("Размер текста и иконок", "Text and icon size")}
              value={Math.round(settings.scale * 100)}
              min={80}
              max={150}
              step={5}
              unit="%"
              onChange={v => patch({ scale: v / 100 })}
            />

            <SliderRow
              label={t("Максимум в стопке", "Max in a stack")}
              desc={t(`Больше ${screenMax} на этом экране не поместится`, `No more than ${screenMax} fit on this screen`)}
              value={settings.maxStack}
              min={1}
              max={screenMax}
              step={1}
              onChange={v => patch({ maxStack: v })}
            />
          </Section>

          <Section label={t("Время показа", "Display time")} icon={Timer1} desc={t("когда карточка исчезает", "when the card disappears")}>
            <ToggleRow
              icon={Timer1}
              label={t("Держать до ответа", "Keep until answered")}
              desc={t("Карточка висит, пока её не закроешь или пока не откроешь Vael", "The card stays until you close it or open Vael")}
              value={settings.holdForever}
              onChange={v => patch({ holdForever: v })}
            />

            {!settings.holdForever && (
              <SliderRow
                label={t("Сколько висит", "How long it stays")}
                desc={t("Наведение курсора ставит таймер на паузу", "Hovering pauses the timer")}
                value={settings.holdSeconds}
                min={2}
                max={30}
                step={1}
                unit={t(" с", " s")}
                onChange={v => patch({ holdSeconds: v })}
              />
            )}
          </Section>

          <Section label={t("Звук", "Sound")} icon={VolumeHigh}>
            <ToggleRow
              icon={VolumeHigh}
              label={t("Звук уведомления", "Notification sound")}
              desc={t("Проигрывать при появлении карточки", "Play when a card appears")}
              value={settings.soundEnabled}
              onChange={v => patch({ soundEnabled: v })}
            />

            {settings.soundEnabled && (
              <>
                <Row
                  icon={MusicPlay}
                  label={t("Мелодия", "Tune")}
                  desc={t("Файлы из папки sounds — добавь свой, появится здесь", "Files from the sounds folder — add your own and it shows up here")}
                >
                  <SoundPicker
                    value={settings.soundFile}
                    sounds={sounds}
                    volume={settings.soundVolume}
                    onChange={v => patch({ soundFile: v })}
                  />
                </Row>

                <SliderRow
                  label={t("Громкость", "Volume")}
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
            <Section label={t("Проверка", "Test")} icon={Notification}>
              <Row
                label={t("Предпросмотр", "Preview")}
                desc={t("Покажет по карточке каждого типа — с текущими настройками", "Shows a card of each type — with the current settings")}
              >
                <button
                  onClick={() => api.previewNotifications()}
                  className="px-3.5 py-2 rounded-xl bg-accent-wash border border-accent/25 text-[13px] font-medium text-accent hover:bg-accent/15 transition-colors"
                >
                  {t("Показать", "Show")}
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
    return <span className="text-[12px] text-text-ghost">{t("папка sounds пуста", "sounds folder is empty")}</span>
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
          title={t("Выбрать и прослушать", "Pick and listen")}
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
