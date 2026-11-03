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
import InstallToolPanel from '../../components/InstallToolPanel'
import ProgressBar from '../../components/ProgressBar'
import Tag from '../../components/Tag'
import TaskLogs from '../../components/TaskLogs'
import { host, type DubRequest, type ToolStatus } from '../../host'
import { getDownloadDirOverride } from '../../lib/downloadPrefs'
import { formatBytes } from '../../lib/formatBytes'
import { useSubmittedIds } from '../../lib/submittedTasks'
import { useTasks } from '../../lib/useTasks'
import type { FeatureDefinition } from '../registry'

const VIDEOS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v']
const TARGETS = [
  { value: 'en', label: 'English' },
  { value: 'sv', label: 'Swedish' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
  { value: 'it', label: 'Italian' },
]
const basename = (p: string) => p.split(/[/\\]/).pop() ?? p
const clean = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

// @category: dub/dub-card
/** Dubbing (Beta): the video speaks another language, with a local voice. */
export default function DubCard({ feature }: { feature: FeatureDefinition }) {
  const [tool, setTool] = useState<ToolStatus | null>(null)
  const [file, setFile] = useState<string | null>(null)
  const [target, setTarget] = useState<DubRequest['target']>('sv')
  const [placement, setPlacement] = useState<'track' | 'replace'>('track')
  const [keepOriginal, setKeepOriginal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ids, setIds] = useSubmittedIds('dub')
  const tasks = useTasks()
  const job = tasks.filter((t) => ids.includes(t.id))
  const running = job.some((t) => t.status === 'queued' || t.status === 'running')

  useEffect(() => {
    void host.checkDub().then(setTool)
  }, [])

  async function run() {
    if (!file) return
    setError(null)
    try {
      setIds([await host.tasks.startDub({ inputPath: file, target, placement, keepOriginal, destination: getDownloadDirOverride() ?? undefined })])
    } catch (err) {
      setError(clean(err))
    }
  }

  return (
    <FeatureCard feature={feature} onDropFiles={running ? undefined : (paths) => paths[0] && setFile(paths[0])} dropExtensions={VIDEOS}>
      {tool && !tool.available && (
        <div className="flex flex-col gap-2 text-xs">
          <span className="text-[var(--text-dim)]">Dubbing needs a Python add-on. The translation pack and the voice download the first time you use a language.</span>
          <InstallToolPanel tool="dub" sizeNote="several GB with the vocal remover" hint={tool.installHint} onInstalled={() => host.checkDub().then(setTool)} />
        </div>
      )}
      <button type="button" className="glass-btn" disabled={running} onClick={() => void host.pickFile({ extensions: VIDEOS }).then((p) => p && setFile(p))}>
        {file ? 'Choose another video…' : 'Choose a video…'}
      </button>
      {file && <span className="truncate text-xs text-[var(--text-dim)]">{basename(file)}</span>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Speak</span>
          <GlassSelect id="dub-target" options={TARGETS} value={target} onChange={(v) => setTarget(v as DubRequest['target'])} />
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">The new voice</span>
          <GlassSelect id="dub-placement" options={[{ value: 'track', label: 'Extra audio track' }, { value: 'replace', label: 'Replace the audio' }]} value={placement} onChange={(v) => setPlacement(v as typeof placement)} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={keepOriginal} onChange={(e) => setKeepOriginal(e.target.checked)} />
        Keep the original voice very quiet underneath
      </label>
      {error && <span className="text-xs text-red-400">{error}</span>}
      {job.map((t) => (
        <div key={t.id} className="flex flex-col gap-1">
          <ProgressBar value={t.progress} status={t.status} />
          <TaskLogs taskId={t.id} />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-xs text-[var(--text-dim)]">{t.status === 'error' ? t.error : t.label}</span>
            {t.status === 'done' && formatBytes(t.sizeBytes) && <Tag>{formatBytes(t.sizeBytes)}</Tag>}
          </div>
        </div>
      ))}
      <button type="button" className="glass-btn" disabled={!file || running || !tool?.available} onClick={() => void run()}>
        Dub it
      </button>
    </FeatureCard>
  )
}
// --- end: dub/dub-card ---
