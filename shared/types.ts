// shared/types.ts — единственный источник типов для main и renderer process

export interface Account {
  id: string
  name: string
  configDir: string
}

export interface Session {
  id: string
  projectPath: string
  projectName: string
  accountId: string
  lastModified: number
  createdAt: number
  messageCount: number
  title?: string
  /** Пользовательские метаданные из <id>.meta.json */
  archived?: boolean
  tags?: string[]
  order?: number
}

/** Содержимое <id>.meta.json — пользовательская надстройка над сессией */
export interface SessionMeta {
  customTitle?: string
  archived?: boolean
  tags?: string[]
  /** позиция в режиме «свой порядок»; меньше — выше */
  order?: number
}

export type SyncStatus = 'idle' | 'syncing' | 'running' | 'error'

// ── JSONL entries ─────────────────────────────────────────────────────────────

export type JsonlEntry =
  | UserEntry
  | AssistantEntry
  | ToolUseEntry
  | ToolResultEntry
  | ResultEntry
  | SystemEntry
  | ErrorEntry
  | CompactBoundaryEntry
  | TuiUsageEntry

export interface TuiUsageEntry {
  type: 'tui_usage'
  data: UsageData
}

export interface UserEntry {
  type: 'user'
  message: { role: 'user'; content: string | ContentBlock[] }
  timestamp?: string
  uuid?: string
}

export interface AssistantEntry {
  type: 'assistant'
  message: { role: 'assistant'; content: ContentBlock[] }
  timestamp?: string
  uuid?: string
}

export interface ToolUseEntry {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
  timestamp?: string
}

export interface ToolResultEntry {
  type: 'tool_result'
  tool_use_id: string
  content: string | ContentBlock[]
  timestamp?: string
}

export interface ResultEntry {
  type: 'result'
  subtype: string
  duration_ms?: number
  usage?: UsageInfo
  timestamp?: string
}

export interface SystemEntry {
  type: 'system'
  subtype: string
  session_id?: string
  timestamp?: string
}

export interface ErrorEntry {
  type: 'error_bubble'
  message: string
  known: boolean
}

export interface CompactBoundaryEntry {
  type: 'compact_boundary'
  pre_tokens: number
  post_tokens: number
  trigger: string
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string | ContentBlock[]
}

export interface UsageInfo {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export interface UsageData {
  sessionPct: number
  sessionResets: string
  weeklyPct: number
  weeklyResets: string
}

export interface ContextData {
  used: string
  total: string
  pct: number
  categories: Array<{ name: string; tokens: string; pct: number }>
  cacheHit?: boolean | null
  cacheReadTokens?: number
  cacheCreatedTokens?: number
}

// ── Stream events — discriminated union ──────────────────────────────────────

export type StreamEvent =
  | { type: 'system'; subtype: string; status?: string | null; compact_result?: string; compact_metadata?: CompactMetadata; attempt?: number; max_retries?: number; error_status?: number | null; error?: string; session_id?: string }
  | { type: 'result'; subtype: string; usage?: UsageInfo; duration_ms?: number }
  | { type: 'error'; error: string }
  | { type: 'assistant'; message: AssistantEntry['message'] }
  | { type: 'user'; message: UserEntry['message'] }

export interface CompactMetadata {
  pre_tokens?: number
  post_tokens?: number
  trigger?: string
}

// ── Chat mode (stream-json) ───────────────────────────────────────────────────

/** Элемент ленты чата: и история из jsonl, и живой поток рисуются из него */
/** Файл, который CLI вернул в контекст после сжатия: целиком (lines) или только именем (ref) */
export interface CompactFile { path: string; lines?: number; ref?: boolean }
/** Хвост jsonl сразу после компакта */
export interface CompactTail { files: CompactFile[]; summary: string | null }
/** Один пересказ сессии */
export interface CompactSummary { at?: number; before?: number; after?: number; summary: string }

export type ChatItem =
  | { kind: 'user'; key: string; text: string; attachments?: string[]; pending?: boolean; at?: number }
  | { kind: 'text'; key: string; text: string; at?: number }
  | { kind: 'thinking'; key: string; done: boolean }
  | { kind: 'tool'; key: string; id: string; name: string; input: unknown; result?: string; isError?: boolean; done?: boolean }
  | { kind: 'note'; key: string; text: string; markdown?: boolean }
  | { kind: 'divider'; key: string; text: string }
  /** Сжатие контекста: идёт / сжато (было → стало) / не вышло */
  | { kind: 'compact'; key: string; state: 'running' | 'done' | 'failed'; startedAt?: number; before?: number; after?: number; error?: string; files?: CompactFile[]; summary?: string }
  | { kind: 'meta'; key: string; text: string; stats?: TurnStats }
  | { kind: 'error'; key: string; text: string }

/** Итог хода: из чего сложилась его цена */
export interface TurnStats {
  sec: number
  /** новый вход: input + запись в кэш */
  input: number
  /** чтение из кэша по всем запросам хода */
  cache: number
  output: number
  requests: number
}

export interface ChatHistory {
  items: ChatItem[]
  /** размер контекста по последнему запросу, если он есть в jsonl */
  contextTokens: number | null
  model: string | null
}

/**
 * Вложение к сообщению чата. Картинки и PDF уходят блоками прямо в сообщение,
 * текст — содержимым; что не влезает или бинарное — путём, его прочитает сама модель
 */
export type ChatAttachment =
  | { kind: 'image'; name: string; size: number; mediaType: string; data: string }
  | { kind: 'pdf'; name: string; size: number; data: string }
  | { kind: 'text'; name: string; size: number; text: string; path?: string }
  | { kind: 'path'; name: string; size: number; path: string; reason: string }

export interface ChatStartOptions {
  /** null — новая сессия, id сгенерирует main */
  sessionId: string | null
  configDir: string | null
  model?: string
  effort?: string
  permissionMode?: string
}

// ── Module types ──────────────────────────────────────────────────────────────

export interface ModuleInfo {
  id: string
  name: string
  running: boolean
  settings: Record<string, unknown> | null
}
