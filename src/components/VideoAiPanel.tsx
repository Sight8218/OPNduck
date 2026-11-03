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

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { host, type Chapter, type SpokenHit, type VideoSummary } from '../host'
import { setTrimHandoff } from '../lib/clipHandoff'
import { renderMarkdown } from '../lib/markdownLite'

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const basename = (p: string) => p.split(/[/\\]/).pop() ?? p
export const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

/** The Library's "Spoken words" search: matching lines from the transcripts of your videos. A hit opens the trimmer at that moment. */
export function SpokenSearch({ query }: { query: string }) {
  const [hits, setHits] = useState<SpokenHit[] | null>(null)
  const navigate = useNavigate()
  useEffect(() => {
    if (!query.trim()) return setHits(null)
    const t = setTimeout(() => void host.transcripts.search(query).then(setHits).catch(() => setHits([])), 250)
    return () => clearTimeout(t)
  }, [query])
  if (!query.trim()) return <p className="mb-4 text-xs text-[var(--text-dim)]">Type a word or phrase from something said in one of your videos. Videos show up here after Subtitles ran on them, or after you press "Spoken words" on a finished video and then "Make searchable".</p>
  if (hits === null) return null
  if (hits.length === 0) return <p className="mb-4 text-sm text-[var(--text-dim)]">Nobody says that in the videos that are searchable yet.</p>
  return (
    <div className="mb-4 flex flex-col gap-2">
      {hits.map((h, i) => (
        <button
          key={i}
          type="button"
          className="glass flex flex-col gap-0.5 rounded-2xl p-3 text-left"
          title="Open the trimmer at this moment"
          onClick={() => {
            setTrimHandoff({ file: h.path, start: Math.max(0, h.start - 1), end: h.end + 1 })
            navigate('/?tool=trim')
          }}
        >
          <span className="text-xs text-[var(--text-dim)]">
            {h.title} · {clock(h.start)}
          </span>
          <span className="text-sm">{h.text}</span>
        </button>
      ))}
    </div>
  )
}

type Tab = 'words' | 'summary' | 'chapters' | 'ask'

/** Everything the AI can do with one video's words: make them searchable, summarise, chapters, and questions. */
export default function VideoAiPanel({ file, onClose }: { file: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('words')
  const [has, setHas] = useState<boolean | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<VideoSummary | null>(null)
  const [chapters, setChapters] = useState<{ chapters: Chapter[]; list: string } | null>(null)
  const [written, setWritten] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [request, setRequest] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const reqRef = useRef<string | null>(null)
  reqRef.current = request

  useEffect(() => {
    void host.transcripts.has(file).then(setHas)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [file, onClose])
  useEffect(
    () =>
      host.ai.onEvent(({ requestId, event }) => {
        if (requestId === reqRef.current && event.type === 'text') setAnswer((a) => a + event.delta)
      }),
    [],
  )

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy('')
    }
  }

  const needs = has === false ? <p className="text-sm text-[var(--text-dim)]">This video has no transcript yet. Go to "Spoken words" and make it searchable first.</p> : null
  const TABS: [Tab, string][] = [['words', 'Spoken words'], ['summary', 'Summary'], ['chapters', 'Chapters'], ['ask', 'Ask']]
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-label="Spoken words" className="glass flex max-h-[85vh] w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-3xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-base font-bold">{basename(file)}</h2>
          <button type="button" className="glass-btn px-3 py-1 text-xs" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="flex gap-1 text-xs">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" className={`glass-btn px-3 py-1 ${tab === id ? 'ring-1 ring-[var(--accent)]' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'words' && (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-[var(--text-dim)]">{has ? 'This video is searchable: its words appear in the Library search under "Spoken words".' : 'Make the words in this video searchable. It is transcribed on this computer with Whisper (a job in the queue). Nothing is sent anywhere.'}</p>
            <div className="flex gap-2">
              <button type="button" className="glass-btn px-3 py-1.5 text-xs" disabled={!!busy} onClick={() => void run('make', async () => (await host.transcripts.make(file), setStarted(true)))}>
                {has ? 'Transcribe again' : 'Make searchable'}
              </button>
              {has && (
                <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => void host.transcripts.remove(file).then(() => setHas(false))}>
                  Delete the transcript
                </button>
              )}
            </div>
            {started && <p className="text-xs text-[var(--text-dim)]">Started. Follow it in the queue; the words are searchable when it finishes.</p>}
          </div>
        )}

        {tab === 'summary' && (
          <div className="flex flex-col gap-2 text-sm">
            {needs}
            {has && (
              <button type="button" className="glass-btn w-fit px-3 py-1.5 text-xs" disabled={!!busy} onClick={() => void run('summary', async () => setSummary(await host.transcripts.summary(file)))}>
                {busy === 'summary' ? 'Reading the transcript…' : summary ? 'Summarize again' : 'Summarize this video'}
              </button>
            )}
            {summary && (
              <div>
                <p className="mb-2">{summary.summary}</p>
                <ul className="list-disc pl-5">
                  {summary.points.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === 'chapters' && (
          <div className="flex flex-col gap-2 text-sm">
            {needs}
            {has && (
              <button type="button" className="glass-btn w-fit px-3 py-1.5 text-xs" disabled={!!busy} onClick={() => void run('chapters', async () => (setWritten(''), setChapters(await host.transcripts.chapters(file))))}>
                {busy === 'chapters' ? 'Finding the topics…' : chapters ? 'Find chapters again' : 'Suggest chapters'}
              </button>
            )}
            {chapters && (
              <>
                <ul className="flex flex-col gap-1">
                  {chapters.chapters.map((c, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-14 shrink-0 text-[var(--text-dim)]">{clock(c.start)}</span>
                      <input
                        className="glass-input min-w-0 flex-1 py-0.5"
                        aria-label={`Chapter ${i + 1} title`}
                        value={c.title}
                        onChange={(e) => setChapters({ ...chapters, chapters: chapters.chapters.map((x, n) => (n === i ? { ...x, title: e.target.value } : x)) })}
                      />
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => void navigator.clipboard.writeText(chapters.chapters.map((c) => `${clock(c.start)} ${c.title}`).join('\n'))}>
                    Copy as a YouTube list
                  </button>
                  <button type="button" className="glass-btn px-3 py-1.5 text-xs" disabled={!!busy} onClick={() => void run('write', async () => setWritten(await host.transcripts.writeChapters(file, chapters.chapters)))}>
                    Write into a copy of the video
                  </button>
                </div>
                {written && <p className="text-xs text-[var(--text-dim)]">Saved {basename(written)} next to the original. The video itself was not re-encoded.</p>}
              </>
            )}
          </div>
        )}

        {tab === 'ask' && (
          <div className="flex flex-col gap-2 text-sm">
            {needs}
            {has && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!question.trim() || request) return
                  const id = crypto.randomUUID()
                  setRequest(id)
                  setAnswer('')
                  setError('')
                  host.transcripts
                    .ask(id, file, question)
                    .catch((err) => setError(clean(err)))
                    .finally(() => setRequest(null))
                }}
              >
                <input className="glass-input min-w-0 flex-1" aria-label="Your question" placeholder="Ask about this video…" value={question} onChange={(e) => setQuestion(e.target.value)} />
                {request ? (
                  <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => void host.ai.abort(request)}>
                    Stop
                  </button>
                ) : (
                  <button type="submit" className="glass-btn px-3 py-1.5 text-xs" disabled={!question.trim()}>
                    Ask
                  </button>
                )}
              </form>
            )}
            {answer && <div>{renderMarkdown(answer)}</div>}
            {has && <p className="text-[11px] text-[var(--text-faint)]">Answers come only from what is said in the video, with the time in brackets.</p>}
          </div>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>,
    document.body,
  )
}
