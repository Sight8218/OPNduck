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

import { useCallback, useEffect, useState } from 'react'
import { host, type ScheduleSettings, type ScheduleStatus } from '../host'
import GlassSelect from './GlassSelect'

const WHEN_DONE = [
  { value: 'nothing', label: 'Do nothing' },
  { value: 'notify', label: 'Show a notification' },
  { value: 'sleep', label: 'Put the computer to sleep' },
  { value: 'shutdown', label: 'Shut the computer down' },
] as const

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">{children}</div>
      <span className="sr-only">{label}</span>
      {hint && <span className="text-[11px] text-[var(--text-dim)]">{hint}</span>}
    </div>
  )
}

// @category: settings/scheduling
/** Settings > Smart scheduling: when heavy jobs may start, battery and heat limits, and what happens when the queue is empty. */
export default function SchedulingCard() {
  const [sc, setSc] = useState<ScheduleSettings | null>(null)
  const [status, setStatus] = useState<ScheduleStatus | null>(null)
  const [error, setError] = useState('')
  const [askPower, setAskPower] = useState<'sleep' | 'shutdown' | null>(null)

  const loadStatus = useCallback(() => void host.schedule.status().then(setStatus), [])
  useEffect(() => {
    void host.settings?.get().then((s) => setSc(s.schedule))
    loadStatus()
    return host.schedule.onChange(loadStatus)
  }, [loadStatus])
  if (!sc) return null

  async function save(patch: Partial<ScheduleSettings>) {
    setError('')
    try {
      const next = await host.settings!.set({ schedule: patch })
      setSc(next.schedule)
      loadStatus()
    } catch (e) {
      setError(clean(e))
    }
  }

  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">Smart scheduling</h2>
      <p className="mb-3 text-xs text-[var(--text-dim)]">
        Rules for heavy jobs (conversions, GPU work, transcription). A job that has to wait says why in the Library. Downloads are not held unless you tick that below.
      </p>
      {status?.reason && <p className="mb-3 rounded-xl bg-[var(--input-bg)] p-2 text-xs">Right now heavy jobs are held: {status.reason}.</p>}
      <div className="flex flex-col gap-4">
        <Row label="Time window" hint="Heavy jobs only start inside this window. Jobs outside it wait.">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" className="accent-[var(--accent)]" checked={sc.window} onChange={(e) => void save({ window: e.target.checked })} />
            Only start heavy jobs between
          </label>
          <input type="time" aria-label="From" className="glass-input w-28" value={sc.from} onChange={(e) => e.target.value && void save({ from: e.target.value })} />
          and
          <input type="time" aria-label="To" className="glass-input w-28" value={sc.to} onChange={(e) => e.target.value && void save({ to: e.target.value })} />
        </Row>
        <Row label="Battery" hint="Waits until the charger is plugged in. Does nothing on a desktop PC.">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" className="accent-[var(--accent)]" checked={sc.battery} onChange={(e) => void save({ battery: e.target.checked })} />
            Hold heavy jobs while on battery
          </label>
        </Row>
        <Row label="Heat" hint={`Pauses the running GPU job above the limit and continues it ${8} degrees cooler. Reads the GPU temperature with nvidia-smi (or the AMD sensor). Not on Windows: there, new jobs wait but a running one finishes.`}>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" className="accent-[var(--accent)]" checked={sc.heat} onChange={(e) => void save({ heat: e.target.checked })} />
            Pause GPU jobs above
          </label>
          <input type="number" aria-label="Temperature limit" className="glass-input w-20" min={60} max={100} value={sc.maxC} onChange={(e) => void save({ maxC: Number(e.target.value) })} />
          °C
          {status?.hot && <span className="text-xs text-amber-400">Cooling down{status.temp != null ? ` (${status.temp} °C)` : ''}</span>}
        </Row>
        <Row label="Away" hint="Starts waiting heavy jobs once you have not touched the keyboard or mouse for this long.">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" className="accent-[var(--accent)]" checked={sc.idle} onChange={(e) => void save({ idle: e.target.checked })} />
            Only start heavy jobs after I have been away
          </label>
          <input type="number" aria-label="Minutes away" className="glass-input w-20" min={1} max={240} value={sc.idleMinutes} onChange={(e) => void save({ idleMinutes: Number(e.target.value) })} />
          minutes
        </Row>
        <Row label="Downloads">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" className="accent-[var(--accent)]" checked={sc.downloads} onChange={(e) => void save({ downloads: e.target.checked })} />
            These rules hold downloads too
          </label>
        </Row>
        <Row label="When the queue finishes" hint="After the last job finishes. Sleep and shut down show a 60 second countdown with a Cancel button.">
          <span>When the queue finishes:</span>
          <div className="w-60">
            <GlassSelect
              id="sched-when-done"
              options={WHEN_DONE.map((o) => ({ value: o.value as string, label: o.label }))}
              value={sc.whenDone}
              onChange={(v) => {
                if ((v === 'sleep' || v === 'shutdown') && !sc.powerConfirmed) setAskPower(v)
                else void save({ whenDone: v as ScheduleSettings['whenDone'] })
              }}
            />
          </div>
        </Row>
        {askPower && (
          <div className="rounded-xl bg-[var(--input-bg)] p-3 text-xs">
            <p className="mb-2">
              OPNduck will {askPower === 'sleep' ? 'put this computer to sleep' : 'shut this computer down'} when the queue finishes, after a 60 second countdown you can cancel. Unsaved work in other programs would be lost on a shutdown. Allow it?
            </p>
            <div className="flex gap-2">
              <button type="button" className="glass-btn px-3 py-1" onClick={() => void save({ powerConfirmed: true, whenDone: askPower }).then(() => setAskPower(null))}>
                Yes, allow it
              </button>
              <button type="button" className="glass-btn px-3 py-1" onClick={() => setAskPower(null)}>
                No
              </button>
            </div>
          </div>
        )}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  )
}
// --- end: settings/scheduling ---
