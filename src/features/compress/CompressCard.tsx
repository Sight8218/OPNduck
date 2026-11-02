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

import { useEffect, useMemo, useState } from 'react'
import AutoSettings from '../../components/AutoSettings'
import FeatureCard from '../../components/FeatureCard'
import ProgressBar from '../../components/ProgressBar'
import SlidingSelector from '../../components/SlidingSelector'
import Tag from '../../components/Tag'
import TaskLogs from '../../components/TaskLogs'
import { host, type CompressQuality, type MediaInfo } from '../../host'
import { getDownloadDirOverride } from '../../lib/downloadPrefs'
import { formatBytes } from '../../lib/formatBytes'
import { useSubmittedIds } from '../../lib/submittedTasks'
import { useTasks } from '../../lib/useTasks'
import type { FeatureDefinition } from '../registry'
import { estimateCompress } from './plan'

const EXTENSIONS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'mp3', 'wav', 'flac', 'm4a', 'ogg', 'opus']

// The size limits people hit most. Services change these now and then (Discord raised its free limit to 20 MB
// and Nitro to 1 GB in 2026), so they live here in one list. Nitro aims a little under 1 GB.
const TARGETS = [
  { label: 'Discord 20 MB', mb: 20 },
  { label: 'Discord Nitro Basic 50 MB', mb: 50 },
  { label: 'Discord Nitro 1 GB', mb: 1000 },
  { label: 'WhatsApp 16 MB', mb: 16 },
  { label: 'Email 25 MB', mb: 25 },
]
const QUALITIES = [
  { value: 'fast' as CompressQuality, label: 'Fast' },
  { value: 'best' as CompressQuality, label: 'Best quality (slower)' },
]

const basename = (p: string) => p.split(/[/\\]/).pop() ?? p
const formatDuration = (s: number) => {
  const t = Math.round(s)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = t % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

// @category: compress/compress-card
/** Make a video or audio file land just under a size, for Discord, WhatsApp, email and the like. */
export default function CompressCard({ feature }: { feature: FeatureDefinition }) {
  const [file, setFile] = useState<string | null>(null)
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [targetMB, setTargetMB] = useState(20)
  const [custom, setCustom] = useState('')
  const [quality, setQuality] = useState<CompressQuality>('fast')
  const [error, setError] = useState<string | null>(null)
  const [submittedIds, setSubmittedIds] = useSubmittedIds('compress')

  const tasks = useTasks()
  const submitted = tasks.filter((t) => submittedIds.includes(t.id))
  const running = submitted.some((t) => t.status === 'queued' || t.status === 'running')

  useEffect(() => {
    if (!file) return
    let alive = true
    host.probeMedia(file).then((i) => {
      if (!alive) return
      setInfo(i)
      setError(i ? null : "Couldn't read that file.")
    })
    return () => {
      alive = false
    }
  }, [file])

  const customMB = custom.trim() ? Number(custom) : null
  const chosenMB = customMB ?? targetMB
  const validTarget = Number.isFinite(chosenMB) && chosenMB >= 0.5
  const estimate = useMemo(() => (info && validTarget ? estimateCompress(info, chosenMB) : null), [info, chosenMB, validTarget])

  async function pick() {
    const p = await host.pickFile({ extensions: EXTENSIONS })
    if (p) setFile(p)
  }

  async function run() {
    if (!file || !info || !validTarget) return
    setError(null)
    try {
      const id = await host.tasks.startCompress({ inputPath: file, targetMB: chosenMB, quality, destination: getDownloadDirOverride() ?? undefined })
      setSubmittedIds([id])
    } catch (err) {
      setError((err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
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
          {info ? ` — ${formatDuration(info.duration)}${info.width ? `, ${info.width}×${info.height}` : ''}` : ''}
        </span>
      )}
      <div>
        <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Stay under</span>
        <div className="flex flex-wrap gap-1.5">
          {TARGETS.map((t) => {
            const on = customMB == null && targetMB === t.mb
            return (
              <button
                key={t.label}
                type="button"
                disabled={running}
                aria-pressed={on}
                onClick={() => {
                  setTargetMB(t.mb)
                  setCustom('')
                }}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                  on ? 'border-[var(--input-border-focus)] bg-[var(--input-bg)] text-[var(--accent)]' : 'border-[var(--glass-border)] text-[var(--text-dim)] hover:text-[var(--text)]'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label htmlFor="compress-custom" className="text-xs text-[var(--text-dim)]">Or your own, in MB</label>
          <input id="compress-custom" className="glass-input w-28" inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. 8" disabled={running} />
        </div>
      </div>
      <AutoSettings tool="compress" file={file} disabled={running} onApply={(s) => (s.quality === 'fast' || s.quality === 'best') && setQuality(s.quality)} />
      <div>
        <SlidingSelector id="compress-quality" options={QUALITIES} value={quality} onChange={setQuality} className="w-full grid-cols-2" />
        <span className="mt-1 block text-[11px] text-[var(--text-faint)]">
          {quality === 'fast' ? 'Uses your graphics card when it can. Lands under the size, a little less exactly.' : 'Two passes on the CPU: the sharpest picture for the size.'}
        </span>
      </div>
      {estimate && (
        <span className="text-xs text-[var(--text-dim)]">
          {estimate.ok
            ? `Will be about ${estimate.label || 'audio only'}, under ${chosenMB} MB.`
            : `Too small for this length. The smallest it can reach is about ${Math.ceil((estimate.minMB ?? 0) * 10) / 10} MB.`}
        </span>
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
                <Tag>{t.quality}</Tag>
                {formatBytes(t.sizeBytes) && <Tag>{formatBytes(t.sizeBytes)}</Tag>}
              </>
            )}
          </div>
        </div>
      ))}
      <button type="button" className="glass-btn" onClick={() => void run()} disabled={!file || !info || running || !validTarget || estimate?.ok === false}>
        Compress
      </button>
    </FeatureCard>
  )
}
