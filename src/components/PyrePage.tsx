import { useEffect, useRef, useState } from 'react'
import { api, type ModuleListItem } from '../lib/api.js'
import { HeartbeatPanel } from './HeartbeatPanel.js'
import type { Session } from '../types/index.js'
import { t } from '../lib/i18n.js'

interface Props {
  sessions: Session[]
  modules: ModuleListItem[]
  activeModuleId: string | null
  onModulesChange: (modules: ModuleListItem[]) => void
}

// Переменные темы, которые отдаём странице модуля: так она совпадает с Vael
const THEME_VARS = ['--bg-base', '--bg-elevated', '--text-primary', '--text-secondary', '--text-muted', '--text-faint', '--accent', '--border-subtle', '--border-default', '--surface-hover']

/**
 * Страница модуля из папки modules. Чужой код: в iframe без allow-same-origin,
 * так что до окна приложения и его api он не дотягивается. Файлы модуля поменяли —
 * перезагружаем
 */
function ModuleFrame({ id, entry }: { id: string; entry: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [rev, setRev] = useState(0)
  useEffect(() => api.onModulesChanged?.(() => setRev(r => r + 1)), [])

  // Мост к серверной части модуля (main.cjs). Страница шлёт
  // { type: 'vael:call', id, method, args } и ждёт { type: 'vael:reply', id, ok, result | error }.
  // Принимаем только от своего iframe и зовём только свой модуль
  useEffect(() => {
    const post = (msg: unknown) => ref.current?.contentWindow?.postMessage(msg, '*')
    const onMessage = async (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return
      const d = e.data as { type?: string; id?: unknown; method?: unknown; args?: unknown }
      if (d?.type !== 'vael:call' || typeof d.method !== 'string' || !api.modulesCall) return
      const r = await api.modulesCall(id, d.method, Array.isArray(d.args) ? d.args : [])
      post({ type: 'vael:reply', id: d.id, ...r })
    }
    window.addEventListener('message', onMessage)
    const off = api.onModuleEvent?.((mid, name, data) => { if (mid === id) post({ type: 'vael:event', name, data }) })
    return () => { window.removeEventListener('message', onMessage); off?.() }
  }, [id])

  const sendTheme = () => {
    const css = getComputedStyle(document.documentElement)
    const vars: Record<string, string> = {}
    for (const v of THEME_VARS) { const val = css.getPropertyValue(v).trim(); if (val) vars[v] = val }
    ref.current?.contentWindow?.postMessage({ type: 'vael:theme', vars }, '*')
  }

  return (
    <iframe
      key={entry + ':' + rev}
      ref={ref}
      src={entry}
      onLoad={sendTheme}
      sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
      className="flex-1 w-full h-full border-0"
      style={{ background: 'var(--bg-base)' }}
      title={entry}
    />
  )
}

export function PyrePage({ sessions, modules, activeModuleId, onModulesChange }: Props) {
  const refresh = () => {
    api.modulesList().then(onModulesChange)
  }

  if (activeModuleId === 'heartbeat') {
    return <HeartbeatPanel sessions={sessions} onStatusChange={refresh} />
  }

  const page = modules.find(m => m.id === activeModuleId && m.kind === 'page')
  if (page?.entry) return <ModuleFrame id={page.id} entry={page.entry} />

  return (
    <div className="flex-1 flex items-center justify-center text-text-ghost text-sm">
      {t("Выбери модуль", "Pick a module")}
    </div>
  )
}
