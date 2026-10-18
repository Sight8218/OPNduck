import { useEffect, useState } from 'react'
import FeatureCard from '../../components/FeatureCard'
import Tag from '../../components/Tag'
import { host, type ContainerFormat, type ConvertMode } from '../../host'
import FormatPickerModal from './FormatPickerModal'
import { CATEGORIES, CATEGORY_LABELS, FORMATS, PICKER_EXTENSIONS, fileCategory } from './formats'
import { getDownloadDirOverride } from '../../lib/downloadPrefs'
import { formatBytes } from '../../lib/formatBytes'
import PresetBar from '../../components/PresetBar'
import { usePresets } from '../../lib/usePresets'
import { startBatch } from '../../lib/startBatch'
import { useSubmittedIds } from '../../lib/submittedTasks'
import { useTasks } from '../../lib/useTasks'
import type { FeatureDefinition } from '../registry'
import { IconX } from '@tabler/icons-react'


function basename(fullPath: string): string {
  return fullPath.split(/[/\\]/).pop() ?? fullPath
}

// @category: converter/converter-card
export default function ConverterCard({ feature }: { feature: FeatureDefinition }) {
  const [files, setFiles] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const presets = usePresets<{ container: ContainerFormat; mode: ConvertMode }>('converter')
  const [submittedIds, setSubmittedIds] = useSubmittedIds('converter')
  const [ffmpeg, setFfmpeg] = useState<{ available: boolean; installHint: string } | null>(null)
  const [office, setOffice] = useState<{ available: boolean; installHint: string } | null>(null)

  useEffect(() => {
    if (!host.isDesktop) return
    host.checkFfmpeg().then(setFfmpeg)
    host.checkLibreOffice().then(setOffice)
  }, [])

  const tasks = useTasks()
  const submittedTasks = tasks.filter((t) => submittedIds.includes(t.id))
  const anyRunning = submittedTasks.some((t) => t.status === 'queued' || t.status === 'running')
  const ffmpegMissing = ffmpeg?.available === false
  const officeMissing = office?.available === false
  // Gate per tool: documents need LibreOffice only, everything else needs ffmpeg only.
  const hasDocs = files.some((f) => fileCategory(f) === 'document')
  const hasMedia = files.some((f) => fileCategory(f) !== 'document')
  const blockedByMissingTool = (ffmpegMissing && hasMedia) || (officeMissing && hasDocs)

  const addDropped = (paths: string[]) => setFiles((prev) => [...prev, ...paths.filter((p) => !prev.includes(p))])

  async function addFiles() {
    const picked = await host.pickFiles({ extensions: PICKER_EXTENSIONS })
    if (!picked) return
    setFiles((prev) => [...prev, ...picked.filter((p) => !prev.includes(p))])
  }

  function removeFile(path: string) {
    setFiles((prev) => prev.filter((p) => p !== path))
  }

  async function convertAll(container: ContainerFormat, mode: ConvertMode) {
    setPickerOpen(false)
    const destination = getDownloadDirOverride() ?? undefined
    const ids = await startBatch(files, (inputPath) => host.tasks.startConvert({ inputPath, container, mode, destination }))
    setSubmittedIds(ids)
    setFiles([])
  }

  return (
    <FeatureCard
      feature={feature}
      onDropFiles={anyRunning ? undefined : addDropped}
      dropExtensions={PICKER_EXTENSIONS}
    >
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

      <PresetBar
        presets={presets.presets}
        applyHint="Convert the added files with this preset"
        onApply={(p) => files.length > 0 && !anyRunning && !blockedByMissingTool && convertAll(p.container, p.mode)}
        onRemove={presets.remove}
      />

      <button type="button" className="glass-btn" onClick={addFiles} disabled={anyRunning}>
        Add files…
      </button>

      {files.length === 0 && (
        // Fills whatever height the Home grid gives this card: the heading stays on top and the
        // category rows spread evenly below it, so extra height reads as spacing, not a hole.
        <div className="flex flex-1 flex-col gap-2 rounded-xl border border-dashed border-[var(--glass-border)] p-3 text-xs">
          <span className="font-medium text-[var(--text)]">Supports {FORMATS.length} formats</span>
          <div className="flex flex-1 flex-col justify-evenly gap-2">
            {CATEGORIES.map((cat) => (
              // Label above the chips (not beside them): beside, the 7 image chips outgrew the
              // card and ICO wrapped onto a line of its own.
              <div key={cat}>
                <span className="mb-1 block text-[var(--text-dim)]">{CATEGORY_LABELS[cat]}</span>
                <div className="flex flex-wrap gap-1">
                  {FORMATS.filter((f) => f.category === cat).map((f) => (
                    <Tag key={f.id}>{f.label}</Tag>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="flex max-h-48 flex-1 flex-col gap-1 overflow-y-auto">
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
        onClick={() => setPickerOpen(true)}
        disabled={files.length === 0 || anyRunning || blockedByMissingTool}
        title={blockedByMissingTool ? 'Install the missing tool first (see above)' : undefined}
      >
        Choose format…
      </button>

      <FormatPickerModal
        open={pickerOpen}
        files={files}
        documentsHint={office && !office.available ? office.installHint : undefined}
        onClose={() => setPickerOpen(false)}
        onConvert={convertAll}
        onSavePreset={(name, container, mode) => presets.save(name, { container, mode })}
      />
    </FeatureCard>
  )
}
