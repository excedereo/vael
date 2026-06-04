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
}

export function stripAnsi(s: string): string {
  return s
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')   // OSC sequences
    .replace(/\x1B\[[0-9;]*[HfABCDEFGST]/g, '\n')          // cursor movement → newline (TUI rows)
    .replace(/\x1B\[[0-9;?]*[a-zA-Z]/g, '')                // other CSI sequences
    .replace(/\x1B[()][AB012UK]/g, '')                      // charset
    .replace(/\x1B[MNOPRST78=><FEDM]/g, '')                 // single char
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')     // control chars
    .replace(/\r/g, '')
}

export function parseUsage(raw: string): UsageData | null {
  const text = stripAnsi(raw).replace(/\r/g, '').replace(/\n+/g, ' ')

  const pctMatches = [...text.matchAll(/(\d+)%\s*used/g)]
  if (!pctMatches.length) return null

  // Match "Resets <time> (<timezone>)" — stop before extra whitespace or next word
  const resetMatches = [...text.matchAll(/Resets\s+(.+?\([^)]+\))/g)]

  return {
    sessionPct: parseInt(pctMatches[0][1]),
    sessionResets: resetMatches[0]?.[1]?.trim().replace(/\s+/g, ' ') || '',
    weeklyPct: pctMatches[1] ? parseInt(pctMatches[1][1]) : 0,
    weeklyResets: resetMatches[1]?.[1]?.trim().replace(/\s+/g, ' ') || '',
  }
}

// Parse context from the clean markdown stored as isMeta user entry in JSONL
export function parseContextFromMarkdown(markdown: string): ContextData | null {
  // "**Tokens:** 27k / 200k (13%)"
  const tokenMatch = markdown.match(/\*\*Tokens:\*\*\s*([\d.]+k?)\s*\/\s*([\d.]+k?)\s*\((\d+)%\)/)
  if (!tokenMatch) return null

  const categories: Array<{ name: string; tokens: string; pct: number }> = []
  // Match table rows: "| System prompt | 6.5k | 3.2% |"
  const rowRegex = /\|\s*([^|\-][^|]*?)\s*\|\s*([\d.<>~]+k?)\s*\|\s*([\d.]+)%\s*\|/g
  for (const m of markdown.matchAll(rowRegex)) {
    const name = m[1].trim()
    if (!name || name === 'Category' || name === 'Tokens' || name === 'Percentage') continue
    categories.push({ name, tokens: m[2], pct: parseFloat(m[3]) })
  }

  return {
    used: tokenMatch[1],
    total: tokenMatch[2],
    pct: parseInt(tokenMatch[3]),
    categories,
  }
}

// Читает последний assistant usage из jsonl и возвращает суммарный контекст в токенах
export function readLastContextTokens(jsonlPath: string): number | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs')
    const content = fs.readFileSync(jsonlPath, 'utf-8')
    const lines = content.trim().split('\n')
    // ищем снизу вверх последний assistant с usage
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i])
        if (obj.type === 'assistant' && obj.message?.usage) {
          const u = obj.message.usage
          const total = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
          if (total > 0) return total
        }
      } catch {}
    }
  } catch {}
  return null
}

export function parseContext(raw: string): ContextData | null {
  const text = stripAnsi(raw)
    .replace(/\r/g, '')
    .replace(/\n+/g, ' ')  // collapse newlines — TUI rows → single space

  // "24.7k/200k tokens (12%)" or "127.0k / 200.0k (64%)"
  const totalMatch = text.match(/([\d.]+k?)\s*\/\s*([\d.]+k?)\s+tokens?\s*\((\d+)%\)/)
  if (!totalMatch) return null

  const categoriesMap = new Map<string, { name: string; tokens: string; pct: number }>()
  // "System prompt: 6.4k tokens (3.2%)" or "Free space: 142.3k (71.2%)"
  const catRegex = /([A-Z][A-Za-z ()]{2,40}?):\s*([\d.]+k?)\s*(?:tokens\s*)?\(([\d.]+)%\)/g
  for (const m of text.matchAll(catRegex)) {
    const name = m[1].trim()
    const pct = parseFloat(m[3])
    if (name && !name.startsWith('Context') && pct >= 0 && !categoriesMap.has(name)) {
      categoriesMap.set(name, { name, tokens: m[2], pct })
    }
  }
  const categories = [...categoriesMap.values()]

  return {
    used: totalMatch[1],
    total: totalMatch[2],
    pct: parseInt(totalMatch[3]),
    categories,
  }
}
