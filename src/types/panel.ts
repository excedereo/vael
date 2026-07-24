import { ReactNode } from 'react'

export type { SessionStatus } from '../context/SessionContext.js'
import type { SessionStatus } from '../context/SessionContext.js'

export interface VaeliPanel {
  id: string
  label: string
  icon: ReactNode
  render(): ReactNode
  onSessionStatus?(sessionId: string, status: SessionStatus): void
  onAppReady?(): void
}
