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
 * Help search for the assistant: finds the parts of OPNduck's own docs that answer a question, so a small model reads the
 * real text instead of guessing. Plain keyword ranking (BM25) over the sections of docs/*.md and PLUGINS.md, no model and no
 * network. The app adds the best sections to the system prompt for the turn (see agent() in index.cjs).
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..', '..')
const FILES = ['docs/HELP.md', 'docs/AI.md', 'docs/COMPANION.md', 'docs/MACOS.md', 'docs/MCP.md', 'docs/SEND.md', 'docs/SERVER.md', 'docs/TUI.md', 'PLUGINS.md']

/** Below this a section only shares generic words with the question ("best", "make"), so it would only add noise. */
const MIN_SCORE = 3.3

const STOP = new Set('a an and are as at be but by can do does for from how i if in is it its me my of on or so that the then there this to was what when where which who why will with you your jag kan hur vad är en ett och att det som på med för inte har min mitt'.split(' '))

/** A question about how OPNduck works (as opposed to a command like "convert a.mp4 to mkv", which should go straight to a tool). */
const QUESTION = /\?|^\s*(how|what|whats|what's|why|when|where|which|who|can|could|does|do|is|are|will|should|kan|kan man|hur|vad|varför|när|var|vilken|vilka|finns|fungerar|får|ska|är)\b/i
const looksLikeQuestion = (text) => QUESTION.test(String(text))

/** Lower-case words; snake_case names also count as their parts, and a trailing "s" is dropped. */
function tokens(text) {
  const out = []
  for (const w of String(text).toLowerCase().match(/[a-z0-9åäö_]+/g) ?? []) {
    const parts = w.includes('_') ? [w, ...w.split('_')] : [w]
    for (let p of parts) {
      if (p.length > 3 && p.endsWith('s') && !p.endsWith('ss')) p = p.slice(0, -1)
      if (p.length > 1 && !STOP.has(p)) out.push(p)
    }
  }
  return out
}

/** Sections: each `## heading` (and its text) of a file, with the file's `# title` kept as context. */
function sectionsOf(file, text) {
  const out = []
  let title = ''
  let heading = null
  let body = []
  const flush = () => {
    const t = body.join('\n').trim()
    if (heading && t) out.push({ file, title: heading, text: t })
    body = []
  }
  for (const line of text.split('\n')) {
    const h2 = line.match(/^##\s+(.*)/)
    const h1 = line.match(/^#\s+(.*)/)
    if (h2) {
      flush()
      heading = h2[1].trim()
    } else if (h1) {
      flush()
      title = h1[1].trim()
      heading = null
    } else body.push(line)
  }
  flush()
  return out.map((s) => ({ ...s, doc: title }))
}

/** @param {{ root?: string, files?: string[] }} [opts] */
function createHelp({ root = ROOT, files = FILES } = {}) {
  let index = null

  function build() {
    const docs = []
    for (const f of files) {
      try {
        docs.push(...sectionsOf(f, fs.readFileSync(path.join(root, f), 'utf8')))
      } catch {
        // A doc that is not shipped (or was moved) just means fewer sections.
      }
    }
    // The heading counts three times: a question usually names the feature.
    const entries = docs.map((d) => {
      const tf = new Map()
      for (const t of [...tokens(d.title), ...tokens(d.title), ...tokens(d.title), ...tokens(d.text)]) tf.set(t, (tf.get(t) ?? 0) + 1)
      return { ...d, tf, len: [...tf.values()].reduce((a, b) => a + b, 0) }
    })
    const df = new Map()
    for (const e of entries) for (const t of e.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
    const avg = entries.reduce((a, e) => a + e.len, 0) / Math.max(1, entries.length)
    return { entries, df, avg, n: entries.length }
  }

  /** The best sections for a question: [{ title, file, text, score }], best first. */
  function search(query, { limit = 3 } = {}) {
    index ??= build()
    const q = [...new Set(tokens(query))]
    if (!q.length || !index.n) return []
    const k1 = 1.4
    const b = 0.75
    const scored = []
    for (const e of index.entries) {
      let score = 0
      let matched = 0
      for (const t of q) {
        const f = e.tf.get(t)
        if (!f) continue
        matched++
        const idf = Math.log(1 + (index.n - index.df.get(t) + 0.5) / (index.df.get(t) + 0.5))
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * e.len) / index.avg)))
      }
      // Several different question words in one section beats one word repeated.
      if (matched) scored.push({ title: e.title, file: e.file, text: e.text, score: score * (0.6 + 0.4 * (matched / q.length)) })
    }
    scored.sort((a, b2) => b2.score - a.score)
    const top = scored[0]?.score ?? 0
    return scored.filter((s) => s.score >= Math.max(MIN_SCORE, top * 0.45)).slice(0, limit)
  }

  /**
   * Text to add to the system prompt for this question, or '' when nothing in the docs matches well. Kept short (about
   * 1,800 characters) because small models lose the thread in long prompts.
   */
  function promptBlock(query, { limit = 3, maxChars = 1800 } = {}) {
    if (!looksLikeQuestion(query)) return ''
    const hits = search(query, { limit })
    if (!hits.length) return ''
    const parts = []
    let used = 0
    for (const h of hits) {
      const room = maxChars - used
      if (room < 200) break
      const text = h.text.length > room ? `${h.text.slice(0, room - 1).replace(/\s+\S*$/, '')}…` : h.text
      parts.push(`### ${h.title}\n${text}`)
      used += text.length + h.title.length + 5
    }
    return `Notes from OPNduck's own help. They are accurate: prefer them over what you remember. If they do not answer the question, say you are not sure instead of guessing.\n\n${parts.join('\n\n')}`
  }

  return { search, promptBlock }
}

module.exports = { createHelp, tokens, sectionsOf, looksLikeQuestion }
