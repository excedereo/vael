import { Cpu, Flash, ShieldTick, ShieldCross, Folder2, InfoCircle, Broom } from 'iconsax-reactjs'
import type { DefaultSessionConfig } from './SettingsPage.js'

/**
 * Правая колонка настроек: то, что нельзя выразить самой строкой настройки —
 * результат её применения. Живёт рядом с формой и обновляется вместе с ней.
 */

function PreviewBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] font-semibold text-text-muted uppercase tracking-[0.08em] mb-2.5 px-0.5">
        {title}
      </div>
      {children}
    </div>
  )
}

// ─── Interface ───────────────────────────────────────────────────────────────

/**
 * Кусок чата в текущей теме. Токены берутся из CSS-переменных, поэтому смена
 * темы перерисовывает превью сама, без пробрасывания цветов пропсами.
 */
export function InterfacePreview({ contentPadding }: { contentPadding: number }) {
  // Отступ в превью — доля от реального: макет уже настоящего окна, 160px
  // «как есть» съели бы всю ширину и картинка врала бы сильнее, чем помогает
  const pad = Math.min(56, Math.round(contentPadding / 4))

  return (
    <div className="space-y-4">
      <PreviewBlock title="Как выглядит чат">
        <div className="rounded-2xl border border-border-default overflow-hidden bg-bg-base">
          {/* шапка окна */}
          <div className="h-9 border-b border-border-subtle flex items-center gap-2 px-4">
            <span className="w-2.5 h-2.5 rounded-full bg-surface-active" />
            <span className="text-[11.5px] text-text-ghost ml-1">Сессия</span>
          </div>

          <div className="py-5 space-y-4" style={{ paddingLeft: pad, paddingRight: pad }}>
            {/* реплика пользователя */}
            <div className="flex justify-end">
              <div className="rounded-xl rounded-br-sm px-3 py-2.5 max-w-[75%] bg-surface-selected space-y-1.5">
                <div className="h-2 w-28 rounded-full bg-text-ghost/50" />
                <div className="h-2 w-20 rounded-full bg-text-ghost/40" />
              </div>
            </div>
            {/* ответ ассистента */}
            <div className="space-y-2">
              <div className="h-2 w-full rounded-full bg-text-ghost/35" />
              <div className="h-2 w-[88%] rounded-full bg-text-ghost/35" />
              <div className="h-2 w-[62%] rounded-full bg-text-ghost/35" />
            </div>
            {/* акцентная деталь — чтобы был виден цвет темы */}
            <div className="flex items-center gap-2 pt-1">
              <span className="w-2 h-2 rounded-full bg-accent" />
              <div className="h-2 w-24 rounded-full bg-accent/40" />
            </div>
          </div>

          {/* поле ввода */}
          <div className="pb-5" style={{ paddingLeft: pad, paddingRight: pad }}>
            <div className="rounded-xl border border-border-default bg-bg-surface h-11 flex items-center px-3.5">
              <div className="h-2 w-20 rounded-full bg-text-ghost/30" />
            </div>
          </div>
        </div>
      </PreviewBlock>

      <div className="rounded-xl border border-border-subtle bg-bg-surface px-3.5 py-3">
        <div className="flex items-center gap-2 text-[12.5px] text-text-muted">
          <InfoCircle size={15} variant="Linear" color="var(--text-faint)" className="shrink-0" />
          Отступ {contentPadding}px с каждой стороны
        </div>
      </div>

      <PreviewBlock title="Палитра темы">
        <div className="flex gap-2">
          {[
            { v: 'var(--accent)',         t: 'Акцент' },
            { v: 'var(--bg-surface)',     t: 'Поверхность' },
            { v: 'var(--bg-elevated)',    t: 'Приподнятая' },
            { v: 'var(--surface-active)', t: 'Активная' },
          ].map(c => (
            <div key={c.t} className="flex-1 min-w-0" title={c.t}>
              <div
                className="h-12 rounded-xl border border-border-subtle"
                style={{ background: c.v }}
              />
              <div className="text-[10.5px] text-text-ghost mt-1.5 truncate text-center">{c.t}</div>
            </div>
          ))}
        </div>
      </PreviewBlock>
    </div>
  )
}

// ─── Sessions ────────────────────────────────────────────────────────────────

const MODEL_LABEL: Record<string, string> = {
  'claude-opus-5': 'Opus 5',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-fable-5': 'Fable 5',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
}

const PERM_LABEL: Record<string, string> = {
  bypassPermissions: 'Bypass',
  acceptEdits: 'Accept Edits',
  default: 'Default',
  plan: 'Plan',
  auto: 'Auto',
}

export function SessionsPreview({ config }: { config: DefaultSessionConfig }) {
  const rows = [
    { icon: Cpu,        label: 'Модель',   value: MODEL_LABEL[config.model] ?? config.model },
    { icon: Flash,      label: 'Мышление', value: config.effort },
    { icon: ShieldTick, label: 'Доступ',   value: PERM_LABEL[config.permissionMode] ?? config.permissionMode },
  ]

  // Bypass снимает все подтверждения — про это стоит сказать прямо, а не
  // прятать за названием режима
  const bypass = config.permissionMode === 'bypassPermissions'

  return (
    <div className="space-y-4">
      <PreviewBlock title="Новая сессия стартует так">
        <div className="rounded-2xl border border-border-default bg-bg-surface overflow-hidden divide-y divide-white/[0.07]">
          {rows.map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-center justify-between px-4 py-3.5 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-surface-hover grid place-items-center shrink-0">
                  <Icon size={16} variant="Linear" color="var(--text-muted)" />
                </div>
                <span className="text-[13px] text-text-muted">{label}</span>
              </div>
              <span className="text-[13.5px] font-semibold text-text-primary capitalize truncate">
                {value}
              </span>
            </div>
          ))}
        </div>
      </PreviewBlock>

      {bypass && (
        <div className="rounded-xl border border-[var(--color-error)]/25 bg-[var(--color-error)]/8 px-3.5 py-3">
          <div className="flex items-start gap-2">
            <ShieldCross size={15} variant="Bold" color="var(--color-error)" className="shrink-0 mt-px" />
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium text-text-primary">Без подтверждений</div>
              <div className="text-[12px] text-text-muted mt-0.5 leading-snug">
                Claude правит файлы и запускает команды, ничего не спрашивая
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border-subtle bg-bg-surface px-3.5 py-3">
        <div className="flex items-start gap-2 text-[12.5px] text-text-muted leading-snug">
          <InfoCircle size={14} variant="Linear" color="var(--text-faint)" className="shrink-0 mt-px" />
          <span>Это только для новых сессий — открытые сохраняют свои параметры</span>
        </div>
      </div>
    </div>
  )
}

// ─── System ──────────────────────────────────────────────────────────────────

export function SystemPreview({ vaelVersion, cliVersion, attachSize, tempSize }: {
  vaelVersion: string
  cliVersion: string
  attachSize: { bytes: number; count: number } | null
  tempSize: { bytes: number; count: number } | null
}) {
  const fmt = (s: { bytes: number; count: number } | null) =>
    s ? `${s.count} файлов · ${(s.bytes / 1024 / 1024).toFixed(1)} MB` : '—'

  const totalMb = ((attachSize?.bytes ?? 0) + (tempSize?.bytes ?? 0)) / 1024 / 1024

  return (
    <div className="space-y-4">
      <PreviewBlock title="Занятое место">
        <div className="rounded-2xl border border-border-default bg-bg-surface p-4">
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-[38px] font-semibold text-text-primary tabular-nums leading-none">
              {totalMb.toFixed(1)}
            </span>
            <span className="text-[15px] text-text-muted">MB</span>
          </div>

          <div className="space-y-3">
            {[
              { icon: Folder2, label: 'Вложения', value: fmt(attachSize), bytes: attachSize?.bytes ?? 0 },
              { icon: Broom,   label: 'Temp',     value: fmt(tempSize),   bytes: tempSize?.bytes ?? 0 },
            ].map(({ icon: Icon, label, value, bytes }) => {
              const total = (attachSize?.bytes ?? 0) + (tempSize?.bytes ?? 0)
              const pct = total > 0 ? (bytes / total) * 100 : 0
              return (
                <div key={label} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon size={15} variant="Linear" color="var(--text-faint)" className="shrink-0" />
                      <span className="text-[13px] text-text-muted">{label}</span>
                    </div>
                    <span className="text-[12.5px] text-text-secondary tabular-nums truncate">{value}</span>
                  </div>
                  {/* доля в общем объёме — видно, что именно занимает место */}
                  <div className="h-1.5 rounded-full bg-surface-active overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </PreviewBlock>

      <PreviewBlock title="Версии">
        <div className="rounded-2xl border border-border-default bg-bg-surface overflow-hidden divide-y divide-white/[0.07]">
          {[
            { label: 'Vael',            value: vaelVersion ? `v${vaelVersion}` : '—' },
            { label: 'Claude Code CLI', value: cliVersion ? `v${cliVersion}` : '—' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between px-3.5 py-2.5 gap-3">
              <span className="text-[12.5px] text-text-muted">{label}</span>
              <span className="text-[12.5px] font-medium text-text-primary tabular-nums">{value}</span>
            </div>
          ))}
        </div>
      </PreviewBlock>
    </div>
  )
}
