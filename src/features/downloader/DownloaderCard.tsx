import { useEffect, useState } from 'react'
import FeatureCard from '../../components/FeatureCard'
import GlassSelect from '../../components/GlassSelect'
import Tag from '../../components/Tag'
import Thumbnail from '../../components/Thumbnail'
import { host, type AudioQuality, type DownloadFormat, type VideoQuality } from '../../host'
import { getDownloadDirOverride } from '../../lib/downloadPrefs'
import { formatBytes } from '../../lib/formatBytes'
import { useTasks } from '../../lib/useTasks'
import type { FeatureDefinition } from '../registry'

const FORMAT_OPTIONS = ['MP4', 'MP3', 'MKV', 'MOV', 'FLAC', 'WAV'].map((f) => ({
  value: f as DownloadFormat,
  label: f,
}))

const VIDEO_QUALITY_OPTIONS: { value: VideoQuality; label: string }[] = [
  { value: 'best', label: 'Best available' },
  { value: '2160', label: '2160p (4K)' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
]

const AUDIO_QUALITY_OPTIONS: { value: AudioQuality; label: string }[] = [
  { value: 'best', label: 'Best (VBR)' },
  { value: '320k', label: '320 kbps' },
  { value: '192k', label: '192 kbps' },
  { value: '128k', label: '128 kbps' },
]

const VIDEO_FORMATS: DownloadFormat[] = ['MP4', 'MKV', 'MOV']

// @category: downloader/download-card
export default function DownloaderCard({ feature }: { feature: FeatureDefinition }) {
  const [url, setUrl] = useState('')
  const [format, setFormat] = useState<DownloadFormat>('MP4')
  const [videoQuality, setVideoQuality] = useState<VideoQuality>('best')
  const [audioQuality, setAudioQuality] = useState<AudioQuality>('best')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ sizeBytes: number | null; thumbnailUrl: string | null } | null>(
    null,
  )
  const [previewing, setPreviewing] = useState(false)
  const [ytDlp, setYtDlp] = useState<{ available: boolean; installHint: string } | null>(null)

  useEffect(() => {
    if (!host.isDesktop) return
    host.checkYtDlp().then(setYtDlp)
  }, [])

  const tasks = useTasks()
  const task = tasks.find((t) => t.id === taskId)
  const running = task?.status === 'queued' || task?.status === 'running'
  const isVideo = VIDEO_FORMATS.includes(format)

  // Debounced size preview: re-probe shortly after the url/format/quality settle,
  // rather than on every keystroke — a yt-dlp lookup takes a real network round trip.
  useEffect(() => {
    const trimmed = url.trim()
    if (!trimmed || !host.isDesktop) {
      setPreview(null)
      return
    }
    setPreviewing(true)
    const timer = setTimeout(async () => {
      const result = await host.tasks.probe({ url: trimmed, format, videoQuality, audioQuality })
      setPreview({ sizeBytes: result.approxSizeBytes, thumbnailUrl: result.thumbnailUrl })
      setPreviewing(false)
    }, 700)
    return () => {
      clearTimeout(timer)
      setPreviewing(false)
    }
  }, [url, format, videoQuality, audioQuality])

  async function run() {
    const id = await host.tasks.startDownload({
      url: url.trim(),
      format,
      videoQuality: isVideo ? videoQuality : undefined,
      audioQuality: format === 'MP3' ? audioQuality : undefined,
      destination: getDownloadDirOverride() ?? undefined,
      approxSizeBytes: preview?.sizeBytes ?? null,
      thumbnailUrl: preview?.thumbnailUrl ?? null,
    })
    setTaskId(id)
  }

  const ytDlpMissing = ytDlp?.available === false

  return (
    <FeatureCard feature={feature}>
      {ytDlpMissing && (
        <div className="flex flex-col gap-1 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-3 text-xs">
          <span className="font-medium text-[var(--text)]">yt-dlp isn't installed</span>
          <span className="text-[var(--text-dim)]">
            OPNduck uses your system's yt-dlp — install it, then reopen this page:
          </span>
          <code className="select-all rounded-md bg-[var(--bg-solid)] px-2 py-1 font-mono text-[var(--text)]">
            {ytDlp.installHint}
          </code>
        </div>
      )}
      <input
        className="glass-input"
        type="url"
        placeholder="Paste a YouTube, TikTok, SoundCloud or Spotify link…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        disabled={running}
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Format</span>
          <GlassSelect id="downloader-format" options={FORMAT_OPTIONS} value={format} onChange={setFormat} />
        </div>
        <div>
          {isVideo && (
            <>
              <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Quality</span>
              <GlassSelect
                id="downloader-video-quality"
                options={VIDEO_QUALITY_OPTIONS}
                value={videoQuality}
                onChange={setVideoQuality}
              />
            </>
          )}
          {format === 'MP3' && (
            <>
              <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Bitrate</span>
              <GlassSelect
                id="downloader-audio-quality"
                options={AUDIO_QUALITY_OPTIONS}
                value={audioQuality}
                onChange={setAudioQuality}
              />
            </>
          )}
          {(format === 'FLAC' || format === 'WAV') && (
            <>
              <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Bitrate</span>
              <div className="glass-input flex items-center text-[var(--text-faint)]">Lossless</div>
            </>
          )}
        </div>
      </div>

      {url.trim() && !running && host.isDesktop && (
        <div className="flex items-center gap-2">
          {preview?.thumbnailUrl && <Thumbnail url={preview.thumbnailUrl} className="h-8 w-14 shrink-0 rounded-md" />}
          <span className="text-xs text-[var(--text-dim)]">
            {previewing
              ? 'Estimating size…'
              : formatBytes(preview?.sizeBytes)
                ? `Approx. size: ${formatBytes(preview?.sizeBytes)}`
                : 'Size unavailable'}
          </span>
        </div>
      )}

      {task && (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--input-bg)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
              style={{ width: `${Math.round(task.progress * 100)}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-[var(--text-dim)]">
              {task.status === 'error'
                ? task.error
                : task.status === 'done'
                  ? 'Done'
                  : task.status === 'canceled'
                    ? 'Canceled'
                    : `${task.label} — ${Math.round(task.progress * 100)}%`}
            </span>
            {(task.status === 'done' || task.status === 'running') && (
              <>
                <Tag>{task.format}</Tag>
                <Tag>{task.quality}</Tag>
                {formatBytes(task.sizeBytes) && (
                  <Tag>
                    {task.sizeIsEstimate ? '~' : ''}
                    {formatBytes(task.sizeBytes)}
                  </Tag>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          className="glass-btn flex-1"
          onClick={run}
          disabled={!url.trim() || running || ytDlpMissing}
          title={ytDlpMissing ? 'Install yt-dlp first' : undefined}
        >
          Run Task
        </button>
        {running && (
          <button
            type="button"
            className="glass-btn shrink-0 px-3"
            onClick={() => taskId && host.tasks.cancel(taskId)}
          >
            Cancel
          </button>
        )}
      </div>
    </FeatureCard>
  )
}
// --- end: downloader/download-card ---
