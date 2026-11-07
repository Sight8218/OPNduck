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

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { host } from '../host'
import { useWindowVisible } from '../lib/windowVisible'

// @category: scheduling/countdown
/** The 60 second countdown before the computer sleeps or shuts down after the queue finished, with a Cancel button. */
export default function QueueCountdown() {
  const [data, setData] = useState<{ action: 'sleep' | 'shutdown'; endsAt: number } | null>(null)
  const [left, setLeft] = useState(0)
  const visible = useWindowVisible()

  useEffect(() => host.schedule.onCountdown((d) => setData(d ? { action: d.action, endsAt: d.endsAt } : null)), [])
  useEffect(() => {
    if (!data || !visible) return // nobody is looking while the window is hidden; it ticks again (and catches up) when shown
    const tick = () => setLeft(Math.max(0, Math.ceil((data.endsAt - Date.now()) / 1000)))
    tick()
    const t = setInterval(tick, 500)
    return () => clearInterval(t)
  }, [data, visible])

  if (!data) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div role="alertdialog" aria-label="The queue is empty" className="glass flex w-full max-w-sm flex-col gap-3 rounded-3xl p-6">
        <h2 className="text-base font-bold">The queue is empty</h2>
        <p className="text-sm text-[var(--text-dim)]">
          This computer will {data.action === 'sleep' ? 'go to sleep' : 'shut down'} in {left} seconds.
        </p>
        <button
          type="button"
          className="glass-btn"
          autoFocus
          onClick={() => {
            void host.schedule.cancelCountdown()
            setData(null)
          }}
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  )
}
// --- end: scheduling/countdown ---
