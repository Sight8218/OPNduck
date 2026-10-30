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

const opts = (max: number) => Array.from({ length: max }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))

// @category: settings/job-queue
/** Settings > Job queue: how many downloads / conversions run at once. (Pause lives in the Library.) */
export default function QueueCard() {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    host.settings?.get().then(setSettings)
  }, [])

  function change(patch: { maxDownloads?: number; maxConversions?: number }) {
    setSettings((s) => (s ? { ...s, ...patch } : s))
    void host.settings?.set(patch)
  }
  if (!settings) return null

  const row = 'flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between'
  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">Job queue</h2>
      <p className="mb-2 text-xs text-[var(--text-dim)]">
        How many jobs of a kind run at once; the rest wait in line. You can pause the whole queue or move a job up from the Library.
        AI upscaling, interpolation and subtitles always run one at a time so they don't fight over the GPU.
      </p>
      <div className="flex flex-col">
        <div className={row}>
          <span className="text-sm font-medium">Parallel downloads</span>
          <SlidingSelector id="max-downloads" options={opts(6)} value={String(settings.maxDownloads)} onChange={(v) => change({ maxDownloads: Number(v) })} className="w-full grid-cols-6 sm:w-72" />
        </div>
        <div className={`${row} border-t border-[var(--glass-border)]`}>
          <span className="text-sm font-medium">Parallel conversions</span>
          <SlidingSelector id="max-conversions" options={opts(4)} value={String(settings.maxConversions)} onChange={(v) => change({ maxConversions: Number(v) })} className="w-full grid-cols-4 sm:w-56" />
        </div>
      </div>
    </div>
  )
}
// --- end: settings/job-queue ---
