import { useEffect, useState } from 'react'
import FeatureCard from '../../components/FeatureCard'
import GlassSelect from '../../components/GlassSelect'
import Tag from '../../components/Tag'
import { host, type SubtitleFormat, type WhisperModel } from '../../host'
import { getDownloadDirOverride } from '../../lib/downloadPrefs'
import { formatBytes } from '../../lib/formatBytes'
import PresetBar from '../../components/PresetBar'
import { usePresets } from '../../lib/usePresets'
import { startBatch } from '../../lib/startBatch'
import { useSubmittedIds } from '../../lib/submittedTasks'
import { useTasks } from '../../lib/useTasks'
import type { FeatureDefinition } from '../registry'
import { IconX } from '@tabler/icons-react'

const MODEL_OPTIONS: { value: WhisperModel; label: string }[] = [
  { value: 'tiny', label: 'Tiny — fastest, rough' },
  { value: 'base', label: 'Base — fast, decent' },
  { value: 'small', label: 'Small — good balance' },
  { value: 'medium', label: 'Medium — most accurate, slow' },
]

const LANGUAGE_OPTIONS = [
  { value: 'auto', label: 'Detect automatically' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'sv', label: 'Swedish' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'nl', label: 'Dutch' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
  { value: 'ru', label: 'Russian' },
]

const FORMAT_OPTIONS: { value: SubtitleFormat; label: string }[] = [
  { value: 'srt', label: 'SRT — works everywhere' },
  { value: 'vtt', label: 'VTT — for the web' },
]

const MEDIA_EXTENSIONS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'mp3', 'wav', 'flac', 'm4a', 'ogg', 'opus']

function basename(fullPath: string): string {
  return fullPath.split(/[/\\]/).pop() ?? fullPath
}

interface SubtitleSettings {
  model: WhisperModel
  language: string
  format: SubtitleFormat
}

/** Same queue pattern as the upscalers, but the engine is faster-whisper running
 *  in the user's own Python rather than a standalone binary. */
// @category: subtitles/subtitles-card
export default function SubtitlesCard({ feature }: { feature: FeatureDefinition }) {
  const [files, setFiles] = useState<string[]>([])
  const presets = usePresets<SubtitleSettings>('subtitles')
  const [model, setModel] = useState<WhisperModel>('tiny')
  const [language, setLanguage] = useState('auto')
  const [format, setFormat] = useState<SubtitleFormat>('srt')
  const [submittedIds, setSubmittedIds] = useSubmittedIds('subtitles')
  const [whisper, setWhisper] = useState<{ available: boolean; installHint: string } | null>(null)

  useEffect(() => {
    if (!host.isDesktop) return
    host.checkFasterWhisper().then(setWhisper)
  }, [])

  const tasks = useTasks()
  const submittedTasks = tasks.filter((t) => submittedIds.includes(t.id))
  const anyRunning = submittedTasks.some((t) => t.status === 'queued' || t.status === 'running')
  const missing = whisper != null && !whisper.available

  const addDropped = (paths: string[]) => setFiles((prev) => [...prev, ...paths.filter((p) => !prev.includes(p))])

  async function addFiles() {
    const picked = await host.pickFiles({ extensions: MEDIA_EXTENSIONS })
    if (!picked) return
    setFiles((prev) => [...prev, ...picked.filter((p) => !prev.includes(p))])
  }

  function removeFile(path: string) {
    setFiles((prev) => prev.filter((p) => p !== path))
  }

  async function transcribeAll() {
    const destination = getDownloadDirOverride() ?? undefined
    const ids = await startBatch(files, `Subtitles (${model})`, (inputPath, batch) =>
      host.tasks.startSubtitles({ inputPath, model, language, format, destination, batch }),
    )
    setSubmittedIds(ids)
    setFiles([])
  }

  return (
    <FeatureCard
      feature={feature}
      onDropFiles={anyRunning ? undefined : addDropped}
      dropExtensions={MEDIA_EXTENSIONS}
    >
      {missing && (
        <div className="flex flex-col gap-1 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-3 text-xs">
          <span className="font-medium text-[var(--text)]">faster-whisper isn't installed</span>
          <span className="text-[var(--text-dim)]">
            Subtitles need Python 3 with the faster-whisper package:
          </span>
          <code className="select-all rounded-md bg-[var(--bg-solid)] px-2 py-1 font-mono text-[var(--text)]">
            {whisper.installHint}
          </code>
          <span className="text-[var(--text-dim)]">Restart OPNduck after installing.</span>
        </div>
      )}

      <PresetBar
        presets={presets.presets}
        onApply={(p) => {
          setModel(p.model)
          setLanguage(p.language)
          setFormat(p.format)
        }}
        onSave={(name) => presets.save(name, { model, language, format })}
        onRemove={presets.remove}
      />

      <button type="button" className="glass-btn" onClick={addFiles} disabled={anyRunning}>
        Add videos or audio…
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
                <IconX size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div>
        <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Model</span>
        <GlassSelect id="subtitles-model" options={MODEL_OPTIONS} value={model} onChange={setModel} />
        <span className="mt-1 block text-xs text-[var(--text-faint)]">
          Each model downloads once, the first time you use it.
        </span>
      </div>

      <div>
        <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Spoken language</span>
        <GlassSelect id="subtitles-language" options={LANGUAGE_OPTIONS} value={language} onChange={setLanguage} />
      </div>

      <div>
        <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Format</span>
        <GlassSelect id="subtitles-format" options={FORMAT_OPTIONS} value={format} onChange={setFormat} />
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
        onClick={transcribeAll}
        disabled={files.length === 0 || anyRunning || missing}
        title={missing ? 'Install faster-whisper first' : undefined}
      >
        Generate Subtitles
      </button>
    </FeatureCard>
  )
}
