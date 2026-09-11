import { useEffect, useState } from 'react'
import { Notification, VolumeHigh, Timer1, MessageQuestion, TickCircle, CloseCircle, Play } from 'iconsax-reactjs'
import { api } from '../lib/api.js'
import type { NotificationSettings } from '../hooks/useSettings.js'

/**
 * Макет экрана с уведомлениями рядом с настройками.
 *
 * Показывает рабочий стол целиком, а не карточку в вакууме: угол, в котором
 * растёт стопка, её высота и размер карточки видны одним элементом — отдельная
 * схема угла для этого больше не нужна.
 *
 * Карточка повторяет вёрстку из electron/notification.html (те же размеры,
 * цвета и формула масштабирования). Это макет, а не общий компонент: настоящая
 * карточка живёт в отдельном BrowserWindow, React в ней недоступен — меняешь
 * там, поправь и здесь.
 */

const KIND = {
  asking: {
    accent: '#d97757',
    icon: MessageQuestion,
    name: 'Вопрос',
    when: 'Сессия ждёт твоего ответа',
    title: 'Рефакторинг сессий',
    body: 'Ждёт ответа на вопрос',
  },
  done: {
    accent: '#4ade80',
    icon: TickCircle,
    name: 'Готово',
    when: 'Claude закончил и ответил',
    title: 'Сборка проекта',
    body: 'Готово: ошибок нет',
  },
  error: {
    accent: '#e26d6d',
    icon: CloseCircle,
    name: 'Ошибка',
    when: 'Процесс упал или прервался',
    title: 'Тесты',
    body: 'Процесс завершился с кодом 1',
  },
} as const

type Kind = keyof typeof KIND

/** Ширина «монитора» в макете, px. Высота считается из пропорций экрана. */
const SCREEN_W = 390
/** Поле от края экрана до стопки — как MARGIN в NotificationWindow.ts */
const REAL_MARGIN = 16
/** Высота панели задач в реальных пикселях — рабочая область на неё меньше */
const TASKBAR_H = 48

function Card({ kind, settings, k: scale }: { kind: Kind; settings: NotificationSettings; k: number }) {
  const kd = KIND[kind]
  // s — масштаб содержимого карточки из настроек, scale — усадка макета
  const s = settings.scale

  return (
    <div
      className="relative flex items-center shrink-0 overflow-hidden"
      style={{
        width: settings.width * scale,
        height: 78 * s * scale,
        gap: 12 * scale,
        padding: `${12 * s * scale}px ${14 * s * scale}px`,
        background: '#141414',
        border: `${Math.max(0.5, scale)}px solid #262626`,
        borderRadius: 10 * scale,
        boxShadow: `0 ${8 * scale}px ${24 * scale}px rgba(0,0,0,.55)`,
      }}
    >
      {/* цветная полоса типа события */}
      <span
        className="absolute left-0"
        style={{
          top: 12 * scale,
          bottom: 12 * scale,
          width: Math.max(1, 3 * scale),
          borderRadius: `0 ${3 * scale}px ${3 * scale}px 0`,
          background: kd.accent,
        }}
      />

      <div
        className="grid place-items-center shrink-0"
        style={{
          width: 34 * s * scale,
          height: 34 * s * scale,
          borderRadius: 8 * scale,
          background: `color-mix(in srgb, ${kd.accent} 14%, transparent)`,
        }}
      >
        <Notification size={Math.max(6, 18 * s * scale)} variant="Bold" color={kd.accent} />
      </div>

      <div className="flex-1 min-w-0" style={{ paddingRight: 26 * s * scale }}>
        <div
          className="font-semibold truncate"
          style={{ fontSize: Math.max(5, 13 * s * scale), color: '#ededed', lineHeight: 1.25 }}
        >
          {kd.title}
        </div>
        <div
          className="truncate"
          style={{ fontSize: Math.max(4.5, 11.5 * s * scale), color: '#8a8a8a', marginTop: 2 * scale, lineHeight: 1.3 }}
        >
          {kd.body}
        </div>
      </div>

      {/* кольцо таймера — в бессрочном режиме остаётся полным */}
      <div
        className="absolute"
        style={{ top: 8 * s * scale, right: 8 * s * scale, width: 20 * s * scale, height: 20 * s * scale }}
      >
        <svg viewBox="0 0 20 20" style={{ transform: 'rotate(-90deg)', display: 'block' }}>
          <circle cx="10" cy="10" r="8" fill="none" strokeWidth="2" stroke="#2e2e2e" />
          <circle
            cx="10" cy="10" r="8" fill="none" strokeWidth="2" strokeLinecap="round"
            stroke={kd.accent}
            strokeDasharray={2 * Math.PI * 8}
            strokeDashoffset={settings.holdForever ? 0 : 2 * Math.PI * 8 * 0.35}
          />
        </svg>
      </div>
    </div>
  )
}

export function NotificationPreview({ settings }: { settings: NotificationSettings }) {
  // Рабочую область берём у main — там же, где считается позиция настоящего
  // окна. Захардкоженные 1920 врали при масштабировании Windows: система
  // отдаёт логические пиксели, их меньше физических, и карточка занимает
  // заметно бо́льшую долю экрана, чем показывал макет
  const [screen, setScreen] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    api.getNotificationWorkArea()
      .then(r => setScreen({ width: r.width, height: r.height }))
      .catch(() => {})
  }, [])

  if (!settings.enabled) return <NotificationPreviewDisabled />

  // Полная высота экрана: workArea уже без панели задач, а её мы рисуем сами
  const realW = screen?.width ?? 1920
  const realH = (screen?.height ?? 1032) + TASKBAR_H

  // Во сколько раз макет мельче настоящего экрана — на него множится всё,
  // что задано в реальных пикселях
  const scale = SCREEN_W / realW

  const right = settings.corner.endsWith('right')
  const top = settings.corner.startsWith('top')

  // Показываем не больше того, что реально влезет в стопку
  const cards: Kind[] = (['asking', 'done', 'error'] as const).slice(0, Math.max(1, Math.min(3, settings.maxStack)))

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline justify-between mb-2.5 px-0.5">
          <span className="text-[12px] font-semibold text-text-muted uppercase tracking-[0.08em]">
            Как это выглядит
          </span>
          <span className="text-[11px] text-text-ghost tabular-nums">
            {realW}×{realH}
          </span>
        </div>

        {/* Монитор: рамка + подставка, внутри — рабочий стол */}
        <div className="rounded-xl border border-border-default bg-bg-surface p-2.5 pb-2">
          <div
            className="relative overflow-hidden rounded-md"
            style={{
              width: '100%',
              aspectRatio: `${realW} / ${realH}`,
              // «обои» — тёмный градиент, чтобы карточки читались как поверх стола
              background: 'linear-gradient(145deg, #1b1a19 0%, #121110 55%, #0d0c0c 100%)',
            }}
          >
            {/* блик, чтобы плоскость не выглядела просто заливкой */}
            <div
              className="absolute inset-0 pointer-events-none opacity-40"
              style={{ background: 'radial-gradient(120% 80% at 15% 0%, rgba(255,255,255,0.05), transparent 60%)' }}
            />

            {/* панель задач — задаёт низ экрана и масштаб */}
            <div
              className="absolute left-0 right-0 bottom-0 border-t border-white/5 bg-black/40 flex items-center justify-center gap-1"
              style={{ height: Math.max(5, TASKBAR_H * scale) }}
            >
              {[0, 1, 2].map(i => (
                <span key={i} className="rounded-[1px] bg-white/15" style={{ width: 4, height: 4 }} />
              ))}
            </div>

            {/* стопка уведомлений в выбранном углу */}
            <div
              className="absolute flex"
              style={{
                [right ? 'right' : 'left']: REAL_MARGIN * scale,
                // Снизу стопка стоит над панелью задач: main позиционирует окно
                // по workArea, а она панель уже не включает
                [top ? 'top' : 'bottom']: (top ? REAL_MARGIN : REAL_MARGIN + TASKBAR_H) * scale,
                flexDirection: top ? 'column' : 'column-reverse',
                gap: 8 * scale,
                alignItems: right ? 'flex-end' : 'flex-start',
              }}
            >
              {cards.map(k => (
                <Card key={k} kind={k} settings={settings} k={scale} />
              ))}
            </div>

            {settings.maxStack > cards.length && (
              <div
                className="absolute text-[9px] text-white/25 tabular-nums"
                style={{
                  [right ? 'right' : 'left']: REAL_MARGIN * scale,
                  [top ? 'bottom' : 'top']: 6,
                }}
              >
                до {settings.maxStack} в стопке
              </div>
            )}
          </div>

          {/* подставка монитора */}
          <div className="flex flex-col items-center pt-1.5">
            <div className="w-10 h-[3px] rounded-full bg-border-default" />
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2.5 px-0.5">
          <span className="text-[12px] font-semibold text-text-muted uppercase tracking-[0.08em]">
            Типы уведомлений
          </span>
          <button
            onClick={() => api.previewNotifications()}
            className="text-[11.5px] text-text-faint hover:text-accent transition-colors"
          >
            показать все
          </button>
        </div>
        <div className="rounded-2xl border border-border-default bg-bg-surface overflow-hidden divide-y divide-white/[0.07]">
          {(['asking', 'done', 'error'] as Kind[]).map(kind => (
            <KindRow key={kind} kind={kind} />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border-subtle bg-bg-surface px-3.5 py-3 space-y-2">
        <div className="flex items-center gap-2 text-[12.5px] text-text-muted">
          <Timer1 size={15} variant="Linear" color="var(--text-faint)" className="shrink-0" />
          {settings.holdForever
            ? 'Висит до клика или открытия Vael'
            : `Исчезает через ${settings.holdSeconds} с`}
        </div>
        <div className="flex items-center gap-2 text-[12.5px] text-text-muted">
          <VolumeHigh size={15} variant="Linear" color="var(--text-faint)" className="shrink-0" />
          {settings.soundEnabled
            ? `Звук ${Math.round(settings.soundVolume * 100)}%`
            : 'Без звука'}
        </div>
        <div className="flex items-center gap-2 text-[12.5px] text-text-muted">
          <Notification size={15} variant="Linear" color="var(--text-faint)" className="shrink-0" />
          {settings.width}px · масштаб {Math.round(settings.scale * 100)}%
        </div>
      </div>
    </div>
  )
}

/** Строка типа события: цвет, когда прилетает, и кнопка показать вживую */
function KindRow({ kind }: { kind: Kind }) {
  const k = KIND[kind]

  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <div
        className="w-8 h-8 rounded-lg grid place-items-center shrink-0"
        style={{ background: `color-mix(in srgb, ${k.accent} 14%, transparent)` }}
      >
        <k.icon size={16} variant="Bold" color={k.accent} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-text-primary leading-snug">{k.name}</div>
        <div className="text-[12px] text-text-muted mt-0.5 leading-snug">{k.when}</div>
      </div>

      <button
        onClick={() => api.previewNotification(kind)}
        title="Показать это уведомление"
        aria-label={`Показать: ${k.name}`}
        className="shrink-0 w-8 h-8 rounded-lg grid place-items-center text-text-faint hover:text-text-primary hover:bg-surface-hover transition-colors"
      >
        <Play size={15} variant="Bold" color="currentColor" />
      </button>
    </div>
  )
}

/** Заглушка, когда уведомления выключены — вместо пустой колонки */
export function NotificationPreviewDisabled() {
  return (
    <div className="rounded-2xl border border-dashed border-border-default px-5 py-10 text-center">
      <Notification size={26} variant="Linear" color="var(--text-ghost)" className="mx-auto mb-2.5" />
      <p className="text-[13px] text-text-ghost leading-snug">
        Уведомления выключены — карточки не появятся
      </p>
    </div>
  )
}
