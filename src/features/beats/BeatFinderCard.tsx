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

import { useEffect, useRef, useState } from 'react'
import FeatureCard from '../../components/FeatureCard'
import InstallToolPanel from '../../components/InstallToolPanel'
import ProgressBar from '../../components/ProgressBar'
import SlidingSelector from '../../components/SlidingSelector'
import Tag from '../../components/Tag'
import TaskLogs from '../../components/TaskLogs'
import { host, type BeatAnalysis, type ToolStatus } from '../../host'
import { getDownloadDirOverride } from '../../lib/downloadPrefs'
import { formatBytes } from '../../lib/formatBytes'
import { useSubmittedIds } from '../../lib/submittedTasks'
import { useTasks } from '../../lib/useTasks'
import type { FeatureDefinition } from '../registry'
import { formatTime } from '../trim/time'
import { beatsChapters, beatsCsv, gridFrom, tapBpm } from './beatMath'

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'opus', 'aac']
const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v']
const TAGGABLE = ['mp3', 'flac', 'ogg', 'opus']
const EVERY = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '4', label: '4' },
  { value: '8', label: '8' },
]

const basename = (p: string) => p.split(/[/\\]/).pop() ?? p
const clean = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

function save(name: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

/** The waveform outline with a line on every beat and a marker on each drop. */
function Waveform({ analysis, beats }: { analysis: BeatAnalysis; beats: number[] }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ratio = window.devicePixelRatio || 1
    const w = c.clientWidth
    const h = c.clientHeight
    c.width = w * ratio
    c.height = h * ratio
    const g = c.getContext('2d')!
    g.scale(ratio, ratio)
    const css = getComputedStyle(c)
    const accent = css.getPropertyValue('--accent').trim() || '#e1892f'
    const dim = css.getPropertyValue('--text-dim').trim() || '#a29b90'
    g.clearRect(0, 0, w, h)
    g.fillStyle = dim
    const n = analysis.peaks.length
    analysis.peaks.forEach((p, i) => {
      const bar = Math.max(1, p * (h - 8))
      g.fillRect((i / n) * w, (h - bar) / 2, Math.max(1, w / n - 0.5), bar)
    })
    g.fillStyle = accent
    for (const b of beats) g.fillRect((b / analysis.duration) * w, 0, 1, h)
    g.fillStyle = '#ffffff'
    for (const d of analysis.drops) g.fillRect((d / analysis.duration) * w - 1, 0, 3, 10)
  }, [analysis, beats])
  return <canvas ref={canvas} className="h-24 w-full rounded-xl bg-[var(--input-bg)]" aria-label="Waveform with the beats marked" />
}

// @category: beats/beat-finder-card
/** Beat Finder: the tempo, beats and key of a song, tags, and a video montage cut to the beat. */
export default function BeatFinderCard({ feature }: { feature: FeatureDefinition }) {
  const [tool, setTool] = useState<ToolStatus | null>(null)
  const [file, setFile] = useState<string | null>(null)
  const [writeTags, setWriteTags] = useState(false)
  const [analysis, setAnalysis] = useState<BeatAnalysis | null>(null)
  const [bpm, setBpm] = useState<number | null>(null) // the tapped tempo, when it overrides the analysis
  const [taps, setTaps] = useState<number[]>([])
  const [clips, setClips] = useState<string[]>([])
  const [every, setEvery] = useState('4')
  const [shuffle, setShuffle] = useState(false)
  const [skip, setSkip] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [ids, setIds] = useSubmittedIds('beats')
  const [cutIds, setCutIds] = useSubmittedIds('beatcut')

  const tasks = useTasks()
  const job = tasks.filter((t) => ids.includes(t.id))
  const cuts = tasks.filter((t) => cutIds.includes(t.id))
  const running = [...job, ...cuts].some((t) => t.status === 'queued' || t.status === 'running')

  useEffect(() => {
    void host.checkBeats().then(setTool)
  }, [])

  // A finished analysis job brings its full result.
  const finished = job.find((t) => t.status === 'done')
  useEffect(() => {
    if (!finished) return
    let alive = true
    void host.beatsResult(finished.id).then((r) => alive && r && (setAnalysis(r), setBpm(null), setTaps([])))
    return () => {
      alive = false
    }
  }, [finished?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const beats = analysis ? (bpm ? gridFrom(analysis.beats[0] ?? 0, bpm, analysis.duration) : analysis.beats) : []
  const shownBpm = bpm ?? analysis?.bpm ?? null
  const ext = file?.split('.').pop()?.toLowerCase() ?? ''

  async function pick() {
    const p = await host.pickFile({ extensions: AUDIO_EXTENSIONS })
    if (p) {
      setFile(p)
      setAnalysis(null)
      setBpm(null)
      setTaps([])
    }
  }

  async function analyse() {
    if (!file) return
    setError(null)
    try {
      setIds([await host.tasks.startBeatAnalyze({ inputPath: file, writeTags: writeTags && TAGGABLE.includes(ext), destination: getDownloadDirOverride() ?? undefined })])
    } catch (err) {
      setError(clean(err))
    }
  }

  function tap() {
    const next = [...taps.filter((t) => Date.now() - t < 2500), Date.now()]
    setTaps(next)
    const b = tapBpm(next)
    if (b) setBpm(b)
  }

  async function addClips() {
    const picked = await host.pickFiles({ extensions: VIDEO_EXTENSIONS })
    if (picked?.length) setClips((c) => [...new Set([...c, ...picked])])
  }
  async function addFolder() {
    const dir = await host.pickFolder()
    if (dir) setClips((c) => [...new Set([...c, dir])])
  }

  async function makeCut() {
    if (!file || !analysis) return
    setError(null)
    try {
      setCutIds([await host.tasks.startBeatCut({ inputPath: file, clips, everyBeats: Number(every) as 1 | 2 | 4 | 8, shuffle, skipSeconds: skip, beats, destination: getDownloadDirOverride() ?? undefined })])
    } catch (err) {
      setError(clean(err))
    }
  }

  return (
    <FeatureCard feature={feature} onDropFiles={running ? undefined : (paths) => paths[0] && (setFile(paths[0]), setAnalysis(null))} dropExtensions={AUDIO_EXTENSIONS}>
      {tool && !tool.available && (
        <div className="flex flex-col gap-2 text-xs">
          <span className="text-[var(--text-dim)]">Beat Finder needs a small Python add-on (librosa, no PyTorch).</span>
          <InstallToolPanel tool="beats" sizeNote="about 250 MB" hint={tool.installHint} onInstalled={() => host.checkBeats().then(setTool)} />
        </div>
      )}
      <button type="button" className="glass-btn" onClick={pick} disabled={running}>
        {file ? 'Choose another song…' : 'Choose a song…'}
      </button>
      {file && <span className="truncate text-xs text-[var(--text-dim)]">{basename(file)}</span>}
      {file && TAGGABLE.includes(ext) && (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="accent-[var(--accent)]" checked={writeTags} onChange={(e) => setWriteTags(e.target.checked)} disabled={running} />
          Also write BPM and key into a tagged copy
        </label>
      )}
      <button type="button" className="glass-btn" onClick={() => void analyse()} disabled={!file || running || !tool?.available}>
        Find the beat
      </button>
      {job.map((t) => (
        <div key={t.id} className="flex flex-col gap-1">
          <ProgressBar value={t.progress} status={t.status} />
          <TaskLogs taskId={t.id} />
          {t.status === 'error' && <span className="text-xs text-red-400">{t.error}</span>}
          {t.status === 'done' && formatBytes(t.sizeBytes) && <Tag>Tagged copy: {formatBytes(t.sizeBytes)}</Tag>}
        </div>
      ))}

      {analysis && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-1">
            <div>
              <span className="block text-3xl font-bold leading-none">{shownBpm}</span>
              <span className="text-[11px] text-[var(--text-dim)]">BPM{bpm ? ' (tapped)' : ''}</span>
            </div>
            <div>
              <span className="block text-xl font-bold leading-none">{analysis.key}</span>
              <span className="text-[11px] text-[var(--text-dim)]">Camelot {analysis.camelot}</span>
            </div>
            <span className="text-[11px] text-[var(--text-dim)]">
              {beats.length} beats · {formatTime(analysis.duration)}
            </span>
          </div>
          <Waveform analysis={analysis} beats={beats} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={tap}>
              Tap the tempo{taps.length ? ` (${taps.length})` : ''}
            </button>
            {bpm && (
              <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => (setBpm(null), setTaps([]))}>
                Use the found tempo
              </button>
            )}
            <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => save(`${basename(file ?? 'song').replace(/\.\w+$/, '')}-beats.csv`, beatsCsv(beats))}>
              Save beats (CSV)
            </button>
            <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => save(`${basename(file ?? 'song').replace(/\.\w+$/, '')}-chapters.txt`, beatsChapters(beats, analysis.duration))}>
              Save chapters
            </button>
          </div>
          <span className="text-[11px] text-[var(--text-faint)]">If the tempo is half or double what you hear, tap along to the music and the beats follow your tempo.</span>

          <div className="flex flex-col gap-2 border-t border-[var(--glass-border)] pt-3">
            <span className="text-sm font-bold">Make a beat-cut video</span>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => void addClips()} disabled={running}>
                Add clips…
              </button>
              <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => void addFolder()} disabled={running}>
                Add a folder…
              </button>
              {clips.length > 0 && (
                <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => setClips([])} disabled={running}>
                  Clear
                </button>
              )}
            </div>
            {clips.length > 0 && <span className="truncate text-xs text-[var(--text-dim)]">{clips.length} chosen: {clips.map(basename).join(', ')}</span>}
            <div>
              <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Switch clip every … beats</span>
              <SlidingSelector id="beat-every" options={EVERY} value={every} onChange={setEvery} className="w-full grid-cols-4" />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="accent-[var(--accent)]" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} disabled={running} />
              Shuffle the clips
            </label>
            <div>
              <label htmlFor="beat-skip" className="mb-1 flex justify-between text-xs font-medium text-[var(--text-dim)]">
                <span>Skip the start of every clip</span>
                <span>{skip} s</span>
              </label>
              <input id="beat-skip" type="range" className="w-full accent-[var(--accent)]" min={0} max={10} step={0.5} value={skip} onChange={(e) => setSkip(Number(e.target.value))} disabled={running} />
            </div>
            {cuts.map((t) => (
              <div key={t.id} className="flex flex-col gap-1">
                <ProgressBar value={t.progress} status={t.status} />
                <span className="truncate text-xs text-[var(--text-dim)]">{t.status === 'error' ? t.error : t.status === 'running' ? (t.stage ?? t.label) : t.label}</span>
                {t.status === 'done' && (
                  <div className="flex gap-1.5">
                    {t.quality && <Tag>{t.quality}</Tag>}
                    {formatBytes(t.sizeBytes) && <Tag>{formatBytes(t.sizeBytes)}</Tag>}
                  </div>
                )}
              </div>
            ))}
            <button type="button" className="glass-btn" onClick={() => void makeCut()} disabled={running || clips.length === 0}>
              Make the video
            </button>
          </div>
        </div>
      )}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </FeatureCard>
  )
}
// --- end: beats/beat-finder-card ---
