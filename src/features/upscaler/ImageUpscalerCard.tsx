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
  { value: 'realesrgan-x4plus', label: 'Photo — strongest detail (4× only)' },
  { value: 'realesr-animevideov3', label: 'Fast — anime/video-tuned (2×/3×/4×)' },
  { value: 'realesrgan-x4plus-anime', label: 'Anime — illustrations (4× only)' },
]

// realesrgan-x4plus and -anime only ever produce a 4x result.
const X4_ONLY_MODELS: UpscaleModel[] = ['realesrgan-x4plus', 'realesrgan-x4plus-anime']

const SCALE_OPTIONS: { value: UpscaleScale; label: string }[] = [
  { value: 2, label: '2×' },
  { value: 3, label: '3×' },
  { value: 4, label: '4×' },
]

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']

function basename(fullPath: string): string {
  return fullPath.split(/[/\\]/).pop() ?? fullPath
}

// @category: upscaler/image-upscaler-card
export default function ImageUpscalerCard({ feature }: { feature: FeatureDefinition }) {
  const [files, setFiles] = useState<string[]>([])
  // Real photos are the default assumption — realesrgan-x4plus gives a much
  // more visible improvement than the (faster, but anime/video-tuned)
  // realesr-animevideov3, which can look like barely anything happened on
  // an ordinary photo.
  const [model, setModel] = useState<UpscaleModel>('realesrgan-x4plus')
  const [scale, setScale] = useState<UpscaleScale>(4)
  const [submittedIds, setSubmittedIds] = useState<string[]>([])
  const [realesrgan, setRealesrgan] = useState<{ available: boolean; installHint: string } | null>(null)

  useEffect(() => {
    if (!host.isDesktop) return
    host.checkRealesrgan().then(setRealesrgan)
  }, [])

  const tasks = useTasks()
  const submittedTasks = tasks.filter((t) => submittedIds.includes(t.id))
  const anyRunning = submittedTasks.some((t) => t.status === 'queued' || t.status === 'running')
  const missing = realesrgan?.available === false
  const scaleLocked = X4_ONLY_MODELS.includes(model)

  function changeModel(next: UpscaleModel) {
    setModel(next)
    if (X4_ONLY_MODELS.includes(next)) setScale(4)
  }

  async function addFiles() {
    const picked = await host.pickFiles({ extensions: IMAGE_EXTENSIONS })
    if (!picked) return
    setFiles((prev) => [...prev, ...picked.filter((p) => !prev.includes(p))])
  }

  function removeFile(path: string) {
    setFiles((prev) => prev.filter((p) => p !== path))
  }

  async function upscaleAll() {
    const destination = getDownloadDirOverride() ?? undefined
    const ids = await Promise.all(
      files.map((inputPath) => host.tasks.startUpscale({ inputPath, scale, model, destination })),
    )
    setSubmittedIds(ids)
    setFiles([])
  }

  return (
    <FeatureCard feature={feature}>
      {missing && (
        <div className="flex flex-col gap-1 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-3 text-xs">
          <span className="font-medium text-[var(--text)]">realesrgan-ncnn-vulkan isn't installed</span>
          <span className="text-[var(--text-dim)]">
            OPNduck uses your system's realesrgan-ncnn-vulkan — install it, then reopen this page:
          </span>
          <code className="select-all rounded-md bg-[var(--bg-solid)] px-2 py-1 font-mono text-[var(--text)]">
            {realesrgan.installHint}
          </code>
        </div>
      )}

      <button type="button" className="glass-btn" onClick={addFiles} disabled={anyRunning}>
        Add images…
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
          <GlassSelect id="upscaler-model" options={MODEL_OPTIONS} value={model} onChange={changeModel} />
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Scale</span>
          <GlassSelect
            id="upscaler-scale"
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
                  {t.status === 'error' ? t.error : t.label}
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
        disabled={files.length === 0 || anyRunning || missing}
        title={missing ? 'Install realesrgan-ncnn-vulkan first' : undefined}
      >
        Upscale All
      </button>
    </FeatureCard>
  )
}
