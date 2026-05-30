# Vael — правила разработки

## Стек
Electron + React + TypeScript + Tailwind v4 + Vite

---

## Цвета — обязательные правила

### Фоны (4 уровня, только их)
| Класс Tailwind | CSS var | Значение | Когда использовать |
|---|---|---|---|
| `bg-bg-base` | `--bg-base` | #0a0a0a | Основной фон приложения |
| `bg-bg-sidebar` | `--bg-sidebar` | #0d0d0d | Фон сайдбара |
| `bg-bg-surface` | `--bg-surface` | #111111 | Карточки, попапы, модалы, панели настроек |
| `bg-bg-elevated` | `--bg-elevated` | #1a1a1a | Дропдауны, контекстные меню, тосты |

**Запрещено** использовать любые другие hex-значения серого/чёрного (`#141414`, `#161616`, `#1c1c1c`, `#1e1e1e` и т.д.) — всё сводить к ближайшему из четырёх.

### Текст — семантические токены (Tailwind v4)

Использовать `text-text-primary` и т.д. вместо `text-white/N`:

| Класс Tailwind | CSS var | Значение | Когда |
|---|---|---|---|
| `text-text-primary` | `--text-primary` | white/85 | Основной контент, сообщения |
| `text-text-secondary` | `--text-secondary` | white/70 | Лейблы, описания |
| `text-text-muted` | `--text-muted` | white/40 | Плейсхолдеры, заголовки секций |
| `text-text-faint` | `--text-faint` | white/25 | Метаданные, временны́е метки |
| `text-text-ghost` | `--text-ghost` | white/15 | Disabled, разделители |

Не использовать raw `text-white/N` в новом коде. Исключения: `text-white` (100%), `text-white/90` (near-full).

### Границы — семантические токены

| Класс Tailwind | CSS var | Значение | Когда |
|---|---|---|---|
| `border-border-subtle` | `--border-subtle` | white/5 | Разделители app shell (сайдбар, header) |
| `border-border-default` | `--border-default` | white/8 | Границы компонентов (карточки, инпуты) |
| `border-border-strong` | `--border-strong` | white/15 | Активные/focused границы |

### Интерактивные состояния — семантические токены

| Класс Tailwind | CSS var | Значение | Когда |
|---|---|---|---|
| `bg-surface-hover` | `--surface-hover` | white/6 | Hover |
| `bg-surface-selected` | `--surface-selected` | white/8 | Selected / open state |
| `bg-surface-active` | `--surface-active` | white/15 | Active / pressed |

### Формат theme JSON (для будущих тем)

```json
{
  "name": "Dark Default",
  "vars": {
    "--bg-base": "#0a0a0a",
    "--bg-sidebar": "#0d0d0d",
    "--bg-surface": "#111111",
    "--bg-elevated": "#1a1a1a",
    "--text-primary": "rgba(255,255,255,0.85)",
    "--text-secondary": "rgba(255,255,255,0.70)",
    "--text-muted": "rgba(255,255,255,0.40)",
    "--text-faint": "rgba(255,255,255,0.25)",
    "--text-ghost": "rgba(255,255,255,0.15)",
    "--border-subtle": "rgba(255,255,255,0.05)",
    "--border-default": "rgba(255,255,255,0.08)",
    "--border-strong": "rgba(255,255,255,0.15)",
    "--surface-hover": "rgba(255,255,255,0.06)",
    "--surface-selected": "rgba(255,255,255,0.08)",
    "--surface-active": "rgba(255,255,255,0.15)",
    "--accent": "#8b5cf6",
    "--accent-dim": "rgba(139,92,246,0.20)"
  }
}
```

### Акцент
- Фиолетовый: `violet-400` / `violet-500` / `violet-600` — основной акцент
- Зелёный: `emerald-*` — только для diff +added строк
- Красный: `red-*` — только для diff -removed строк и ошибок
- `#f87171`, `#fbbf24` — только внутри `ringColor()` в UsageCircles (предупреждения лимита)

### Inline SVG
Для `stroke` / `fill` в SVG можно использовать `rgba(255,255,255,0.1)` — там Tailwind не работает.

---

## Архитектура

### IPC (Electron ↔ Renderer)
- `main.ts` — `ipcMain.handle(...)` регистрирует обработчики
- `preload.ts` — пробрасывает через `contextBridge` как `window.api`
- `src/lib/api.ts` — типизированная обёртка с интерфейсом `ElectronAPI`

При добавлении нового IPC: добавить в все три файла.

### Вкладки (sidebarTab)
`sessions` | `pyre` | `console` — независимые, рендерятся через условный рендер в App.tsx. InputBar показывается только на `sessions`.

### Usage / Context данные
- Приходят через `usage:data` IPC событие → `api.onUsageData`
- `UsageCircles` подписывается в useEffect + дёргает `api.getCachedUsage()` при монте
- Usage = глобальный (показывается без сессии), Context = только при активной сессии

---

## Компоненты

Новые компоненты — в `src/components/`. Логика стейта — в `src/hooks/`.

Не определять компоненты с хуками (useState/useEffect) внутри других компонентов — вызывает ремаунт при каждом рендере.
