/*
 * OPNduck — local-first media processing suite.
 * Copyright (C) 2026 Aaron Jonsson
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { IconX } from '@tabler/icons-react'
import SlidingSelector from '../../components/SlidingSelector'
import { host, type MediaInfo, type TrimMode } from '../../host'
import { formatTime, parseTime } from './time'

const MODES = [
  { value: 'fast' as TrimMode, label: 'Fast cut' },
  { value: 'precise' as TrimMode, label: 'Precise' },
]
const MIN_LEN = 0.1
const basename = (p: string) => p.split(/[/\\]/).pop() ?? p

// @category: trim/trim-modal
/** Pop-up trimmer: a thumbnail timeline with two draggable handles and a live preview of the frame at the handle
 *  you are moving, so you can see exactly what you are cutting. Portaled to <body> (cards trap fixed overlays). */
export default function TrimModal({
  open,
  file,
  info,
  initial,
  onClose,
  onConfirm,
  confirmLabel = 'Trim this part',
  hideMode = false,
  onExportClip,
}: {
  open: boolean
  file: string
  info: MediaInfo
  initial: { start: number; end: number; mode: TrimMode }
  onClose: () => void
  onConfirm: (start: number, end: number, mode: TrimMode) => void
  /** Text of the main button (default "Trim this part"). */
  confirmLabel?: string
  /** Hide the Fast/Precise switch (for callers that only want a start and an end). */
  hideMode?: boolean
  /** When set, a button hands the chosen part to the GIF/sticker maker. */
  onExportClip?: (start: number, end: number) => void
}) {
  const duration = info.duration
  const [start, setStart] = useState(initial.start)
  const [end, setEnd] = useState(initial.end)
  const [mode, setMode] = useState<TrimMode>(initial.mode)
  const [active, setActive] = useState<'start' | 'end'>('start')
  const [thumbs, setThumbs] = useState<(string | null)[]>([])
  const [frame, setFrame] = useState<string | null>(null)
  const [startText, setStartText] = useState(formatTime(initial.start))
  const [endText, setEndText] = useState(formatTime(initial.end))
  const track = useRef<HTMLDivElement>(null)
  const drag = useRef<'start' | 'end' | null>(null)

  // Reset to the card's current values each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setStart(initial.start)
    setEnd(initial.end)
    setMode(initial.mode)
    setStartText(formatTime(initial.start))
    setEndText(formatTime(initial.end))
    setActive('start')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the dialog opens
  }, [open])

  // Thumbnail strip, once per file.
  useEffect(() => {
    if (!open || !info.hasVideo) {
      setThumbs([])
      return
    }
    let alive = true
    host.mediaThumbs(file, duration, 14).then((t) => alive && setThumbs(t))
    return () => {
      alive = false
    }
  }, [open, file, duration, info.hasVideo])

  // Preview frame at the active handle (debounced while dragging).
  const activeTime = active === 'start' ? start : Math.max(0, end - 0.05)
  useEffect(() => {
    if (!open || !info.hasVideo) return
    let alive = true
    const t = setTimeout(() => {
      host.mediaFrame(file, activeTime, 640).then((f) => alive && f && setFrame(f))
    }, 140)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [open, file, activeTime, info.hasVideo])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const setHandle = useCallback(
    (which: 'start' | 'end', value: number) => {
      const v = Math.min(duration, Math.max(0, value))
      if (which === 'start') {
        const s = Math.min(v, end - MIN_LEN)
        setStart(s)
        setStartText(formatTime(s))
      } else {
        const e = Math.max(v, start + MIN_LEN)
        setEnd(e)
        setEndText(formatTime(e))
      }
    },
    [duration, start, end],
  )

  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    return (Math.min(Math.max(clientX - r.left, 0), r.width) / r.width) * duration
  }

  function onTrackDown(e: React.PointerEvent) {
    const t = timeAt(e.clientX)
    const which = Math.abs(t - start) <= Math.abs(t - end) ? 'start' : 'end'
    drag.current = which
    setActive(which)
    setHandle(which, t)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onTrackMove(e: React.PointerEvent) {
    if (drag.current) setHandle(drag.current, timeAt(e.clientX))
  }
  const onTrackUp = () => {
    drag.current = null
  }
  function nudge(which: 'start' | 'end', e: React.KeyboardEvent) {
    const step = e.shiftKey ? 1 : 0.1
    if (e.key === 'ArrowLeft') setHandle(which, (which === 'start' ? start : end) - step)
    else if (e.key === 'ArrowRight') setHandle(which, (which === 'start' ? start : end) + step)
    else return
    e.preventDefault()
  }

  const pct = (t: number) => `${(t / duration) * 100}%`

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
            aria-label="Trim"
            className="glass glass-strong flex max-h-[92vh] w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-3xl p-6"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-lg font-bold">Trim</h2>
                <p className="truncate text-xs text-[var(--text-dim)]">
                  {basename(file)} · {formatTime(duration)}
                  {info.width ? ` · ${info.width}×${info.height}` : ''}
                </p>
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--text-faint)] hover:text-[var(--text)]">
                <IconX size={18} aria-hidden="true" />
              </button>
            </div>

            {info.hasVideo && (
              <div className="flex aspect-video max-h-[38vh] items-center justify-center self-center overflow-hidden rounded-xl bg-black/50">
                {frame ? (
                  <img src={frame} alt={`Frame at ${formatTime(activeTime)}`} className="h-full w-full object-contain" />
                ) : (
                  <span className="text-xs text-[var(--text-faint)]">Loading preview…</span>
                )}
              </div>
            )}
            <p className="-mt-2 text-center text-[11px] text-[var(--text-faint)]">
              Showing the frame at the {active === 'start' ? 'start' : 'end'} handle ({formatTime(activeTime)}). Drag the handles, or focus one and use ← → (Shift = 1 s).
            </p>

            <div
              ref={track}
              className="relative h-16 w-full touch-none select-none overflow-hidden rounded-lg bg-[var(--input-bg)]"
              onPointerDown={onTrackDown}
              onPointerMove={onTrackMove}
              onPointerUp={onTrackUp}
              onPointerCancel={onTrackUp}
            >
              <div className="absolute inset-0 flex">
                {thumbs.map((t, i) => (
                  <div key={i} className="h-full flex-1 overflow-hidden">
                    {t && <img src={t} alt="" draggable={false} className="h-full w-full object-cover" />}
                  </div>
                ))}
              </div>
              {/* outside the cut: dimmed */}
              <div className="absolute inset-y-0 left-0 bg-black/65" style={{ width: pct(start) }} />
              <div className="absolute inset-y-0 right-0 bg-black/65" style={{ width: `${100 - (end / duration) * 100}%` }} />
              <div className="pointer-events-none absolute inset-y-0 border-y-2 border-[var(--accent)]" style={{ left: pct(start), width: pct(end - start) }} />
              {(['start', 'end'] as const).map((which) => (
                <button
                  key={which}
                  type="button"
                  role="slider"
                  aria-label={which === 'start' ? 'Start of the cut' : 'End of the cut'}
                  aria-valuemin={0}
                  aria-valuemax={duration}
                  aria-valuenow={which === 'start' ? start : end}
                  aria-valuetext={formatTime(which === 'start' ? start : end)}
                  className={`absolute inset-y-0 w-3 -translate-x-1/2 cursor-ew-resize rounded-sm bg-[var(--accent)] shadow ${active === which ? 'ring-2 ring-white/70' : ''}`}
                  style={{ left: pct(which === 'start' ? start : end) }}
                  onFocus={() => setActive(which)}
                  onKeyDown={(e) => nudge(which, e)}
                />
              ))}
            </div>

            <div className="grid grid-cols-3 items-end gap-3">
              <div>
                <label htmlFor="trim-modal-start" className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Start</label>
                <input
                  id="trim-modal-start"
                  className="glass-input"
                  value={startText}
                  onChange={(e) => setStartText(e.target.value)}
                  onBlur={() => {
                    const v = parseTime(startText)
                    if (v != null) setHandle('start', v)
                    else setStartText(formatTime(start))
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              </div>
              <div className="pb-2 text-center text-xs text-[var(--text-dim)]">
                Keeping <span className="font-medium text-[var(--text)]">{formatTime(end - start)}</span>
              </div>
              <div>
                <label htmlFor="trim-modal-end" className="mb-1 block text-xs font-medium text-[var(--text-dim)]">End</label>
                <input
                  id="trim-modal-end"
                  className="glass-input"
                  value={endText}
                  onChange={(e) => setEndText(e.target.value)}
                  onBlur={() => {
                    const v = parseTime(endText)
                    if (v != null) setHandle('end', v)
                    else setEndText(formatTime(end))
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              </div>
            </div>

            {!hideMode && (
            <div>
              <SlidingSelector id="trim-modal-mode" options={MODES} value={mode} onChange={setMode} className="w-full grid-cols-2" />
              <span className="mt-1 block text-[11px] text-[var(--text-faint)]">
                {mode === 'fast' ? 'Instant, no quality loss; the cut snaps to the nearest keyframe.' : 'Re-encodes so the cut lands on the exact frame (slower).'}
              </span>
            </div>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" className="glass-btn px-4 py-2 text-sm" onClick={onClose}>
                Cancel
              </button>
              {onExportClip && (
                <button type="button" className="glass-btn px-4 py-2 text-sm" onClick={() => onExportClip(start, end)}>
                  Make a GIF or sticker of this part
                </button>
              )}
              <button type="button" className="glass-btn px-4 py-2 text-sm" onClick={() => onConfirm(start, end, mode)}>
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
// --- end: trim/trim-modal ---
