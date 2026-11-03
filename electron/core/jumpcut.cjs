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
 * The jump-cut editor and loudness normalizer: removes the silences from a talking video or podcast (one re-encode, no
 * temporary files) and/or evens out the loudness (two-pass loudnorm). No Electron: everything it needs comes in
 * through `ctx` (see core/*.cjs).
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')

/** Loudness targets in LUFS. */
const LOUDNESS = { podcast: -14, broadcast: -23 }
const AUDIO_EXTS = ['mp3', 'flac', 'wav', 'm4a', 'ogg', 'opus', 'aac']
const VIDEO_KEEP = ['mp4', 'mkv', 'mov']

const DEFAULTS = { thresholdDb: -30, minSilence: 0.5, padding: 0.15, mergeGap: 0.3 }

/** The silences in the text `silencedetect` prints, as [{ start, end }]. A silence still open at the end runs to `duration`. */
function parseSilences(text, duration) {
  const out = []
  let open = null
  for (const m of String(text).matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const t = Math.max(0, Number(m[2]))
    if (m[1] === 'start') open = t
    else if (open != null) {
      out.push({ start: open, end: Math.min(t, duration) })
      open = null
    }
  }
  if (open != null && open < duration) out.push({ start: open, end: duration })
  return out
}

/**
 * The parts to keep: the gaps between silences, each widened by `padding` on both sides, with parts closer than
 * `mergeGap` joined. Parts shorter than a tenth of a second are dropped.
 */
function keepSegments(silences, duration, { padding = DEFAULTS.padding, mergeGap = DEFAULTS.mergeGap } = {}) {
  let keep = []
  let cursor = 0
  for (const s of [...silences].sort((a, b) => a.start - b.start)) {
    if (s.start > cursor) keep.push({ start: cursor, end: s.start })
    cursor = Math.max(cursor, s.end)
  }
  if (cursor < duration) keep.push({ start: cursor, end: duration })
  keep = keep.map((k) => ({ start: Math.max(0, k.start - padding), end: Math.min(duration, k.end + padding) }))
  const merged = []
  for (const k of keep) {
    const last = merged[merged.length - 1]
    if (last && k.start - last.end < mergeGap) last.end = Math.max(last.end, k.end)
    else merged.push({ ...k })
  }
  return merged.filter((k) => k.end - k.start >= 0.1)
}

const sum = (segs) => segs.reduce((t, s) => t + (s.end - s.start), 0)
const num = (n) => String(Math.round(n * 1000) / 1000)

/** The select expression for a list of parts: between(t,a,b)+between(t,c,d)+... */
const selectExpr = (segs) => segs.map((s) => `between(t,${num(s.start)},${num(s.end)})`).join('+')

/**
 * The filter graph that cuts the parts out and joins them in one go. `loudnorm` is the audio filter text to add at the
 * end (or ''). Returns { graph, maps }: the graph text and the -map arguments for its outputs.
 */
function buildGraph({ segments, hasVideo, hasAudio, audioOnly, loudnorm }) {
  const lines = []
  const maps = []
  if (hasVideo && !audioOnly) {
    lines.push(segments ? `[0:v]select='${selectExpr(segments)}',setpts=N/FRAME_RATE/TB[v]` : '[0:v]null[v]')
    maps.push('-map', '[v]')
  }
  if (hasAudio) {
    const chain = []
    if (segments) chain.push(`aselect='${selectExpr(segments)}'`, 'asetpts=N/SR/TB')
    if (loudnorm) chain.push(loudnorm)
    lines.push(`[0:a]${chain.length ? chain.join(',') : 'anull'}[a]`)
    maps.push('-map', '[a]')
  }
  return { graph: lines.join(';\n'), maps }
}

/** loudnorm for a target, with the numbers from the measuring pass when there are some. */
function loudnormFilter(targetLufs, measured) {
  const base = `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11`
  if (!measured) return `${base}:print_format=json`
  return `${base}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`
}

/** The JSON block loudnorm prints at the end of its measuring pass, or null. */
function parseLoudnorm(text) {
  const m = /\{\s*"input_i"[\s\S]*?\}/.exec(String(text))
  if (!m) return null
  try {
    const j = JSON.parse(m[0])
    return ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'].every((k) => Number.isFinite(Number(j[k]))) ? j : null
  } catch {
    return null
  }
}

function validate(req, { assertAbsolutePath, assertOneOf }) {
  assertAbsolutePath(req.inputPath, 'inputPath')
  if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
  const o = { cut: true, thresholdDb: DEFAULTS.thresholdDb, minSilence: DEFAULTS.minSilence, padding: DEFAULTS.padding, normalize: 'off', audioOnly: false, ...req }
  if (typeof o.cut !== 'boolean' || typeof o.audioOnly !== 'boolean') throw new Error('cut and audioOnly must be true or false')
  assertOneOf(o.normalize, ['off', 'podcast', 'broadcast'], 'normalize')
  if (!Number.isFinite(o.thresholdDb) || o.thresholdDb > -10 || o.thresholdDb < -80) throw new Error('The silence level must be between -80 and -10 dB')
  if (!Number.isFinite(o.minSilence) || o.minSilence < 0.1 || o.minSilence > 10) throw new Error('The shortest silence must be 0.1 to 10 seconds')
  if (!Number.isFinite(o.padding) || o.padding < 0 || o.padding > 2) throw new Error('The padding must be 0 to 2 seconds')
  if (!o.cut && o.normalize === 'off') throw new Error('Nothing to do: turn on cutting silences or loudness normalizing')
  return o
}

function createJumpCut(ctx) {
  const {
    handleStart, assertAbsolutePath, assertOneOf, defaultDownloadDir, uniqueOutputPath, addTask, broadcastTasks, runInPool, convertPool, updateTask, tasks, probeMedia, isCanceled, spawnTracked, fmtClock,
  } = ctx

  /** Runs ffmpeg and returns what it printed (silencedetect and loudnorm report on stderr, -version on stdout). */
  function captureStderr(args) {
    return new Promise((resolve, reject) => {
      let text = ''
      const child = spawn('ffmpeg', ['-hide_banner', '-nostats', ...args])
      child.stdout.on('data', (c) => (text += c))
      child.stderr.on('data', (c) => (text += c))
      child.on('error', reject)
      child.on('close', (code) => (code === 0 ? resolve(text) : reject(new Error(text.trim().split('\n').pop() || `ffmpeg exited with code ${code}`))))
    })
  }

  async function silencesOf(inputPath, o, duration) {
    const text = await captureStderr(['-i', inputPath, '-vn', '-af', `silencedetect=noise=${o.thresholdDb}dB:d=${o.minSilence}`, '-f', 'null', '-'])
    return parseSilences(text, duration)
  }

  /** The dry run: how much would be cut, without encoding anything. */
  async function analyzeJumpCut(req) {
    assertAbsolutePath(req.inputPath, 'inputPath')
    const o = validate({ cut: true, ...req }, { assertAbsolutePath, assertOneOf })
    const info = await probeMedia(req.inputPath)
    if (!info || !info.hasAudio) throw new Error('This file has no audio to find silences in.')
    const segments = keepSegments(await silencesOf(req.inputPath, o, info.duration), info.duration, o)
    const kept = sum(segments)
    return { duration: info.duration, keptSeconds: kept, removedSeconds: Math.max(0, info.duration - kept), parts: segments.length }
  }

  handleStart('tasks:startJumpCut', async (_e, req) => {
    const o = validate(req, { assertAbsolutePath, assertOneOf })
    const id = crypto.randomUUID()
    const destDir = o.destination || defaultDownloadDir()
    fs.mkdirSync(destDir, { recursive: true })
    const inExt = path.extname(o.inputPath).replace(/^\./, '').toLowerCase()
    const ext = o.audioOnly ? 'mp3' : AUDIO_EXTS.includes(inExt) ? inExt : VIDEO_KEEP.includes(inExt) ? inExt : 'mp4'
    const base = path.basename(o.inputPath, path.extname(o.inputPath))
    const outputPath = uniqueOutputPath(destDir, `${base}-${o.cut ? 'cut' : 'normalized'}`, ext)
    addTask(id, {
      state: {
        id,
        kind: 'jumpcut',
        status: 'queued',
        progress: 0,
        label: path.basename(o.inputPath),
        format: o.cut ? 'Silences removed' : 'Normalized',
        quality: o.normalize === 'off' ? `${o.thresholdDb} dB` : `${LOUDNESS[o.normalize]} LUFS`,
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
      },
      child: null,
      finalPath: outputPath,
    })
    broadcastTasks()
    runInPool(convertPool, id, () => jumpCutJob(id, o, outputPath, ext)).catch((err) => updateTask(id, { status: 'error', error: `Jump cut failed to start: ${err.message}` }))
    return id
  })

  /** Whether this ffmpeg takes `-/filter_complex <file>` (7.1+); older ones use -filter_complex_script. */
  let slashOption = null
  async function takesSlashOption() {
    if (slashOption == null) {
      try {
        const m = /ffmpeg version n?(\d+)\.(\d+)/.exec(await captureStderr(['-version']).catch((e) => e.message))
        slashOption = !!m && (Number(m[1]) > 7 || (Number(m[1]) === 7 && Number(m[2]) >= 1))
      } catch {
        slashOption = false
      }
    }
    return slashOption
  }

  async function jumpCutJob(id, o, outputPath, ext) {
    const entry = tasks.get(id)
    updateTask(id, { status: 'running' })
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-jc-'))
    try {
      const info = await probeMedia(o.inputPath)
      if (isCanceled(id)) return
      if (!info) return updateTask(id, { status: 'error', error: "Couldn't read this file." })
      if (!info.hasAudio) return updateTask(id, { status: 'error', error: 'This file has no audio, so there are no silences to cut and nothing to normalize.' })
      const audioOnly = o.audioOnly || !info.hasVideo
      let segments = null
      if (o.cut) {
        segments = keepSegments(await silencesOf(o.inputPath, o, info.duration), info.duration, o)
        if (isCanceled(id)) return
        if (segments.length === 0) return updateTask(id, { status: 'error', error: 'Everything counts as silence at this level. Raise the silence level (for example -40 dB).' })
        if (sum(segments) > info.duration - 0.05) segments = null // nothing to cut: leave the timeline alone
        if (!segments && o.normalize === 'off') return updateTask(id, { status: 'error', error: 'No silences found at this level, so there is nothing to cut.' })
      }
      const length = segments ? sum(segments) : info.duration
      const common = { segments, hasVideo: info.hasVideo, hasAudio: true, audioOnly }

      let loud = ''
      if (o.normalize !== 'off') {
        // Pass 1 measures the audio as it will be after cutting; pass 2 applies exactly that correction.
        const target = LOUDNESS[o.normalize]
        updateTask(id, { progress: 0.02 })
        const probeGraph = buildGraph({ ...common, audioOnly: true, loudnorm: loudnormFilter(target) })
        const text = await captureStderr(['-i', o.inputPath, '-filter_complex', probeGraph.graph, ...probeGraph.maps, '-f', 'null', '-'])
        const measured = parseLoudnorm(text)
        if (!measured) return updateTask(id, { status: 'error', error: "Couldn't measure the loudness of this file." })
        loud = loudnormFilter(target, measured)
      }
      if (isCanceled(id)) return

      const { graph, maps } = buildGraph({ ...common, loudnorm: loud })
      const script = path.join(tmp, 'graph.txt')
      fs.writeFileSync(script, graph)
      const codec = audioOnly ? (ext === 'mp3' ? ['-c:a', 'libmp3lame', '-q:a', '2'] : ['-c:a', ext === 'flac' ? 'flac' : ext === 'wav' ? 'pcm_s16le' : 'aac']) : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', ...(ext === 'mp4' || ext === 'mov' ? ['-movflags', '+faststart'] : [])]
      const graphArgs = (await takesSlashOption()) ? ['-/filter_complex', script] : ['-filter_complex_script', script]
      await spawnTracked('ffmpeg', ['-y', '-i', o.inputPath, ...graphArgs, ...maps, ...codec, '-progress', 'pipe:1', '-nostats', outputPath], entry, {
        onStdout: (text) => {
          const m = [...text.matchAll(/out_time_ms=(\d+)/g)].pop()
          if (m) updateTask(id, { progress: Math.min(0.99, Math.max(0.05, Number(m[1]) / 1e6 / length)) })
        },
      })
      let realSize = null
      try {
        realSize = fs.statSync(outputPath).size
      } catch {
        /* keep null */
      }
      const removed = info.duration - length
      updateTask(id, { status: 'done', progress: 1, label: path.basename(outputPath), quality: removed > 0.5 ? `${fmtClock(removed)} removed` : undefined, ...(realSize != null ? { sizeBytes: realSize } : {}) })
    } catch (err) {
      fs.rmSync(outputPath, { force: true })
      if (!isCanceled(id)) updateTask(id, { status: 'error', error: `Jump cut failed: ${err.message}` })
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }

  return { jumpCutJob, analyzeJumpCut }
}

module.exports = { createJumpCut, parseSilences, keepSegments, selectExpr, buildGraph, loudnormFilter, parseLoudnorm, validate, LOUDNESS, DEFAULTS }
