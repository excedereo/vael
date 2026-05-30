import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, AlertCircle } from 'lucide-react'

interface Props {
  message: string | null
  onClose: () => void
}

export function ErrorToast({ message, onClose }: Props) {
  useEffect(() => {
    if (!message) return
    const t = setTimeout(onClose, 8000)
    return () => clearTimeout(t)
  }, [message, onClose])

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="fixed top-10 left-1/2 -translate-x-1/2 z-50 flex items-start gap-2.5 bg-[#1a0a0a] border border-red-500/30 rounded-xl px-4 py-3 shadow-2xl max-w-sm w-full mx-4"
        >
          <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium text-red-400">Ошибка</div>
            <div className="text-[11px] text-text-muted mt-0.5 leading-relaxed">{message}</div>
          </div>
          <button onClick={onClose} className="text-text-faint hover:text-text-secondary transition-colors shrink-0">
            <X size={13} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
