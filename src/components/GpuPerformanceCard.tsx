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

const SPEED_OPTIONS = [
  { value: 'auto' as AppSettings['gpuThreads'], label: 'Fast' },
  { value: 'low' as AppSettings['gpuThreads'], label: 'Low memory' },
]
const ENGINE_OPTIONS = [
  { value: 'auto' as AppSettings['upscaleEngine'], label: 'Auto' },
  { value: 'ncnn' as AppSettings['upscaleEngine'], label: 'Classic (ncnn)' },
]
const ENCODER_OPTIONS = [
  { value: 'auto' as AppSettings['videoEncoder'], label: 'GPU if possible' },
  { value: 'cpu' as AppSettings['videoEncoder'], label: 'CPU (x264)' },
]

// @category: settings/gpu-performance
/** Settings > Performance: how aggressively the AI upscaler and interpolator use the GPU. Stored by the
 *  main process (electron/settings.cjs), which applies it to every new job. */
export default function GpuPerformanceCard() {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    host.settings?.get().then(setSettings)
  }, [])

  function change(patch: Parameters<NonNullable<typeof host.settings>['set']>[0]) {
    setSettings((s) => (s ? { ...s, ...patch, cookies: s.cookies } : s))
    void host.settings?.set(patch)
  }
  if (!settings) return null

  const row = 'flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between'
  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">GPU jobs</h2>
      <p className="mb-2 text-xs text-[var(--text-dim)]">
        How the AI upscaler and interpolator use your GPU. Changes apply to jobs you start afterwards.
      </p>
      <div className="flex flex-col">
        <div className={row}>
          <div>
            <span className="text-sm font-medium">GPU job speed</span>
            <p className="text-[11px] text-[var(--text-dim)]">Fast loads and saves frames in parallel. Pick Low memory if a job fails on an older GPU.</p>
          </div>
          <SlidingSelector id="gpu-threads" options={SPEED_OPTIONS} value={settings.gpuThreads} onChange={(v) => change({ gpuThreads: v })} className="w-full grid-cols-2 sm:w-64" />
        </div>
        <div className={`${row} border-t border-[var(--glass-border)]`}>
          <div>
            <span className="text-sm font-medium">Video upscaling engine</span>
            <p className="text-[11px] text-[var(--text-dim)]">Auto uses the faster PyTorch engine when it is installed (about 1.5 to 3.5× faster, no temp files), otherwise the classic one.</p>
          </div>
          <SlidingSelector id="upscale-engine" options={ENGINE_OPTIONS} value={settings.upscaleEngine} onChange={(v) => change({ upscaleEngine: v })} className="w-full grid-cols-2 sm:w-64" />
        </div>
        <div className={`${row} border-t border-[var(--glass-border)]`}>
          <div>
            <span className="text-sm font-medium">AI video encoder</span>
            <p className="text-[11px] text-[var(--text-dim)]">GPU (NVENC) encoding is faster and falls back to the CPU by itself; CPU gives slightly smaller files.</p>
          </div>
          <SlidingSelector id="video-encoder" options={ENCODER_OPTIONS} value={settings.videoEncoder} onChange={(v) => change({ videoEncoder: v })} className="w-full grid-cols-2 sm:w-64" />
        </div>
      </div>
    </div>
  )
}
// --- end: settings/gpu-performance ---
