export interface Account {
  id: string
  name: string
  configDir: string
  email?: string
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

// Raw .jsonl entry types
export type JsonlEntry =
  | UserEntry
  | AssistantEntry
  | ToolUseEntry
  | ToolResultEntry
  | ResultEntry
  | SystemEntry
  | ErrorEntry

export interface ErrorEntry {
  type: 'error_bubble'
  message: string
  known: boolean
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

// Stream-json event from live claude run
export interface StreamEvent {
  type: string
  subtype?: string
  message?: AssistantEntry['message']
  tool_use_id?: string
  content?: string | ContentBlock[]
  usage?: UsageInfo
  session_id?: string
  error?: string
}

export type SyncStatus = 'idle' | 'syncing' | 'running' | 'error'

export interface AppState {
  accounts: Account[]
  activeAccountId: string
  sessions: Session[]
  activeSessionId: string | null
  syncStatus: SyncStatus
  syncMessage?: string
}
