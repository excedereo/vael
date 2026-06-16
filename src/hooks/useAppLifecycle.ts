/**
 * useAppLifecycle — жизненный цикл приложения.
 * Этап 2 рефакторинга: здесь будет логика phase (splash/no-deps/no-accounts/ready).
 * Сейчас заглушка — возвращает 'ready' чтобы не ломать App.tsx.
 */
export type AppPhase = 'splash' | 'no-deps' | 'no-accounts' | 'ready'

export function useAppLifecycle() {
  return { phase: 'ready' as AppPhase }
}
