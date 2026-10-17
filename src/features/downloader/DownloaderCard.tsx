import { useEffect, useState } from 'react'
import FeatureCard from '../../components/FeatureCard'
import GlassSelect from '../../components/GlassSelect'
import Tag from '../../components/Tag'
import Thumbnail from '../../components/Thumbnail'
import { host, type AudioQuality, type DownloadFormat, type PlaylistInfo, type VideoQuality } from '../../host'
import { getDownloadDirOverride } from '../../lib/downloadPrefs'
import { formatBytes } from '../../lib/formatBytes'
import PresetBar from '../../components/PresetBar'
import { usePresets } from '../../lib/usePresets'
import { useSubmittedIds } from '../../lib/submittedTasks'
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
  const presets = usePresets<{ format: DownloadFormat; videoQuality: VideoQuality; audioQuality: AudioQuality }>('downloader')
  const [format, setFormat] = useState<DownloadFormat>('MP4')
  const [videoQuality, setVideoQuality] = useState<VideoQuality>('best')
  const [audioQuality, setAudioQuality] = useState<AudioQuality>('best')
  const [submitted, setSubmitted] = useSubmittedIds('downloader')
  const taskId = submitted[0] ?? null
  const setTaskId = (id: string) => setSubmitted([id])
  const [preview, setPreview] = useState<{
    sizeBytes: number | null
    thumbnailUrl: string | null
    playlist: PlaylistInfo | null
  } | null>(null)
  // Only consulted for "video inside a playlist" links, where the user picks.
  const [playlistMode, setPlaylistMode] = useState<'single' | 'all'>('single')
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
  const playlist = preview?.playlist ?? null
  const wholePlaylist = !!playlist && (!playlist.ambiguous || playlistMode === 'all')

  // Debounced size preview: re-probe shortly after the url/format/quality settle,
  // rather than on every keystroke — a yt-dlp lookup takes a real network round trip.
  useEffect(() => {
    const trimmed = url.trim()
    if (!trimmed || !host.isDesktop) {
      setPreview(null)
      return
    }
    setPreviewing(true)
    // A slow probe for an older url/format must not overwrite a newer one's result.
    let stale = false
    const timer = setTimeout(async () => {
      const result = await host.tasks.probe({ url: trimmed, format, videoQuality, audioQuality })
      if (stale) return
      setPreview({
        sizeBytes: result.approxSizeBytes,
        thumbnailUrl: result.thumbnailUrl,
        playlist: result.playlist ?? null,
      })
      setPreviewing(false)
    }, 700)
    return () => {
      stale = true
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
      approxSizeBytes: wholePlaylist ? null : (preview?.sizeBytes ?? null),
      thumbnailUrl: preview?.thumbnailUrl ?? null,
      playlist: playlistMode,
    })
    setTaskId(id)
  }

  const ytDlpMissing = ytDlp?.available === false

  return (
    <FeatureCard feature={feature} onDropText={
        running
          ? undefined
          : (t) => {
              if (!/^https?:\/\//i.test(t)) return
              setUrl(t)
              setPreview(null)
              setPlaylistMode('single')
            }
      }>
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
      <PresetBar
        presets={presets.presets}
        onApply={(p) => {
          setFormat(p.format)
          setVideoQuality(p.videoQuality)
          setAudioQuality(p.audioQuality)
        }}
        onSave={(name) => presets.save(name, { format, videoQuality, audioQuality })}
        onRemove={presets.remove}
      />
      <input
        className="glass-input"
        type="url"
        placeholder="Paste a YouTube, TikTok, SoundCloud — or Spotify track (experimental) — link…"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value)
          setPreview(null) // a stale thumbnail/size must not be attached to the new link
          setPlaylistMode('single')
        }}
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
              ? 'Checking link…'
              : wholePlaylist
                ? `Playlist: ${playlist?.title} — ${playlist?.count} videos`
                : formatBytes(preview?.sizeBytes)
                  ? `Approx. size: ${formatBytes(preview?.sizeBytes)}`
                  : 'Size unavailable'}
          </span>
        </div>
      )}

      {playlist?.ambiguous && !running && !previewing && (
        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">
            This video is part of a playlist
          </span>
          <GlassSelect
            id="downloader-playlist-mode"
            options={[
              { value: 'single' as const, label: 'Just this video' },
              { value: 'all' as const, label: `Entire playlist (${playlist.count} videos)` },
            ]}
            value={playlistMode}
            onChange={setPlaylistMode}
          />
        </div>
      )}

      {task && (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--input-bg)]">
            <div
              className={`h-full rounded-full bg-[var(--accent)] transition-[width] duration-300 ${
                task.status === 'running' ? 'progress-shimmer' : ''
              }`}
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
                {task.playlist && task.playlist.total > 0 && (
                  <Tag>
                    {task.playlist.index}/{task.playlist.total}
                  </Tag>
                )}
                {formatBytes(task.sizeBytes) && (
                  <Tag>
                    {task.sizeIsEstimate ? '~' : ''}
                    {formatBytes(task.sizeBytes)}
                  </Tag>
                )}
                {task.experimentalMatch && <Tag>{task.experimentalMatch}</Tag>}
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
