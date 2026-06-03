# VaeliGUI — Session Notes (04.06.2026)

## Проект

Electron приложение для общения с Claude через PTY.
Путь: `C:\Users\reaya\Documents\Github\vael\`
Запуск dev: `npm run electron:dev` (через `dev.mjs`)
Build: `npm run build` (vite + electron-build.mjs)
Аккаунт активный: proton, configDir `C:\Users\reaya\.claude-accounts\proton`
Сессия: `f012424c-6648-4356-a02e-2a11e502b3f5`

## Архитектура

```
electron/main.ts           — главный процесс, IPC хендлеры
electron/PtySessionManager.ts  — PTY + xterm-headless парсер (ГЛАВНЫЙ ФАЙЛ)
electron/PtyManager.ts     — contextPty (для /context команды)
electron/usageParser.ts    — парсинг usage из jsonl
shared/types.ts            — StreamEvent и другие типы
src/App.tsx                — главный компонент, useSession хук
src/hooks/useSession.ts    — обработка stream событий, состояние
src/components/ChatView.tsx    — рендер чата
src/components/MessageBubble.tsx  — рендер блоков (text, tool_use, diff)
src/components/InputBar.tsx    — поле ввода
```

## PTY парсер — как работает

`PtySessionManager` = `claudeRunner` в main.ts (переименован).

**Ключевая идея:**
1. Спавним `claude.exe --dangerously-skip-permissions --resume <sessionId>`
2. PTY данные → `xterm-headless Terminal` (cols=120, rows=50)
3. После каждого чанка читаем экран через `term.buffer.active.getLine(i)`
4. Находим последнее вхождение нашего echo (`> наше_сообщение`) — всё ниже него это контент текущего ответа
5. Сравниваем с `prevScreen` — берём только изменившиеся строки (delta)
6. Парсим delta построчно

**Паттерны в delta:**
- `✻ Churning…` / `* Baking…` → spinner → `assistant_streaming_start`
- `● ToolName(args)` → `tool_use` event (с дедупликацией)
- `⎿  result text` → `tool_result` event (с дедупликацией)
- `⎿  Added N lines` → начинаем сбор diff строк (`collectingDiff = true`)
- `17 -старое` / `17 +новое` → diff строки → `pty_tool_update` event
- `● текст` (не tool) → `assistant_streaming_text` event
- `← for agents` / `? for shortcuts` → `result` event (финализация)
- `31149 tokens` → `pty_tokens` event

**Дедупликация:** `emittedTools`, `emittedResults`, `emittedTexts` — Set'ы для предотвращения дублей при перерисовке экрана.

**Echo детекция:** `sentMessage.slice(-15)` — последние 15 символов уникальны, ищем снизу вверх.

**reset(sentMessage):** `term.reset()` + сброс всех полей — вызывается перед каждым send.

## Stream события (кастомные PTY)

| Event type | Что значит |
|---|---|
| `assistant_streaming_start` | Появился spinner, claude думает |
| `assistant_streaming_text` | Текст появляется в реальном времени (поле `text`) |
| `commit_streaming_text` | Зафиксировать текст перед tool call |
| `pty_tool_update` | Обновить input tool_use блока diff-ом (поле `tool_use_id`, `patch`) |
| `pty_tokens` | Счётчик токенов контекста (поле `count`) |
| `assistant` | Финальный assistant message (tool_use или text) |
| `user` | tool_result |
| `result` | Готово, финализация |

## Фронт — useSession.ts

`streamingTextCommittedRef` — флаг что текущий streaming text зафиксирован.
При `commit_streaming_text` → `streamingTextCommittedRef.current = true`.
При `assistant_streaming_text` — если флаг true → добавляем новый entry, иначе заменяем последний.

`ptyTokens` + `ptyTokensDelta` + `prevPtyTokensRef` — счётчик токенов с дельтой.

## Проблема ptyTokens не отображается

Добавлен `console.log('[useSession] pty_tokens:', count)` в обработчик.
Нужно запустить и проверить в DevTools → Console появляется ли лог.
Если нет — событие не доходит до фронта.
Токены в delta выглядят как `31149 tokens` (regex: `/^(\d+)\s+tokens$/`).

## UI над InputBar

```tsx
{ptyTokens !== null && (
  <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
    <span className="text-[11px] font-mono text-text-faint tabular-nums">
      {ptyTokens.toLocaleString()} ctx
    </span>
    {ptyTokensDelta !== null && ptyTokensDelta > 0 && (
      <span className="text-[11px] font-mono text-emerald-400/70 tabular-nums">
        +{ptyTokensDelta.toLocaleString()}
      </span>
    )}
  </div>
)}
```

Находится в `src/App.tsx` прямо над `<InputBar>` внутри `{sidebarTab === 'sessions' && ...}`.

## Тестовые скрипты

- `pty-test3.mjs` — xterm-headless тест, показывает экран после каждого чанка
- `pty-test2.mjs` — raw chunk dump с таймстампами

## Tool рендеринг в MessageBubble

`toolHeading` и `ToolDetail` — `Update` добавлен как алиас `Edit`.
`diffStats` — тоже поддерживает `Update`.
Input для tool_use: `{ command, file_path, pattern, query, url, args }` — все поля для всех инструментов.

## Git

Последний коммит: `feat: xterm-headless PTY parser with real-time tool streaming`
Branch: main, ahead of origin/main by 2 commits.
