import { useEffect, useMemo, useState } from 'react'
import { IconChevronDown } from '@tabler/icons-react'
import ChipSelect from '../../components/ChipSelect'
import FeatureCard from '../../components/FeatureCard'
import GlassSelect from '../../components/GlassSelect'
import PresetBar from '../../components/PresetBar'
import SlidingSelector from '../../components/SlidingSelector'
import Tag from '../../components/Tag'
import Thumbnail from '../../components/Thumbnail'
import {
  host,
  type AudioQuality,
  type DownloadFormat,
  type DownloadProbe,
  type PlaylistInfo,
  type SubtitleOptions,
  type VideoQuality,
} from '../../host'
import { getDownloadDirOverride } from '../../lib/downloadPrefs'
import { formatBytes } from '../../lib/formatBytes'
import { initialPrefs, isSmartMode, rememberPrefs, setSmartMode } from '../../lib/smartMode'
import { useSubmittedIds } from '../../lib/submittedTasks'
import { useTasks } from '../../lib/useTasks'
import { usePresets } from '../../lib/usePresets'
import type { FeatureDefinition } from '../registry'
import {
  AUDIO_QUALITY_OPTIONS,
  FORMAT_OPTIONS,
  LIMIT_OPTIONS,
  SEARCH_LIMIT_OPTIONS,
  SUB_MODE_OPTIONS,
  VIDEO_FORMATS,
  VIDEO_QUALITY_OPTIONS,
  languageLabel,
  normalizePrefs,
  type DownloaderPrefs,
} from './options'

const LIST_TYPE_LABEL: Record<NonNullable<PlaylistInfo['type']>, string> = {
  playlist: 'Playlist',
  channel: 'Channel',
  search: 'Search results',
  watchlater: 'Watch Later',
  liked: 'Liked videos',
}

type Preview = Pick<DownloadProbe, 'subtitleLangs' | 'autoLangs' | 'audioLangs' | 'flags'> & {
  sizeBytes: number | null
  thumbnailUrl: string | null
  playlist: PlaylistInfo | null
}

// @category: downloader/download-card
export default function DownloaderCard({ feature }: { feature: FeatureDefinition }) {
  const [url, setUrl] = useState('')
  const presets = usePresets<DownloaderPrefs>('downloader')
  const [start] = useState(initialPrefs) // Smart Mode restores the last-used setup
  const [format, setFormat] = useState<DownloadFormat>(start.format)
  const [videoQuality, setVideoQuality] = useState<VideoQuality>(start.videoQuality)
  const [audioQuality, setAudioQuality] = useState<AudioQuality>(start.audioQuality)
  const [subMode, setSubMode] = useState<SubtitleOptions['mode']>(start.subMode)
  const [subLangs, setSubLangs] = useState<string[]>(start.subLangs)
  const [subEmbed, setSubEmbed] = useState(start.subEmbed)
  const [subOnly, setSubOnly] = useState(start.subOnly)
  const [audioTracks, setAudioTracks] = useState<string[]>([])
  const [limit, setLimit] = useState('all')
  const [showMore, setShowMore] = useState(start.subMode !== 'off')
  const [smart, setSmart] = useState(isSmartMode)
  const [submitted, setSubmitted] = useSubmittedIds('downloader')
  const taskId = submitted[0] ?? null
  const setTaskId = (id: string) => setSubmitted([id])
  const [preview, setPreview] = useState<Preview | null>(null)
  // Only consulted for "video inside a playlist" links, where the user picks.
  const [playlistMode, setPlaylistMode] = useState<'single' | 'all'>('single')
  const [previewing, setPreviewing] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [subNotice, setSubNotice] = useState<{ ok: boolean; text: string } | null>(null)
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
  const wholePlaylist = !!playlist && playlist.count > 0 && (!playlist.ambiguous || playlistMode === 'all')
  const isSearch = playlist?.type === 'search'
  const needsLogin = !!playlist?.needsLogin
  // Searches always have a count; every other list defaults to all.
  const effectiveLimit = isSearch ? (limit === 'all' ? '20' : limit) : limit
  const probeLimit = isSearch ? Number(effectiveLimit) : undefined

  const prefs: DownloaderPrefs = { format, videoQuality, audioQuality, subMode, subLangs, subEmbed, subOnly }
  const applyPrefs = (raw: Partial<DownloaderPrefs>) => {
    const p = normalizePrefs(raw)
    setFormat(p.format)
    setVideoQuality(p.videoQuality)
    setAudioQuality(p.audioQuality)
    setSubMode(p.subMode)
    setSubLangs(p.subLangs)
    setSubEmbed(p.subEmbed)
    setSubOnly(p.subOnly)
    if (p.subMode !== 'off') setShowMore(true)
  }

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
      let next: Preview = { sizeBytes: null, thumbnailUrl: null, playlist: null }
      try {
        const r = await host.tasks.probe({ url: trimmed, format, videoQuality, audioQuality, limit: probeLimit })
        next = {
          sizeBytes: r.approxSizeBytes,
          thumbnailUrl: r.thumbnailUrl,
          playlist: r.playlist ?? null,
          subtitleLangs: r.subtitleLangs,
          autoLangs: r.autoLangs,
          audioLangs: r.audioLangs,
          flags: r.flags,
        }
      } catch {
        /* link check failed — fall through with an empty preview rather than hang on 'Checking link…' */
      }
      if (stale) return
      setPreview(next)
      setPreviewing(false)
    }, 700)
    return () => {
      stale = true
      clearTimeout(timer)
      setPreviewing(false)
    }
  }, [url, format, videoQuality, audioQuality, probeLimit])

  // Subtitle languages this video actually offers for the chosen kind of subtitles.
  const subChoices = useMemo(() => {
    const manual = preview?.subtitleLangs ?? []
    const auto = preview?.autoLangs ?? []
    const codes = subMode === 'manual' ? manual : subMode === 'auto' ? auto : subMode === 'both' ? [...new Set([...manual, ...auto])] : []
    return codes.map((c) => ({ value: c, label: languageLabel(c) }))
  }, [preview, subMode])
  const audioChoices = useMemo(
    () => (preview?.audioLangs ?? []).map((c) => ({ value: c, label: languageLabel(c) })),
    [preview],
  )

  // A new link (or mode) changes which languages exist: drop ones that vanished, and preselect
  // English (or the first available) so turning subtitles on never leaves nothing chosen.
  useEffect(() => {
    if (subMode === 'off' || subChoices.length === 0) return
    const have = new Set(subChoices.map((c) => c.value))
    const kept = subLangs.filter((l) => have.has(l))
    const next = kept.length ? kept : [have.has('en') ? 'en' : subChoices[0].value]
    if (next.join() !== subLangs.join()) setSubLangs(next)
  }, [subChoices, subMode, subLangs])
  useEffect(() => {
    setAudioTracks((prev) => prev.filter((l) => audioChoices.some((c) => c.value === l)))
  }, [audioChoices])

  async function subscribe() {
    setSubNotice(null)
    try {
      const sub = await host.subscriptions!.add({
        url: url.trim(),
        format,
        videoQuality: isVideo ? videoQuality : undefined,
        audioQuality: format === 'MP3' ? audioQuality : undefined,
        destination: getDownloadDirOverride() ?? undefined,
        backfill: 0,
      })
      setSubNotice({ ok: true, text: `Subscribed to “${sub.title}” — new uploads will download automatically (see Library → Subscriptions).` })
    } catch (err) {
      setSubNotice({ ok: false, text: (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    }
  }

  async function run() {
    setStartError(null)
    let id: string
    try {
      id = await host.tasks.startDownload({
        url: url.trim(),
        format,
        videoQuality: isVideo ? videoQuality : undefined,
        audioQuality: format === 'MP3' ? audioQuality : undefined,
        destination: getDownloadDirOverride() ?? undefined,
        approxSizeBytes: wholePlaylist ? null : (preview?.sizeBytes ?? null),
        thumbnailUrl: preview?.thumbnailUrl ?? null,
        playlist: playlistMode,
        limit: wholePlaylist && effectiveLimit !== 'all' ? Number(effectiveLimit) : undefined,
        subs:
          subMode !== 'off' && subLangs.length > 0
            ? { mode: subMode, langs: subLangs, embed: subEmbed && isVideo, only: subOnly }
            : undefined,
        audioTracks: audioTracks.length > 0 ? audioTracks : undefined,
      })
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err))
      return
    }
    rememberPrefs(prefs)
    setTaskId(id)
  }

  const ytDlpMissing = ytDlp?.available === false
  const subsOnlyRun = subOnly && subMode !== 'off' && subLangs.length > 0

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PresetBar
          presets={presets.presets}
          onApply={applyPrefs}
          onSave={(name) => presets.save(name, prefs)}
          onRemove={presets.remove}
        />
        <label
          className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-dim)]"
          title="Remember your choices and apply them to every new download, here and in the command palette"
        >
          <input
            type="checkbox"
            className="accent-[var(--accent)]"
            checked={smart}
            onChange={(e) => {
              setSmart(e.target.checked)
              setSmartMode(e.target.checked)
              if (e.target.checked) rememberPrefs(prefs)
            }}
          />
          Smart mode
        </label>
      </div>
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
              : needsLogin
                ? 'This list needs you to be signed in — set a cookie source in Settings → Downloads.'
                : wholePlaylist
                  ? `${LIST_TYPE_LABEL[playlist?.type ?? 'playlist']}: ${playlist?.title} — ${playlist?.count} videos`
                  : formatBytes(preview?.sizeBytes)
                    ? `Approx. size: ${formatBytes(preview?.sizeBytes)}`
                    : 'Size unavailable'}
          </span>
          {!previewing && preview?.flags?.includes('360') && <Tag>360°</Tag>}
          {!previewing && preview?.flags?.includes('3d') && <Tag>3D</Tag>}
        </div>
      )}

      {wholePlaylist && !running && !previewing && (
        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">How many</span>
          <GlassSelect
            id="downloader-limit"
            options={isSearch ? SEARCH_LIMIT_OPTIONS : LIMIT_OPTIONS}
            value={effectiveLimit}
            onChange={setLimit}
          />
        </div>
      )}

      {host.subscriptions && wholePlaylist && !running && !previewing && (playlist?.type === 'channel' || playlist?.type === 'playlist') && (
        <div className="flex flex-col gap-1">
          <button type="button" className="glass-btn self-start px-3 py-1.5 text-xs" onClick={subscribe}>
            Subscribe to new uploads
          </button>
          {subNotice && <span className={`text-xs ${subNotice.ok ? 'text-[var(--text-dim)]' : 'text-red-400'}`}>{subNotice.text}</span>}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <button
          type="button"
          className="flex items-center gap-1 self-start text-xs font-medium text-[var(--text-dim)] hover:text-[var(--text)]"
          aria-expanded={showMore}
          onClick={() => setShowMore((v) => !v)}
        >
          <IconChevronDown
            size={14}
            aria-hidden="true"
            style={{ transform: showMore ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}
          />
          More options
          {!showMore && (subMode !== 'off' || audioTracks.length > 0) && (
            <span className="text-[var(--accent)]">
              {' '}
              · {[subMode !== 'off' ? 'subtitles' : '', audioTracks.length ? `${audioTracks.length} audio` : ''].filter(Boolean).join(', ')}
            </span>
          )}
        </button>
        {showMore && (
          <div className="flex flex-col gap-3 rounded-xl border border-[var(--glass-border)] p-3">
            <div>
              <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Subtitles</span>
              <SlidingSelector<SubtitleOptions['mode']>
                id="downloader-sub-mode"
                options={SUB_MODE_OPTIONS}
                value={subMode}
                onChange={setSubMode}
                className="w-full grid-cols-4"
              />
            </div>
            {subMode !== 'off' &&
              (subChoices.length > 0 ? (
                <>
                  <ChipSelect options={subChoices} value={subLangs} onChange={setSubLangs} max={20} disabled={running} />
                  <div className="flex flex-wrap gap-4 text-xs text-[var(--text-dim)]">
                    {isVideo && (
                      <label className="flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          className="accent-[var(--accent)]"
                          checked={subEmbed && !subOnly}
                          disabled={subOnly}
                          onChange={(e) => setSubEmbed(e.target.checked)}
                        />
                        Embed in the video
                      </label>
                    )}
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="accent-[var(--accent)]"
                        checked={subOnly}
                        onChange={(e) => setSubOnly(e.target.checked)}
                      />
                      Subtitles only (no video)
                    </label>
                  </div>
                </>
              ) : (
                <span className="text-xs text-[var(--text-faint)]">
                  {preview ? 'This video lists no subtitles of that kind.' : 'Paste a link to see which languages exist.'}
                </span>
              ))}
            {audioChoices.length > 1 && (
              <div>
                <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">
                  Also save audio tracks (dubs) as separate MP3 files
                </span>
                <ChipSelect options={audioChoices} value={audioTracks} onChange={setAudioTracks} max={10} disabled={running} />
              </div>
            )}
          </div>
        )}
      </div>

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

      {startError && <span className="text-xs text-red-400">{startError}</span>}

      <div className="flex gap-2">
        <button
          className="glass-btn flex-1"
          onClick={run}
          disabled={!url.trim() || running || ytDlpMissing || needsLogin}
          title={ytDlpMissing ? 'Install yt-dlp first' : needsLogin ? 'Sign-in required — see Settings → Downloads' : undefined}
        >
          {subsOnlyRun ? 'Download subtitles' : 'Run Task'}
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
