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
/**
 * Transcripts of the person's videos and a search over their spoken words. Each transcript is a small JSON file under
 * userData/transcripts/; the search index is SQLite FTS5 (the built-in `node:sqlite`), or a plain in-memory index
 * when that is not available. Everything stays on this computer. No Electron.
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const MAX_SEGMENTS = 20000

/** "00:01:02,500" or "1:02.5" as seconds. */
function parseClock(text) {
  const m = /^(?:(\d+):)?(\d+):(\d+)(?:[.,](\d+))?$/.exec(String(text).trim())
  if (!m) return null
  return (Number(m[1] ?? 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number(`0.${m[4]}`) : 0)
}

/** The segments of an .srt or .vtt file: [{ start, end, text }]. */
function parseSubtitles(text) {
  const out = []
  for (const block of String(text).replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    const i = lines.findIndex((l) => l.includes('-->'))
    if (i < 0) continue
    const [a, b] = lines[i].split('-->').map((s) => parseClock(s.trim().split(/\s+/)[0]))
    if (a == null || b == null) continue
    const body = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (body) out.push({ start: a, end: b, text: body })
    if (out.length >= MAX_SEGMENTS) break
  }
  return out
}

/** Search words from what the person typed: lower-case letters and digits only, at most 8, so nothing reaches the query syntax. */
const words = (q) => (String(q).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8)

/** Words that say nothing about what a question is about (English and Swedish). */
const STOP = new Set('a an the is are was were be been of to in on at for and or but not no do does did what who whom whose which when where why how it its this that these those with from as by about into than then so if i you he she we they me my your our their there here can could should would will shall och att det som en ett är var vad vem när var hur varför inte med för av på om till de den'.split(' '))

/** The words of a question that carry meaning. */
const keywords = (q) => words(q).filter((w) => w.length > 1 && !STOP.has(w))

/** The index behind a common interface: add(videoId, segments), remove(videoId), search(words, limit, any). */
function createIndex(dir) {
  try {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(path.join(dir, 'index.db'))
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS seg USING fts5(text, video UNINDEXED, start UNINDEXED, end UNINDEXED, tokenize='unicode61 remove_diacritics 2')")
    const insert = db.prepare('INSERT INTO seg (text, video, start, end) VALUES (?, ?, ?, ?)')
    return {
      kind: 'sqlite',
      add(video, segments) {
        db.prepare('DELETE FROM seg WHERE video = ?').run(video)
        db.exec('BEGIN')
        try {
          for (const s of segments) insert.run(s.text, video, s.start, s.end)
          db.exec('COMMIT')
        } catch (err) {
          db.exec('ROLLBACK')
          throw err
        }
      },
      remove: (video) => void db.prepare('DELETE FROM seg WHERE video = ?').run(video),
      search(ws, limit, any = false, only = null) {
        const q = ws.map((w) => `"${w}"*`).join(any ? ' OR ' : ' AND ')
        // One video's hits are picked inside the query: filtering afterwards would lose them behind better matches in other videos.
        const rows = only ? db.prepare('SELECT video, start, end, text, bm25(seg) AS score FROM seg WHERE seg MATCH ? AND video = ? ORDER BY score LIMIT ?').all(q, only, limit) : db.prepare('SELECT video, start, end, text, bm25(seg) AS score FROM seg WHERE seg MATCH ? ORDER BY score LIMIT ?').all(q, limit)
        return rows.map((r) => ({ video: r.video, start: r.start, end: r.end, text: r.text }))
      },
      close: () => db.close(),
    }
  } catch {
    // No node:sqlite (an older Node): the same answers from a list held in memory.
    const rows = []
    return {
      kind: 'memory',
      add(video, segments) {
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i].video === video) rows.splice(i, 1)
        for (const s of segments) rows.push({ video, ...s, lower: s.text.toLowerCase() })
      },
      remove(video) {
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i].video === video) rows.splice(i, 1)
      },
      search: (ws, limit, any = false, only = null) =>
        rows
          .filter((r) => (!only || r.video === only) && (any ? ws.some((w) => r.lower.includes(w)) : ws.every((w) => r.lower.includes(w))))
          .slice(0, limit)
          .map(({ lower: _l, ...r }) => r),
      close() {},
    }
  }
}

/** @param {{ dir: string }} deps */
function createTranscripts({ dir }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const idOf = (p) => crypto.createHash('sha256').update(path.resolve(p)).digest('hex').slice(0, 16)
  const file = (id) => path.join(dir, `${id}.json`)
  const index = createIndex(dir)

  const read = (id) => {
    try {
      return JSON.parse(fs.readFileSync(file(id), 'utf8'))
    } catch {
      return null
    }
  }

  // The index is rebuilt from the files when the database is new or its kind changed (the in-memory one starts empty).
  const all = () => fs.readdirSync(dir).filter((n) => /^[0-9a-f]{16}\.json$/.test(n)).map((n) => read(n.slice(0, 16))).filter(Boolean)
  if (index.kind === 'memory') for (const t of all()) index.add(idOf(t.path), t.segments)

  /** Stores a transcript for a video and indexes its words. */
  function add(videoPath, segments, { language = '', source = 'subtitles' } = {}) {
    if (!path.isAbsolute(videoPath)) throw new Error('The video path must be absolute')
    const clean = segments.filter((s) => s && Number.isFinite(s.start) && Number.isFinite(s.end) && String(s.text ?? '').trim()).slice(0, MAX_SEGMENTS).map((s) => ({ start: Math.round(s.start * 100) / 100, end: Math.round(s.end * 100) / 100, text: String(s.text).trim() }))
    if (clean.length === 0) throw new Error('There is no speech in this transcript')
    let size = 0
    let mtime = 0
    try {
      const st = fs.statSync(videoPath)
      size = st.size
      mtime = st.mtimeMs
    } catch {
      /* the file may be gone; the transcript is still useful */
    }
    const id = idOf(videoPath)
    const t = { id, path: path.resolve(videoPath), title: path.basename(videoPath), language, source, size, mtime, indexedAt: Date.now(), duration: clean[clean.length - 1].end, segments: clean }
    fs.writeFileSync(file(id), JSON.stringify(t), { mode: 0o600 })
    index.add(id, clean)
    return { id, segments: clean.length }
  }

  /** Stores the transcript in a subtitle file (.srt or .vtt) for a video. */
  const addFromSubtitleFile = (videoPath, subtitlePath, opts) => add(videoPath, parseSubtitles(fs.readFileSync(subtitlePath, 'utf8')), opts)

  const get = (videoPath) => read(idOf(videoPath))
  const has = (videoPath) => fs.existsSync(file(idOf(videoPath)))

  function remove(videoPath) {
    const id = idOf(videoPath)
    index.remove(id)
    fs.rmSync(file(id), { force: true })
  }

  /** Videos with a transcript, newest first (without the text). */
  const list = () => all().map(({ segments, ...t }) => ({ ...t, segments: segments.length })).sort((a, b) => b.indexedAt - a.indexedAt)

  /** Which spoken words match: [{ path, title, start, end, text }] best first. A video that no longer exists is skipped. */
  function search(query, { limit = 30, videoPath = null, any = false } = {}) {
    const ws = any ? keywords(query) : words(query)
    if (ws.length === 0) return []
    const only = videoPath ? idOf(videoPath) : null
    const byId = new Map(all().map((t) => [t.id, t]))
    const out = []
    for (const r of index.search(ws, only ? Math.max(limit, 500) : Math.min(200, limit * 3), any, only)) {
      if (only && r.video !== only) continue
      const t = byId.get(r.video)
      if (!t || !fs.existsSync(t.path)) continue
      out.push({ path: t.path, title: t.title, start: r.start, end: r.end, text: r.text })
      if (out.length >= limit) break
    }
    return out
  }

  return { add, addFromSubtitleFile, get, has, remove, list, search, kind: index.kind, close: index.close }
}

module.exports = { createTranscripts, parseSubtitles, parseClock, words }
