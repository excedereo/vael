import { Download, X, RotateCcw, AlertTriangle } from 'lucide-react'
import { t } from '../lib/i18n.js'

export type UpdateState =
  | { status: 'available'; version: string }
  | { status: 'downloading'; progress: number }
  | { status: 'ready' }
  | { status: 'error'; message: string }

interface Props {
  state: UpdateState
  onClick: () => void
  onDismiss?: () => void
}

export function UpdateBanner({ state, onClick, onDismiss }: Props) {
  if (state.status === 'error') {
    return (
      <div className="mx-2 mb-2 rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--error-border)', background: 'var(--error-bg)' }}
      >
        <div className="flex flex-col gap-2 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--error-text)' }} />
            <div className="flex-1 min-w-0">
              <span className="text-[12px] font-semibold leading-tight block" style={{ color: 'var(--error-text)' }}>{t("Ошибка скачивания", "Download error")}</span>
              <span className="text-[11px] leading-tight block text-text-muted">{state.message}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClick}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors"
              style={{ background: 'var(--error-border)', color: 'var(--error-text)' }}
            >
              <RotateCcw size={11} />
              {t("Попробовать снова", "Try again")}
            </button>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-text-muted hover:text-text-secondary transition-colors"
              >
                <X size={11} />
                {t("Закрыть", "Close")}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={onClick}
      className="mx-2 mb-2 rounded-xl border border-accent/30 bg-accent/10 hover:bg-accent/15 transition-colors text-left overflow-hidden w-[calc(100%-16px)]"
    >
      {state.status === 'available' && (
        <div className="flex items-center gap-3 px-3 py-2.5">
          <div className="w-7 h-7 rounded-lg bg-accent/20 flex items-center justify-center shrink-0">
            <Download size={13} className="text-accent" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[12px] font-semibold text-accent leading-tight">{t("Доступно обновление", "Update available")}</span>
            <span className="text-[11px] text-text-muted leading-tight">v{state.version} {t("— нажми чтобы скачать", "— click to download")}</span>
          </div>
        </div>
      )}

      {state.status === 'downloading' && (
        <div className="flex flex-col gap-1.5 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-accent">{t("Скачивание обновления...", "Downloading update...")}</span>
            <span className="text-[11px] text-text-muted">{Math.round(state.progress)}%</span>
          </div>
          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--border-default)' }}>
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${state.progress}%` }}
            />
          </div>
        </div>
      )}

      {state.status === 'ready' && (
        <div className="flex items-center gap-3 px-3 py-2.5">
          <div className="w-7 h-7 rounded-lg bg-accent/20 flex items-center justify-center shrink-0">
            <Download size={13} className="text-accent" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[12px] font-semibold text-accent leading-tight">{t("Готово к установке", "Ready to install")}</span>
            <span className="text-[11px] text-text-muted leading-tight">{t("Нажми чтобы перезапустить", "Click to restart")}</span>
          </div>
        </div>
      )}
    </button>
  )
}
