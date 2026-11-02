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
 * Clip to GIF / animated WebP / sticker: cut a section out of a video and turn it into a short loop.
 * Sticker presets have hard limits (Telegram: WebM VP9, 512 px, up to 3 s, 256 KB; Discord: APNG, 320 px, 512 KB),
 * so a result that is too big is retried with a lower frame rate, then a smaller size, then lower quality.
 * No Electron: everything comes in through `ctx`. The pure planning/argument functions are exported for the tests.
 */
const fs = require('node:fs')
const path = require('node:path')

/** The four outputs. `maxBytes`/`maxSeconds` are the service limits (null = none); `box` is the longest side. */
const PRESETS = {
  gif: { label: 'GIF', ext: 'gif', width: 480, fps: 15, maxBytes: null, maxSeconds: 60 },
  webp: { label: 'Animated WebP', ext: 'webp', width: 480, fps: 15, maxBytes: null, maxSeconds: 60 },
  telegram: { label: 'Telegram sticker', ext: 'webm', box: 512, fps: 30, maxBytes: 256 * 1024, maxSeconds: 3 },
  discord: { label: 'Discord sticker', ext: 'png', box: 320, fps: 15, maxBytes: 512 * 1024, maxSeconds: 15 },
}
const FPS_STEPS = [30, 24, 20, 15, 12, 10, 8]

const even = (n) => Math.max(2, Math.round(n / 2) * 2)

/** The size/rate/quality tries for a preset, easiest first: same, then fewer frames, then smaller, then lower quality. */
function attemptsFor(presetName, { width, fps }) {
  const p = PRESETS[presetName]
  const w0 = p.box ?? width ?? p.width
  const f0 = Math.min(fps ?? p.fps, p.fps === 30 ? 30 : 60)
  const first = { width: w0, fps: f0, quality: 0 }
  if (!p.maxBytes) return [first]
  const lowerFps = FPS_STEPS.find((f) => f < f0) ?? f0
  return [
    first,
    { width: w0, fps: lowerFps, quality: 0 },
    { width: even(w0 * 0.8), fps: lowerFps, quality: 1 },
    { width: even(w0 * 0.64), fps: Math.min(lowerFps, 15), quality: 2 },
  ]
}

/** The video filter that fits the picture into the preset's size (width for GIF/WebP, a box for stickers). */
function scaleFilter(presetName, width) {
  const p = PRESETS[presetName]
  if (p.box) return `scale=${width}:${width}:force_original_aspect_ratio=decrease:flags=lanczos`
  return `scale=${width}:-2:flags=lanczos`
}

/** ffmpeg arguments for one attempt. `clip` is { start, length } in seconds; `try` one entry of attemptsFor(). */
function gifArgs({ input, output, preset, clip, attempt, loop = true }) {
  const p = PRESETS[preset]
  const seek = ['-ss', String(clip.start), '-t', String(clip.length), '-i', input, '-an', '-sn']
  const tail = ['-progress', 'pipe:1', '-nostats', output]
  const base = `fps=${attempt.fps},${scaleFilter(preset, attempt.width)}`
  if (preset === 'gif') {
    const colors = [256, 128, 64][attempt.quality] ?? 64
    return ['-y', ...seek, '-vf', `${base},split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`, '-loop', loop ? '0' : '-1', ...tail]
  }
  if (preset === 'webp') {
    return ['-y', ...seek, '-vf', base, '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', String([75, 60, 45][attempt.quality] ?? 45), '-loop', loop ? '0' : '1', '-pix_fmt', 'yuva420p', ...tail]
  }
  if (preset === 'telegram') {
    return ['-y', ...seek, '-vf', base, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', String([32, 36, 40, 44][attempt.quality] ?? 44), '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', ...tail]
  }
  // discord: APNG that plays forever
  return ['-y', ...seek, '-vf', base, '-c:v', 'apng', '-plays', '0', '-f', 'apng', ...tail]
}

/** Checks the clip against the preset and returns { start, length } or throws a readable Error. */
function planClip({ preset, start, end, duration }) {
  const p = PRESETS[preset]
  if (!Number.isFinite(start) || start < 0) throw new Error('Invalid start time')
  if (start >= duration) throw new Error('The start is past the end of the file.')
  const stop = end == null ? Math.min(duration, start + p.maxSeconds) : Math.min(end, duration)
  if (!(stop > start)) throw new Error('The end must be after the start')
  const length = stop - start
  if (length > p.maxSeconds) throw new Error(`${p.label} can be at most ${p.maxSeconds} seconds long (this clip is ${Math.round(length * 10) / 10}).`)
  return { start, length }
}

function createGif(ctx) {
  const {
    handleStart, assertAbsolutePath, assertOneOf, defaultDownloadDir, uniqueOutputPath, addTask, fmtClock, broadcastTasks, runInPool, convertPool, updateTask, tasks, probeMedia, isCanceled, spawnTracked,
  } = ctx

  handleStart('tasks:startGif', async (_e, req) => {
    assertAbsolutePath(req.inputPath, 'inputPath')
    if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
    assertOneOf(req.preset, Object.keys(PRESETS), 'preset')
    if (req.width != null && (!Number.isInteger(req.width) || req.width < 64 || req.width > 1920)) throw new Error('width must be 64 to 1920')
    if (req.fps != null && (!Number.isInteger(req.fps) || req.fps < 5 || req.fps > 30)) throw new Error('fps must be 5 to 30')
    const info = await probeMedia(req.inputPath)
    if (!info || !info.hasVideo) throw new Error('This is not a video file.')
    const clip = planClip({ preset: req.preset, start: req.start ?? 0, end: req.end ?? null, duration: info.duration })
    const p = PRESETS[req.preset]
    const id = crypto.randomUUID()
    const destDir = req.destination || defaultDownloadDir()
    fs.mkdirSync(destDir, { recursive: true })
    const inputBase = path.basename(req.inputPath, path.extname(req.inputPath))
    const outputPath = uniqueOutputPath(destDir, `${inputBase}-${req.preset === 'gif' || req.preset === 'webp' ? 'clip' : req.preset + '-sticker'}`, p.ext)
    addTask(id, {
      state: {
        id,
        kind: 'gif',
        status: 'queued',
        progress: 0,
        label: path.basename(req.inputPath),
        format: p.label,
        quality: `${fmtClock(clip.start)} – ${fmtClock(clip.start + clip.length)}`,
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
      },
      child: null,
      finalPath: outputPath,
    })
    broadcastTasks()
    runInPool(convertPool, id, () => gifJob(id, req, clip, outputPath)).catch((err) => updateTask(id, { status: 'error', error: `Clip failed to start: ${err.message}` }))
    return id
  })

  async function gifJob(id, req, clip, outputPath) {
    const entry = tasks.get(id)
    const p = PRESETS[req.preset]
    updateTask(id, { status: 'running' })
    const attempts = attemptsFor(req.preset, { width: req.width, fps: req.fps })
    let smallest = Infinity
    try {
      for (let n = 0; n < attempts.length; n++) {
        const from = n / attempts.length
        const to = (n + 1) / attempts.length
        await spawnTracked('ffmpeg', gifArgs({ input: req.inputPath, output: outputPath, preset: req.preset, clip, attempt: attempts[n], loop: req.loop !== false }), entry, {
          onStdout: (text) => {
            const m = [...text.matchAll(/out_time_ms=(\d+)/g)].pop()
            if (m) updateTask(id, { progress: Math.min(0.99, from + (to - from) * Math.min(1, Number(m[1]) / 1e6 / clip.length)) })
          },
        })
        const size = fs.statSync(outputPath).size
        smallest = Math.min(smallest, size)
        if (!p.maxBytes || size <= p.maxBytes) {
          const a = attempts[n]
          return updateTask(id, { status: 'done', progress: 1, label: path.basename(outputPath), sizeBytes: size, quality: `${a.width}px · ${a.fps} fps${n > 0 ? ' (shrunk to fit)' : ''}` })
        }
      }
      throw new Error(`Could not get under the ${Math.round(p.maxBytes / 1024)} KB limit (smallest was ${Math.round(smallest / 1024)} KB). Try a shorter clip.`)
    } catch (err) {
      fs.rmSync(outputPath, { force: true })
      if (!isCanceled(id)) updateTask(id, { status: 'error', error: `Clip failed: ${err.message}` })
    }
  }

  return { gifJob }
}

module.exports = { createGif, PRESETS, attemptsFor, gifArgs, planClip, scaleFilter }
