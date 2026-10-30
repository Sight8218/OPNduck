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
import { host, type MediaInfo, type TrimMode } from '../../host'
import { getDownloadDirOverride } from '../../lib/downloadPrefs'
import { formatBytes } from '../../lib/formatBytes'
import { useSubmittedIds } from '../../lib/submittedTasks'
import { useTasks } from '../../lib/useTasks'
import type { FeatureDefinition } from '../registry'
import TrimModal from './TrimModal'
import { formatTime, parseTime } from './time'

const EXTENSIONS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'mp3', 'wav', 'flac', 'm4a', 'ogg', 'opus']
const MODES = [
  { value: 'fast' as TrimMode, label: 'Fast cut' },
  { value: 'precise' as TrimMode, label: 'Precise' },
]

const basename = (p: string) => p.split(/[/\\]/).pop() ?? p

// @category: trim/trim-card
/** Cut a section out of a video or audio file: instantly (stream copy) or frame-exact (re-encode). */
export default function TrimCard({ feature }: { feature: FeatureDefinition }) {
  const [file, setFile] = useState<string | null>(null)
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [start, setStart] = useState('0:00')
  const [end, setEnd] = useState('')
  const [mode, setMode] = useState<TrimMode>('fast')
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [submittedIds, setSubmittedIds] = useSubmittedIds('trim')

  const tasks = useTasks()
  const submitted = tasks.filter((t) => submittedIds.includes(t.id))
  const running = submitted.some((t) => t.status === 'queued' || t.status === 'running')

  useEffect(() => {
    if (!file) return
    let alive = true
    host.probeMedia(file).then((i) => {
      if (!alive) return
      setInfo(i)
      setEnd(i ? formatTime(i.duration) : '')
      setError(i ? null : "Couldn't read that file.")
    })
    return () => {
      alive = false
    }
  }, [file])

  async function pick() {
    const p = await host.pickFile({ extensions: EXTENSIONS })
    if (p) setFile(p)
  }

  async function run(override?: { start: number; end: number; mode: TrimMode }) {
    if (!file || !info) return
    const s = override ? override.start : parseTime(start)
    const e = override ? override.end : end.trim() ? parseTime(end) : null
    if (s == null || (end.trim() && e == null)) return setError('Use times like 1:23 or 1:02:03.')
    if (s >= info.duration) return setError('The start is past the end of the file.')
    if (e != null && e <= s) return setError('The end must be after the start.')
    setError(null)
    try {
      const id = await host.tasks.startTrim({ inputPath: file, start: s, end: e, mode: override?.mode ?? mode, destination: getDownloadDirOverride() ?? undefined })
      setSubmittedIds([id])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <FeatureCard feature={feature} onDropFiles={running ? undefined : (paths) => paths[0] && setFile(paths[0])} dropExtensions={EXTENSIONS}>
      <button type="button" className="glass-btn" onClick={pick} disabled={running}>
        {file ? 'Choose another file…' : 'Choose a video or audio file…'}
      </button>
      {file && (
        <span className="truncate text-xs text-[var(--text-dim)]">
          {basename(file)}
          {info ? ` — ${formatTime(info.duration)}${info.width ? `, ${info.width}×${info.height}` : ''}` : ''}
        </span>
      )}
      {file && info && (
        <button type="button" className="glass-btn" onClick={() => setModalOpen(true)} disabled={running}>
          Open visual trimmer…
        </button>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="trim-start" className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Start</label>
          <input id="trim-start" className="glass-input" value={start} onChange={(e) => setStart(e.target.value)} placeholder="0:00" disabled={running} />
        </div>
        <div>
          <label htmlFor="trim-end" className="mb-1 block text-xs font-medium text-[var(--text-dim)]">End</label>
          <input id="trim-end" className="glass-input" value={end} onChange={(e) => setEnd(e.target.value)} placeholder="end of file" disabled={running} />
        </div>
      </div>
      <div>
        <SlidingSelector id="trim-mode" options={MODES} value={mode} onChange={setMode} className="w-full grid-cols-2" />
        <span className="mt-1 block text-[11px] text-[var(--text-faint)]">
          {mode === 'fast' ? 'Instant, no quality loss; the cut snaps to the nearest keyframe.' : 'Re-encodes so the cut lands on the exact frame (slower).'}
        </span>
      </div>
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
      <button type="button" className="glass-btn" onClick={() => void run()} disabled={!file || !info || running}>
        Trim
      </button>
      {file && info && (
        <TrimModal
          open={modalOpen}
          file={file}
          info={info}
          initial={{ start: parseTime(start) ?? 0, end: parseTime(end) ?? info.duration, mode }}
          onClose={() => setModalOpen(false)}
          onConfirm={(s, e, m) => {
            setModalOpen(false)
            setStart(formatTime(s))
            setEnd(formatTime(e))
            setMode(m)
            void run({ start: s, end: e, mode: m })
          }}
        />
      )}
    </FeatureCard>
  )
}
