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
  messageCount: number
  title?: string
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
  | { type: 'assistant_streaming_start' }
  | { type: 'assistant_streaming_text'; text: string }
  | { type: 'commit_streaming_text' }
  | { type: 'pty_tool_update'; tool_use_id: string; patch: Record<string, string> }
  | { type: 'pty_final_message'; entry: AssistantEntry }
  | { type: 'pty_tokens'; count: number }
  | { type: 'pty_tui_screen'; text: string }
  | { type: 'result'; subtype: string; usage?: UsageInfo; duration_ms?: number }
  | { type: 'error'; error: string }
  | { type: 'assistant'; message: AssistantEntry['message'] }
  | { type: 'user'; message: UserEntry['message'] }

export interface CompactMetadata {
  pre_tokens?: number
  post_tokens?: number
  trigger?: string
}

// ── Module types ──────────────────────────────────────────────────────────────

export interface ModuleInfo {
  id: string
  name: string
  running: boolean
  settings: Record<string, unknown> | null
}
