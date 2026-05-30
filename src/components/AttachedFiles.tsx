import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, FileText, X } from 'lucide-react'
import { cn } from '../lib/utils.js'

export interface AttachedFile {
  id: string
  filename: string
  filePath: string
  isImage: boolean
  thumbnail: string | null
  loading: boolean
}

interface Props {
  files: AttachedFile[]
  onRemove: (id: string) => void
}

export function AttachedFiles({ files, onRemove }: Props) {
  const [lightbox, setLightbox] = useState<string | null>(null)

  return (
    <>
      <AnimatePresence initial={false}>
        {files.length > 0 && (
          <motion.div
            key="container"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
            className="flex gap-2 flex-wrap px-1 pb-2"
          >
            <AnimatePresence initial={false}>
              {files.map(f => (
                <motion.div
                  key={f.id}
                  layout
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="flex flex-col items-center gap-0"
                >
                  {/* Square preview */}
                  <div
                    className="relative w-16 h-16 rounded-xl border border-border-default bg-bg-elevated overflow-hidden group"
                    title={f.filePath}
                  >
                    {f.isImage && f.thumbnail && !f.loading ? (
                      <img
                        src={f.thumbnail}
                        className="w-full h-full object-cover cursor-pointer"
                        onClick={() => setLightbox(f.thumbnail)}
                      />
                    ) : !f.loading ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <FileText size={24} className="text-text-muted" />
                      </div>
                    ) : null}

                    {/* Loading overlay */}
                    {f.loading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-bg-elevated">
                        <Loader2 size={20} className="text-text-muted animate-spin" />
                      </div>
                    )}

                    {/* Remove button */}
                    {!f.loading && (
                      <button
                        onClick={() => onRemove(f.id)}
                        className="absolute top-1 right-1 w-4 h-4 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={10} className="text-white" />
                      </button>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/70 z-[200] flex items-center justify-center"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            className="max-w-[80vw] max-h-[80vh] object-contain rounded-xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
