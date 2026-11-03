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
 * Background remover: cuts people and objects out of pictures and videos with no green screen, and puts a transparent
 * background, a flat colour, a blurred copy or another picture behind them. The work is a small Python script in OPNduck's
 * environment (rembg for pictures, RobustVideoMatting for video); frames stream through FFmpeg, no temporary images. No Electron.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'avif']
const OUTPUTS = ['transparent', 'color', 'blur', 'image']
const MODELS = ['u2net', 'isnet-general-use', 'birefnet-general'] // rembg models: small and quick, medium, best edges (big download)

/** The FFmpeg filter graph that puts a cut-out picture (input 1, with alpha) over its new background (input 0 or the original). */
function compositeGraph(output, { color = '#00ff00' } = {}) {
  if (output === 'color') return { inputs: (w, h) => ['-f', 'lavfi', '-i', `color=c=0x${color.replace('#', '')}:s=${w}x${h}`], graph: '[0][1]overlay=format=auto' }
  if (output === 'blur') return { inputs: () => [], graph: '[0]boxblur=luma_radius=min(h\\,w)/40:luma_power=2[b];[b][1]overlay=format=auto' }
  return { inputs: () => [], graph: '[0]scale=iw:ih[b];[b][1]overlay=format=auto' }
}

function validate(req, { assertAbsolutePath, assertOneOf }) {
  assertAbsolutePath(req.inputPath, 'inputPath')
  if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
  const o = { output: 'transparent', color: '#00ff00', quality: 'fast', model: 'u2net', format: 'webm', ...req }
  assertOneOf(o.output, OUTPUTS, 'output')
  assertOneOf(o.quality, ['fast', 'best'], 'quality')
  assertOneOf(o.model, MODELS, 'model')
  assertOneOf(o.format, ['webm', 'mov'], 'format')
  if (!/^#[0-9a-fA-F]{6}$/.test(o.color)) throw new Error('The colour looks like #00ff00')
  if (o.output === 'image') {
    assertAbsolutePath(o.backgroundImage, 'backgroundImage')
    if (!IMAGE_EXT.includes(path.extname(o.backgroundImage).slice(1).toLowerCase())) throw new Error('The background must be a picture')
  }
  return o
}

function createBgRemove(ctx) {
  const {
    handleStart, assertAbsolutePath, assertOneOf, defaultDownloadDir, uniqueOutputPath, addTask, broadcastTasks, runInPool, gpuPool, updateTask, tasks, probeMedia, isCanceled, spawnTracked, demucsPython, pythonCwd, platform,
  } = ctx
  const SCRIPT = platform.scriptPath('bg_remove.py')

  /** Runs the script; `onProgress(0..1)` as it reports; rejects with its own message when it fails. */
  async function runPython(args, entry, onProgress = () => {}) {
    let text = ''
    try {
      await spawnTracked(demucsPython(), [SCRIPT, ...args], entry, {
        cwd: pythonCwd(),
        onStdout: (chunk) => {
          text += chunk
          for (const line of chunk.split('\n')) if (line.startsWith('@@PROGRESS ')) onProgress(Number(line.slice(11)))
        },
      })
    } catch (err) {
      if (/No module named/.test(`${err.message} ${text}`)) throw new Error('The Background Remover needs its add-on. Install it from the Background Remover card.')
      throw new Error(/@@FAIL (.*)/.exec(text)?.[1] ?? err.message)
    }
  }

  handleStart('tasks:startBgRemove', async (_e, req) => {
    const o = validate(req, { assertAbsolutePath, assertOneOf })
    const ext = path.extname(o.inputPath).slice(1).toLowerCase()
    const isImage = IMAGE_EXT.includes(ext)
    const id = crypto.randomUUID()
    const destDir = o.destination || defaultDownloadDir()
    fs.mkdirSync(destDir, { recursive: true })
    const outExt = isImage ? 'png' : o.output === 'transparent' ? o.format : 'mp4'
    const outputPath = uniqueOutputPath(destDir, `${path.basename(o.inputPath, path.extname(o.inputPath))}-cutout`, outExt)
    addTask(id, {
      state: { id, kind: 'bgremove', status: 'queued', progress: 0, label: path.basename(o.inputPath), format: 'Cut-out', quality: o.output === 'transparent' ? 'Transparent' : o.output, sizeBytes: null, sizeIsEstimate: false, thumbnailUrl: null, experimentalMatch: null },
      child: null,
      finalPath: outputPath,
    })
    broadcastTasks()
    runInPool(gpuPool, id, () => (isImage ? imageJob(id, o, outputPath) : videoJob(id, o, outputPath))).catch((err) => updateTask(id, { status: 'error', error: `Background removal failed to start: ${err.message}` }))
    return id
  })

  async function imageJob(id, o, outputPath) {
    const entry = tasks.get(id)
    updateTask(id, { status: 'running' })
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-bg-'))
    try {
      const cut = o.output === 'transparent' ? outputPath : path.join(tmp, 'cut.png')
      await runPython(['image', o.inputPath, cut, o.model], entry, (p) => updateTask(id, { progress: p }))
      if (isCanceled(id)) return
      if (o.output !== 'transparent') {
        const info = await probeMedia(o.inputPath)
        const g = compositeGraph(o.output, o)
        const bgInput = o.output === 'image' ? ['-i', o.backgroundImage] : o.output === 'color' ? g.inputs(info?.width ?? 1280, info?.height ?? 720) : ['-i', o.inputPath]
        const graph = o.output === 'image' ? `[0]scale=${info?.width ?? 1280}:${info?.height ?? 720}:force_original_aspect_ratio=increase,crop=${info?.width ?? 1280}:${info?.height ?? 720}[b];[b][1]overlay=format=auto` : g.graph
        await spawnTracked('ffmpeg', ['-y', ...bgInput, '-i', cut, '-filter_complex', graph, '-frames:v', '1', outputPath], entry)
      }
      updateTask(id, { status: 'done', progress: 1, label: path.basename(outputPath), sizeBytes: fs.statSync(outputPath).size })
    } catch (err) {
      fs.rmSync(outputPath, { force: true })
      if (!isCanceled(id)) updateTask(id, { status: 'error', error: err.message })
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }

  async function videoJob(id, o, outputPath) {
    const entry = tasks.get(id)
    updateTask(id, { status: 'running' })
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-bg-'))
    try {
      const info = await probeMedia(o.inputPath)
      if (!info?.hasVideo) return updateTask(id, { status: 'error', error: "Couldn't read a video in this file." })
      const fps = info.fps ?? 30
      const job = { modelDir: path.join(platform.paths.userData, 'models', 'rvm'), input: o.inputPath, output: outputPath, ffmpeg: 'ffmpeg', mode: o.output, color: o.color, bgImage: o.backgroundImage, quality: o.quality, width: Math.floor(info.width / 2) * 2, height: Math.floor(info.height / 2) * 2, fps, codec: o.format, frames: Math.round(info.duration * fps) }
      const file = path.join(tmp, 'job.json')
      fs.writeFileSync(file, JSON.stringify(job))
      await runPython(['video', file], entry, (p) => updateTask(id, { progress: p }))
      if (isCanceled(id)) return
      updateTask(id, { status: 'done', progress: 1, label: path.basename(outputPath), sizeBytes: fs.statSync(outputPath).size })
    } catch (err) {
      fs.rmSync(outputPath, { force: true })
      if (!isCanceled(id)) updateTask(id, { status: 'error', error: err.message })
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }

  /** The cut-out of one frame (a picture, or a video's frame about a third in) as a transparent PNG data URL, to judge before a long job. */
  async function preview(inputPath) {
    assertAbsolutePath(inputPath, 'inputPath')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-bgp-'))
    const entry = { state: { id: 'bgpreview' }, child: null }
    try {
      let src = inputPath
      if (!IMAGE_EXT.includes(path.extname(inputPath).slice(1).toLowerCase())) {
        const info = await probeMedia(inputPath)
        if (!info?.hasVideo) throw new Error("Couldn't read a video in this file.")
        src = path.join(tmp, 'frame.png')
        await spawnTracked('ffmpeg', ['-y', '-ss', String(info.duration * 0.33), '-i', inputPath, '-vf', 'scale=640:-2', '-frames:v', '1', src], entry)
      }
      const out = path.join(tmp, 'cut.png')
      await runPython(['image', src, out, 'u2net'], entry)
      return `data:image/png;base64,${fs.readFileSync(out).toString('base64')}`
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }

  return { imageJob, videoJob, preview }
}

module.exports = { createBgRemove, validate, compositeGraph, IMAGE_EXT, OUTPUTS, MODELS }
