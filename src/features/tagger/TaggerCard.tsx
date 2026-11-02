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

import { useEffect, useState } from 'react'
import FeatureCard from '../../components/FeatureCard'
import ProgressBar from '../../components/ProgressBar'
import TaskLogs from '../../components/TaskLogs'
import Tag from '../../components/Tag'
import { host, type TagLookup, type ToolStatus } from '../../host'
import { startBatch } from '../../lib/startBatch'
import { takeTagHandoff } from '../../lib/tagHandoff'
import { useSubmittedIds } from '../../lib/submittedTasks'
import { useTasks } from '../../lib/useTasks'
import type { FeatureDefinition } from '../registry'

const EXTENSIONS = ['mp3', 'flac', 'm4a', 'ogg', 'opus']
const AUTO_ACCEPT = 0.9
const MAX_FILES = 500

const basename = (p: string) => p.split(/[/\\]/).pop() ?? p
const COVER_EXTS = ['mp3', 'flac', 'm4a']

interface Row {
  path: string
  status: 'waiting' | 'looking' | 'done' | 'error'
  lookup?: TagLookup
  error?: string
  accept: boolean
}

const describe = (t: { artist: string | null; title: string | null; album: string | null; year: number | null; track: number | null } | null) =>
  t && (t.title || t.artist) ? `${[t.artist, t.title].filter(Boolean).join(' - ')}${t.album ? ` · ${t.album}` : ''}${t.year ? ` (${t.year})` : ''}` : '—'

// @category: tagger/tagger-card
/** Fill in artist, title, album, year, track and cover art for audio files: look them up, check the guesses, then write. */
export default function TaggerCard({ feature }: { feature: FeatureDefinition }) {
  const [rows, setRows] = useState<Row[]>([])
  const [looking, setLooking] = useState(false)
  const [organize, setOrganize] = useState(false)
  const [fpcalc, setFpcalc] = useState<ToolStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submittedIds, setSubmittedIds] = useSubmittedIds('tag')

  const tasks = useTasks()
  const submitted = tasks.filter((t) => submittedIds.includes(t.id))
  const running = submitted.some((t) => t.status === 'queued' || t.status === 'running')

  useEffect(() => {
    void host.checkFpcalc().then(setFpcalc)
    const handed = takeTagHandoff()
    if (handed?.length) void addPaths(handed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addPaths(paths: string[]) {
    const files: string[] = []
    for (const p of paths) {
      if (EXTENSIONS.includes(p.split('.').pop()?.toLowerCase() ?? '')) files.push(p)
      else if (!/\.[A-Za-z0-9]{1,5}$/.test(basename(p))) files.push(...(await host.tagger.listAudio(p))) // no extension: probably a folder
    }
    setRows((cur) => {
      const have = new Set(cur.map((r) => r.path))
      const add = files.filter((f) => !have.has(f)).map((path): Row => ({ path, status: 'waiting', accept: false }))
      return [...cur, ...add].slice(0, MAX_FILES)
    })
    setError(files.length === 0 ? 'No audio files there (mp3, flac, m4a, ogg, opus).' : null)
  }

  async function pickFiles() {
    const p = await host.pickFiles({ extensions: EXTENSIONS })
    if (p?.length) await addPaths(p)
  }

  async function pickFolder() {
    const p = await host.pickFolder()
    if (p) await addPaths([p])
  }

  const patch = (path: string, change: Partial<Row>) => setRows((cur) => cur.map((r) => (r.path === path ? { ...r, ...change } : r)))

  async function lookUp() {
    setLooking(true)
    setError(null)
    // One file at a time: the music databases ask for no more than about one request per second.
    for (const row of rows) {
      if (row.status === 'done') continue
      patch(row.path, { status: 'looking' })
      try {
        const lookup = await host.tagger.identify(row.path)
        patch(row.path, { status: 'done', lookup, accept: !!lookup.found && lookup.source === 'acoustid' && lookup.confidence >= AUTO_ACCEPT })
      } catch (err) {
        const message = (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
        patch(row.path, { status: 'error', error: message })
        if (/fpcalc|Couldn't reach/.test(message)) {
          setError(message)
          break
        }
      }
    }
    setLooking(false)
  }

  async function write() {
    const todo = rows.filter((r) => r.accept && r.lookup?.found)
    setError(null)
    const ids = await startBatch(todo, `Tag music${organize ? ' and organize' : ''}`, (r, batch) => {
      const f = r.lookup!.found!
      return host.tasks.startTag({
        batch,
        inputPath: r.path,
        organize,
        tags: { title: f.title ?? undefined, artist: f.artist ?? undefined, album: f.album ?? undefined, year: f.year ?? undefined, track: f.track ?? undefined, coverUrl: f.coverUrl },
      })
    })
    if (ids.length) setSubmittedIds(ids)
  }

  const ticked = rows.filter((r) => r.accept).length
  const lookedUp = rows.some((r) => r.status === 'done')
  const pending = rows.some((r) => r.status === 'waiting' || r.status === 'error')
  const busy = looking || running

  return (
    <FeatureCard feature={feature} onDropFiles={busy ? undefined : (paths) => void addPaths(paths)} dropExtensions={EXTENSIONS}>
      {fpcalc && !fpcalc.available && (
        <span className="text-xs text-red-400">
          The fingerprint tool (Chromaprint) is not installed. Install it with: <code>{fpcalc.installHint}</code>
        </span>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="glass-btn" onClick={() => void pickFiles()} disabled={busy}>
          Choose songs…
        </button>
        <button type="button" className="glass-btn" onClick={() => void pickFolder()} disabled={busy}>
          Choose a folder…
        </button>
        {rows.length > 0 && (
          <button
            type="button"
            className="glass-btn"
            onClick={() => {
              setRows([])
              setError(null)
            }}
            disabled={busy}
          >
            Clear
          </button>
        )}
      </div>
      <span className="text-[11px] text-[var(--text-faint)]">
        Only when you press Look up: each song's audio fingerprint and title are sent to AcoustID, MusicBrainz and the Cover Art Archive. Nothing else, and nothing without that button.
      </span>

      {rows.length > 0 && (
        <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--glass-border)]">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[var(--bg-solid)] text-[var(--text-dim)]">
              <tr>
                <th className="w-8 px-2 py-1" />
                <th className="px-2 py-1">File and current tags</th>
                <th className="px-2 py-1">Found</th>
                <th className="w-16 px-2 py-1">Sure</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const found = r.lookup?.found
                return (
                  <tr key={r.path} className="border-t border-[var(--glass-border)] align-top">
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        className="accent-[var(--accent)]"
                        aria-label={`Write the found tags to ${basename(r.path)}`}
                        checked={r.accept}
                        disabled={!found || busy}
                        onChange={(e) => patch(r.path, { accept: e.target.checked })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <span className="block truncate" title={r.path}>{basename(r.path)}</span>
                      <span className="block text-[var(--text-faint)]">{r.lookup ? describe(r.lookup.current) : ''}</span>
                    </td>
                    <td className="px-2 py-1">
                      {r.status === 'looking' && <span className="text-[var(--text-dim)]">Looking…</span>}
                      {r.status === 'waiting' && <span className="text-[var(--text-faint)]">Not looked up yet</span>}
                      {r.status === 'error' && <span className="text-red-400">{r.error}</span>}
                      {r.status === 'done' && (
                        <>
                          <span className="block">{describe(found ?? null)}</span>
                          {found?.coverUrl && COVER_EXTS.includes(r.path.split('.').pop()?.toLowerCase() ?? '') && <span className="text-[var(--text-faint)]">with cover</span>}
                          {r.lookup?.source === 'filename' && <span className="text-[var(--text-faint)]">guessed from the file name</span>}
                        </>
                      )}
                    </td>
                    <td className="px-2 py-1">{r.lookup && found ? `${Math.round(r.lookup.confidence * 100)}%` : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {lookedUp && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="glass-btn"
            disabled={busy}
            onClick={() => setRows((cur) => cur.map((r) => ({ ...r, accept: !!r.lookup?.found && r.lookup.source === 'acoustid' && r.lookup.confidence >= AUTO_ACCEPT })))}
          >
            Tick matches above 90%
          </button>
          <button type="button" className="glass-btn" disabled={busy} onClick={() => setRows((cur) => cur.map((r) => ({ ...r, accept: false })))}>
            Untick all
          </button>
        </div>
      )}

      <label className="flex cursor-pointer items-start gap-3 py-1">
        <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={organize} disabled={busy} onChange={(e) => setOrganize(e.target.checked)} />
        <span>
          <span className="text-sm font-medium">Move files into Artist/Album/ folders</span>
          <span className="block text-[11px] text-[var(--text-dim)]">Folders are made next to where each file is now, and nothing is overwritten.</span>
        </span>
      </label>
      <span className="text-[11px] text-[var(--text-faint)]">Covers are added to MP3, FLAC and M4A. Opus and Ogg get the tags only.</span>

      {error && <span className="text-xs text-red-400">{error}</span>}
      {submitted.map((t) => (
        <div key={t.id} className="flex flex-col gap-1">
          <ProgressBar value={t.progress} status={t.status} />
          <TaskLogs taskId={t.id} />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-xs text-[var(--text-dim)]">{t.status === 'error' ? t.error : t.label}</span>
            {t.status === 'done' && t.quality && <Tag>{t.quality}</Tag>}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="glass-btn" onClick={() => void lookUp()} disabled={busy || rows.length === 0 || !pending || fpcalc?.available === false}>
          {looking ? 'Looking up…' : 'Look up'}
        </button>
        <button type="button" className="glass-btn" onClick={() => void write()} disabled={busy || ticked === 0}>
          Write tags{ticked ? ` (${ticked})` : ''}
        </button>
      </div>
    </FeatureCard>
  )
}
