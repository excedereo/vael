import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTime(ms: number): string {
  const date = new Date(ms)
  const now = new Date()
  const diff = now.getTime() - ms

  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (date.getFullYear() === now.getFullYear())
    return date.toLocaleDateString('en', { month: 'short', day: 'numeric' })
  return date.toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '')
}
