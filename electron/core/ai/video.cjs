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
 * What the AI does with a video's transcript: a summary, chapters, and answers to questions that cite the time. Long
 * transcripts are cut into chunks that fit the model and combined (map-reduce). Pure helpers, plus functions that take
 * the AI runtime. No Electron.
 */

const CHUNK_CHARS = 3500
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** 75 seconds as "1:15", 3725 as "1:02:05". */
function clock(sec) {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

/** The transcript as lines with the time in front, for the model to quote. */
const stamped = (segments) => segments.map((s) => `[${clock(s.start)}] ${s.text}`).join('\n')

/** Cuts the segments into groups of about `maxChars` characters (never splitting a segment). */
function chunkSegments(segments, maxChars = CHUNK_CHARS) {
  const chunks = []
  let cur = []
  let size = 0
  for (const s of segments) {
    const len = s.text.length + 8
    if (cur.length && size + len > maxChars) {
      chunks.push(cur)
      cur = []
      size = 0
    }
    cur.push(s)
    size += len
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

async function text(ai, opts) {
  let out = ''
  for await (const ev of ai.chat({ temperature: 0.2, reasoning: 'off', ...opts })) if (ev.type === 'text') out += ev.delta
  return out.trim()
}

const parseJson = (t) => {
  try {
    return JSON.parse(String(t).trim().replace(/^```(?:json)?|```$/g, ''))
  } catch {
    throw new Error('The model did not give a usable answer. Try again.')
  }
}

const summarySchema = { type: 'object', properties: { summary: { type: 'string' }, points: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'points'], additionalProperties: false }

/** A short summary and key points of a transcript. `onProgress(done, total)` is called per chunk. */
async function summarize(ai, transcript, { onProgress = () => {} } = {}) {
  const chunks = chunkSegments(transcript.segments)
  let material
  if (chunks.length === 1) material = stamped(chunks[0])
  else {
    const parts = []
    for (let i = 0; i < chunks.length; i++) {
      onProgress(i, chunks.length)
      parts.push(`Part ${i + 1} (from ${clock(chunks[i][0].start)}): ${await text(ai, { messages: [{ role: 'system', content: 'Summarize this part of a video transcript in at most 60 words. Only what is said.' }, { role: 'user', content: stamped(chunks[i]) }], maxTokens: 250 })}`)
    }
    material = parts.join('\n')
  }
  onProgress(chunks.length, chunks.length)
  const r = parseJson(await text(ai, { messages: [{ role: 'system', content: 'Summarize this video from its transcript. Give a summary of 2 to 4 sentences and up to 7 short key points. Use only what the transcript says, in the language of the transcript.' }, { role: 'user', content: material }], jsonSchema: summarySchema, maxTokens: 700 }))
  return { summary: String(r.summary ?? '').slice(0, 1500), points: (Array.isArray(r.points) ? r.points : []).map((p) => String(p).slice(0, 200)).slice(0, 7) }
}

const chaptersSchema = { type: 'object', properties: { chapters: { type: 'array', items: { type: 'object', properties: { start: { type: 'number' }, title: { type: 'string' } }, required: ['start', 'title'], additionalProperties: false } } }, required: ['chapters'], additionalProperties: false }

/**
 * Chapters, cleaned up: sorted, the first at 0:00, no two closer than `minGap` seconds, titles trimmed, none past the
 * end, at most 30.
 */
function tidyChapters(list, duration, { minGap = 30 } = {}) {
  const sorted = list
    .map((c) => ({ start: clamp(Number(c.start), 0, duration), title: String(c.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) }))
    .filter((c) => c.title && Number.isFinite(c.start))
    .sort((a, b) => a.start - b.start)
  const out = []
  for (const c of sorted) if (!out.length || c.start - out[out.length - 1].start >= minGap) out.push(c)
  if (out.length) out[0].start = 0
  return out.slice(0, 30)
}

/** Chapter titles at the topic changes of a transcript. */
async function proposeChapters(ai, transcript) {
  const found = []
  for (const chunk of chunkSegments(transcript.segments, 6000)) {
    const r = parseJson(await text(ai, { messages: [{ role: 'system', content: 'Find the topic changes in this part of a video transcript and give a short chapter title (2 to 6 words) for each, with the time in seconds where it starts. Give 1 to 6 chapters. Use the language of the transcript.' }, { role: 'user', content: stamped(chunk).replace(/^\[(\S+)\]/gm, (_m, t) => `[${t} = ${t.split(':').reduce((a, b) => a * 60 + Number(b), 0)}s]`) }], jsonSchema: chaptersSchema, maxTokens: 500 }))
    found.push(...(Array.isArray(r.chapters) ? r.chapters : []))
  }
  const chapters = tidyChapters(found, transcript.duration)
  if (!chapters.length) throw new Error('No chapters were found in this video.')
  return chapters
}

/** FFmpeg chapter metadata (FFMETADATA1) for the chapters, ready for `-map_metadata`. */
function chaptersMetadata(chapters, duration) {
  const lines = [';FFMETADATA1']
  chapters.forEach((c, i) => {
    const start = Math.round(c.start * 1000)
    const end = Math.round((chapters[i + 1]?.start ?? duration) * 1000)
    lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${start}`, `END=${Math.max(start + 1, end)}`, `title=${c.title.replace(/[=;#\\\n]/g, ' ')}`)
  })
  return lines.join('\n') + '\n'
}

/** The chapters as the list YouTube reads from a description ("0:00 Intro"). */
const chaptersList = (chapters) => chapters.map((c) => `${clock(c.start)} ${c.title}`).join('\n')

/**
 * Answers a question about a video from its transcript, quoting times like [1:23]. The whole transcript goes to the
 * model when it fits; otherwise the passages that best match the question's words.
 * @param {{ chat: Function }} ai
 * @param {{ segments: {start:number,end:number,text:string}[] }} transcript
 * @param {string} question
 * @param {(q: string) => {start:number,end:number,text:string}[]} [passages]  finds the matching segments for long transcripts
 */
async function* ask(ai, transcript, question, passages = () => []) {
  const all = stamped(transcript.segments)
  let material = all
  let partial = false
  if (all.length > CHUNK_CHARS * 3) {
    partial = true
    const hits = passages(question)
    const picked = (hits.length ? hits : transcript.segments.slice(0, 40)).slice(0, 40)
    // A little before and after each hit, so a sentence is not cut off.
    const idx = new Set()
    for (const h of picked) {
      const i = transcript.segments.findIndex((s) => s.start === h.start && s.text === h.text)
      for (let k = Math.max(0, i - 1); k <= Math.min(transcript.segments.length - 1, i + 2) && i >= 0; k++) idx.add(k)
    }
    material = stamped([...idx].sort((a, b) => a - b).map((i) => transcript.segments[i]))
    if (!material) material = stamped(picked)
  }
  yield* ai.chat({
    temperature: 0.2,
    messages: [
      { role: 'system', content: `Answer the question using ONLY this transcript of a video${partial ? ' (only the passages most related to the question are shown)' : ''}. Quote the time of what you rely on in square brackets, like [1:23]. If the transcript does not say, say that you cannot tell from the transcript. Answer in the language of the question.\n\nTranscript:\n${material}` },
      { role: 'user', content: String(question).slice(0, 1000) },
    ],
  })
}

/**
 * Writes the chapters into a copy of the file (stream copy, no re-encode) named "<name>-chapters.<ext>" beside `destDir`.
 * Returns the new file's path.
 */
async function writeChapters(videoPath, chapters, duration, destDir, uniqueOutputPath) {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const { spawn } = require('node:child_process')
  const ext = path.extname(videoPath).slice(1).toLowerCase()
  if (!['mp4', 'm4v', 'mkv', 'mov', 'm4a', 'mp3'].includes(ext)) throw new Error(`Chapters can be written into MP4, MKV, MOV, M4A and MP3 files, not .${ext}`)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-chap-'))
  const out = uniqueOutputPath(destDir, `${path.basename(videoPath, path.extname(videoPath))}-chapters`, ext)
  try {
    const meta = path.join(tmp, 'chapters.txt')
    fs.writeFileSync(meta, chaptersMetadata(chapters, duration))
    await new Promise((resolve, reject) => {
      let err = ''
      const child = spawn('ffmpeg', ['-y', '-i', videoPath, '-i', meta, '-map', '0', '-map_metadata', '1', '-map_chapters', '1', '-c', 'copy', out])
      child.stderr.on('data', (c) => (err += c))
      child.on('error', reject)
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `ffmpeg exited with code ${code}`))))
    })
    return out
  } catch (err) {
    fs.rmSync(out, { force: true })
    throw err
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

module.exports = { writeChapters, summarize, proposeChapters, tidyChapters, chaptersMetadata, chaptersList, ask, chunkSegments, stamped, clock, CHUNK_CHARS }
