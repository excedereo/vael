import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Check, X } from 'lucide-react'
import type { CompactSummary, Session } from '../../shared/types.js'
import { api } from '../lib/api.js'
import { fmtTokens } from '../hooks/useChatSession.js'
import { MdBlock } from './ChatView.js'
import { t, LOCALE } from '../lib/i18n.js'

/** Все пересказы сессии: что модель «помнила» после каждого сжатия */
export function SummariesModal({ session, onClose }: { session: Session; onClose: () => void }) {
  const [list, setList] = useState<CompactSummary[] | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [copied, setCopied] = useState<number | null>(null)

  useEffect(() => {
    api.chatSummaries(`${session.projectPath}\\${session.id}.jsonl`).then(l => {
      setList(l)
      // Последний пересказ — самый нужный, раскрываем его сразу
      if (l.length) setOpen(l.length - 1)
    }).catch(() => setList([]))
  }, [session])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const copy = (i: number, text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(i)
    setTimeout(() => setCopied(c => (c === i ? null : c)), 1200)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-bg-elevated border border-border-default rounded-2xl shadow-2xl w-[760px] max-w-full max-h-[85vh] flex flex-col">
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-border-subtle">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium text-text-primary">{t("Пересказы", "Summaries")}</div>
            <div className="text-[12.5px] text-text-muted truncate">{session.title || session.projectName} · <span className="font-mono">{session.id.slice(0, 8)}</span></div>
          </div>
          <button onClick={onClose} className="acc-icon"><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-auto thin-scroll px-3 py-3">
          {list === null && <div className="px-2 py-6 text-center text-[13px] text-text-muted">{t("Читаю сессию…", "Reading the session…")}</div>}
          {list && list.length === 0 && (
            <div className="px-2 py-8 text-center text-[13px] text-text-muted">
              {t("В этом файле сессии сжатий не было", "This session file has no compactions")}
              <div className="mt-1 text-[12px] text-text-faint">{t("Если её продолжали через resume в новый файл, пересказы остались в старом", "If it was continued with resume into a new file, the summaries stayed in the old one")}</div>
            </div>
          )}
          {list && list.map((s, i) => (
            <div key={i} className="rounded-xl hover:bg-white/[.02]">
              <div className="flex items-center gap-2 px-2 py-2">
                <button className="flex-1 min-w-0 flex items-center gap-2 text-left" onClick={() => setOpen(o => (o === i ? null : i))}>
                  {open === i ? <ChevronDown size={14} className="text-text-muted shrink-0" /> : <ChevronRight size={14} className="text-text-muted shrink-0" />}
                  <span className="text-[13.5px] text-text-primary">{t("Сжатие", "Compaction")}{' '}{i + 1}</span>
                  {s.at && <span className="text-[12.5px] text-text-muted">{new Date(s.at).toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
                  {s.before != null && s.after != null && (
                    <span className="text-[12.5px] text-text-faint tabular-nums">{fmtTokens(s.before)} → {fmtTokens(s.after)}</span>
                  )}
                </button>
                <button className="acc-icon" title={t("Копировать пересказ", "Copy summary")} onClick={() => copy(i, s.summary)}>
                  {copied === i ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              {open === i && <div className="px-4 pb-4 pt-1 text-[13.5px]"><MdBlock text={s.summary} /></div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
