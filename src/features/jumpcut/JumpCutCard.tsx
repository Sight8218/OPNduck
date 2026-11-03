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
import ProgressBar from '../../components/ProgressBar'
import SlidingSelector from '../../components/SlidingSelector'
import Tag from '../../components/Tag'
import TaskLogs from '../../components/TaskLogs'
import { host, type JumpCutAnalysis, type LoudnessTarget, type MediaInfo } from '../../host'
import { getDownloadDirOverride } from '../../lib/downloadPrefs'
import { formatBytes } from '../../lib/formatBytes'
import { useSubmittedIds } from '../../lib/submittedTasks'
import { useTasks } from '../../lib/useTasks'
import type { FeatureDefinition } from '../registry'
import { formatTime } from '../trim/time'

const EXTENSIONS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'mp3', 'wav', 'flac', 'm4a', 'ogg', 'opus']
const LOUDNESS = [
  { value: 'off' as LoudnessTarget, label: 'Off' },
  { value: 'podcast' as LoudnessTarget, label: 'Podcast' },
  { value: 'broadcast' as LoudnessTarget, label: 'Broadcast' },
]
const LOUDNESS_HINT: Record<LoudnessTarget, string> = {
  off: 'Leave the volume as it is.',
  podcast: 'Evens the loudness out to -14 LUFS, what YouTube and Spotify play at.',
  broadcast: 'Evens the loudness out to -23 LUFS, the TV and radio standard.',
}

const basename = (p: string) => p.split(/[/\\]/).pop() ?? p
const clean = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

function Slider({ id, label, value, min, max, step, unit, onChange, disabled }: { id: string; label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 flex justify-between text-xs font-medium text-[var(--text-dim)]">
        <span>{label}</span>
        <span>
          {value}
          {unit}
        </span>
      </label>
      <input id={id} type="range" className="w-full accent-[var(--accent)]" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled} />
    </div>
  )
}

// @category: jumpcut/jumpcut-card
/** Jump cuts for talking videos and podcasts: removes the silences and/or evens out the loudness. */
export default function JumpCutCard({ feature }: { feature: FeatureDefinition }) {
  const [file, setFile] = useState<string | null>(null)
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [cut, setCut] = useState(true)
  const [thresholdDb, setThresholdDb] = useState(-30)
  const [minSilence, setMinSilence] = useState(0.5)
  const [padding, setPadding] = useState(0.15)
  const [normalize, setNormalize] = useState<LoudnessTarget>('off')
  const [audioOnly, setAudioOnly] = useState(false)
  const [preview, setPreview] = useState<JumpCutAnalysis | 'checking' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submittedIds, setSubmittedIds] = useSubmittedIds('jumpcut')

  const tasks = useTasks()
  const submitted = tasks.filter((t) => submittedIds.includes(t.id))
  const running = submitted.some((t) => t.status === 'queued' || t.status === 'running')

  useEffect(() => {
    if (!file) return
    let alive = true
    void host.probeMedia(file).then((i) => {
      if (!alive) return
      setInfo(i)
      setError(i ? null : "Couldn't read that file.")
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

  async function check() {
    if (!file) return
    setError(null)
    setPreview('checking')
    try {
      setPreview(await host.analyzeJumpCut({ inputPath: file, thresholdDb, minSilence, padding }))
    } catch (err) {
      setPreview(null)
      setError(clean(err))
    }
  }

  async function run() {
    if (!file) return
    setError(null)
    try {
      const id = await host.tasks.startJumpCut({ inputPath: file, cut, thresholdDb, minSilence, padding, normalize, audioOnly, destination: getDownloadDirOverride() ?? undefined })
      setSubmittedIds([id])
    } catch (err) {
      setError(clean(err))
    }
  }

  const noVideo = !!info && !info.hasVideo
  return (
    <FeatureCard feature={feature} onDropFiles={running ? undefined : (paths) => paths[0] && choose(paths[0])} dropExtensions={EXTENSIONS}>
      <button type="button" className="glass-btn" onClick={pick} disabled={running}>
        {file ? 'Choose another file…' : 'Choose a video or audio file…'}
      </button>
      {file && (
        <span className="truncate text-xs text-[var(--text-dim)]">
          {basename(file)}
          {info ? ` — ${formatTime(info.duration)}` : ''}
        </span>
      )}
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" className="accent-[var(--accent)]" checked={cut} onChange={(e) => (setCut(e.target.checked), setPreview(null))} disabled={running} />
        Cut the silences
      </label>
      {cut && (
        <div className="flex flex-col gap-3">
          <Slider id="jc-level" label="Silence level" value={thresholdDb} min={-60} max={-15} step={1} unit=" dB" onChange={(v) => (setThresholdDb(v), setPreview(null))} disabled={running} />
          <Slider id="jc-min" label="Shortest silence to cut" value={minSilence} min={0.2} max={3} step={0.1} unit=" s" onChange={(v) => (setMinSilence(Math.round(v * 10) / 10), setPreview(null))} disabled={running} />
          <Slider id="jc-pad" label="Keep around each cut" value={padding} min={0} max={1} step={0.05} unit=" s" onChange={(v) => (setPadding(Math.round(v * 100) / 100), setPreview(null))} disabled={running} />
          <button type="button" className="glass-btn" onClick={() => void check()} disabled={!file || running || preview === 'checking'}>
            {preview === 'checking' ? 'Listening…' : 'See how much would be cut'}
          </button>
          {preview && preview !== 'checking' && (
            <span className="text-xs text-[var(--text-dim)]">
              Removes {formatTime(preview.removedSeconds)} of {formatTime(preview.duration)} ({preview.parts} parts stay).
            </span>
          )}
        </div>
      )}
      <div>
        <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Normalize loudness</span>
        <SlidingSelector id="jc-loud" options={LOUDNESS} value={normalize} onChange={setNormalize} className="w-full grid-cols-3" />
        <span className="mt-1 block text-[11px] text-[var(--text-faint)]">{LOUDNESS_HINT[normalize]}</span>
      </div>
      {!noVideo && (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="accent-[var(--accent)]" checked={audioOnly} onChange={(e) => setAudioOnly(e.target.checked)} disabled={running} />
          Audio only (MP3, for podcasts)
        </label>
      )}
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
      <button type="button" className="glass-btn" onClick={() => void run()} disabled={!file || running || (!cut && normalize === 'off')}>
        {cut ? 'Cut silences' : 'Normalize'}
      </button>
    </FeatureCard>
  )
}
// --- end: jumpcut/jumpcut-card ---
