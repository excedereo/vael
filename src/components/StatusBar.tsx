import { SyncStatus } from '../types/index'
import { cn } from '../lib/utils.js'
import { Loader2, AlertCircle, CheckCircle } from 'lucide-react'

interface Props {
  syncStatus: SyncStatus
  syncMessage?: string
}

export function StatusBar({ syncStatus, syncMessage }: Props) {
  if (syncStatus === 'idle') return null

  return (
    <div className={cn(
      'fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 py-1.5 text-xs',
      syncStatus === 'syncing' && 'bg-violet-900/80 text-violet-200',
      syncStatus === 'running' && 'bg-zinc-900/80 text-zinc-300',
      syncStatus === 'error' && 'bg-red-900/80 text-red-200',
    )}>
      {syncStatus === 'syncing' && <Loader2 size={12} className="animate-spin" />}
      {syncStatus === 'error' && <AlertCircle size={12} />}
      {syncStatus === 'running' && <Loader2 size={12} className="animate-spin" />}
      <span>{syncMessage || (syncStatus === 'syncing' ? 'Syncing...' : syncStatus)}</span>
    </div>
  )
}
