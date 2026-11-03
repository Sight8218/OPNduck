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
import FeatureCard from '../../components/FeatureCard'
import GlassSelect from '../../components/GlassSelect'
import ProgressBar from '../../components/ProgressBar'
import Tag from '../../components/Tag'
import TaskLogs from '../../components/TaskLogs'
import { host, type DenoiseLevel, type MediaInfo, type RestorePreview } from '../../host'
import { getDownloadDirOverride } from '../../lib/downloadPrefs'
import { formatBytes } from '../../lib/formatBytes'
import { useSubmittedIds } from '../../lib/submittedTasks'
import { useTasks } from '../../lib/useTasks'
import type { FeatureDefinition } from '../registry'
import { formatTime } from '../trim/time'

const EXTENSIONS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'mpg', 'mpeg', 'ts', 'wmv', 'flv']
const DENOISE: { value: DenoiseLevel; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'light', label: 'Light (grain)' },
  { value: 'medium', label: 'Medium (VHS, old camera)' },
  { value: 'strong', label: 'Strong (slow)' },
]

const basename = (p: string) => p.split(/[/\\]/).pop() ?? p
const clean = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

function Check({ id, checked, onChange, disabled, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean; label: string; hint: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2 text-sm">
      <input id={id} type="checkbox" className="mt-1 accent-[var(--accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span>
        {label}
        <span className="block text-[11px] text-[var(--text-dim)]">{hint}</span>
      </span>
    </label>
  )
}

/** The original frame with the restored one revealed from the left by a slider. */
function BeforeAfter({ preview }: { preview: RestorePreview }) {
  const [pos, setPos] = useState(50)
  if (!preview.before || !preview.after) return <span className="text-xs text-red-400">Couldn't make a preview of this video.</span>
  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-xl">
        <img src={preview.before} alt="Before" className="block w-full" />
        <img src={preview.after} alt="After" className="absolute inset-0 block w-full" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-[var(--accent)]" style={{ left: `${pos}%` }} />
        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 text-[10px]">After</span>
        <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 text-[10px]">Before</span>
      </div>
      <input type="range" aria-label="Before and after" className="w-full accent-[var(--accent)]" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} />
      {!preview.applied && <span className="text-[11px] text-[var(--text-dim)]">Nothing here would change this frame: it is not interlaced and no other fix is on.</span>}
    </div>
  )
}

// @category: restore/restore-card
/** Restore old video: deinterlace, denoise, stabilize and fix colors in one pass, then optionally upscale and smooth the motion. */
export default function RestoreCard({ feature }: { feature: FeatureDefinition }) {
  const [file, setFile] = useState<string | null>(null)
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [deinterlace, setDeinterlace] = useState(true)
  const [denoise, setDenoise] = useState<DenoiseLevel>('off')
  const [stabilize, setStabilize] = useState(false)
  const [fixColors, setFixColors] = useState(false)
  const [upscale, setUpscale] = useState(false)
  const [interpolate, setInterpolate] = useState(false)
  const [preview, setPreview] = useState<RestorePreview | 'working' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submittedIds, setSubmittedIds] = useSubmittedIds('restore')

  const tasks = useTasks()
  const submitted = tasks.filter((t) => submittedIds.includes(t.id))
  const running = submitted.some((t) => t.status === 'queued' || t.status === 'running')

  useEffect(() => {
    if (!file) return
    let alive = true
    void host.probeMedia(file).then((i) => {
      if (!alive) return
      setInfo(i)
      setError(i && i.hasVideo ? null : "Couldn't read a video in that file.")
    })
    return () => {
      alive = false
    }
  }, [file])

  function choose(p: string) {
    setFile(p)
    setPreview(null)
  }
  async function pick() {
    const p = await host.pickFile({ extensions: EXTENSIONS })
    if (p) choose(p)
  }

  async function makePreview() {
    if (!file) return
    setError(null)
    setPreview('working')
    try {
      setPreview(await host.previewRestore({ inputPath: file, deinterlace: deinterlace ? 'auto' : 'off', denoise, fixColors, width: 640 }))
    } catch (err) {
      setPreview(null)
      setError(clean(err))
    }
  }

  const anything = deinterlace || denoise !== 'off' || stabilize || fixColors || upscale || interpolate
  async function run() {
    if (!file) return
    setError(null)
    try {
      const id = await host.tasks.startRestore({ inputPath: file, deinterlace: deinterlace ? 'auto' : 'off', denoise, stabilize, fixColors, upscale, interpolate, destination: getDownloadDirOverride() ?? undefined })
      setSubmittedIds([id])
    } catch (err) {
      setError(clean(err))
    }
  }

  return (
    <FeatureCard feature={feature} onDropFiles={running ? undefined : (paths) => paths[0] && choose(paths[0])} dropExtensions={EXTENSIONS}>
      <button type="button" className="glass-btn" onClick={pick} disabled={running}>
        {file ? 'Choose another video…' : 'Choose a video…'}
      </button>
      {file && (
        <span className="truncate text-xs text-[var(--text-dim)]">
          {basename(file)}
          {info ? ` — ${formatTime(info.duration)}${info.width ? `, ${info.width}×${info.height}` : ''}` : ''}
        </span>
      )}
      <Check id="rs-deint" checked={deinterlace} onChange={(v) => (setDeinterlace(v), setPreview(null))} disabled={running} label="Deinterlace" hint="Fixes the comb-like lines on old TV, DV and camcorder footage. Only done when the video is interlaced." />
      <div>
        <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Remove noise</span>
        <GlassSelect id="rs-denoise" options={DENOISE.map((d) => ({ value: d.value as string, label: d.label }))} value={denoise} onChange={(v) => (setDenoise(v as DenoiseLevel), setPreview(null))} />
      </div>
      <Check id="rs-colors" checked={fixColors} onChange={(v) => (setFixColors(v), setPreview(null))} disabled={running} label="Fix colors" hint="Evens out faded or dark footage with automatic levels." />
      <Check id="rs-stab" checked={stabilize} onChange={setStabilize} disabled={running} label="Stabilize" hint="Steadies shaky handheld footage (two passes; crops the edges a little). Not shown in the preview." />
      <Check id="rs-up" checked={upscale} onChange={setUpscale} disabled={running} label="Then upscale 2×" hint="Runs the AI upscaler on the result as a second job." />
      <Check id="rs-int" checked={interpolate} onChange={setInterpolate} disabled={running} label="Then smooth the motion" hint="Doubles the frame rate with RIFE as a last job." />
      {file && (
        <button type="button" className="glass-btn" onClick={() => void makePreview()} disabled={running || preview === 'working'}>
          {preview === 'working' ? 'Making a preview…' : 'Preview before and after'}
        </button>
      )}
      {preview && preview !== 'working' && <BeforeAfter preview={preview} />}
      {error && <span className="text-xs text-red-400">{error}</span>}
      {submitted.map((t) => (
        <div key={t.id} className="flex flex-col gap-1">
          <ProgressBar value={t.progress} status={t.status} />
          <TaskLogs taskId={t.id} />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-xs text-[var(--text-dim)]">{t.status === 'error' ? t.error : t.label}</span>
            {t.status === 'done' && (
              <>
                {t.quality && <Tag>{t.quality}</Tag>}
                {formatBytes(t.sizeBytes) && <Tag>{formatBytes(t.sizeBytes)}</Tag>}
              </>
            )}
          </div>
        </div>
      ))}
      <button type="button" className="glass-btn" onClick={() => void run()} disabled={!file || !info?.hasVideo || running || !anything}>
        Restore
      </button>
    </FeatureCard>
  )
}
// --- end: restore/restore-card ---
