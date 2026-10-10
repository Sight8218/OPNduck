import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { IconCheck, IconX } from '@tabler/icons-react'
import type { ContainerFormat, ConvertMode } from '../../host'
import {
  CATEGORY_LABELS,
  FORMATS,
  canConvert,
  fileCategory,
  type FormatCategory,
} from './formats'

const CATEGORIES: FormatCategory[] = ['video', 'audio', 'image', 'document']

// Portaled to <body>: .glass cards use backdrop-filter, which would trap a
// fixed overlay inside the card's own stacking context.
export default function FormatPickerModal({
  open,
  files,
  documentsHint,
  onClose,
  onConvert,
}: {
  open: boolean
  files: string[]
  /** Set when LibreOffice is missing: document tiles are disabled and this is shown. */
  documentsHint?: string
  onClose: () => void
  onConvert: (format: ContainerFormat, mode: ConvertMode) => void
}) {
  const [picked, setPicked] = useState<ContainerFormat | null>(null)
  const [mode, setMode] = useState<ConvertMode>('remux')

  const sources = useMemo(() => files.map(fileCategory), [files])
  const info = FORMATS.find((f) => f.id === picked) ?? null
  const allVideo = sources.length > 0 && sources.every((c) => c === 'video')
  // Stream-copy only exists for video containers (GIF is always re-encoded).
  const remuxPossible = !!info && info.category === 'video' && info.id !== 'GIF' && allVideo
  const effectiveMode: ConvertMode = remuxPossible ? mode : 'transcode'

  // Reset the selection only when the dialog opens — not whenever the parent
  // re-renders with a fresh onClose identity (e.g. on every task update).
  useEffect(() => {
    if (open) setPicked(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Choose output format"
            className="glass glass-strong flex max-h-[90vh] w-full max-w-4xl flex-col rounded-3xl p-6"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold">
                  Convert {files.length} {files.length === 1 ? 'file' : 'files'} to…
                </h2>
                <p className="text-xs text-[var(--text-dim)]">
                  Pick an output format. Greyed-out formats can't be made from your selected files.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 text-[var(--text-dim)] hover:text-[var(--text)]"
              >
                <IconX size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="flex flex-col gap-5 overflow-y-auto pr-1">
              {CATEGORIES.map((cat) => (
                <section key={cat}>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--text-dim)]">
                    {CATEGORY_LABELS[cat]}
                  </h3>
                  {cat === 'document' && documentsHint && (
                    <p className="mb-2 text-xs text-[var(--text-dim)]">
                      Document conversion needs LibreOffice. Install it, then reopen this page:{' '}
                      <code className="select-all font-mono text-[var(--text)]">{documentsHint}</code>
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
                    {FORMATS.filter((f) => f.category === cat).map((f) => {
                      const ok =
                        sources.every((s) => canConvert(s, f)) && !(f.category === 'document' && documentsHint)
                      const active = picked === f.id
                      return (
                        <button
                          key={f.id}
                          type="button"
                          disabled={!ok}
                          onClick={() => setPicked(f.id)}
                          className={`flex flex-col items-start rounded-2xl border p-3 text-left transition-colors ${
                            active
                              ? 'border-[var(--input-border-focus)] bg-[var(--input-bg)]'
                              : 'border-[var(--glass-border)] bg-[var(--glass-bg)] hover:border-[var(--glass-border-inner)] hover:bg-[var(--glass-bg-strong)]'
                          } ${ok ? '' : 'cursor-not-allowed opacity-35'}`}
                        >
                          <span className="flex w-full items-center justify-between text-sm font-bold">
                            {f.label}
                            {active && (
                              <IconCheck size={14} className="text-[var(--accent)]" aria-hidden="true" />
                            )}
                          </span>
                          <span className="text-xs text-[var(--text-dim)]">{f.hint}</span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--glass-border)] pt-4">
              <div className="flex items-center gap-2 text-xs">
                {remuxPossible ? (
                  <>
                    <span className="text-[var(--text-dim)]">Mode</span>
                    {(['remux', 'transcode'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className={`rounded-lg border px-2.5 py-1 font-medium ${
                          mode === m
                            ? 'border-[var(--input-border-focus)] bg-[var(--input-bg)] text-[var(--text)]'
                            : 'border-[var(--glass-border)] text-[var(--text-dim)]'
                        }`}
                      >
                        {m === 'remux' ? 'Remux (fast, no re-encode)' : 'Transcode (re-encode)'}
                      </button>
                    ))}
                  </>
                ) : (
                  <span className="text-[var(--text-faint)]">
                    {info ? 'This conversion re-encodes the file.' : 'Choose a format to continue.'}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="glass-btn"
                disabled={!picked}
                onClick={() => picked && onConvert(picked, effectiveMode)}
              >
                {info ? `Convert to ${info.label}` : 'Convert'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
