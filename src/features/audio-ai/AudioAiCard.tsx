import { useEffect, useState } from 'react'
import { IconX } from '@tabler/icons-react'
import FeatureCard from '../../components/FeatureCard'
import GlassSelect from '../../components/GlassSelect'
import PresetBar from '../../components/PresetBar'
import Tag from '../../components/Tag'
import { host, type AudioAiFormat, type AudioAiMode } from '../../host'
import { getDownloadDirOverride } from '../../lib/downloadPrefs'
import { formatBytes } from '../../lib/formatBytes'
import { startBatch } from '../../lib/startBatch'
import { useSubmittedIds } from '../../lib/submittedTasks'
import { usePresets } from '../../lib/usePresets'
import { useTasks } from '../../lib/useTasks'
import type { FeatureDefinition } from '../registry'

const MODE_OPTIONS: { value: AudioAiMode; label: string }[] = [
  { value: 'no-vocals', label: 'Remove vocals (instrumental)' },
  { value: 'vocals', label: 'Extract vocals / remove music' },
  { value: 'voice', label: 'Isolate voice (clear speech)' },
  { value: 'echo', label: 'Reduce echo & noise (basic)' },
]

const MODE_HINT: Record<AudioAiMode, string> = {
  'no-vocals': 'Keeps the music, drops the singing.',
  vocals: 'Keeps only the voice — removes background music from speech too.',
  voice: 'Isolates the voice, then cleans and levels it for clear speech.',
  echo: 'Plain ffmpeg filtering, no AI model — helps with room echo and hiss, but it is not true dereverb.',
}

const FORMAT_OPTIONS: { value: AudioAiFormat; label: string }[] = [
  { value: 'MP3', label: 'MP3' },
  { value: 'FLAC', label: 'FLAC (lossless)' },
  { value: 'WAV', label: 'WAV' },
]

const VIDEO_EXT = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'm4v', 'wmv', 'ts', 'mpg', 'mpeg', '3gp']
const MEDIA_EXTENSIONS = [...VIDEO_EXT, 'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 'wma']

const basename = (p: string) => p.split(/[/\\]/).pop() ?? p
const isVideo = (p: string) => VIDEO_EXT.includes(p.split('.').pop()?.toLowerCase() ?? '')

// @category: audio-ai/audio-ai-card
export default function AudioAiCard({ feature }: { feature: FeatureDefinition }) {
  const [files, setFiles] = useState<string[]>([])
  const presets = usePresets<{ mode: AudioAiMode; format: AudioAiFormat; keepVideo: boolean }>('audio-ai')
  const [mode, setMode] = useState<AudioAiMode>('no-vocals')
  const [format, setFormat] = useState<AudioAiFormat>('MP3')
  const [keepVideo, setKeepVideo] = useState(true)
  const [submittedIds, setSubmittedIds] = useSubmittedIds('audio-ai')
  const [ffmpeg, setFfmpeg] = useState<{ available: boolean; installHint: string } | null>(null)
  const [demucs, setDemucs] = useState<{ available: boolean; installHint: string } | null>(null)

  useEffect(() => {
    if (!host.isDesktop) return
    host.checkFfmpeg().then(setFfmpeg)
    host.checkDemucs().then(setDemucs)
  }, [])

  const tasks = useTasks()
  const submittedTasks = tasks.filter((t) => submittedIds.includes(t.id))
  const anyRunning = submittedTasks.some((t) => t.status === 'queued' || t.status === 'running')
  // The echo mode needs only ffmpeg; the others also need Python + Demucs.
  const needsDemucs = mode !== 'echo'
  const missing = ffmpeg?.available === false ? 'ffmpeg' : needsDemucs && demucs?.available === false ? 'demucs' : null
  const hasVideo = files.some(isVideo)

  const addDropped = (paths: string[]) => setFiles((prev) => [...prev, ...paths.filter((p) => !prev.includes(p))])

  async function addFiles() {
    const picked = await host.pickFiles({ extensions: MEDIA_EXTENSIONS })
    if (!picked) return
    addDropped(picked)
  }

  async function startAll() {
    const destination = getDownloadDirOverride() ?? undefined
    const ids = await startBatch(files, MODE_OPTIONS.find((m) => m.value === mode)!.label, (inputPath, batch) =>
      host.tasks.startAudioAi({ inputPath, mode, format, keepVideo, destination, batch }),
    )
    setSubmittedIds(ids)
    setFiles([])
  }

  return (
    <FeatureCard feature={feature} onDropFiles={anyRunning ? undefined : addDropped} dropExtensions={MEDIA_EXTENSIONS}>
      {missing === 'ffmpeg' && ffmpeg && (
        <div className="flex flex-col gap-1 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-3 text-xs">
          <span className="font-medium text-[var(--text)]">ffmpeg isn't installed</span>
          <code className="select-all rounded-md bg-[var(--bg-solid)] px-2 py-1 font-mono text-[var(--text)]">{ffmpeg.installHint}</code>
        </div>
      )}
      {missing === 'demucs' && demucs && (
        <div className="flex flex-col gap-1 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-3 text-xs">
          <span className="font-medium text-[var(--text)]">Demucs isn't set up</span>
          <span className="text-[var(--text-dim)]">
            The AI modes need Python with torch, demucs and soundfile (about 2–3 GB). The model itself (~80 MB) downloads the first
            time you run it. Install, then restart OPNduck:
          </span>
          <code className="select-all rounded-md bg-[var(--bg-solid)] px-2 py-1 font-mono text-[var(--text)]">{demucs.installHint}</code>
          <span className="text-[var(--text-dim)]">The "Reduce echo & noise" mode works without it.</span>
        </div>
      )}

      <PresetBar
        presets={presets.presets}
        onApply={(p) => {
          setMode(p.mode)
          setFormat(p.format)
          setKeepVideo(p.keepVideo ?? true)
        }}
        onSave={(name) => presets.save(name, { mode, format, keepVideo })}
        onRemove={presets.remove}
      />

      <button type="button" className="glass-btn" onClick={addFiles} disabled={anyRunning}>
        Add audio or video…
      </button>

      {files.length > 0 && (
        <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
          {files.map((f) => (
            <div key={f} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--input-bg)] px-2.5 py-1.5 text-xs">
              <span className="truncate text-[var(--text)]">{basename(f)}</span>
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((p) => p !== f))}
                aria-label={`Remove ${basename(f)}`}
                className="shrink-0 text-[var(--text-faint)] hover:text-[var(--text)]"
              >
                <IconX size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div>
        <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">What to do</span>
        <GlassSelect id="audioai-mode" options={MODE_OPTIONS} value={mode} onChange={setMode} />
        <span className="mt-1 block text-xs text-[var(--text-faint)]">{MODE_HINT[mode]}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Audio format</span>
          <GlassSelect id="audioai-format" options={FORMAT_OPTIONS} value={format} onChange={setFormat} />
        </div>
        {hasVideo && (
          <label className="flex cursor-pointer items-end gap-2 pb-2 text-xs text-[var(--text-dim)]">
            <input type="checkbox" className="accent-[var(--accent)]" checked={keepVideo} onChange={(e) => setKeepVideo(e.target.checked)} />
            Keep the video (MP4)
          </label>
        )}
      </div>

      {submittedTasks.length > 0 && (
        <div className="flex flex-col gap-2">
          {submittedTasks.map((t) => (
            <div key={t.id} className="flex flex-col gap-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--input-bg)]">
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ${t.status === 'error' ? 'bg-red-500' : 'bg-[var(--accent)]'} ${
                    t.status === 'running' ? 'progress-shimmer' : ''
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
                    <Tag>{t.format}</Tag>
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
        onClick={startAll}
        disabled={files.length === 0 || anyRunning || missing !== null}
        title={missing ? (missing === 'ffmpeg' ? 'Install ffmpeg first' : 'Set up Demucs first (see above)') : undefined}
      >
        Process
      </button>
    </FeatureCard>
  )
}
// --- end: audio-ai/audio-ai-card ---
