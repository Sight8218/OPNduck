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
 * The fit-to-size compressor: make a video or audio file land just under a size ("under 10 MB for Discord").
 * It works out the bitrate that fills the size, picks a resolution that stays sharp at that bitrate, and encodes
 * in two passes (x264) or one rate-controlled NVENC pass. No Electron: everything comes in through `ctx`.
 * The pure planning/argument functions are exported for the tests.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const OVERHEAD = 0.97 // container overhead margin: aim 3% under the target
const MIN_VIDEO_KBPS = 80 // below this the picture is not worth making
const MIN_BPP = 0.05 // bits per pixel per frame the picture must keep
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null'

/** Audio and video bitrates (kb/s) that fill `targetBytes` over `durationSec`, or { error, minBytes } when it cannot be done. */
function planBitrates({ durationSec, targetBytes, hasAudio, hasVideo = true }) {
  if (!(durationSec > 0) || !(targetBytes > 0)) return { error: 'Invalid duration or target.', minBytes: 0 }
  const totalKbps = (targetBytes * 8 * OVERHEAD) / durationSec / 1000
  if (!hasVideo) {
    const audioKbps = Math.min(320, Math.floor(totalKbps))
    if (audioKbps < 24) return { error: 'That target is too small for this audio length.', minBytes: Math.ceil((24 * 1000 * durationSec) / 8 / OVERHEAD) }
    return { videoKbps: 0, audioKbps, totalKbps }
  }
  let audioKbps = 0
  if (hasAudio) audioKbps = totalKbps - 96 < 500 ? 64 : 96
  const videoKbps = Math.floor(totalKbps - audioKbps)
  if (videoKbps < MIN_VIDEO_KBPS) {
    const need = MIN_VIDEO_KBPS + (hasAudio ? 64 : 0)
    return { error: 'That target is too small for this video length.', minBytes: Math.ceil((need * 1000 * durationSec) / 8 / OVERHEAD) }
  }
  return { videoKbps, audioKbps, totalKbps }
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2)

/** The biggest of the source size / 1080p / 720p / 480p / 360p that keeps MIN_BPP at the bitrate; then, if needed, 30 fps. */
function pickResolution({ width, height, fps, videoKbps }) {
  const srcFps = fps > 0 ? fps : 30
  const steps = [...new Set([height, 1080, 720, 480, 360].filter((h) => h <= height))].sort((a, b) => b - a)
  const at = (h, f) => {
    const w = h === height ? width : even((h * width) / height)
    return { width: even(w), height: even(h), fps: f, bpp: (videoKbps * 1000) / (even(w) * even(h) * f) }
  }
  let pick = null
  for (const f of srcFps > 30 ? [srcFps, 30] : [srcFps]) {
    for (const h of steps) {
      const c = at(h, f)
      if (c.bpp >= MIN_BPP) {
        pick = c
        break
      }
    }
    if (pick) break
  }
  pick ??= at(steps[steps.length - 1], Math.min(srcFps, 30)) // nothing reaches the target quality: smallest size
  const scaled = pick.height !== height
  const fpsCapped = pick.fps < srcFps - 0.5
  return { width: pick.width, height: pick.height, fps: pick.fps, scaled, fpsCapped, label: `${pick.height}p${fpsCapped ? ` · ${Math.round(pick.fps)} fps` : ''}` }
}

/** The video filter and rate arguments shared by every video pass. */
function videoCommon(plan, res) {
  const filters = []
  if (res.scaled) filters.push(`scale=${res.width}:${res.height}:flags=lanczos`)
  if (res.fpsCapped) filters.push(`fps=${Math.round(res.fps)}`)
  return [...(filters.length ? ['-vf', filters.join(',')] : []), '-pix_fmt', 'yuv420p']
}

const audioArgs = (plan) => (plan.audioKbps ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', `${plan.audioKbps}k`] : ['-an'])

/** x264 pass 1 (analysis, no audio, no output file) or pass 2 (the real file). `scale` lowers the bitrate for a retry. */
function x264Args({ input, output, plan, res, pass, passlog, scale = 1 }) {
  const rate = ['-c:v', 'libx264', '-preset', 'medium', '-b:v', `${Math.floor(plan.videoKbps * scale)}k`, '-pass', String(pass), '-passlogfile', passlog]
  const tail = ['-progress', 'pipe:1', '-nostats']
  if (pass === 1) return ['-y', '-i', input, '-map', '0:v:0', ...videoCommon(plan, res), ...rate, '-an', ...tail, '-f', 'null', NULL_DEVICE]
  return ['-y', '-i', input, '-map', '0:v:0', ...videoCommon(plan, res), ...rate, ...audioArgs(plan), '-movflags', '+faststart', ...tail, output]
}

/** One NVENC pass with rate control close to the target (it has no two-pass flag; -multipass does the lookahead). */
function nvencArgs({ input, output, plan, res, scale = 1 }) {
  const v = Math.floor(plan.videoKbps * scale)
  const rate = ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-b:v', `${v}k`, '-maxrate', `${Math.floor(v * 1.25)}k`, '-bufsize', `${v * 2}k`, '-multipass', 'fullres']
  return ['-y', '-i', input, '-map', '0:v:0', ...videoCommon(plan, res), ...rate, ...audioArgs(plan), '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output]
}

/** Audio-only: one MP3 pass at the bitrate that fills the target. */
function audioOnlyArgs({ input, output, plan, scale = 1 }) {
  return ['-y', '-i', input, '-vn', '-c:a', 'libmp3lame', '-b:a', `${Math.max(24, Math.floor(plan.audioKbps * scale))}k`, '-progress', 'pipe:1', '-nostats', output]
}

const formatMB = (mb) => String(Math.round(mb * 100) / 100)

function createCompress(ctx) {
  const {
    handleStart, assertAbsolutePath, assertOneOf, defaultDownloadDir, uniqueOutputPath, addTask, broadcastTasks, runInPool, convertPool, updateTask, tasks, probeMedia, isCanceled, spawnTracked, getSettings, hwEncoderWorks,
  } = ctx

  handleStart('tasks:startCompress', async (_e, req) => {
    assertAbsolutePath(req.inputPath, 'inputPath')
    if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
    assertOneOf(req.quality, ['fast', 'best'], 'quality')
    if (!Number.isFinite(req.targetMB) || req.targetMB < 0.5 || req.targetMB > 100000) throw new Error('The target size must be between 0.5 and 100000 MB')
    const id = crypto.randomUUID()
    const destDir = req.destination || defaultDownloadDir()
    fs.mkdirSync(destDir, { recursive: true })
    const info = await probeMedia(req.inputPath)
    if (!info) throw new Error("Couldn't read this file.")
    const targetBytes = Math.floor(req.targetMB * 1024 * 1024)
    const plan = planBitrates({ durationSec: info.duration, targetBytes, hasAudio: info.hasAudio !== false, hasVideo: info.hasVideo })
    if (plan.error) throw new Error(`${plan.error} The smallest this can reach is about ${formatMB(plan.minBytes / 1024 / 1024)} MB.`)
    // Already small enough: nothing to do, and re-encoding would only lose quality.
    const inSize = fs.statSync(req.inputPath).size
    if (inSize <= targetBytes) throw new Error(`This file is already ${formatMB(inSize / 1024 / 1024)} MB, under the ${formatMB(req.targetMB)} MB target.`)
    const res = info.hasVideo ? pickResolution({ width: info.width, height: info.height, fps: info.fps, videoKbps: plan.videoKbps }) : null

    const ext = info.hasVideo ? 'mp4' : 'mp3'
    const inputBase = path.basename(req.inputPath, path.extname(req.inputPath))
    const outputPath = uniqueOutputPath(destDir, `${inputBase}-${formatMB(req.targetMB)}MB`, ext)
    addTask(id, {
      state: {
        id,
        kind: 'compress',
        status: 'queued',
        progress: 0,
        label: path.basename(req.inputPath),
        format: `Under ${formatMB(req.targetMB)} MB`,
        quality: res ? res.label : `${plan.audioKbps} kb/s`,
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
      },
      child: null,
      finalPath: outputPath,
    })
    broadcastTasks()
    runInPool(convertPool, id, () => compressJob(id, req, { info, plan, res, targetBytes, outputPath })).catch((err) =>
      updateTask(id, { status: 'error', error: `Compress failed to start: ${err.message}` }),
    )
    return id
  })

  async function compressJob(id, req, { info, plan, res, targetBytes, outputPath }) {
    const entry = tasks.get(id)
    updateTask(id, { status: 'running' })
    const passlogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-compress-'))
    const passlog = path.join(passlogDir, 'pass')
    const input = req.inputPath
    // Runs one ffmpeg pass; `from`..`to` is the slice of the task's progress bar this pass fills.
    const run = (args, from, to) =>
      spawnTracked('ffmpeg', args, entry, {
        onStdout: (text) => {
          const m = [...text.matchAll(/out_time_ms=(\d+)/g)].pop()
          if (m) updateTask(id, { progress: Math.min(0.99, from + (to - from) * Math.min(1, Number(m[1]) / 1e6 / info.duration)) })
        },
      })
    const sizeNow = () => fs.statSync(outputPath).size
    try {
      if (!info.hasVideo) {
        await run(audioOnlyArgs({ input, output: outputPath, plan }), 0, 1)
        if (sizeNow() > targetBytes) await run(audioOnlyArgs({ input, output: outputPath, plan, scale: 0.92 }), 0, 1)
      } else {
        const useNvenc = req.quality === 'fast' && getSettings().videoEncoder !== 'cpu' && (await hwEncoderWorks('h264_nvenc'))
        let done = false
        if (useNvenc) {
          try {
            await run(nvencArgs({ input, output: outputPath, plan, res }), 0, 1)
            if (sizeNow() > targetBytes) await run(nvencArgs({ input, output: outputPath, plan, res, scale: 0.92 }), 0, 1)
            done = true
          } catch (err) {
            if (isCanceled(id)) throw err
            updateTask(id, { progress: 0 }) // NVENC refused these settings: carry on with x264 two-pass
          }
        }
        if (!done) {
          await run(x264Args({ input, output: outputPath, plan, res, pass: 1, passlog }), 0, 0.4)
          await run(x264Args({ input, output: outputPath, plan, res, pass: 2, passlog }), 0.4, 1)
          if (sizeNow() > targetBytes) await run(x264Args({ input, output: outputPath, plan, res, pass: 2, passlog, scale: 0.92 }), 0.4, 1)
        }
      }
    } catch (err) {
      fs.rmSync(outputPath, { force: true })
      if (!isCanceled(id)) updateTask(id, { status: 'error', error: `Compress failed: ${err.message}` })
      return
    } finally {
      fs.rmSync(passlogDir, { recursive: true, force: true })
    }
    let realSize = null
    try {
      realSize = sizeNow()
    } catch {
      /* keep null */
    }
    updateTask(id, { status: 'done', progress: 1, label: path.basename(outputPath), ...(realSize != null ? { sizeBytes: realSize } : {}) })
  }

  return { compressJob }
}

module.exports = { createCompress, planBitrates, pickResolution, x264Args, nvencArgs, audioOnlyArgs, MIN_BPP }
