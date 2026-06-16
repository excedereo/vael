import { Component, ReactNode } from 'react'

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
          <span className="text-[13px] text-red-400">Панель {this.props.id} упала</span>
          <span className="text-[12px] text-text-ghost font-mono">{this.state.error.message}</span>
        </div>
      )
    }
    return this.props.children
  }
}
