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
import { host } from '../host'

// @category: library/queue-pause
/** Whether the job queue is paused (no new jobs start; running ones finish). Live across windows. */
export function useQueuePaused(): boolean {
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    let alive = true
    void host.queue?.state().then((s) => alive && setPaused(s.paused))
    const off = host.queue?.subscribe((s) => setPaused(s.paused))
    return () => {
      alive = false
      off?.()
    }
  }, [])
  return paused
}
// --- end: library/queue-pause ---
