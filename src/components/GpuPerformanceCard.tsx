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
import { host, type AppSettings } from '../host'
import SlidingSelector from './SlidingSelector'

const OPTIONS = [
  { value: 'auto' as AppSettings['gpuThreads'], label: 'Fast' },
  { value: 'low' as AppSettings['gpuThreads'], label: 'Low memory' },
]

// @category: settings/gpu-performance
/** Settings > Performance: how aggressively the AI upscaler and interpolator use the GPU. Stored by the
 *  main process (electron/settings.cjs), which applies it to every new job. */
export default function GpuPerformanceCard() {
  const [mode, setMode] = useState<AppSettings['gpuThreads']>('auto')

  useEffect(() => {
    host.settings?.get().then((s) => setMode(s.gpuThreads))
  }, [])

  function change(next: AppSettings['gpuThreads']) {
    setMode(next)
    void host.settings?.set({ gpuThreads: next })
  }

  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">GPU job speed</h2>
      <p className="mb-4 text-xs text-[var(--text-dim)]">
        Fast overlaps loading, upscaling and saving frames (up to about 2× quicker on small videos, less on large
        ones) and uses a little more memory. Pick Low memory if upscaling or interpolation fails on an older GPU.
        Applies to jobs you start after changing it.
      </p>
      <SlidingSelector id="gpu-threads" options={OPTIONS} value={mode} onChange={change} className="w-full grid-cols-2 sm:w-64" />
    </div>
  )
}
// --- end: settings/gpu-performance ---
