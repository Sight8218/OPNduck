import { useState } from 'react'
import GlassSelect from './GlassSelect'
import Tag from './Tag'
import { host, type AudioQuality, type DownloadFormat, type Subscription, type VideoQuality } from '../host'
import {
  AUDIO_QUALITY_OPTIONS,
  FORMAT_OPTIONS,
  VIDEO_FORMATS,
  VIDEO_QUALITY_OPTIONS,
} from '../features/downloader/options'
import { getDownloadDirOverride } from '../lib/downloadPrefs'
import { useSubscriptions } from '../lib/useSubscriptions'

const BACKFILL_OPTIONS = [
  { value: '0', label: 'Only new uploads' },
  { value: '3', label: 'Also the latest 3' },
  { value: '5', label: 'Also the latest 5' },
  { value: '10', label: 'Also the latest 10' },
]

const cleanError = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function ago(ms: number | null): string {
  if (!ms) return 'not checked yet'
  const mins = Math.round((Date.now() - ms) / 60000)
  if (mins < 1) return 'checked just now'
  if (mins < 60) return `checked ${mins} min ago`
  const hours = Math.round(mins / 60)
  return hours < 48 ? `checked ${hours} h ago` : `checked ${Math.round(hours / 24)} days ago`
}

function Row({ sub }: { sub: Subscription }) {
  const [busy, setBusy] = useState(false)
  const quality = VIDEO_FORMATS.includes(sub.format) ? sub.videoQuality : sub.audioQuality
  return (
    <div className="glass flex flex-col gap-2 rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{sub.title}</div>
          <div className="truncate text-xs text-[var(--text-faint)]">{sub.url}</div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Tag>{sub.format}</Tag>
          {quality && quality !== 'best' && <Tag>{VIDEO_FORMATS.includes(sub.format) ? `${quality}p` : quality}</Tag>}
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-dim)]">
            <input
              type="checkbox"
              className="accent-[var(--accent)]"
              checked={sub.enabled}
              onChange={(e) => void host.subscriptions!.setEnabled(sub.id, e.target.checked)}
            />
            Active
          </label>
          <button
            type="button"
            className="glass-btn px-2 py-1 text-xs"
            disabled={busy || !sub.enabled}
            onClick={async () => {
              setBusy(true)
              try {
                await host.subscriptions!.checkNow(sub.id)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Checking…' : 'Check now'}
          </button>
          <button type="button" className="glass-btn px-2 py-1 text-xs" onClick={() => void host.subscriptions!.remove(sub.id)}>
            Remove
          </button>
        </div>
      </div>
      <div className={`text-xs ${sub.lastResult && !sub.lastResult.ok ? 'text-red-400' : 'text-[var(--text-dim)]'}`}>
        {sub.lastResult?.ok === false
          ? `${sub.lastResult.error} (${ago(sub.lastCheckedAt)})`
          : `${ago(sub.lastCheckedAt)}${sub.lastResult ? ` — started ${sub.lastResult.started} download${sub.lastResult.started === 1 ? '' : 's'}` : ''}`}
      </div>
    </div>
  )
}

/** Library > Subscriptions: automatic downloads of new uploads from channels and playlists. */
export default function SubscriptionsPanel() {
  const subs = useSubscriptions()
  const [url, setUrl] = useState('')
  const [format, setFormat] = useState<DownloadFormat>('MP4')
  const [videoQuality, setVideoQuality] = useState<VideoQuality>('best')
  const [audioQuality, setAudioQuality] = useState<AudioQuality>('best')
  const [backfill, setBackfill] = useState('0')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isVideo = VIDEO_FORMATS.includes(format)

  async function add() {
    setAdding(true)
    setError(null)
    try {
      await host.subscriptions!.add({
        url: url.trim(),
        format,
        videoQuality: isVideo ? videoQuality : undefined,
        audioQuality: format === 'MP3' ? audioQuality : undefined,
        destination: getDownloadDirOverride() ?? undefined,
        backfill: Number(backfill),
      })
      setUrl('')
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="glass flex flex-col gap-3 rounded-2xl p-4">
        <div>
          <h2 className="text-base font-bold">Subscribe to a channel or playlist</h2>
          <p className="text-xs text-[var(--text-dim)]">
            New uploads download automatically. OPNduck checks shortly after it starts and then every hour while it is open, so
            videos uploaded while it was closed are picked up the next time you open it.
          </p>
        </div>
        <input
          className="glass-input"
          type="url"
          placeholder="https://www.youtube.com/@channel  or a playlist link…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && url.trim() && !adding && add()}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <GlassSelect id="sub-format" options={FORMAT_OPTIONS} value={format} onChange={setFormat} />
          {isVideo ? (
            <GlassSelect id="sub-vq" options={VIDEO_QUALITY_OPTIONS} value={videoQuality} onChange={setVideoQuality} />
          ) : format === 'MP3' ? (
            <GlassSelect id="sub-aq" options={AUDIO_QUALITY_OPTIONS} value={audioQuality} onChange={setAudioQuality} />
          ) : (
            <div className="glass-input flex items-center text-[var(--text-faint)]">Lossless</div>
          )}
          <GlassSelect id="sub-backfill" options={BACKFILL_OPTIONS} value={backfill} onChange={setBackfill} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="glass-btn px-4" onClick={add} disabled={!url.trim() || adding}>
            {adding ? 'Checking the list…' : 'Subscribe'}
          </button>
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </div>

      {subs.length === 0 ? (
        <div className="glass flex items-center justify-center rounded-3xl p-8 text-sm text-[var(--text-dim)]">
          No subscriptions yet.
        </div>
      ) : (
        subs.map((s) => <Row key={s.id} sub={s} />)
      )}
    </div>
  )
}
