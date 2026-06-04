import fs from 'fs'
import path from 'path'
import { PATHS } from './SettingsService.js'

// Вся логика памяти — индексы, CLAUDE.md блок, мета-данные

const VAEL_BLOCK_START = '<!-- [VAEL MEMORY] -->'
const VAEL_BLOCK_END = '<!-- [/VAEL MEMORY] -->'

export let lastMemoryTokens = { auto: 0, total: 0 }

export interface MemoryMeta {
  [relativePath: string]: { auto?: boolean; desc?: string }
}

export interface FsEntry {
  // exported — используется в ipc/memory.ts
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  mtime?: number
  auto?: boolean
  tag?: string
}

export function ensureMemoryDir() {
  if (!fs.existsSync(PATHS.memory)) fs.mkdirSync(PATHS.memory, { recursive: true })
}

export function loadMeta(): MemoryMeta {
  try {
    if (fs.existsSync(PATHS.memoryMeta)) return JSON.parse(fs.readFileSync(PATHS.memoryMeta, 'utf-8'))
  } catch {}
  return {}
}

export function saveMeta(meta: MemoryMeta) {
  fs.mkdirSync(PATHS.vael, { recursive: true })
  fs.writeFileSync(PATHS.memoryMeta, JSON.stringify(meta, null, 2), 'utf-8')
}

export function parseFrontmatter(content: string): { title: string; desc: string; auto: boolean; tag?: string } | null {
  const lines = content.split('\n')
  if (!lines[0]?.startsWith('### ')) return null
  const title = lines[0].slice(4).trim()
  const descLines: string[] = []
  let auto = false
  let tag: string | undefined
  let i = 1
  while (i < lines.length && lines[i].trim() !== '---') {
    const line = lines[i].trim()
    if (line === 'auto') { auto = true }
    else if (line.startsWith('tag: ')) { tag = line.slice(5).trim() }
    else if (line) descLines.push(lines[i])
    i++
  }
  return { title, desc: descLines.join(' ').trim(), auto, tag }
}

export function relPath(absPath: string): string {
  return path.relative(PATHS.memory, absPath).replace(/\\/g, '/')
}

export function buildIndexContent(dirPath: string, meta: MemoryMeta): string {
  const dirName = path.basename(dirPath)
  let entries: string[]
  try { entries = fs.readdirSync(dirPath) } catch { return '' }

  const indexPath = path.join(dirPath, 'INDEX.md')
  let header = `### ${dirName}\n\n---\n`
  if (fs.existsSync(indexPath)) {
    try {
      const existing = fs.readFileSync(indexPath, 'utf-8')
      const sepIdx = existing.indexOf('\n---')
      if (sepIdx !== -1) header = existing.slice(0, sepIdx + 4)
    } catch {}
  }

  const lines: string[] = [header, '']
  const sorted = entries
    .filter(e => !e.startsWith('.') && e !== 'INDEX.md')
    .map(e => ({ name: e, fullPath: path.join(dirPath, e), isDir: fs.statSync(path.join(dirPath, e)).isDirectory() }))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  for (const entry of sorted) {
    const entryRel = relPath(entry.fullPath)
    const entryMeta = meta[entryRel] || {}
    let desc = (entryMeta as { desc?: string }).desc || ''
    if (!desc && !entry.isDir) {
      try {
        const fm = parseFrontmatter(fs.readFileSync(entry.fullPath, 'utf-8'))
        if (fm) desc = fm.desc
      } catch {}
    }
    if (entry.isDir) {
      lines.push(`- [${entry.name}/](${entry.name}/INDEX.md)${desc ? ' — ' + desc : ''}`)
    } else {
      lines.push(`- [${entry.name}](${entry.name})${desc ? ' — ' + desc : ''}`)
    }
  }
  return lines.join('\n') + '\n'
}

export function rebuildIndexChain(startDir: string, meta: MemoryMeta) {
  let current = startDir
  while (true) {
    if (current !== PATHS.memory) {
      const content = buildIndexContent(current, meta)
      if (content) fs.writeFileSync(path.join(current, 'INDEX.md'), content, 'utf-8')
    }
    if (current === PATHS.memory) break
    current = path.dirname(current)
  }
}

export function rebuildClaudeMdBlock(meta: MemoryMeta) {
  if (!fs.existsSync(PATHS.claudeMd)) return

  const existing = fs.readFileSync(PATHS.claudeMd, 'utf-8')
  const alwaysLines: string[] = []
  const onDemandLines: string[] = []
  const tagMap: Record<string, string[]> = {}

  function scanDir(dirPath: string, dirRel: string) {
    let entries: string[]
    try { entries = fs.readdirSync(dirPath) } catch { return }
    for (const name of entries.sort()) {
      if (name.startsWith('.') || name === 'INDEX.md') continue
      const fullPath = path.join(dirPath, name)
      const rel = dirRel ? dirRel + '/' + name : name
      const isDir = fs.statSync(fullPath).isDirectory()
      if (isDir) {
        scanDir(fullPath, rel)
      } else {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8')
          const fm = parseFrontmatter(content)
          if (fm?.auto) {
            alwaysLines.push(`### ${rel}\n${content.trim()}`)
          } else if (fm?.tag) {
            if (!tagMap[fm.tag]) tagMap[fm.tag] = []
            tagMap[fm.tag].push(rel)
          } else {
            const desc = fm?.desc || ''
            onDemandLines.push(`- ${rel}${desc ? ' — ' + desc : ''}`)
          }
        } catch {}
      }
    }
  }

  scanDir(PATHS.memory, '')

  const topDirs: string[] = []
  try {
    for (const name of fs.readdirSync(PATHS.memory)) {
      const fullPath = path.join(PATHS.memory, name)
      if (!fs.statSync(fullPath).isDirectory()) continue
      let desc = ''
      const indexPath = path.join(fullPath, 'INDEX.md')
      if (fs.existsSync(indexPath)) {
        try {
          const fm = parseFrontmatter(fs.readFileSync(indexPath, 'utf-8'))
          if (fm) desc = fm.desc
        } catch {}
      }
      topDirs.push(`- ${name}/ — ${desc || name}. Read ${name}/INDEX.md for details.`)
    }
  } catch {}

  const tagLines: string[] = []
  for (const [tag, paths] of Object.entries(tagMap).sort()) {
    for (const p of paths) tagLines.push(`[${tag}] - ${p}`)
  }

  // Count tokens
  const alwaysContent = alwaysLines.join('\n\n')
  const autoTokens = Math.round(alwaysContent.length / 4)
  let totalChars = 0
  function countDir(dirPath: string) {
    try {
      for (const name of fs.readdirSync(dirPath)) {
        if (name.startsWith('.') || name === 'INDEX.md') continue
        const fullPath = path.join(dirPath, name)
        if (fs.statSync(fullPath).isDirectory()) countDir(fullPath)
        else { try { totalChars += fs.readFileSync(fullPath, 'utf-8').length } catch {} }
      }
    } catch {}
  }
  countDir(PATHS.memory)
  lastMemoryTokens = { auto: autoTokens, total: Math.round(totalChars / 4) }

  const block = [
    VAEL_BLOCK_START,
    `Memory root: ${PATHS.memory}`,
    '',
    alwaysLines.length > 0 ? '## Always loaded:\n' + alwaysLines.join('\n\n') : '',
    topDirs.length > 0 ? '## Available on demand (read INDEX.md of category first):\n' + topDirs.join('\n') : '',
    onDemandLines.length > 0 ? '## Individual files on demand:\n' + onDemandLines.join('\n') : '',
    tagLines.length > 0 ? '## Tags:\nФайлы с тегами загружаются только когда в сообщении встречается соответствующий тег в скобках, например [TG]. При виде тега — прочитать соответствующий файл.\n' + tagLines.join('\n') : '',
  ].filter(Boolean).join('\n') + '\n' + VAEL_BLOCK_END

  const startIdx = existing.indexOf(VAEL_BLOCK_START)
  const endIdx = existing.indexOf(VAEL_BLOCK_END)
  let updated: string
  if (startIdx !== -1 && endIdx !== -1) {
    let afterEnd = endIdx + VAEL_BLOCK_END.length
    const rest = existing.slice(afterEnd)
    const tokenLineMatch = rest.match(/^\n-{3,}[^\n]*-{3,}/)
    if (tokenLineMatch) afterEnd += tokenLineMatch[0].length
    updated = existing.slice(0, startIdx) + block + existing.slice(afterEnd)
  } else {
    updated = existing.trimEnd() + '\n\n' + block + '\n'
  }

  fs.writeFileSync(PATHS.claudeMd, updated, 'utf-8')
}

export function rebuildAllIndexes() {
  try {
    const meta = loadMeta()
    function walkDirs(dirPath: string) {
      try {
        for (const name of fs.readdirSync(dirPath)) {
          const full = path.join(dirPath, name)
          if (fs.statSync(full).isDirectory()) {
            const indexContent = buildIndexContent(full, meta)
            if (indexContent) fs.writeFileSync(path.join(full, 'INDEX.md'), indexContent, 'utf-8')
            walkDirs(full)
          }
        }
      } catch {}
    }
    walkDirs(PATHS.memory)
    rebuildClaudeMdBlock(meta)
  } catch {}
}

export function startMemoryWatcher() {
  if (!fs.existsSync(PATHS.memory)) return
  let debounce: ReturnType<typeof setTimeout> | null = null
  try {
    fs.watch(PATHS.memory, { recursive: true }, (_, filename) => {
      if (!filename || filename.endsWith('INDEX.md')) return
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => rebuildAllIndexes(), 500)
    })
  } catch {}
}
