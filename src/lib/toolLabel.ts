// Единое место для лейблов инструментов
// toolLabel() — для лайв-индикатора в useSession (одна строка)
// toolHeading() — для отрендеренного блока в MessageBubble (verb + subject)

const short = (p: unknown) => {
  const s = String(p || '').replace(/\\/g, '/')
  const parts = s.split('/')
  return parts[parts.length - 1] || s
}

const fullPath = (p: unknown) => String(p || '').replace(/\\/g, '/')

export function toolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read':       return `Reading ${short(input.file_path)}`
    case 'Edit':
    case 'Update':     return `Editing ${short(input.file_path)}`
    case 'Write':      return `Writing ${short(input.file_path)}`
    case 'Grep':       return `Searching "${String(input.pattern || '').slice(0, 30)}"`
    case 'Glob':       return `Globbing ${String(input.pattern || '')}`
    case 'Bash':       return `Running ${String(input.command || '').slice(0, 40)}`
    case 'PowerShell': return `Running ${short(input.file_path) || String(input.command || '').slice(0, 35)}`
    case 'WebSearch':  return `Searching "${String(input.query || '').slice(0, 30)}"`
    case 'WebFetch':   return `Fetching ${short(input.url)}`
    case 'Agent':      return `Spawning ${String(input.subagent_type || 'agent')}…`
    case 'Task':
    case 'TaskCreate': return `Creating task…`
    default:           return name
  }
}

export function toolHeading(name: string, input: Record<string, unknown>): { verb: string; subject: string } {
  switch (name) {
    case 'Read':       return { verb: 'Read',         subject: fullPath(input.file_path) }
    case 'Edit':
    case 'Update':     return { verb: 'Edited',       subject: fullPath(input.file_path) }
    case 'Write':      return { verb: 'Created',      subject: fullPath(input.file_path) }
    case 'Grep':       return { verb: 'Searched',     subject: `"${String(input.pattern || '').slice(0, 35)}"` }
    case 'Glob':       return { verb: 'Globbed',      subject: String(input.pattern || '') }
    case 'Bash':       return { verb: '$',            subject: String(input.command || '').slice(0, 55) }
    case 'PowerShell': return { verb: 'PS',           subject: String(input.command || '').slice(0, 55) }
    case 'WebSearch':  return { verb: 'Searched web', subject: String(input.query || '').slice(0, 40) }
    case 'WebFetch':   return { verb: 'Fetched',      subject: String(input.url || '').slice(0, 50) }
    case 'Agent':      return { verb: 'Spawned',      subject: String(input.subagent_type || 'agent') }
    default:           return { verb: name,           subject: '' }
  }
}
