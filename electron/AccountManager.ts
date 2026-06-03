import fs from 'fs'
import path from 'path'
import type { Account, Session } from '../shared/types.js'

const ACCOUNTS_ROOT = path.join(process.env.USERPROFILE || '', '.claude-accounts')
const REGISTRY_PATH = path.join(ACCOUNTS_ROOT, 'accounts.json')

interface AccountRecord {
  id: string
  name: string
  createdAt: number
}

export class AccountManager {
  private accounts: Account[] = []

  constructor() {
    this.loadAccounts()
  }

  private readRegistry(): AccountRecord[] {
    if (!fs.existsSync(REGISTRY_PATH)) return []
    try { return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8')) }
    catch { return [] }
  }

  private writeRegistry(records: AccountRecord[]): void {
    fs.mkdirSync(ACCOUNTS_ROOT, { recursive: true })
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(records, null, 2))
  }

  private loadAccounts() {
    if (!fs.existsSync(ACCOUNTS_ROOT)) {
      fs.mkdirSync(ACCOUNTS_ROOT, { recursive: true })
    }

    const records = this.readRegistry()
    // Only include accounts whose directory actually exists
    this.accounts = records
      .filter(r => fs.existsSync(path.join(ACCOUNTS_ROOT, r.id)))
      .map(r => {
        const configDir = path.join(ACCOUNTS_ROOT, r.id)
        let email: string | undefined
        try {
          const claudeJson = path.join(configDir, '.claude.json')
          if (fs.existsSync(claudeJson)) {
            const cfg = JSON.parse(fs.readFileSync(claudeJson, 'utf-8'))
            email = cfg.oauthAccount?.emailAddress || cfg.oauthAccount?.email
          }
        } catch {}
        return { id: r.id, name: r.name, configDir, email }
      })
  }

  getAccounts(): Account[] {
    this.loadAccounts()
    return this.accounts
  }

  getAccount(id: string): Account | undefined {
    return this.accounts.find(a => a.id === id)
  }

  logoutAccount(id: string): void {
    id = this.sanitizeId(id)
    const configDir = path.join(ACCOUNTS_ROOT, id)
    // Remove only credentials, keep sessions
    const credPath = path.join(configDir, '.credentials.json')
    if (fs.existsSync(credPath)) fs.unlinkSync(credPath)
    const claudeJsonPath = path.join(configDir, '.claude.json')
    if (fs.existsSync(claudeJsonPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'))
        delete cfg.oauthAccount
        fs.writeFileSync(claudeJsonPath, JSON.stringify(cfg, null, 2))
      } catch {}
    }
  }

  deleteAccount(id: string): void {
    id = this.sanitizeId(id)
    const configDir = path.join(ACCOUNTS_ROOT, id)
    if (fs.existsSync(configDir)) {
      fs.rmSync(configDir, { recursive: true, force: true })
    }
    this.accounts = this.accounts.filter(a => a.id !== id)
    const records = this.readRegistry().filter(r => r.id !== id)
    this.writeRegistry(records)
  }

  private sanitizeId(raw: string): string {
    // Trim whitespace and allow only safe filesystem characters
    return raw.trim().replace(/[^a-zA-Z0-9._\-@]/g, '_')
  }

  createAccount(id: string): Account {
    id = this.sanitizeId(id)
    if (!id) throw new Error('Account id cannot be empty')
    const existing = this.accounts.find(a => a.id.toLowerCase() === id.toLowerCase())
    if (existing) return existing
    const configDir = path.join(ACCOUNTS_ROOT, id)
    fs.mkdirSync(configDir, { recursive: true })

    // Pre-seed .claude.json so CLI skips onboarding/theme/login dialogs
    const claudeJsonPath = path.join(configDir, '.claude.json')
    if (!fs.existsSync(claudeJsonPath)) {
      const homedir = (process.env.USERPROFILE || process.env.HOME || '').replace(/\\/g, '/')
      const seed = {
        hasCompletedOnboarding: true,
        lastOnboardingVersion: '99.0.0',
        migrationVersion: 13,
        projects: { [homedir]: { hasTrustDialogAccepted: true } },
      }
      fs.writeFileSync(claudeJsonPath, JSON.stringify(seed, null, 2))
    }

    const account: Account = { id, name: id, configDir }
    this.accounts.push(account)
    // Register in accounts.json
    const records = this.readRegistry().filter(r => r.id !== id)
    records.push({ id, name: id, createdAt: Date.now() })
    this.writeRegistry(records)
    return account
  }

  getActiveAccountId(): string | null {
    const p = path.join(ACCOUNTS_ROOT, 'active.json')
    if (!fs.existsSync(p)) return null
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')).activeAccountId || null }
    catch { return null }
  }

  setActiveAccountId(id: string): void {
    fs.mkdirSync(ACCOUNTS_ROOT, { recursive: true })
    fs.writeFileSync(path.join(ACCOUNTS_ROOT, 'active.json'), JSON.stringify({ activeAccountId: id }))
  }

  getConfigDir(accountId: string): string {
    accountId = this.sanitizeId(accountId)
    const account = this.getAccount(accountId)
    if (!account) throw new Error(`Account not found: ${accountId}`)
    return account.configDir
  }

  private vaeliConfigPath(accountId: string): string {
    return path.join(ACCOUNTS_ROOT, accountId, 'vaeli-config.json')
  }

  getUsageSessionId(accountId: string): string | null {
    const p = this.vaeliConfigPath(accountId)
    if (!fs.existsSync(p)) return null
    try {
      const id = JSON.parse(fs.readFileSync(p, 'utf-8')).usageSessionId
      if (!id) return null
      // Verify the JSONL file still exists
      const jsonl = this.findSessionFile(id, path.join(ACCOUNTS_ROOT, accountId))
      return jsonl ? id : null
    }
    catch { return null }
  }

  setUsageSessionId(accountId: string, sessionId: string): void {
    const p = this.vaeliConfigPath(accountId)
    let cfg: Record<string, unknown> = {}
    if (fs.existsSync(p)) { try { cfg = JSON.parse(fs.readFileSync(p, 'utf-8')) } catch {} }
    cfg.usageSessionId = sessionId
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2))
  }

  // ── Session meta ────────────────────────────────────────────────────────────

  findSessionFile(sessionId: string, configDir: string): string | null {
    const projectsDir = path.join(configDir, 'projects')
    if (!fs.existsSync(projectsDir)) return null
    for (const proj of fs.readdirSync(projectsDir, { withFileTypes: true })) {
      if (!proj.isDirectory()) continue
      const p = path.join(projectsDir, proj.name, `${sessionId}.jsonl`)
      if (fs.existsSync(p)) return p
    }
    return null
  }

  getSessionMeta(sessionId: string, configDir: string): Record<string, unknown> | null {
    const jsonlPath = this.findSessionFile(sessionId, configDir)
    if (!jsonlPath) return null
    const metaPath = jsonlPath.replace('.jsonl', '.meta.json')
    if (!fs.existsSync(metaPath)) return null
    try { return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) }
    catch { return null }
  }

  setSessionMeta(sessionId: string, configDir: string, data: Record<string, unknown>): void {
    const jsonlPath = this.findSessionFile(sessionId, configDir)
    if (!jsonlPath) return
    const metaPath = jsonlPath.replace('.jsonl', '.meta.json')
    let existing: Record<string, unknown> = {}
    if (fs.existsSync(metaPath)) { try { existing = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) } catch {} }
    fs.writeFileSync(metaPath, JSON.stringify({ ...existing, ...data, sessionId }, null, 2))
  }

  // Get all session meta files across all accounts (for startup cache restore)
  getAllSessionMetas(): Array<Record<string, unknown>> {
    const metas: Array<Record<string, unknown>> = []
    for (const account of this.accounts) {
      const projectsDir = path.join(account.configDir, 'projects')
      if (!fs.existsSync(projectsDir)) continue
      for (const proj of fs.readdirSync(projectsDir, { withFileTypes: true })) {
        if (!proj.isDirectory()) continue
        const projPath = path.join(projectsDir, proj.name)
        for (const file of fs.readdirSync(projPath)) {
          if (!file.endsWith('.meta.json')) continue
          try { metas.push(JSON.parse(fs.readFileSync(path.join(projPath, file), 'utf-8'))) }
          catch {}
        }
      }
    }
    return metas
  }

  // Read all sessions across all project dirs for an account
  getSessionsForAccount(accountId: string): Session[] {
    const account = this.getAccount(accountId)
    if (!account) return []

    const projectsDir = path.join(account.configDir, 'projects')
    if (!fs.existsSync(projectsDir)) return []

    const sessions: Session[] = []
    const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())

    for (const proj of projectDirs) {
      const projPath = path.join(projectsDir, proj.name)
      const files = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl'))

      for (const file of files) {
        const sessionId = file.replace('.jsonl', '')
        const filePath = path.join(projPath, file)
        const stat = fs.statSync(filePath)

        // Count messages quickly
        const content = fs.readFileSync(filePath, 'utf-8')
        const lines = content.split('\n').filter(l => l.trim())
        const msgCount = lines.filter(l => {
          try { const e = JSON.parse(l); return e.type === 'user' || e.type === 'assistant' }
          catch { return false }
        }).length

        // Extract title from first user message
        let title: string | undefined
        let firstUserMsg = ''
        for (const line of lines) {
          try {
            const entry = JSON.parse(line)
            if (entry.type === 'user') {
              const content = typeof entry.message?.content === 'string'
                ? entry.message.content
                : entry.message?.content?.[0]?.text || ''
              firstUserMsg = content.trim()
              title = content.slice(0, 60)
              break
            }
          } catch { /* skip */ }
        }

        // Hide internal PTY sessions (usage session or context queries)
        const usageId = this.getUsageSessionId(accountId)
        if (sessionId === usageId) continue
        if (firstUserMsg.startsWith('/context') || firstUserMsg === '') continue

        sessions.push({
          id: sessionId,
          projectPath: projPath,
          projectName: decodeURIComponent(proj.name.replace(/-/g, '/')),
          accountId,
          lastModified: stat.mtimeMs,
          messageCount: msgCount,
          title,
        })
      }
    }

    return sessions.sort((a, b) => b.lastModified - a.lastModified)
  }

  // Scan configDir for the newest .jsonl files not in excludeIds, return up to limit sessionIds
  findNewSessions(configDir: string, excludeIds: Set<string>, limit = 3): string[] {
    const projectsDir = path.join(configDir, 'projects')
    if (!fs.existsSync(projectsDir)) return []

    const entries: { sessionId: string; mtime: number }[] = []
    for (const proj of fs.readdirSync(projectsDir, { withFileTypes: true })) {
      if (!proj.isDirectory()) continue
      const projPath = path.join(projectsDir, proj.name)
      for (const file of fs.readdirSync(projPath)) {
        if (!file.endsWith('.jsonl')) continue
        const sessionId = file.replace('.jsonl', '')
        if (excludeIds.has(sessionId)) continue
        try {
          const mtime = fs.statSync(path.join(projPath, file)).mtimeMs
          entries.push({ sessionId, mtime })
        } catch {}
      }
    }

    return entries
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map(e => e.sessionId)
  }

  // Read latest context from a session's isMeta user entries (written by /context all)
  getLatestContextMarkdown(sessionId: string, configDir: string): string | null {
    const jsonlPath = this.findSessionFile(sessionId, configDir)
    if (!jsonlPath) return null
    try {
      const lines = fs.readFileSync(jsonlPath, 'utf-8').split('\n').filter(l => l.trim())
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i])
          if (
            entry.type === 'user' &&
            entry.isMeta === true &&
            typeof entry.message?.content === 'string' &&
            entry.message.content.startsWith('## Context Usage')
          ) {
            return entry.message.content as string
          }
        } catch { /* skip */ }
      }
    } catch { }
    return null
  }

  // Sync all sessions from sourceAccount to targetAccount
  // Only copies if target doesn't have the file or source is newer
  syncSessionsTo(sourceAccountId: string, targetAccountId: string): void {
    const source = this.getAccount(sourceAccountId)
    const target = this.getAccount(targetAccountId)
    if (!source || !target) return

    const sourceProjects = path.join(source.configDir, 'projects')
    const targetProjects = path.join(target.configDir, 'projects')

    if (!fs.existsSync(sourceProjects)) return
    fs.mkdirSync(targetProjects, { recursive: true })

    const projectDirs = fs.readdirSync(sourceProjects, { withFileTypes: true })
      .filter(e => e.isDirectory())

    for (const proj of projectDirs) {
      const srcProjDir = path.join(sourceProjects, proj.name)
      const dstProjDir = path.join(targetProjects, proj.name)
      fs.mkdirSync(dstProjDir, { recursive: true })

      const files = fs.readdirSync(srcProjDir).filter(f => f.endsWith('.jsonl'))
      for (const file of files) {
        const srcFile = path.join(srcProjDir, file)
        const dstFile = path.join(dstProjDir, file)

        fs.copyFileSync(srcFile, dstFile)
      }
    }
  }
}
