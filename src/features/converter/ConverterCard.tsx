import { useEffect, useState } from 'react'
import FeatureCard from '../../components/FeatureCard'
import GlassSelect from '../../components/GlassSelect'
import Tag from '../../components/Tag'
import { host, type ContainerFormat, type ConvertMode } from '../../host'
import { getDownloadDirOverride } from '../../lib/downloadPrefs'
import { formatBytes } from '../../lib/formatBytes'
import { useTasks } from '../../lib/useTasks'
import type { FeatureDefinition } from '../registry'

const CONTAINER_OPTIONS: { value: ContainerFormat; label: string }[] = [
  { value: 'MP4', label: 'MP4' },
  { value: 'MKV', label: 'MKV' },
  { value: 'WEBM', label: 'WebM' },
  { value: 'MOV', label: 'MOV' },
]

const MODE_OPTIONS: { value: ConvertMode; label: string }[] = [
  { value: 'remux', label: 'Remux (fast, no re-encode)' },
  { value: 'transcode', label: 'Transcode (re-encode)' },
]

const MEDIA_EXTENSIONS = [
  'mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'm4v', 'wmv',
  'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a',
]

function basename(fullPath: string): string {
  return fullPath.split(/[/\\]/).pop() ?? fullPath
}

// @category: converter/converter-card
export default function ConverterCard({ feature }: { feature: FeatureDefinition }) {
  const [files, setFiles] = useState<string[]>([])
  const [container, setContainer] = useState<ContainerFormat>('MP4')
  const [mode, setMode] = useState<ConvertMode>('remux')
  const [submittedIds, setSubmittedIds] = useState<string[]>([])
  const [ffmpeg, setFfmpeg] = useState<{ available: boolean; installHint: string } | null>(null)

  useEffect(() => {
    if (!host.isDesktop) return
    host.checkFfmpeg().then(setFfmpeg)
  }, [])

  const tasks = useTasks()
  const submittedTasks = tasks.filter((t) => submittedIds.includes(t.id))
  const anyRunning = submittedTasks.some((t) => t.status === 'queued' || t.status === 'running')
  const ffmpegMissing = ffmpeg?.available === false

  async function addFiles() {
    const picked = await host.pickFiles({ extensions: MEDIA_EXTENSIONS })
    if (!picked) return
    setFiles((prev) => [...prev, ...picked.filter((p) => !prev.includes(p))])
  }

  function removeFile(path: string) {
    setFiles((prev) => prev.filter((p) => p !== path))
  }

  async function convertAll() {
    const destination = getDownloadDirOverride() ?? undefined
    const ids = await Promise.all(
      files.map((inputPath) => host.tasks.startConvert({ inputPath, container, mode, destination })),
    )
    setSubmittedIds(ids)
    setFiles([])
  }

  return (
    <FeatureCard feature={feature}>
      {ffmpegMissing && (
        <div className="flex flex-col gap-1 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-3 text-xs">
          <span className="font-medium text-[var(--text)]">ffmpeg isn't installed</span>
          <span className="text-[var(--text-dim)]">
            OPNduck uses your system's ffmpeg — install it, then reopen this page:
          </span>
          <code className="select-all rounded-md bg-[var(--bg-solid)] px-2 py-1 font-mono text-[var(--text)]">
            {ffmpeg.installHint}
          </code>
        </div>
      )}

      <button type="button" className="glass-btn" onClick={addFiles} disabled={anyRunning}>
        Add files…
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
          <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Container</span>
          <GlassSelect id="converter-container" options={CONTAINER_OPTIONS} value={container} onChange={setContainer} />
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Mode</span>
          <GlassSelect id="converter-mode" options={MODE_OPTIONS} value={mode} onChange={setMode} />
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
                    <Tag>{t.format}</Tag>
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
        onClick={convertAll}
        disabled={files.length === 0 || anyRunning || ffmpegMissing}
        title={ffmpegMissing ? 'Install ffmpeg first' : undefined}
      >
        Convert All
      </button>
    </FeatureCard>
  )
}
