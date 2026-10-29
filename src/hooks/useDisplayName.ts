import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'

// Имя для приветствия — из профиля claude.ai активного аккаунта.
// Кэш на модуль: приветствие рисуется в каждом пустом чате, читать файлы каждый раз незачем
let cached: { accountId: string; name: string | null } | null = null

export function useDisplayName(): string | null {
  const accountId = (() => { try { return localStorage.getItem('activeAccountId') ?? '' } catch { return '' } })()
  const [name, setName] = useState<string | null>(cached?.accountId === accountId ? cached.name : null)

  useEffect(() => {
    if (cached?.accountId === accountId) return
    let alive = true
    api.getAccounts()
      .then(list => {
        const acc = list.find(a => a.id === accountId) ?? list[0]
        return acc ? api.getAuthInfo(acc.configDir) : null
      })
      .then(info => {
        const n = info?.displayName ?? null
        cached = { accountId, name: n }
        if (alive) setName(n)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [accountId])

  return name
}
