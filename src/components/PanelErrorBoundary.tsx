import { Component, type ReactNode } from 'react'
import { t } from '../lib/i18n.js'

interface Props {
  id: string
  children: ReactNode
}

interface State {
  error: Error | null
}

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
          <span className="text-[13px] text-red-400">{t("Панель", "Panel")}{' '}{this.props.id} {t("упала", "crashed")}</span>
          <span className="text-[12px] text-text-ghost font-mono">{this.state.error.message}</span>
        </div>
      )
    }
    return this.props.children
  }
}
