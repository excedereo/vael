import { Download, RotateCw, ExternalLink } from 'lucide-react'
import { api } from '../lib/api.js'
import { WindowControls } from './WindowControls.js'
import logo from '../assets/logo.svg'
import { t } from '../lib/i18n.js'

interface Props {
  deps: { npm: string | null; claude: string | null }
  installing: boolean
  installLog: string | null
  onInstall: () => void
  onRecheck: () => void
}

/** Claude Code не найден: предлагаем поставить. Показывается раньше входа в аккаунт — без claude вход не работает */
export function DepsScreen({ deps, installing, installLog, onInstall, onRecheck }: Props) {
  return (
    <div className="fixed inset-0 bg-bg-base flex flex-col">
      <div className="h-11 shrink-0 flex items-stretch">
        <div className="flex-1 app-drag-region" />
        <WindowControls />
      </div>

      <div className="flex-1 flex items-center justify-center px-6 pb-11">
        <div className="w-[400px] max-w-full flex flex-col items-center text-center">
          <img src={logo} alt="" width={64} height={64} draggable={false} className="select-none" />
          <h1 className="mt-5 text-[22px] font-medium text-text-primary">{t("Нужен Claude Code", "Claude Code is required")}</h1>
          <p className="mt-1.5 text-[13.5px] text-text-muted">
            {installing
              ? t("Ставлю Claude Code — обычно это минута-две, зависит от интернета", "Installing Claude Code — usually a minute or two, depending on your connection")
              : t("Vael работает поверх Claude Code. Его можно поставить отсюда одной кнопкой", "Vael runs on top of Claude Code. You can install it from here with one click")}
          </p>

          {installing ? (
            <div className="chat-compact-track mt-7 w-full">
              <div className="fill" style={{ width: '100%', opacity: .35 }} />
              <div className="shimmer" />
            </div>
          ) : (
            <div className="mt-6 w-full flex flex-col gap-1.5 text-left">
              <div className="acc-tile flex items-center justify-between">
                <span className="text-[13px] text-text-secondary font-mono">claude</span>
                <span className="text-[13px] font-mono" style={{ color: deps.claude ? 'var(--color-success, #5fb98a)' : 'var(--color-error, #e0705c)' }}>
                  {deps.claude ?? t("не найден", "not found")}
                </span>
              </div>
              <div className="acc-tile flex items-center justify-between" title={t("npm нужен только чтобы ставить конкретную версию Claude Code", "npm is only needed to install a specific Claude Code version")}>
                <span className="text-[13px] text-text-muted font-mono">npm</span>
                <span className="text-[12.5px] text-text-muted font-mono">{deps.npm ?? t("нет — нужен только для смены версии", "none — only needed to change the version")}</span>
              </div>
            </div>
          )}

          {installLog && !installing && (
            <div className="acc-warn mt-3 w-full !items-start text-left">
              <span className="font-mono text-[12px] whitespace-pre-wrap break-all max-h-40 overflow-auto thin-scroll">{installLog}</span>
            </div>
          )}

          {!installing && (
            <>
              <button onClick={onInstall} className="acc-btn is-primary mt-6 w-full justify-center !h-10 !text-[14px]">
                <Download size={15} />{installLog ? t("Попробовать ещё раз", "Try again") : t("Установить автоматически", "Install automatically")}
              </button>
              <div className="mt-3 flex gap-2">
                <button onClick={onRecheck} className="acc-btn"><RotateCw size={13} />{t("Проверить снова", "Check again")}</button>
                <button onClick={() => api.openExternal('https://docs.anthropic.com/en/docs/claude-code/setup')} className="acc-btn">
                  <ExternalLink size={13} />{t("Как поставить вручную", "How to install manually")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
