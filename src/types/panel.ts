import { ReactNode } from 'react'

export type SessionStatus = 'idle' | 'thinking' | 'streaming' | 'tool'

export interface VaeliPanel {
  id: string
  label: string
  icon: ReactNode
  render(): ReactNode
  onSessionStatus?(sessionId: string, status: SessionStatus): void
  onAppReady?(): void
}
