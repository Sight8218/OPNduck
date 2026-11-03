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
 * Restore old video: deinterlace, denoise, stabilize and fix the colors in one FFmpeg pass (stabilizing measures the
 * shake first), then optionally hand the result to the upscaler and the frame interpolator as follow-up jobs in the
 * same Library group. No Electron: everything it needs comes in through `ctx` (see core/*.cjs).
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')

const DENOISE = {
  light: 'hqdn3d=2:1.5:3:2.5',
  medium: 'hqdn3d=4:3:6:4.5',
  strong: 'nlmeans=s=3:p=7:r=15', // slow, but clean
}

/** The counts idet prints at the end of its run: { tff, bff, progressive }, or null. */
function parseIdet(text) {
  // idet reports twice when ffmpeg sets the filter up twice; the last report has the real counts.
  const all = [...String(text).matchAll(/Multi frame detection:\s*TFF:\s*(\d+)\s*BFF:\s*(\d+)\s*Progressive:\s*(\d+)/g)]
  const m = all[all.length - 1]
  return m ? { tff: Number(m[1]), bff: Number(m[2]), progressive: Number(m[3]) } : null
}

/** Is a clip interlaced? Yes when more of the frames the detector classified are interlaced than progressive. */
const looksInterlaced = (idet) => !!idet && idet.tff + idet.bff > idet.progressive

/**
 * The filters that run on every frame on their own, in the order that gives the best result: deinterlace first (the
 * others expect whole frames), then noise, then colors. `interlaced` is the answer for deinterlace 'auto'.
 */
function buildChain(o, interlaced) {
  const f = []
  if (o.deinterlace === 'on' || (o.deinterlace === 'auto' && interlaced)) f.push('bwdif=mode=send_frame:parity=auto:deint=all')
  if (o.denoise !== 'off') f.push(DENOISE[o.denoise])
  if (o.fixColors) f.push('normalize=blackpt=black:whitept=white:smoothing=50')
  return f
}

/** The two stabilizing filters: detect (writes the motion file) and transform (reads it, then a light sharpen to make up for the crop). */
const detectFilter = (trf) => `vidstabdetect=shakiness=5:accuracy=15:result=${trf}`
const transformFilter = (trf) => `vidstabtransform=input=${trf}:smoothing=15:zoom=0:optzoom=1,unsharp=5:5:0.8:3:3:0.4`

/** A filter list as one -vf value. Paths in filters need their colons and backslashes escaped. */
const joinFilters = (list) => list.join(',')
const escapePath = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:')

function validate(req, { assertAbsolutePath, assertOneOf }) {
  assertAbsolutePath(req.inputPath, 'inputPath')
  if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
  const o = { deinterlace: 'auto', denoise: 'off', stabilize: false, fixColors: false, upscale: false, interpolate: false, ...req }
  assertOneOf(o.deinterlace, ['auto', 'on', 'off'], 'deinterlace')
  assertOneOf(o.denoise, ['off', 'light', 'medium', 'strong'], 'denoise')
  for (const k of ['stabilize', 'fixColors', 'upscale', 'interpolate']) if (typeof o[k] !== 'boolean') throw new Error(`${k} must be true or false`)
  if (o.deinterlace === 'off' && o.denoise === 'off' && !o.stabilize && !o.fixColors && !o.upscale && !o.interpolate) throw new Error('Nothing to do: pick at least one fix')
  return o
}

function createRestore(ctx) {
  const {
    handleStart, assertAbsolutePath, assertOneOf, defaultDownloadDir, uniqueOutputPath, addTask, broadcastTasks, runInPool, convertPool, updateTask, tasks, probeMedia, isCanceled, spawnTracked,
  } = ctx

  function capture(args, { stdout = false } = {}) {
    return new Promise((resolve, reject) => {
      let text = ''
      const child = spawn('ffmpeg', ['-hide_banner', '-nostats', '-nostdin', ...args])
      child.stdout.on('data', (c) => (text += c))
      child.stderr.on('data', (c) => (text += c))
      child.on('error', reject)
      child.on('close', (code) => (code === 0 || stdout ? resolve(text) : reject(new Error(text.trim().split('\n').pop() || `ffmpeg exited with code ${code}`))))
    })
  }

  let hasVidstab = null
  async function vidstabAvailable() {
    if (hasVidstab == null) hasVidstab = /vidstabdetect/.test(await capture(['-filters']).catch(() => ''))
    return hasVidstab
  }

  async function detectInterlaced(inputPath) {
    const text = await capture(['-i', inputPath, '-vf', 'idet', '-frames:v', '500', '-an', '-f', 'null', '-']).catch(() => '')
    return looksInterlaced(parseIdet(text))
  }

  /** One frame before and after the per-frame fixes (not stabilizing: it needs the whole clip), for the before/after slider. */
  async function previewRestore(req) {
    const o = validate({ ...req, stabilize: false, upscale: false, interpolate: false, ...(req.deinterlace || req.denoise || req.fixColors ? {} : { fixColors: true }) }, { assertAbsolutePath, assertOneOf })
    const info = await probeMedia(o.inputPath)
    if (!info || !info.hasVideo) throw new Error("Couldn't read this video.")
    const t = Math.min(Math.max(0, req.time ?? info.duration * 0.3), Math.max(0, info.duration - 0.5))
    const width = Math.min(1280, Math.max(160, Number(req.width) || 640))
    const interlaced = o.deinterlace === 'auto' ? await detectInterlaced(o.inputPath) : false
    const chain = buildChain(o, interlaced)
    const frame = (filters) =>
      new Promise((resolve) => {
        // A few frames are decoded first so filters that look at neighbouring frames have something to look at; the 6th is kept.
        const vf = joinFilters([...filters, "select='gte(n,5)'", `scale=${width}:-2`])
        const child = spawn('ffmpeg', ['-v', 'error', '-nostdin', '-ss', String(t), '-i', o.inputPath, '-vf', vf, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '5', '-'])
        const chunks = []
        const timer = setTimeout(() => child.kill(), 30_000)
        child.stdout.on('data', (c) => chunks.push(c))
        child.on('error', () => (clearTimeout(timer), resolve(null)))
        child.on('close', () => {
          clearTimeout(timer)
          const buf = Buffer.concat(chunks)
          resolve(buf.length ? `data:image/jpeg;base64,${buf.toString('base64')}` : null)
        })
      })
    const [before, after] = await Promise.all([frame([]), frame(chain)])
    return { before, after, interlaced, applied: chain.length > 0 }
  }

  handleStart('tasks:startRestore', async (_e, req) => {
    const o = validate(req, { assertAbsolutePath, assertOneOf })
    if (o.upscale || o.interpolate) {
      // The fixes, then the upscaler and the interpolator, as one recipe run: each step starts from the previous result.
      const steps = [{ tool: 'restore', args: { deinterlace: o.deinterlace, denoise: o.denoise, stabilize: o.stabilize, fixColors: o.fixColors } }]
      if (o.upscale) steps.push({ tool: 'upscale_video', args: { scale: 2 } })
      if (o.interpolate) steps.push({ tool: 'interpolate', args: { multiplier: 2 } })
      const anyFix = o.deinterlace !== 'off' || o.denoise !== 'off' || o.stabilize || o.fixColors
      const run = await ctx.recipes.run({ name: 'Restore old video', input: 'video', steps: anyFix ? steps : steps.slice(1) }, o.inputPath, { destination: o.destination })
      return run.taskIds[0]
    }
    const id = crypto.randomUUID()
    const destDir = o.destination || defaultDownloadDir()
    fs.mkdirSync(destDir, { recursive: true })
    const base = path.basename(o.inputPath, path.extname(o.inputPath))
    const outputPath = uniqueOutputPath(destDir, `${base}-restored`, 'mp4')
    const fixes = [o.deinterlace !== 'off' && 'deinterlace', o.denoise !== 'off' && 'denoise', o.stabilize && 'stabilize', o.fixColors && 'colors'].filter(Boolean)
    addTask(id, {
      state: {
        id,
        kind: 'restore',
        status: 'queued',
        progress: 0,
        label: path.basename(o.inputPath),
        format: 'Restore',
        quality: fixes.join(', '),
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
      },
      child: null,
      finalPath: outputPath,
    })
    broadcastTasks()
    runInPool(convertPool, id, () => restoreJob(id, o, outputPath)).catch((err) => updateTask(id, { status: 'error', error: `Restore failed to start: ${err.message}` }))
    return id
  })

  async function restoreJob(id, o, outputPath) {
    const entry = tasks.get(id)
    updateTask(id, { status: 'running' })
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-restore-'))
    try {
      const info = await probeMedia(o.inputPath)
      if (isCanceled(id)) return
      if (!info || !info.hasVideo) return updateTask(id, { status: 'error', error: "Couldn't read this video." })
      if (o.stabilize && !(await vidstabAvailable())) return updateTask(id, { status: 'error', error: "This FFmpeg was built without libvidstab, so it cannot stabilize. Turn Stabilize off, or install an FFmpeg that has it." })
      const interlaced = o.deinterlace === 'auto' ? await detectInterlaced(o.inputPath) : false
      if (isCanceled(id)) return
      const chain = buildChain(o, interlaced)
      if (!o.stabilize && chain.length === 0) {
        // Nothing the filters would change (a clip that is not interlaced, with only "auto" on): say so rather than re-encode for nothing.
        return updateTask(id, { status: 'error', error: 'This video is not interlaced and no other fix is switched on, so there is nothing to do.' })
      }
      const trf = path.join(tmp, 'motion.trf')
      const onProgress = (from, to) => (text) => {
        const m = [...text.matchAll(/out_time_ms=(\d+)/g)].pop()
        if (m) updateTask(id, { progress: Math.min(0.99, from + (to - from) * Math.min(1, Number(m[1]) / 1e6 / info.duration)) })
      }
      let vf = chain
      if (o.stabilize) {
        const pass1 = joinFilters([...chain, detectFilter(escapePath(trf))])
        await spawnTracked('ffmpeg', ['-y', '-i', o.inputPath, '-vf', pass1, '-an', '-f', 'null', '-progress', 'pipe:1', '-nostats', '-'], entry, { onStdout: onProgress(0, 0.35) })
        if (isCanceled(id)) return
        vf = [...chain, transformFilter(escapePath(trf))]
      }
      await spawnTracked('ffmpeg', ['-y', '-i', o.inputPath, '-vf', joinFilters(vf), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', outputPath], entry, {
        onStdout: onProgress(o.stabilize ? 0.35 : 0, 1),
      })
      let realSize = null
      try {
        realSize = fs.statSync(outputPath).size
      } catch {
        /* keep null */
      }
      updateTask(id, { status: 'done', progress: 1, label: path.basename(outputPath), ...(realSize != null ? { sizeBytes: realSize } : {}) })
    } catch (err) {
      fs.rmSync(outputPath, { force: true })
      if (!isCanceled(id)) updateTask(id, { status: 'error', error: `Restore failed: ${err.message}` })
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }

  return { restoreJob, previewRestore, vidstabAvailable }
}

module.exports = { createRestore, parseIdet, looksInterlaced, buildChain, detectFilter, transformFilter, validate, DENOISE }
