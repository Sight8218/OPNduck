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
 * Beat Finder: the tempo, beat times and key of a song (a small Python script with librosa), writing them as tags, and
 * cutting a video montage to the beat. No Electron: everything it needs comes in through `ctx` (see core/*.cjs).
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const FPS = 30
const WIDTH = 1280
const HEIGHT = 720
const VIDEO_EXT = new Set(['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'mpg', 'mpeg', 'ts', 'wmv', 'flv'])
const TAG_FORMATS = { mp3: 'id3', flac: 'vorbis', ogg: 'vorbis', opus: 'vorbis' }

/** The result line the script prints last, or null. Progress and stage lines are handled as they arrive. */
function parseResult(text) {
  const line = String(text).split('\n').reverse().find((l) => l.startsWith('@@RESULT '))
  if (!line) return null
  try {
    return JSON.parse(line.slice('@@RESULT '.length))
  } catch {
    return null
  }
}

/** The tag arguments for ffmpeg that carry the tempo and key, per file format. */
function tagArgs(ext, bpm, key) {
  const kind = TAG_FORMATS[ext]
  if (kind === 'id3') return ['-metadata', `TBPM=${Math.round(bpm)}`, '-metadata', `TKEY=${key}`, '-id3v2_version', '3']
  if (kind === 'vorbis') return ['-metadata', `BPM=${Math.round(bpm)}`, '-metadata', `INITIALKEY=${key}`]
  return null
}

/** The beat times a cut uses: every `every`-th beat from the first, enough for whole cuts only. */
function cutPoints(beats, every) {
  const points = []
  for (let i = 0; i < beats.length; i += every) points.push(beats[i])
  return points
}

/**
 * Which part of which clip fills each cut. Clips are used in order (or shuffled with `random`), each one carrying on
 * from where it stopped last time, and wrapping to its start when it runs out. `skip` seconds at the start and end of
 * every clip are left alone. Returns [{ clip, start, duration, frames }] with frame counts that add up exactly.
 */
function assignClips(points, clips, { skip = 0, random = null, fps = FPS } = {}) {
  const order = clips.map((_, i) => i)
  if (random) for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
  const cursor = clips.map(() => skip)
  const out = []
  for (let i = 0; i + 1 < points.length; i++) {
    const clip = clips[order[i % order.length]]
    const slot = order[i % order.length]
    const duration = points[i + 1] - points[i]
    const frames = Math.round((points[i + 1] - points[0]) * fps) - Math.round((points[i] - points[0]) * fps)
    const room = clip.duration - skip * 2
    let start = cursor[slot]
    if (start + duration > clip.duration - skip) start = skip // wrap to the start
    if (room < duration) start = Math.max(0, Math.min(skip, clip.duration - duration))
    cursor[slot] = start + duration
    out.push({ clip: clip.path, start, duration, frames })
  }
  return out
}

function validate(req, { assertAbsolutePath }) {
  assertAbsolutePath(req.inputPath, 'inputPath')
  if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
  return req
}

function validateCut(req, { assertAbsolutePath }) {
  assertAbsolutePath(req.inputPath, 'inputPath')
  if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
  if (!Array.isArray(req.clips) || req.clips.length === 0 || req.clips.length > 200) throw new Error('Choose 1 to 200 video clips or a folder of them')
  req.clips.forEach((c, i) => assertAbsolutePath(c, `clips[${i}]`))
  const o = { everyBeats: 4, shuffle: false, skipSeconds: 0, ...req }
  if (![1, 2, 4, 8].includes(o.everyBeats)) throw new Error('Cut every 1, 2, 4 or 8 beats')
  if (typeof o.shuffle !== 'boolean') throw new Error('shuffle must be true or false')
  if (!Number.isFinite(o.skipSeconds) || o.skipSeconds < 0 || o.skipSeconds > 30) throw new Error('Skip 0 to 30 seconds')
  if (o.beats != null && (!Array.isArray(o.beats) || o.beats.length < 2 || o.beats.length > 5000 || o.beats.some((b) => !Number.isFinite(b) || b < 0))) throw new Error('beats must be a list of times in seconds')
  return o
}

function createBeats(ctx) {
  const {
    handleStart, assertAbsolutePath, assertOneOf, defaultDownloadDir, uniqueOutputPath, addTask, broadcastTasks, runInPool, convertPool, updateTask, tasks, probeMedia, isCanceled, spawnTracked, demucsPython, pythonCwd, platform,
  } = ctx
  const SCRIPT = platform.scriptPath('beat_finder.py')

  /** Runs the script on a song. `entry` is the task's entry (cancel works), `onProgress(0..1, stage)` is called as it goes. */
  async function analyzeSong(inputPath, entry, onProgress = () => {}) {
    let text = ''
    try {
      await spawnTracked(demucsPython(), [SCRIPT, inputPath], entry, {
        cwd: pythonCwd(),
        onStdout: (chunk) => {
          text += chunk
          for (const line of chunk.split('\n')) {
            if (line.startsWith('@@PROGRESS ')) onProgress(Number(line.slice(11)))
            else if (line.startsWith('@@STAGE ')) onProgress(null, line.slice(8))
          }
        },
      })
    } catch (err) {
      const fail = /@@FAIL (.*)/.exec(text)?.[1]
      if (/No module named 'librosa'|No module named librosa/.test(String(err.message) + text)) throw new Error('Beat Finder needs librosa. Install it from the Beat Finder card (or: pip install librosa soundfile).')
      throw new Error(fail || err.message)
    }
    const result = parseResult(text)
    if (!result) throw new Error('The analysis gave no result.')
    return result
  }

  const summary = (r) => `${Math.round(r.bpm * 10) / 10} BPM · ${r.key} (${r.camelot})`

  handleStart('tasks:startBeatAnalyze', async (_e, req) => {
    validate(req, { assertAbsolutePath })
    const writeTags = req.writeTags === true
    const ext = path.extname(req.inputPath).slice(1).toLowerCase()
    if (writeTags && !TAG_FORMATS[ext]) throw new Error(`Writing tags works for MP3, FLAC, Ogg and Opus files, not .${ext}`)
    const id = crypto.randomUUID()
    const destDir = req.destination || defaultDownloadDir()
    let outputPath = null
    if (writeTags) {
      fs.mkdirSync(destDir, { recursive: true })
      outputPath = uniqueOutputPath(destDir, `${path.basename(req.inputPath, path.extname(req.inputPath))}-tagged`, ext)
    }
    addTask(id, {
      state: { id, kind: 'beats', status: 'queued', progress: 0, label: path.basename(req.inputPath), format: 'Beat Finder', quality: '', sizeBytes: null, sizeIsEstimate: false, thumbnailUrl: null, experimentalMatch: null },
      child: null,
      finalPath: outputPath,
    })
    broadcastTasks()
    runInPool(convertPool, id, () => analyzeJob(id, req.inputPath, outputPath, ext)).catch((err) => updateTask(id, { status: 'error', error: `Beat Finder failed to start: ${err.message}` }))
    return id
  })

  async function analyzeJob(id, inputPath, outputPath, ext) {
    const entry = tasks.get(id)
    updateTask(id, { status: 'running' })
    try {
      const r = await analyzeSong(inputPath, entry, (p, stage) => updateTask(id, { ...(p != null ? { progress: Math.min(0.9, p) } : {}), ...(stage ? { stage } : {}) }))
      if (isCanceled(id)) return
      entry.beats = r // the card asks for the full result (thousands of beats stay out of the task list)
      if (outputPath) {
        await spawnTracked('ffmpeg', ['-y', '-i', inputPath, '-map', '0', '-c', 'copy', ...tagArgs(ext, r.bpm, r.key), outputPath], entry)
        updateTask(id, { label: path.basename(outputPath), sizeBytes: fs.statSync(outputPath).size })
      }
      updateTask(id, { status: 'done', progress: 1, stage: null, quality: summary(r) })
    } catch (err) {
      if (outputPath) fs.rmSync(outputPath, { force: true })
      if (!isCanceled(id)) updateTask(id, { status: 'error', error: err.message })
    }
  }

  /** The full analysis of a finished Beat Finder task, for the card. */
  const beatsResult = (taskId) => tasks.get(taskId)?.beats ?? null

  handleStart('tasks:startBeatCut', async (_e, req) => {
    const o = validateCut(req, { assertAbsolutePath })
    const id = crypto.randomUUID()
    const destDir = o.destination || defaultDownloadDir()
    fs.mkdirSync(destDir, { recursive: true })
    const outputPath = uniqueOutputPath(destDir, `${path.basename(o.inputPath, path.extname(o.inputPath))}-beatcut`, 'mp4')
    addTask(id, {
      state: { id, kind: 'beatcut', status: 'queued', progress: 0, label: path.basename(o.inputPath), format: `Every ${o.everyBeats} beat${o.everyBeats > 1 ? 's' : ''}`, quality: `${o.clips.length} clip${o.clips.length > 1 ? 's' : ''}`, sizeBytes: null, sizeIsEstimate: false, thumbnailUrl: null, experimentalMatch: null },
      child: null,
      finalPath: outputPath,
    })
    broadcastTasks()
    runInPool(convertPool, id, () => beatCutJob(id, o, outputPath)).catch((err) => updateTask(id, { status: 'error', error: `Beat cut failed to start: ${err.message}` }))
    return id
  })

  /** Folders in the clip list become the video files inside them. */
  function expandClips(paths) {
    const files = []
    for (const p of paths) {
      let st
      try {
        st = fs.statSync(p)
      } catch {
        throw new Error(`This clip does not exist: ${p}`)
      }
      if (st.isDirectory()) {
        for (const n of fs.readdirSync(p).sort()) if (VIDEO_EXT.has(path.extname(n).slice(1).toLowerCase())) files.push(path.join(p, n))
      } else files.push(p)
    }
    if (files.length === 0) throw new Error('No video files found in what you chose')
    return files.slice(0, 200)
  }

  async function beatCutJob(id, o, outputPath) {
    const entry = tasks.get(id)
    updateTask(id, { status: 'running' })
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-beatcut-'))
    try {
      const files = expandClips(o.clips)
      const clips = []
      for (const f of files) {
        const info = await probeMedia(f)
        if (info?.hasVideo && info.duration > 0.5) clips.push({ path: f, duration: info.duration })
      }
      if (clips.length === 0) return updateTask(id, { status: 'error', error: "None of the clips could be read as video." })
      let beats = o.beats
      if (!beats) {
        updateTask(id, { stage: 'Finding the beat' })
        beats = (await analyzeSong(o.inputPath, entry)).beats
      }
      if (isCanceled(id)) return
      const points = cutPoints(beats, o.everyBeats)
      if (points.length < 2) return updateTask(id, { status: 'error', error: 'Too few beats to cut to. Try cutting on every beat.' })
      const plan = assignClips(points, clips, { skip: o.skipSeconds, random: o.shuffle ? Math.random : null })
      updateTask(id, { stage: 'Cutting the clips', progress: 0.02 })
      const listLines = []
      for (let i = 0; i < plan.length; i++) {
        const seg = plan[i]
        const out = path.join(tmp, `s${String(i).padStart(5, '0')}.mp4`)
        const vf = `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}`
        await spawnTracked('ffmpeg', ['-y', '-ss', String(seg.start), '-i', seg.clip, '-vf', vf, '-frames:v', String(seg.frames), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', out], entry)
        if (isCanceled(id)) return
        listLines.push(`file '${out.replace(/'/g, "'\\''")}'`)
        updateTask(id, { progress: 0.02 + 0.93 * ((i + 1) / plan.length) })
      }
      const list = path.join(tmp, 'list.txt')
      fs.writeFileSync(list, listLines.join('\n'))
      updateTask(id, { stage: 'Adding the song' })
      const length = points[points.length - 1] - points[0]
      await spawnTracked('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-ss', String(points[0]), '-t', String(length), '-i', o.inputPath, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', outputPath], entry)
      updateTask(id, { status: 'done', progress: 1, stage: null, label: path.basename(outputPath), quality: `${plan.length} cuts`, sizeBytes: fs.statSync(outputPath).size })
    } catch (err) {
      fs.rmSync(outputPath, { force: true })
      if (!isCanceled(id)) updateTask(id, { status: 'error', error: `Beat cut failed: ${err.message}` })
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }

  return { analyzeSong, beatsResult, beatCutJob }
}

module.exports = { createBeats, parseResult, tagArgs, cutPoints, assignClips, validateCut, TAG_FORMATS }
