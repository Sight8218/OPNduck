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

import { useEffect, useRef } from 'react'
import type { TaskStatus } from '../host'
import { useReduceMotion } from '../lib/motionPrefs'

// @category: app/task-progress
/**
 * A progress bar that only moves forward and eases toward the reported value instead of jumping.
 * The width is written straight to the DOM from an animation frame loop (no React re-render per frame).
 * Tools report in bursts (and some restart their own percentages per stage), so the bar chases the
 * latest value at a gentle speed: far behind catches up faster, near the target it slows down.
 */
export default function ProgressBar({ value, status }: { value: number; status: TaskStatus }) {
  const fill = useRef<HTMLDivElement>(null)
  const state = useRef({ shown: value, target: value, raf: 0 })
  const { reduceMotion } = useReduceMotion()

  useEffect(() => {
    const s = state.current
    s.target = Math.max(s.target, Math.min(1, value)) // never retarget backwards
    const paint = () => {
      if (fill.current) fill.current.style.width = `${(s.shown * 100).toFixed(2)}%`
    }
    if (reduceMotion || status === 'error') {
      s.shown = status === 'error' ? Math.min(s.shown, s.target) : s.target
      paint()
      return
    }
    const finishing = status === 'done'
    const step = () => {
      const gap = s.target - s.shown
      if (gap > 0.0002) {
        // 8% of the remaining gap per frame (12% when finishing), but never slower than ~0.1% per frame.
        s.shown = Math.min(s.target, s.shown + Math.max(gap * (finishing ? 0.12 : 0.08), 0.001))
        paint()
        s.raf = requestAnimationFrame(step)
      } else {
        s.shown = s.target
        paint()
      }
    }
    cancelAnimationFrame(s.raf)
    s.raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(s.raf)
  }, [value, status, reduceMotion])

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--input-bg)]">
      <div
        ref={fill}
        className={`h-full rounded-full ${status === 'error' ? 'bg-red-500' : 'bg-[var(--accent)]'} ${status === 'running' ? 'progress-shimmer' : ''}`}
        style={{ width: `${(value * 100).toFixed(2)}%` }}
      />
    </div>
  )
}
// --- end: app/task-progress ---
