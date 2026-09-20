import { useEffect, useState } from 'react'
import FeatureCard from '../../components/FeatureCard'
import GlassSelect from '../../components/GlassSelect'
import Tag from '../../components/Tag'
import { host, type UpscaleModel, type UpscaleScale } from '../../host'
import { getDownloadDirOverride } from '../../lib/downloadPrefs'
import { formatBytes } from '../../lib/formatBytes'
import { useTasks } from '../../lib/useTasks'
import type { FeatureDefinition } from '../registry'

const MODEL_OPTIONS: { value: UpscaleModel; label: string }[] = [
  { value: 'realesr-animevideov3', label: 'Fast — video-tuned (2×/3×/4×)' },
  { value: 'realesrgan-x4plus', label: 'Photo model — strongest detail, slow (4× only)' },
  { value: 'realesrgan-x4plus-anime', label: 'Anime (4× only)' },
]

// realesrgan-x4plus and -anime only ever produce a 4x result.
const X4_ONLY_MODELS: UpscaleModel[] = ['realesrgan-x4plus', 'realesrgan-x4plus-anime']

const SCALE_OPTIONS: { value: UpscaleScale; label: string }[] = [
  { value: 2, label: '2×' },
  { value: 3, label: '3×' },
  { value: 4, label: '4×' },
]

const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v']

function basename(fullPath: string): string {
  return fullPath.split(/[/\\]/).pop() ?? fullPath
}

/** Every frame gets individually AI-upscaled — this is real work, not a
 *  quick filter. Every queued video runs its own full extract/upscale/
 *  reassemble pipeline, the same way multiple images already do. */
// @category: upscaler/video-upscaler-card
export default function VideoUpscalerCard({ feature }: { feature: FeatureDefinition }) {
  const [files, setFiles] = useState<string[]>([])
  // Video-tuned model by default — realesrgan-x4plus is much slower per
  // frame and that cost multiplies by every frame in the video.
  const [model, setModel] = useState<UpscaleModel>('realesr-animevideov3')
  const [scale, setScale] = useState<UpscaleScale>(2)
  const [submittedIds, setSubmittedIds] = useState<string[]>([])
  const [realesrgan, setRealesrgan] = useState<{ available: boolean; installHint: string } | null>(null)
  const [ffmpeg, setFfmpeg] = useState<{ available: boolean; installHint: string } | null>(null)

  useEffect(() => {
    if (!host.isDesktop) return
    host.checkRealesrgan().then(setRealesrgan)
    host.checkFfmpeg().then(setFfmpeg)
  }, [])

  const tasks = useTasks()
  const submittedTasks = tasks.filter((t) => submittedIds.includes(t.id))
  const anyRunning = submittedTasks.some((t) => t.status === 'queued' || t.status === 'running')
  const missingTool = !realesrgan?.available ? realesrgan : !ffmpeg?.available ? ffmpeg : null
  const missingName = !realesrgan?.available ? 'realesrgan-ncnn-vulkan' : 'ffmpeg'
  const scaleLocked = X4_ONLY_MODELS.includes(model)

  function changeModel(next: UpscaleModel) {
    setModel(next)
    if (X4_ONLY_MODELS.includes(next)) setScale(4)
  }

  async function addFiles() {
    const picked = await host.pickFiles({ extensions: VIDEO_EXTENSIONS })
    if (!picked) return
    setFiles((prev) => [...prev, ...picked.filter((p) => !prev.includes(p))])
  }

  function removeFile(path: string) {
    setFiles((prev) => prev.filter((p) => p !== path))
  }

  async function upscaleAll() {
    const destination = getDownloadDirOverride() ?? undefined
    const ids = await Promise.all(
      files.map((inputPath) => host.tasks.startVideoUpscale({ inputPath, scale, model, destination })),
    )
    setSubmittedIds(ids)
    setFiles([])
  }

  return (
    <FeatureCard feature={feature}>
      {missingTool && realesrgan && ffmpeg && (
        <div className="flex flex-col gap-1 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-3 text-xs">
          <span className="font-medium text-[var(--text)]">{missingName} isn't installed</span>
          <span className="text-[var(--text-dim)]">
            Video upscaling needs both ffmpeg and realesrgan-ncnn-vulkan on your system:
          </span>
          <code className="select-all rounded-md bg-[var(--bg-solid)] px-2 py-1 font-mono text-[var(--text)]">
            {missingTool.installHint}
          </code>
        </div>
      )}

      <p className="text-xs text-[var(--text-dim)]">
        Every frame gets AI-upscaled individually — expect this to take a while,
        even for a short clip.
      </p>

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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Model</span>
          <GlassSelect id="video-upscaler-model" options={MODEL_OPTIONS} value={model} onChange={changeModel} />
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Scale</span>
          <GlassSelect
            id="video-upscaler-scale"
            options={SCALE_OPTIONS.map((o) => ({ ...o, value: String(o.value) }))}
            value={String(scale)}
            onChange={(v) => setScale(Number(v) as UpscaleScale)}
            disabled={scaleLocked}
          />
        </div>
      </div>

      {submittedTasks.length > 0 && (
        <div className="flex flex-col gap-2">
          {submittedTasks.map((t) => (
            <div key={t.id} className="flex flex-col gap-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--input-bg)]">
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ${
                    t.status === 'error' ? 'bg-red-500' : 'bg-[var(--accent)]'
                  }`}
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
        onClick={upscaleAll}
        disabled={files.length === 0 || anyRunning || Boolean(missingTool)}
        title={missingTool ? `Install ${missingName} first` : undefined}
      >
        Upscale All
      </button>
    </FeatureCard>
  )
}
