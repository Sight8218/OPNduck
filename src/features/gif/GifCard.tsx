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
import { host, type GifPreset, type MediaInfo } from '../../host'
import { getDownloadDirOverride } from '../../lib/downloadPrefs'
import { takeClipHandoff } from '../../lib/clipHandoff'
import { formatBytes } from '../../lib/formatBytes'
import { useSubmittedIds } from '../../lib/submittedTasks'
import { useTasks } from '../../lib/useTasks'
import type { FeatureDefinition } from '../registry'
import TrimModal from '../trim/TrimModal'
import { formatTime, parseTime } from '../trim/time'

const EXTENSIONS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'gif']
const PRESETS: { value: GifPreset; label: string; hint: string; maxSeconds: number }[] = [
  { value: 'gif', label: 'GIF', hint: 'Works everywhere. Big files for long clips.', maxSeconds: 60 },
  { value: 'webp', label: 'Animated WebP', hint: 'Smaller than a GIF and sharper; most apps and browsers open it.', maxSeconds: 60 },
  { value: 'telegram', label: 'Telegram sticker', hint: 'WebM, up to 512 px, at most 3 seconds and 256 KB, no sound.', maxSeconds: 3 },
  { value: 'discord', label: 'Discord sticker', hint: 'APNG, up to 320 px and 512 KB.', maxSeconds: 15 },
]
const WIDTHS = [320, 480, 640]
const FPS = [10, 15, 20, 30]

const basename = (p: string) => p.split(/[/\\]/).pop() ?? p

// @category: gif/gif-card
/** Turn a section of a video into a GIF, an animated WebP or a Telegram/Discord sticker. */
export default function GifCard({ feature }: { feature: FeatureDefinition }) {
  const [file, setFile] = useState<string | null>(null)
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [start, setStart] = useState('0:00')
  const [end, setEnd] = useState('')
  const [preset, setPreset] = useState<GifPreset>('gif')
  const [width, setWidth] = useState(480)
  const [fps, setFps] = useState(15)
  const [loop, setLoop] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submittedIds, setSubmittedIds] = useSubmittedIds('gif')

  const tasks = useTasks()
  const submitted = tasks.filter((t) => submittedIds.includes(t.id))
  const running = submitted.some((t) => t.status === 'queued' || t.status === 'running')
  const current = PRESETS.find((p) => p.value === preset)!
  const isSticker = preset === 'telegram' || preset === 'discord'

  // A section picked in the trimmer arrives here.
  useEffect(() => {
    const clip = takeClipHandoff()
    if (!clip) return
    setFile(clip.file)
    setStart(formatTime(clip.start))
    setEnd(formatTime(clip.end))
  }, [])

  useEffect(() => {
    if (!file) return
    let alive = true
    host.probeMedia(file).then((i) => {
      if (!alive) return
      setInfo(i)
      setError(i && i.hasVideo ? null : "That isn't a video file.")
    })
    return () => {
      alive = false
    }
  }, [file])

  async function pick() {
    const p = await host.pickFile({ extensions: EXTENSIONS })
    if (p) {
      setFile(p)
      setStart('0:00')
      setEnd('')
    }
  }

  async function run(override?: { start: number; end: number }) {
    if (!file || !info) return
    const s = override ? override.start : parseTime(start)
    const e = override ? override.end : end.trim() ? parseTime(end) : null
    if (s == null || (end.trim() && !override && e == null)) return setError('Use times like 1:23 or 1:02:03.')
    if (s >= info.duration) return setError('The start is past the end of the file.')
    if (e != null && e <= s) return setError('The end must be after the start.')
    if (e != null && e - s > current.maxSeconds) return setError(`${current.label} can be at most ${current.maxSeconds} seconds long.`)
    setError(null)
    try {
      const id = await host.tasks.startGif({ inputPath: file, preset, start: s, end: e, ...(isSticker ? {} : { width, fps, loop }), destination: getDownloadDirOverride() ?? undefined })
      setSubmittedIds([id])
    } catch (err) {
      setError((err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
    }
  }

  return (
    <FeatureCard feature={feature} onDropFiles={running ? undefined : (paths) => paths[0] && setFile(paths[0])} dropExtensions={EXTENSIONS}>
      {/* Two columns when there is room: the clip on the left, the output settings and the result on the right. */}
      <div className="grid gap-x-6 gap-y-2 lg:grid-cols-2">
      <div className="flex flex-col gap-2">
      <button type="button" className="glass-btn" onClick={pick} disabled={running}>
        {file ? 'Choose another video…' : 'Choose a video…'}
      </button>
      {file && (
        <span className="truncate text-xs text-[var(--text-dim)]">
          {basename(file)}
          {info ? ` — ${formatTime(info.duration)}${info.width ? `, ${info.width}×${info.height}` : ''}` : ''}
        </span>
      )}
      {file && info?.hasVideo && (
        <button type="button" className="glass-btn" onClick={() => setModalOpen(true)} disabled={running}>
          Pick the part visually…
        </button>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="gif-start" className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Start</label>
          <input id="gif-start" className="glass-input" value={start} onChange={(e) => setStart(e.target.value)} placeholder="0:00" disabled={running} />
        </div>
        <div>
          <label htmlFor="gif-end" className="mb-1 block text-xs font-medium text-[var(--text-dim)]">End</label>
          <input id="gif-end" className="glass-input" value={end} onChange={(e) => setEnd(e.target.value)} placeholder={`up to ${current.maxSeconds} s`} disabled={running} />
        </div>
      </div>
      <div>
        <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Make a</span>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              disabled={running}
              aria-pressed={preset === p.value}
              onClick={() => setPreset(p.value)}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                preset === p.value ? 'border-[var(--input-border-focus)] bg-[var(--input-bg)] text-[var(--accent)]' : 'border-[var(--glass-border)] text-[var(--text-dim)] hover:text-[var(--text)]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="mt-1 block text-[11px] text-[var(--text-faint)]">{current.hint}</span>
      </div>
      </div>
      <div className="flex flex-col gap-2">
      {!isSticker && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Width</span>
              <SlidingSelector id="gif-width" options={WIDTHS.map((w) => ({ value: String(w), label: `${w}` }))} value={String(width)} onChange={(v) => setWidth(Number(v))} className="w-full grid-cols-3" />
            </div>
            <div>
              <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Frames per second</span>
              <SlidingSelector id="gif-fps" options={FPS.map((f) => ({ value: String(f), label: String(f) }))} value={String(fps)} onChange={(v) => setFps(Number(v))} className="w-full grid-cols-4" />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-3 py-1">
            <input type="checkbox" className="accent-[var(--accent)]" checked={loop} disabled={running} onChange={(e) => setLoop(e.target.checked)} />
            <span className="text-sm font-medium">Loop forever</span>
          </label>
        </>
      )}
      {isSticker && <span className="text-[11px] text-[var(--text-faint)]">If the file comes out over the limit, OPNduck lowers the frame rate, then the size, then the quality until it fits.</span>}
      {error && <span className="text-xs text-red-400">{error}</span>}
      {submitted.map((t) => (
        <div key={t.id} className="flex flex-col gap-1">
          <ProgressBar value={t.progress} status={t.status} />
          <TaskLogs taskId={t.id} />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-xs text-[var(--text-dim)]">{t.status === 'error' ? t.error : t.label}</span>
            {t.status === 'done' && (
              <>
                <Tag>{t.quality}</Tag>
                {formatBytes(t.sizeBytes) && <Tag>{formatBytes(t.sizeBytes)}</Tag>}
              </>
            )}
          </div>
        </div>
      ))}
      <button type="button" className="glass-btn" onClick={() => void run()} disabled={!file || !info || !info.hasVideo || running}>
        Make {current.label}
      </button>
      </div>
      </div>
      {file && info && (
        <TrimModal
          open={modalOpen}
          file={file}
          info={info}
          initial={{ start: parseTime(start) ?? 0, end: parseTime(end) ?? Math.min(info.duration, (parseTime(start) ?? 0) + Math.min(current.maxSeconds, 5)), mode: 'fast' }}
          confirmLabel="Use this part"
          hideMode
          onClose={() => setModalOpen(false)}
          onConfirm={(s, e) => {
            setModalOpen(false)
            setStart(formatTime(s))
            setEnd(formatTime(e))
          }}
        />
      )}
    </FeatureCard>
  )
}
