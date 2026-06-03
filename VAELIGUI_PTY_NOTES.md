# VaeliGUI PTY Parsing — Notes & Technology

## Что выяснили

### Формат вывода claude TUI
- Ответ идёт как `● текст` (bullet + пробел + текст)
- Tool call: `● ToolName(args)` — на одной строке, иногда слито с `⎿  (No output)`
- Tool result: `⎿  текст` — отдельная строка (с xterm-headless правильно разделяется)
- Spinner thinking: `✻ Churned for 2s`, `* Calculating…` и т.д.
- Ready prompt: `← for agents`, `? for shortcuts`
- История: всегда присутствует на экране, claude перерисовывает весь TUI

### Почему история прёт
claude при каждом чанке перерисовывает весь экран через cursor positioning escape sequences.
stripAnsi не помогает — строки всё равно содержат историю.
cols=220 делает строки длинными и слитными.

### xterm-headless — правильное решение
- `@xterm/headless` v6.0.0 установлен
- Правильно эмулирует терминал, строки чистые
- `⎿` на отдельной строке (не слито с tool call)
- После `term.reset()` + send — первый чанк уже содержит наше сообщение и spinner
- cols=120, rows=50

### Стратегия стриминга с xterm
1. PTY данные → `term.write(data)`
2. После каждого чанка читаем экран: `term.buffer.active.getLine(i).translateToString(true)`
3. Сравниваем с предыдущим экраном — берём дельту
4. Детектируем появление новых строк:
   - `❯ наше_сообщение` → наш echo, сбрасываем "до нас" историю
   - `● ToolName(...)` → emit tool_use  
   - `⎿  результат` → emit tool_result
   - `● текст` (не tool) → emit streaming text
   - spinner → emit thinking
   - ready prompt → done
5. Это реальный стриминг — каждые ~100-200ms новый update

### Важно: term.reset() перед send
```js
term.reset()
proc.write(message + '\r')
```
После reset первый чанк содержит echo нашего сообщения — по нему детектируем начало ответа.

### Конфиги
- proton account: `C:\Users\reaya\.claude-accounts\proton`
- sY account: `C:\Users\reaya\.claude-accounts\sY`
- proton session (активная): `f012424c-6648-4356-a02e-2a11e502b3f5`
- Claude exe: `C:\Users\reaya\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`

### Текущий парсер (рабочий базовый)
В `PtySessionManager.ts` — берёт последний `●` блок после последнего `❯` перед ready.
Работает для простого текста, частично для tool use.
Проблема — история затягивается в tool use блоки.

### Следующий шаг
Переписать `PtyParser` на xterm-headless:
- Хранить `term: Terminal` внутри класса
- В `feed(data)` → `term.write(data)`, потом читать экран
- Сравнивать с `prevLines` — дельта = новые строки
- Парсить дельту: tool_use / tool_result / text / spinner
- При `reset()` → `term.reset()`

### Тестовые скрипты
- `pty-test.mjs` — базовый multi-message тест
- `pty-test2.mjs` — raw chunk dump с таймстампами (proton account)
- `pty-test3.mjs` — xterm-headless тест, показывает экран после каждого чанка
- `test-streamjson.mjs` — тест `--output-format stream-json` (нет стриминга, есть токен инфо)

### stream-json токены (для справки)
- Первый запуск (холодный кеш): ~$0.10, input_tokens: 3, cache_read: 0
- Второй запуск (тёплый кеш): ~$0.009, input_tokens: 3, cache_read: 28464
- Нет стриминга — ответ приходит целиком в конце
- PTY лучше по токенам — держит процесс живым, контекст один раз

### jsonl — не лайв
Проверили: claude пишет jsonl батчем в конце, не построчно.
Только метаданные (`ai-title`, `mode`) пишутся сразу.
Нельзя использовать для стриминга.

## Что работает прямо сейчас
- PTY запуск и resume сессии ✓
- Детекция ready prompt ✓
- Базовый текстовый ответ (`● текст`) ✓
- Детекция spinner / thinking_start ✓  
- Простые сообщения без tool use — работают чисто ✓
- Tool use выполняется (файл реально пишется) ✓
- Tool use блоки в UI — частично, история тянется

## Что не работает
- Tool use стриминг в реальном времени
- Лишние PS блоки из истории в UI
- Multi-line ответы иногда с мусором (spinner chars)
