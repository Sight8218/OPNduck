/*
 * OPNduck — local-first media processing suite.
 * Copyright (C) 2026 Aaron Jonsson
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import ProgressBar from '../components/ProgressBar'
import TaskLogs from '../components/TaskLogs'
import { memo, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { IconChevronDown, IconX } from '@tabler/icons-react'
import GlassSelect from '../components/GlassSelect'
import SlidingSelector from '../components/SlidingSelector'
import SubscriptionsPanel from '../components/SubscriptionsPanel'
import Tag from '../components/Tag'
import Thumbnail from '../components/Thumbnail'
import { host, type ImportedTask, type TaskState } from '../host'
import { formatBytes } from '../lib/formatBytes'
import { setTagHandoff } from '../lib/tagHandoff'
import {
  DEFAULT_VIEW,
  applyView,
  summarizeGroup,
  type KindFilter,
  type SortKey,
  type StatusFilter,
  type ViewOptions,
} from '../lib/libraryView'
import { useQueuePaused } from '../lib/useQueuePaused'
import { useTasks } from '../lib/useTasks'
import VideoAiPanel, { SpokenSearch } from '../components/VideoAiPanel'

const RUNNING_LABEL: Record<TaskState['kind'], string> = {
  download: 'Downloading',
  convert: 'Converting',
  upscale: 'Upscaling',
  interpolate: 'Interpolating',
  subtitles: 'Transcribing',
  'audio-ai': 'Processing audio',
  trim: 'Trimming',
  compress: 'Compressing',
  tag: 'Tagging',
  gif: 'Making a clip',
  jumpcut: 'Cutting silences',
  restore: 'Restoring',
  grade: 'Grading',
  bgremove: 'Cutting out',
  beats: 'Finding the beat',
  beatcut: 'Cutting to the beat',
}

function statusLabel(task: TaskState): string {
  if (task.waiting && (task.status === 'queued' || task.status === 'running')) return task.waiting
  if (task.status === 'running') return task.stage || RUNNING_LABEL[task.kind]
  return { queued: 'Queued', done: 'Done', error: 'Error', canceled: 'Canceled' }[task.status]
}

/** Shown before retrying a failed Spotify→YouTube match with a different video. */
function AnotherMatchDialog({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // Portaled: .glass rows would trap a fixed overlay in their own stacking context.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Find another video"
        className="glass flex w-full max-w-sm flex-col gap-3 rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">Try a different video?</h2>
        <p className="text-sm text-[var(--text-dim)]">
          That video didn't work, so OPNduck will search YouTube again and skip it. This match is experimental: it can be
          less accurate and may pick the wrong video (a cover, a remix, a live version).
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className="glass-btn px-3 py-1.5 text-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="glass-btn px-3 py-1.5 text-sm" onClick={onConfirm}>
            Find another video
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const AUDIO_FORMATS = ['MP3', 'FLAC', 'M4A', 'OGG', 'OPUS']

function TaskRowImpl({ task }: { task: TaskState }) {
  const navigate = useNavigate()
  const running = task.status === 'queued' || task.status === 'running'
  const [askMatch, setAskMatch] = useState(false)
  const [wordsFile, setWordsFile] = useState<string | null>(null)
  const [tidy, setTidy] = useState<{ from: string; to: string } | null>(null)
  useEffect(() => {
    if (task.status !== 'done' || !host.isDesktop) return
    let alive = true
    void host.cleanName(task.id).then((r) => alive && setTidy(r)).catch(() => {})
    return () => {
      alive = false
    }
  }, [task.id, task.status, task.label])
  const [why, setWhy] = useState<Awaited<ReturnType<typeof host.explainJob>> | { error: string } | null>(null)
  async function applyFix(fix: NonNullable<Awaited<ReturnType<typeof host.explainJob>>['fix']>) {
    try {
      if (fix === 'update_ytdlp') {
        const r = await host.installYtDlp()
        if (!r.ok) return setWhy({ error: r.error ?? 'The update failed' })
      } else if (fix === 'cookies_firefox') await host.settings?.set({ cookies: { mode: 'browser', browser: 'firefox' } })
      else if (fix === 'cpu_encoder') await host.settings?.set({ videoEncoder: 'cpu' })
      await host.tasks.rerun(task.id)
      setWhy(null)
    } catch (e) {
      setWhy({ error: e instanceof Error ? e.message : String(e) })
    }
  }
  // A failed Spotify match: "Run again" offers a different video instead of repeating the same search.
  const retryOtherMatch = task.status === 'error' && !!task.experimentalMatch
  const size = formatBytes(task.sizeBytes)
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.98, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      className="glass flex flex-col gap-2 rounded-2xl p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Thumbnail url={task.thumbnailUrl} className="h-10 w-[72px] shrink-0 rounded-lg" />
          <span className="truncate text-sm font-medium">{task.label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs text-[var(--text-dim)]">{statusLabel(task)}</span>
          {task.status === 'done' && (
            <button type="button" className="glass-btn px-2 py-1 text-xs" onClick={() => host.tasks.openFolder(task.id)}>
              Open folder
            </button>
          )}
          {task.status === 'done' && task.kind !== 'tag' && AUDIO_FORMATS.includes(String(task.format).toUpperCase()) && (
            <button
              type="button"
              className="glass-btn px-2 py-1 text-xs"
              title="Open this song in the Music Tagger to fill in its tags and cover"
              onClick={async () => {
                const file = await host.tasks.fileOf(task.id)
                if (!file) return
                setTagHandoff([file])
                navigate('/?tool=tagger')
              }}
            >
              Fix tags
            </button>
          )}
          {task.status === 'done' && host.isDesktop && ['download', 'convert', 'upscale', 'interpolate', 'trim', 'compress', 'restore', 'grade', 'jumpcut', 'beatcut'].includes(task.kind) && !AUDIO_FORMATS.includes(String(task.format).toUpperCase()) && (
            <button
              type="button"
              className="glass-btn px-2 py-1 text-xs"
              title="Search what is said in this video, summarize it, find chapters or ask it questions"
              onClick={async () => setWordsFile((await host.tasks.fileOf(task.id)) ?? null)}
            >
              Spoken words
            </button>
          )}
          {tidy && (
            <button
              type="button"
              className="glass-btn px-2 py-1 text-xs"
              title={`Rename the file to: ${tidy.to}`}
              onClick={() => void host.renameClean(task.id).then(() => setTidy(null)).catch(() => {})}
            >
              Tidy name
            </button>
          )}
          {task.status === 'error' && host.isDesktop && (
            <button type="button" className="glass-btn px-2 py-1 text-xs" title="A plain-language reason, and a fix when there is one" onClick={() => void host.explainJob(task.id).then(setWhy).catch((e) => setWhy({ error: e instanceof Error ? e.message : String(e) }))}>
              Why?
            </button>
          )}
          {task.status === 'queued' && (
            <button
              type="button"
              className="glass-btn px-2 py-1 text-xs"
              title="Start this one before the other waiting jobs"
              onClick={() => void host.tasks.runNext(task.id)}
            >
              Run next
            </button>
          )}
          {!running && (
            <button type="button" className="glass-btn px-2 py-1 text-xs" onClick={() => (retryOtherMatch ? setAskMatch(true) : void host.tasks.rerun(task.id).catch(() => {}))}>
              Run again
            </button>
          )}
          {!running && (
            <button
              type="button"
              aria-label="Remove from history"
              title="Remove from history"
              className="text-[var(--text-faint)] hover:text-[var(--text)]"
              onClick={() => void host.tasks.remove([task.id])}
            >
              <IconX size={14} aria-hidden="true" />
            </button>
          )}
          {running && (
            <button
              type="button"
              className="glass-btn px-2 py-1 text-xs"
              onClick={() => host.tasks.cancel(task.id)}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag>{task.format}</Tag>
        <Tag>{task.quality}</Tag>
        {size && (
          <Tag>
            {task.sizeIsEstimate ? '~' : ''}
            {size}
          </Tag>
        )}
        {task.experimentalMatch && <Tag>{task.experimentalMatch}</Tag>}
        {task.source === 'mcp' && <Tag>via MCP</Tag>}
        {task.source === 'link' && <Tag>via link</Tag>}
        {task.source === 'ai' && <Tag>via AI</Tag>}
        {task.host && <Tag>on {task.host}</Tag>}
      </div>
      <ProgressBar value={task.progress} status={task.status} />
      <TaskLogs taskId={task.id} />
      {task.error && <span className="text-xs text-red-400">{task.error}</span>}
      {why && (
        <div className="flex flex-col gap-1.5 rounded-xl bg-[var(--input-bg)] p-3 text-xs">
          {'error' in why ? (
            <span className="text-red-400">{why.error}</span>
          ) : (
            <>
              <span>{why.reason}</span>
              {why.source === 'ai' && <span className="text-[var(--text-faint)]">This explanation came from your AI model, so it may be wrong.</span>}
              <div className="flex gap-2">
                {why.fix && why.fixLabel && (
                  <button type="button" className="glass-btn px-2 py-1 text-xs" onClick={() => void applyFix(why.fix!)}>
                    {why.fixLabel}
                  </button>
                )}
                <button type="button" className="glass-btn px-2 py-1 text-xs" onClick={() => setWhy(null)}>
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {wordsFile && <VideoAiPanel file={wordsFile} onClose={() => setWordsFile(null)} />}
      {askMatch && (
        <AnotherMatchDialog
          onClose={() => setAskMatch(false)}
          onConfirm={() => {
            setAskMatch(false)
            void host.tasks.rerun(task.id, { anotherMatch: true }).catch(() => {})
          }}
        />
      )}
    </motion.div>
  )
}

/** Every task update from the main process arrives as fresh objects, so without this each
 *  of the (up to 500) history rows re-rendered on every progress tick of a running job.
 *  Compare only the fields a row actually shows. */
const TaskRow = memo(
  TaskRowImpl,
  (a, b) =>
    a.task.id === b.task.id &&
    a.task.status === b.task.status &&
    a.task.progress === b.task.progress &&
    a.task.label === b.task.label &&
    a.task.error === b.task.error &&
    a.task.sizeBytes === b.task.sizeBytes &&
    a.task.sizeIsEstimate === b.task.sizeIsEstimate &&
    a.task.format === b.task.format &&
    a.task.quality === b.task.quality &&
    a.task.thumbnailUrl === b.task.thumbnailUrl &&
    a.task.experimentalMatch === b.task.experimentalMatch,
)

const PAGE_SIZE = 60

const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'download', label: 'Downloads' },
  { value: 'convert', label: 'Conversions' },
  { value: 'upscale', label: 'Upscales' },
  { value: 'interpolate', label: 'Interpolation' },
  { value: 'subtitles', label: 'Subtitles' },
  { value: 'audio-ai', label: 'AI audio' },
]
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Any status' },
  { value: 'active', label: 'Active' },
  { value: 'done', label: 'Done' },
  { value: 'failed', label: 'Failed / canceled' },
]
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'size', label: 'Largest first' },
  { value: 'status', label: 'By status' },
]

const VIEW_KEY = 'opnduck.library.view'
function readView(): ViewOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null')
    return { ...DEFAULT_VIEW, ...(raw && typeof raw === 'object' ? raw : {}), query: '' }
  } catch {
    return DEFAULT_VIEW
  }
}

/** One batch of jobs (e.g. "5 files — Convert to WEBM") as a collapsible block with group actions. */
function GroupBlock({
  label,
  tasks,
  open,
  onToggle,
}: {
  label: string
  tasks: TaskState[]
  open: boolean
  onToggle: () => void
}) {
  const sum = summarizeGroup(tasks)
  const failedTasks = tasks.filter((t) => t.status === 'error' || t.status === 'canceled')
  return (
    <div className="glass flex flex-col gap-2 rounded-2xl p-3">
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="flex min-w-0 items-center gap-2 text-left" aria-expanded={open} onClick={onToggle}>
          <IconChevronDown
            size={16}
            aria-hidden="true"
            className="shrink-0 text-[var(--text-dim)]"
            style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 150ms' }}
          />
          <span className="truncate text-sm font-medium">{label}</span>
        </button>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Tag>
            {sum.done}/{sum.total} done
          </Tag>
          {sum.failed > 0 && <Tag>{sum.failed} failed</Tag>}
          {sum.active > 0 && (
            <button
              type="button"
              className="glass-btn px-2 py-1 text-xs"
              onClick={() => tasks.filter((t) => t.status === 'queued' || t.status === 'running').forEach((t) => host.tasks.cancel(t.id))}
            >
              Cancel all
            </button>
          )}
          {failedTasks.length > 0 && sum.active === 0 && (
            <button
              type="button"
              className="glass-btn px-2 py-1 text-xs"
              onClick={async () => {
                // Re-run each failed job, then drop the old failed rows so the group doesn't double up.
                await Promise.allSettled(failedTasks.map((t) => host.tasks.rerun(t.id)))
                void host.tasks.remove(failedTasks.map((t) => t.id))
              }}
            >
              Retry failed
            </button>
          )}
        </div>
      </div>
      <ProgressBar value={sum.progress} status={sum.active > 0 ? 'running' : sum.failed > 0 ? 'error' : 'done'} />
      {open && (
        <div className="flex flex-col gap-2 border-l border-[var(--glass-border)] pl-3">
          <AnimatePresence initial={false}>
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

// @category: library/library-queue-page
export default function Library() {
  const tasks = useTasks()
  const [view, setView] = useState<ViewOptions>(readView)
  // A long history is rendered in pages: 500 animated rows at once is what made this page heavy.
  const [shownCount, setShownCount] = useState(PAGE_SIZE)
  const queuePaused = useQueuePaused()
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [pendingImport, setPendingImport] = useState<ImportedTask[] | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [tab, setTab] = useState<'history' | 'subscriptions'>('history')
  const [spoken, setSpoken] = useState(false) // search the words said in videos instead of the job list
  const hasFinished = tasks.some((t) => t.status === 'done' || t.status === 'error' || t.status === 'canceled')

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ ...view, query: '' }))
    } catch {
      /* storage unavailable */
    }
  }, [view])

  const items = useMemo(() => applyView(tasks, view), [tasks, view])
  const shown = items.reduce((n, i) => n + (i.type === 'task' ? 1 : i.tasks.length), 0)
  const filtering = view.query.trim() !== '' || view.kind !== 'all' || view.status !== 'all'
  const update = (patch: Partial<ViewOptions>) => setView((v) => ({ ...v, ...patch }))

  async function exportLibrary() {
    try {
      const r = await host.library!.exportHistory()
      if (r.ok) setNotice({ ok: true, text: `Exported ${r.count} entries to ${r.path}` })
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : String(err) })
    }
  }
  async function pickImport() {
    try {
      const r = await host.library!.importHistory()
      if (r.ok) {
        setPendingImport(r.entries)
        setNotice(null)
      } else if (r.error) setNotice({ ok: false, text: r.error })
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : String(err) })
    }
  }
  async function applyImport(run: boolean) {
    if (!pendingImport) return
    const entries = pendingImport
    setPendingImport(null)
    try {
      const r = await host.library!.importApply(entries, run)
      setNotice({ ok: true, text: run ? `Started ${r.started} of ${entries.length} jobs.` : `Added ${r.added} entries to the history.` })
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="mb-1 text-2xl font-extrabold sm:text-3xl">Library</h1>
          <p className="text-sm text-[var(--text-dim)]">
            Track and manage your downloads and conversions. History is kept between launches.
          </p>
        </div>
        <div className={`flex flex-wrap items-center gap-2 ${tab === 'subscriptions' ? 'hidden' : ''}`}>
          {host.library && (
            <>
              <button type="button" className="glass-btn shrink-0 px-3 py-1.5 text-xs" onClick={exportLibrary} disabled={!hasFinished}>
                Export…
              </button>
              <button type="button" className="glass-btn shrink-0 px-3 py-1.5 text-xs" onClick={pickImport}>
                Import…
              </button>
            </>
          )}
          {host.queue && (
            <button
              type="button"
              className="glass-btn shrink-0 px-3 py-1.5 text-xs"
              title={queuePaused ? 'Let waiting jobs start again' : 'Stop waiting jobs from starting (running ones finish)'}
              onClick={() => void host.queue?.setPaused(!queuePaused)}
            >
              {queuePaused ? 'Resume queue' : 'Pause queue'}
            </button>
          )}
          {hasFinished && (
            <button type="button" className="glass-btn shrink-0 px-3 py-1.5 text-xs" onClick={() => host.tasks.clearFinished()}>
              Clear finished
            </button>
          )}
        </div>
      </div>

      {host.subscriptions && (
        <SlidingSelector<'history' | 'subscriptions'>
          id="library-tab"
          options={[
            { value: 'history', label: 'History' },
            { value: 'subscriptions', label: 'Subscriptions' },
          ]}
          value={tab}
          onChange={setTab}
          className="mb-4 w-full grid-cols-2 sm:w-80"
        />
      )}

      {tab === 'subscriptions' && host.subscriptions ? (
        <SubscriptionsPanel />
      ) : (
        <>
      {pendingImport && (
        <div className="glass mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-3 text-sm">
          <span>
            Found {pendingImport.length} {pendingImport.length === 1 ? 'entry' : 'entries'} in that file. Imported entries keep the
            settings they were run with.
          </span>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => applyImport(false)}>
              Add to history
            </button>
            <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => applyImport(true)}>
              Add and run them
            </button>
            <button type="button" className="rounded-lg border border-[var(--glass-border)] px-3 py-1.5 text-xs text-[var(--text-dim)]" onClick={() => setPendingImport(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {notice && <p className={`mb-4 text-xs ${notice.ok ? 'text-[var(--text-dim)]' : 'text-red-400'}`}>{notice.text}</p>}

      {tasks.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className="glass-input"
            type="search"
            placeholder="Search name, format, error…"
            value={view.query}
            onChange={(e) => update({ query: e.target.value })}
            aria-label="Search the library"
          />
          <GlassSelect id="library-kind" options={KIND_OPTIONS} value={view.kind} onChange={(kind) => update({ kind })} />
          <GlassSelect id="library-status" options={STATUS_OPTIONS} value={view.status} onChange={(status) => update({ status })} />
          <GlassSelect id="library-sort" options={SORT_OPTIONS} value={view.sort} onChange={(sort) => update({ sort })} />
        </div>
      )}
      {host.isDesktop && (
        <label className="mb-3 flex w-fit cursor-pointer items-center gap-2 text-xs text-[var(--text-dim)]">
          <input type="checkbox" className="accent-[var(--accent)]" checked={spoken} onChange={(e) => setSpoken(e.target.checked)} />
          Spoken words: search what is said in your videos
        </label>
      )}
      {spoken && <SpokenSearch query={view.query} />}
      {tasks.length > 0 && filtering && !spoken && (
        <div className="mb-3 flex items-center gap-3 text-xs text-[var(--text-dim)]">
          <span>
            Showing {shown} of {tasks.length}
          </span>
          <button type="button" className="underline underline-offset-2 hover:text-[var(--text)]" onClick={() => setView(DEFAULT_VIEW)}>
            Clear filters
          </button>
        </div>
      )}

      {spoken ? null : tasks.length === 0 ? (
        <div className="glass flex items-center justify-center rounded-3xl p-10 text-sm text-[var(--text-dim)]">
          Nothing here yet — start a download or conversion from Home.
        </div>
      ) : items.length === 0 ? (
        <div className="glass flex items-center justify-center rounded-3xl p-10 text-sm text-[var(--text-dim)]">
          Nothing matches those filters.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {items.slice(0, shownCount).map((item) =>
              item.type === 'task' ? (
                <TaskRow key={item.task.id} task={item.task} />
              ) : (
                <GroupBlock
                  key={`g-${item.id}`}
                  label={item.label}
                  tasks={item.tasks}
                  // Groups with work in flight open themselves; finished ones start collapsed.
                  open={openGroups[item.id] ?? item.tasks.some((t) => t.status === 'queued' || t.status === 'running')}
                  onToggle={() =>
                    setOpenGroups((o) => ({
                      ...o,
                      [item.id]: !(o[item.id] ?? item.tasks.some((t) => t.status === 'queued' || t.status === 'running')),
                    }))
                  }
                />
              ),
            )}
          </AnimatePresence>
          {items.length > shownCount && (
            <button type="button" className="glass-btn self-center px-4 py-2 text-sm" onClick={() => setShownCount((n) => n + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, items.length - shownCount)} more ({items.length - shownCount} hidden)
            </button>
          )}
        </div>
      )}
        </>
      )}
    </div>
  )
}
// --- end: library/library-queue-page ---
