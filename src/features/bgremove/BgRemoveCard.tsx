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
import { host, type ToolStatus } from '../../host'
import { getDownloadDirOverride } from '../../lib/downloadPrefs'
import { formatBytes } from '../../lib/formatBytes'
import { useSubmittedIds } from '../../lib/submittedTasks'
import { useTasks } from '../../lib/useTasks'
import type { FeatureDefinition } from '../registry'

const IMAGES = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'avif']
const VIDEOS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v']
const OUTPUTS = [
  { value: 'transparent', label: 'Transparent' },
  { value: 'color', label: 'A flat colour' },
  { value: 'blur', label: 'The same scene, blurred' },
  { value: 'image', label: 'Another picture' },
]
const basename = (p: string) => p.split(/[/\\]/).pop() ?? p
const clean = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

// @category: bgremove/bgremove-card
/** Background Remover: cut a person or object out of a picture or video, no green screen. */
export default function BgRemoveCard({ feature }: { feature: FeatureDefinition }) {
  const [tool, setTool] = useState<ToolStatus | null>(null)
  const [file, setFile] = useState<string | null>(null)
  const [output, setOutput] = useState<'transparent' | 'color' | 'blur' | 'image'>('transparent')
  const [color, setColor] = useState('#00ff00')
  const [bgImage, setBgImage] = useState<string | null>(null)
  const [quality, setQuality] = useState<'fast' | 'best'>('fast')
  const [format, setFormat] = useState<'webm' | 'mov'>('webm')
  const [preview, setPreview] = useState<string | 'working' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ids, setIds] = useSubmittedIds('bgremove')
  const tasks = useTasks()
  const job = tasks.filter((t) => ids.includes(t.id))
  const running = job.some((t) => t.status === 'queued' || t.status === 'running')

  useEffect(() => {
    void host.checkBgRemove().then(setTool)
  }, [])

  const isImage = !!file && IMAGES.includes(file.split('.').pop()?.toLowerCase() ?? '')
  function choose(p: string) {
    setFile(p)
    setPreview(null)
  }

  async function makePreview() {
    if (!file) return
    setError(null)
    setPreview('working')
    try {
      setPreview(await host.bgPreview(file))
    } catch (err) {
      setPreview(null)
      setError(clean(err))
    }
  }

  async function run() {
    if (!file) return
    setError(null)
    try {
      setIds([await host.tasks.startBgRemove({ inputPath: file, output, color, backgroundImage: output === 'image' ? (bgImage ?? undefined) : undefined, quality, format, destination: getDownloadDirOverride() ?? undefined })])
    } catch (err) {
      setError(clean(err))
    }
  }

  return (
    <FeatureCard feature={feature} onDropFiles={running ? undefined : (paths) => paths[0] && choose(paths[0])} dropExtensions={[...IMAGES, ...VIDEOS]}>
      {tool && !tool.available && (
        <div className="flex flex-col gap-2 text-xs">
          <span className="text-[var(--text-dim)]">The Background Remover needs a small Python add-on (the cut-out models download the first time you use them).</span>
          <InstallToolPanel tool="bgremove" sizeNote="about 150 MB" hint={tool.installHint} onInstalled={() => host.checkBgRemove().then(setTool)} />
        </div>
      )}
      <button type="button" className="glass-btn" disabled={running} onClick={() => void host.pickFile({ extensions: [...IMAGES, ...VIDEOS] }).then((p) => p && choose(p))}>
        {file ? 'Choose another file…' : 'Choose a picture or video…'}
      </button>
      {file && <span className="truncate text-xs text-[var(--text-dim)]">{basename(file)}</span>}
      <div>
        <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Put behind it</span>
        <GlassSelect id="bg-output" options={OUTPUTS} value={output} onChange={(v) => setOutput(v as typeof output)} />
      </div>
      {output === 'color' && (
        <label className="flex items-center gap-2 text-sm">
          <input type="color" aria-label="Background colour" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-12 cursor-pointer rounded bg-transparent" />
          {color}
        </label>
      )}
      {output === 'image' && (
        <button type="button" className="glass-btn" disabled={running} onClick={() => void host.pickFile({ extensions: IMAGES }).then((p) => p && setBgImage(p))}>
          {bgImage ? `Picture: ${basename(bgImage)}` : 'Choose the background picture…'}
        </button>
      )}
      {file && !isImage && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Quality</span>
            <GlassSelect id="bg-quality" options={[{ value: 'fast', label: 'Fast' }, { value: 'best', label: 'Best (slower)' }]} value={quality} onChange={(v) => setQuality(v as typeof quality)} />
          </div>
          {output === 'transparent' && (
            <div>
              <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">File type</span>
              <GlassSelect id="bg-format" options={[{ value: 'webm', label: 'WebM (small)' }, { value: 'mov', label: 'MOV ProRes (for editors)' }]} value={format} onChange={(v) => setFormat(v as typeof format)} />
            </div>
          )}
        </div>
      )}
      {file && (
        <button type="button" className="glass-btn" disabled={running || preview === 'working' || !tool?.available} onClick={() => void makePreview()}>
          {preview === 'working' ? 'Cutting out one frame…' : 'Preview one frame'}
        </button>
      )}
      {preview && preview !== 'working' && (
        <img src={preview} alt="The cut-out of one frame" className="w-full rounded-xl" style={{ background: 'repeating-conic-gradient(#8884 0% 25%, #0000 0% 50%) 50% / 16px 16px' }} />
      )}
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
      <button type="button" className="glass-btn" disabled={!file || running || !tool?.available || (output === 'image' && !bgImage)} onClick={() => void run()}>
        Cut it out
      </button>
    </FeatureCard>
  )
}
// --- end: bgremove/bgremove-card ---
