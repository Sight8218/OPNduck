import { useEffect, useState } from 'react'
import FeatureCard from '../../components/FeatureCard'
import GlassSelect from '../../components/GlassSelect'
import Tag from '../../components/Tag'
import { host, type InterpolateMultiplier } from '../../host'
import { getDownloadDirOverride } from '../../lib/downloadPrefs'
import { formatBytes } from '../../lib/formatBytes'
import { useTasks } from '../../lib/useTasks'
import type { FeatureDefinition } from '../registry'

const MULTIPLIER_OPTIONS: { value: InterpolateMultiplier; label: string }[] = [
  { value: 2, label: '2× — e.g. 24fps → 48fps' },
  { value: 4, label: '4× — e.g. 24fps → 96fps' },
]

const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v']

function basename(fullPath: string): string {
  return fullPath.split(/[/\\]/).pop() ?? fullPath
}

/** Every source frame plus every AI-generated in-between frame gets written
 *  and re-encoded — real work, same queue pattern as the upscalers. */
// @category: interpolate/interpolation-card
export default function InterpolationCard({ feature }: { feature: FeatureDefinition }) {
  const [files, setFiles] = useState<string[]>([])
  const [multiplier, setMultiplier] = useState<InterpolateMultiplier>(2)
  const [submittedIds, setSubmittedIds] = useState<string[]>([])
  const [rife, setRife] = useState<{ available: boolean; installHint: string } | null>(null)
  const [ffmpeg, setFfmpeg] = useState<{ available: boolean; installHint: string } | null>(null)

  useEffect(() => {
    if (!host.isDesktop) return
    host.checkRife().then(setRife)
    host.checkFfmpeg().then(setFfmpeg)
  }, [])

  const tasks = useTasks()
  const submittedTasks = tasks.filter((t) => submittedIds.includes(t.id))
  const anyRunning = submittedTasks.some((t) => t.status === 'queued' || t.status === 'running')
  const missingTool = !rife?.available ? rife : !ffmpeg?.available ? ffmpeg : null
  const missingName = !rife?.available ? 'rife-ncnn-vulkan' : 'ffmpeg'

  async function addFiles() {
    const picked = await host.pickFiles({ extensions: VIDEO_EXTENSIONS })
    if (!picked) return
    setFiles((prev) => [...prev, ...picked.filter((p) => !prev.includes(p))])
  }

  function removeFile(path: string) {
    setFiles((prev) => prev.filter((p) => p !== path))
  }

  async function interpolateAll() {
    const destination = getDownloadDirOverride() ?? undefined
    const ids = await Promise.all(
      files.map((inputPath) => host.tasks.startInterpolate({ inputPath, multiplier, destination })),
    )
    setSubmittedIds(ids)
    setFiles([])
  }

  return (
    <FeatureCard feature={feature}>
      {missingTool && rife && ffmpeg && (
        <div className="flex flex-col gap-1 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-3 text-xs">
          <span className="font-medium text-[var(--text)]">{missingName} isn't installed</span>
          <span className="text-[var(--text-dim)]">
            Frame interpolation needs both ffmpeg and rife-ncnn-vulkan on your system:
          </span>
          <code className="select-all rounded-md bg-[var(--bg-solid)] px-2 py-1 font-mono text-[var(--text)]">
            {missingTool.installHint}
          </code>
        </div>
      )}

      <button type="button" className="glass-btn" onClick={addFiles} disabled={anyRunning}>
        Add videos…
      </button>

      {files.length > 0 && (
        <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
          {files.map((f) => (
            <div
              key={f}
              className="flex items-center justify-between gap-2 rounded-lg bg-[var(--input-bg)] px-2.5 py-1.5 text-xs"
            >
              <span className="truncate text-[var(--text)]">{basename(f)}</span>
              <button
                type="button"
                onClick={() => removeFile(f)}
                aria-label={`Remove ${basename(f)}`}
                className="shrink-0 text-[var(--text-faint)] hover:text-[var(--text)]"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div>
        <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Frame rate multiplier</span>
        <GlassSelect
          id="interpolation-multiplier"
          options={MULTIPLIER_OPTIONS.map((o) => ({ ...o, value: String(o.value) }))}
          value={String(multiplier)}
          onChange={(v) => setMultiplier(Number(v) as InterpolateMultiplier)}
        />
      </div>

      {submittedTasks.length > 0 && (
        <div className="flex flex-col gap-2">
          {submittedTasks.map((t) => (
            <div key={t.id} className="flex flex-col gap-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--input-bg)]">
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ${
                    t.status === 'error' ? 'bg-red-500' : 'bg-[var(--accent)]'
                  } ${t.status === 'running' ? 'progress-shimmer' : ''}`}
                  style={{ width: `${Math.round(t.progress * 100)}%` }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-xs text-[var(--text-dim)]">
                  {t.status === 'error' ? t.error : `${t.label} — ${Math.round(t.progress * 100)}%`}
                </span>
                {(t.status === 'done' || t.status === 'running') && (
                  <>
                    <Tag>{t.quality}</Tag>
                    {formatBytes(t.sizeBytes) && <Tag>{formatBytes(t.sizeBytes)}</Tag>}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className="glass-btn"
        onClick={interpolateAll}
        disabled={files.length === 0 || anyRunning || Boolean(missingTool)}
        title={missingTool ? `Install ${missingName} first` : undefined}
      >
        Interpolate All
      </button>
    </FeatureCard>
  )
}
