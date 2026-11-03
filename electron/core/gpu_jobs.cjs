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
 * GPU jobs: image and video upscaling (Real-ESRGAN via ncnn or the PyTorch engine) and frame interpolation (RIFE), with chunked frame processing.
 * No Electron: everything it needs comes in through `ctx` (see core/*.cjs).
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const os = require('node:os')

function createGpuJobs(ctx) {
  const {
    getSettings, spawnTracked, isCanceled, handleStart, assertAbsolutePath, assertOneOf, defaultDownloadDir, uniqueOutputPath, addTask, broadcastTasks, runInPool, gpuPool, attachLog, updateTask, tasks, probeVideoMeta, jobLog, listSorted, platform, cachedEngineCheck, demucsPython, pythonCwd, whisperWorker, demucsWorker,
  } = ctx

  const UPSCALE_MODELS = ['realesr-animevideov3', 'realesrgan-x4plus', 'realesrgan-x4plus-anime']

  /** realesrgan-x4plus and -anime only support 4x; realesr-animevideov3 (the
   *  default) supports 2x/3x/4x — the renderer is responsible for not letting
   *  the user pick an invalid scale/model pair in the first place. No -m flag:
   *  the binary finds its own bundled/packaged models without help, verified
   *  against both a manual build layout and this system's AUR package. */
  /** -j load:proc:save threads for the ncnn tools. Their default (1:2:2) leaves the GPU idle while frames
   *  load and save; measured on an RTX 3080: ~1.4x (realesrgan, 360p) and ~1.1-2x (rife) faster. */
  const GPU_THREADS = { upscale: '2:4:4', interpolate: '4:4:4', low: '1:2:2' }

  const gpuThreadArg = (kind) => (getSettings().gpuThreads === 'low' ? GPU_THREADS.low : GPU_THREADS[kind])

  /** Runs an ncnn GPU tool with the faster thread setting; if it fails before finishing a single frame
   *  (typically not enough GPU memory for that setting), retries once with the conservative one. */
  async function spawnGpuTool(id, cmd, args, kind, entry, opts, framesDone, state = { low: false }) {
    const threads = state.low ? GPU_THREADS.low : gpuThreadArg(kind)
    try {
      return await spawnTracked(cmd, [...args, '-j', threads], entry, opts)
    } catch (err) {
      if (isCanceled(id) || threads === GPU_THREADS.low || framesDone() > 0) throw err
      state.low = true // once the fast setting failed, the remaining chunks of this job use the safe one
      return spawnTracked(cmd, [...args, '-j', GPU_THREADS.low], entry, opts)
    }
  }

  function upscaleArgs(req, outputPath) {
    return ['-i', req.inputPath, '-o', outputPath, '-s', String(req.scale), '-n', req.model, '-v']
  }

  handleStart('tasks:startUpscale', (_e, req) => {
    assertAbsolutePath(req.inputPath, 'inputPath')
    if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
    assertOneOf(req.model, UPSCALE_MODELS, 'model')
    assertOneOf(req.scale, [2, 3, 4], 'scale')
    const id = crypto.randomUUID()
    const destDir = req.destination || defaultDownloadDir()
    fs.mkdirSync(destDir, { recursive: true })

    const ext = path.extname(req.inputPath).replace(/^\./, '').toLowerCase() || 'png'
    const inputBase = path.basename(req.inputPath, path.extname(req.inputPath))
    const outputPath = uniqueOutputPath(destDir, `${inputBase}-${req.scale}x`, ext)

    addTask(id, {
      state: {
        id,
        kind: 'upscale',
        status: 'queued',
        progress: 0,
        label: path.basename(req.inputPath),
        format: req.model,
        quality: `${req.scale}×`,
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
      },
      child: null,
      finalPath: outputPath,
    })
    broadcastTasks()

    runInPool(gpuPool, id, () => {
      let child
      try {
        child = spawn('realesrgan-ncnn-vulkan', upscaleArgs(req, outputPath))
        attachLog(child, id)
      } catch (err) {
        updateTask(id, { status: 'error', error: `Failed to start realesrgan-ncnn-vulkan: ${err.message}` })
        return
      }

      const entry = tasks.get(id)
      entry.child = child
      updateTask(id, { status: 'running' })

      // Everything — GPU info, per-tile progress percentages, and the final
      // "done" line — comes out on stderr, not stdout (verified directly).
      let stderrTail = ''
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString()
        stderrTail = (stderrTail + text).slice(-2000)
        const match = text.match(/(\d+(?:\.\d+)?)%/)
        if (match) updateTask(id, { progress: Math.min(1, Number(match[1]) / 100) })
      })
      child.on('error', (err) => {
        updateTask(id, { status: 'error', error: `realesrgan-ncnn-vulkan not found on PATH (${err.message})` })
      })
      child.on('close', (code, signal) => {
        if (!tasks.has(id)) return
        // A spawn failure (ENOENT) fires 'error' and then 'close'(-2); keep the clearer 'error' message.
        if (entry.state.status === 'canceled' || entry.state.status === 'error') return
        if (signal || code !== 0) {
          updateTask(id, {
            status: 'error',
            error: stderrTail.trim().split('\n').pop() || `realesrgan-ncnn-vulkan exited with code ${code}`,
          })
          return
        }
        let realSize = null
        try {
          realSize = fs.statSync(outputPath).size
        } catch {
          /* keep null if the output can't be read */
        }
        updateTask(id, {
          status: 'done',
          progress: 1,
          label: path.basename(outputPath),
          ...(realSize != null ? { sizeBytes: realSize } : {}),
        })
      })

    })
    return id
  })

  handleStart('tasks:startVideoUpscale', async (_e, req) => {
    assertAbsolutePath(req.inputPath, 'inputPath')
    if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
    assertOneOf(req.model, UPSCALE_MODELS, 'model')
    assertOneOf(req.scale, [2, 3, 4], 'scale')
    const id = crypto.randomUUID()
    const destDir = req.destination || defaultDownloadDir()
    fs.mkdirSync(destDir, { recursive: true })

    // Frames are re-encoded with libx264/aac, which only fits an MP4 container — a .webm/.avi
    // input name would produce a mismatched file.
    const ext = 'mp4'
    const inputBase = path.basename(req.inputPath, path.extname(req.inputPath))
    const outputPath = uniqueOutputPath(destDir, `${inputBase}-${req.scale}x`, ext)

    addTask(id, {
      state: {
        id,
        kind: 'upscale',
        status: 'queued',
        progress: 0,
        label: path.basename(req.inputPath),
        format: req.model,
        quality: `${req.scale}×`,
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
      },
      child: null,
      finalPath: outputPath,
    })
    broadcastTasks()

    // Return the id right away so the UI can show the job immediately; the pipeline runs on.
    runVideoUpscale(id, req, outputPath).catch((err) =>
      updateTask(id, { status: 'error', error: `Video upscale failed: ${err.message}` }),
    )
    return id
  })

  const runVideoUpscale = (id, req, outputPath) => runInPool(gpuPool, id, () => videoUpscaleJob(id, req, outputPath))

  /* --- Chunked frame pipelines (video upscale, frame interpolation) ---
   * Extracting every frame of a long video to PNG at once needs tens of GB of temp disk. Instead the
   * source video is split (stream copy, keyframe-aligned, so nothing is re-encoded or lost) into
   * segments of a few GB worth of frames; each segment is extracted -> processed on the GPU ->
   * encoded to its own small file -> its PNGs deleted, and the encoded segments are joined at the end
   * together with the original audio. Peak temp use is one segment, not the whole video. */
  const CHUNK_BUDGET_BYTES = 2.5e9

  /** Frames per segment such that one segment's PNGs (input + output) stay around CHUNK_BUDGET_BYTES.
   *  OPNDUCK_CHUNK_FRAMES forces a size (tests). */
  function framesPerChunk(meta, outFactor, isScale) {
    const forced = Number(process.env.OPNDUCK_CHUNK_FRAMES)
    if (Number.isInteger(forced) && forced >= 2) return forced
    const px = (meta.width || 1920) * (meta.height || 1080)
    const outBytes = px * 1.5 * (isScale ? outFactor * outFactor : outFactor) // PNG ~1.5 bytes/px
    return Math.max(24, Math.floor(CHUNK_BUDGET_BYTES / (px * 1.5 + outBytes)))
  }

  /**
   * Runs the extract -> GPU tool -> encode loop over keyframe segments.
   * cfg: { tempPrefix, tool, threadsKind, failLabel, outFactor, isScale, gpuArgs(inDir, outDir, framesIn, hasNext),
   *        overlap }  — `overlap` (interpolation) feeds each segment the first frame of the next one so the
   * boundary gets its in-between frames; the extra output frame is dropped.
   */
  async function chunkedFrameJob(id, req, outputPath, cfg) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), cfg.tempPrefix))
    const segDir = path.join(tempDir, 'segments')
    const doneDir = path.join(tempDir, 'encoded')
    const framesDir = path.join(tempDir, 'frames')
    const outDir = path.join(tempDir, 'processed')
    for (const d of [segDir, doneDir, framesDir, outDir]) fs.mkdirSync(d, { recursive: true })
    const cleanup = () => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true })
      } catch {
        /* best-effort — a leftover temp dir isn't worth failing the task over */
      }
    }
    const fail = (message) => {
      if (!isCanceled(id)) updateTask(id, { status: 'error', error: message })
      cleanup()
    }
    const emptyDir = (dir) => {
      for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true })
    }

    const meta = await probeVideoMeta(req.inputPath)
    if (isCanceled(id)) return cleanup()
    if (!meta) {
      updateTask(id, { status: 'error', error: "Couldn't read this video's frame rate/frame count." })
      return cleanup()
    }
    const entry = tasks.get(id)
    updateTask(id, { status: 'running' })
    if (isCanceled(id)) return cleanup()

    const chunkFrames = framesPerChunk(meta, cfg.outFactor, cfg.isScale)
    const total = meta.frameCount
    let framesDone = 0
    const setProgress = (extra) => updateTask(id, { progress: Math.min(0.97, (framesDone + extra) / total) })

    // 1. Split (stream copy, video only).
    jobLog(id, `Splitting the video into chunks of about ${chunkFrames} frames (no re-encode)…`)
    try {
      await spawnTracked(
        'ffmpeg',
        ['-y', '-i', req.inputPath, '-map', '0:v:0', '-c', 'copy', '-f', 'segment', '-segment_time', String(Math.max(1, chunkFrames / meta.fps)),
          '-reset_timestamps', '1', path.join(segDir, 'seg%05d.mkv')],
        entry,
      )
    } catch (err) {
      return fail(`Splitting the video failed: ${err.message}`)
    }
    if (isCanceled(id)) return cleanup()
    const segments = listSorted(segDir).map((f) => path.join(segDir, f))
    if (!segments.length) return fail('Splitting the video produced nothing.')

    // 2. Per segment: extract -> process -> encode.
    const gpuState = { low: false }
    const outFps = `${meta.fpsNum * cfg.outFactorFps}/${meta.fpsDen}`
    const encodedParts = []
    for (let k = 0; k < segments.length; k++) {
      const hasNext = cfg.overlap && k < segments.length - 1
      jobLog(id, `Chunk ${k + 1} of ${segments.length}: extracting frames`)
      try {
        await spawnTracked('ffmpeg', ['-y', '-i', segments[k], '-fps_mode', 'passthrough', path.join(framesDir, '%08d.png')], entry)
      } catch (err) {
        return fail(`Frame extraction failed: ${err.message}`)
      }
      if (isCanceled(id)) return cleanup()
      const framesIn = fs.readdirSync(framesDir).length
      if (framesIn === 0) return fail('A video segment had no frames.')
      setProgress(framesIn * 0.1)
      if (hasNext) {
        // The next segment's first frame completes the last frame pair of this one.
        try {
          await spawnTracked(
            'ffmpeg',
            ['-y', '-i', segments[k + 1], '-fps_mode', 'passthrough', '-frames:v', '1', '-start_number', String(framesIn + 1), path.join(framesDir, '%08d.png')],
            entry,
          )
        } catch (err) {
          return fail(`Frame extraction failed: ${err.message}`)
        }
        if (isCanceled(id)) return cleanup()
      }

      let doneCount = 0
      jobLog(id, `Chunk ${k + 1} of ${segments.length}: ${cfg.failLabel.toLowerCase()} ${framesIn} frames on the GPU`)
      try {
        await spawnGpuTool(
          id,
          cfg.tool,
          cfg.gpuArgs(framesDir, outDir, framesIn, hasNext),
          cfg.threadsKind,
          entry,
          {
            onStderr: (text) => {
              // " done" lines mark whole-frame completion (the per-tile percentages restart every frame).
              const matches = text.match(/ done\r?\n/g)
              if (matches) {
                doneCount += matches.length
                setProgress(framesIn * (0.1 + 0.8 * Math.min(1, doneCount / (framesIn * (cfg.isScale ? 1 : cfg.outFactor)))))
              }
            },
          },
          () => doneCount,
          gpuState,
        )
      } catch (err) {
        return fail(`${cfg.failLabel} failed: ${err.message}`)
      }
      if (isCanceled(id)) return cleanup()

      // With overlap the last output is the next segment's first frame: it belongs to that segment.
      if (hasNext) {
        const outs = listSorted(outDir)
        fs.rmSync(path.join(outDir, outs[outs.length - 1]), { force: true })
      }
      jobLog(id, `Chunk ${k + 1} of ${segments.length}: encoding`)
      const part = path.join(doneDir, `part${String(k).padStart(5, '0')}.mkv`)
      const encodeWith = (codec) =>
        spawnTracked(
          'ffmpeg',
          ['-y', '-framerate', outFps, '-i', path.join(outDir, '%08d.png'), ...(codec === 'libx264' ? ['-c:v', 'libx264'] : ['-c:v', codec, '-preset', 'p5', '-cq', codec === 'hevc_nvenc' ? '30' : '28', '-b:v', '0']), '-pix_fmt', 'yuv420p', part],
          entry,
        )
      try {
        // GPU (NVENC) encoding of each chunk is several times faster than x264 and falls back to it on any failure.
        const codec = await pickVideoEncoder(Number(meta.width) * cfg.outFactorWidth)
        try {
          await encodeWith(codec)
        } catch (err) {
          if (codec === 'libx264' || isCanceled(id)) throw err
          jobLog(id, `${codec} failed (${err.message}); encoding this chunk on the CPU`)
          await encodeWith('libx264')
        }
      } catch (err) {
        return fail(`Reassembly failed: ${err.message}`)
      }
      if (isCanceled(id)) return cleanup()
      encodedParts.push(part)
      emptyDir(framesDir)
      emptyDir(outDir)
      fs.rmSync(segments[k], { force: true })
      framesDone += framesIn
      setProgress(0)
    }

    // 3. Join the parts and mux the original audio back in.
    jobLog(id, 'Joining the chunks and adding the original audio…')
    const listFile = path.join(tempDir, 'parts.txt')
    fs.writeFileSync(listFile, encodedParts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n')
    try {
      await spawnTracked(
        'ffmpeg',
        ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-i', req.inputPath, '-map', '0:v', '-map', '1:a?', '-c:v', 'copy', '-c:a', 'aac', '-shortest',
          '-progress', 'pipe:1', '-nostats', outputPath],
        entry,
      )
    } catch (err) {
      return fail(`Reassembly failed: ${err.message}`)
    }
    cleanup()

    let realSize = null
    try {
      realSize = fs.statSync(outputPath).size
    } catch {
      /* keep null if the output can't be read */
    }
    updateTask(id, { status: 'done', progress: 1, label: path.basename(outputPath), ...(realSize != null ? { sizeBytes: realSize } : {}) })
  }

  /* --- PyTorch upscale engine: frames stream ffmpeg -> GPU -> ffmpeg through pipes, no PNG files ---
   * Used for video upscaling when OPNduck's Python environment has CUDA PyTorch (Settings can force ncnn).
   * Measured on an RTX 3080 end to end: ~1.4-1.8x faster than the ncnn path at 2x and 2.3-3.6x at 4x,
   * with no temp disk use. Any failure falls back to the ncnn path automatically. */
  const TORCH_SCRIPT = platform.scriptPath('torch_upscale.py')

  const TORCH_MODELS = {
    'realesr-animevideov3': {
      file: 'realesr-animevideov3.pth',
      url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-animevideov3.pth',
      sha256: 'b8a8376811077954d82ca3fcf476f1ac3da3e8a68a4f4d71363008000a18b75d',
    },
    'realesrgan-x4plus': {
      file: 'RealESRGAN_x4plus.pth',
      url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth',
      sha256: '4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1',
    },
    'realesrgan-x4plus-anime': {
      file: 'RealESRGAN_x4plus_anime_6B.pth',
      url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth',
      sha256: 'f872d837d3c90ed2e05227bed711af5671a6fd1c9f7d7e91c911a61f155e99da',
    },
  }

  const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

  /** The model weights file, downloaded once (checksum-pinned official release) into userData/models. */
  async function ensureWeights(id, model) {
    const spec = TORCH_MODELS[model]
    const dir = path.join(platform.paths.userData, 'models')
    const file = path.join(dir, spec.file)
    try {
      if (fs.existsSync(file) && sha256File(file) === spec.sha256) return file
    } catch {
      /* re-download below */
    }
    jobLog(id, `Downloading the ${model} model weights (one time)…`)
    fs.mkdirSync(dir, { recursive: true })
    const res = await fetch(spec.url, { signal: AbortSignal.timeout(180_000) })
    if (!res.ok || new URL(res.url).protocol !== 'https:') throw new Error(`Couldn't download the model (${res.status}).`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (crypto.createHash('sha256').update(buf).digest('hex') !== spec.sha256) throw new Error('The downloaded model failed its checksum, so it was discarded.')
    const tmp = `${file}.download`
    fs.writeFileSync(tmp, buf)
    fs.renameSync(tmp, file)
    return file
  }

  function torchEngineReady() {
    if (getSettings().upscaleEngine === 'ncnn') return Promise.resolve(false)
    return cachedEngineCheck('torch', demucsPython(), 'import sys, torch, numpy; sys.exit(0 if torch.cuda.is_available() else 3)')
  }

  const encoderWorks = new Map()

  /** Whether this ffmpeg can really encode with a hardware encoder (a one-frame test, cached). */
  function hwEncoderWorks(name) {
    if (!encoderWorks.has(name)) {
      encoderWorks.set(
        name,
        new Promise((resolve) => {
          let child
          try {
            child = spawn('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'nullsrc=s=256x256', '-frames:v', '1', '-c:v', name, '-f', 'null', '-'])
          } catch {
            resolve(false)
            return
          }
          child.on('error', () => resolve(false))
          child.on('close', (code) => resolve(code === 0))
        }),
      )
    }
    return encoderWorks.get(name)
  }

  /** x264 on the CPU, or NVENC when it works and the output fits (h264 up to 4096 px wide, else HEVC). */
  async function pickVideoEncoder(outWidth) {
    if (getSettings().videoEncoder === 'cpu') return 'libx264'
    if (process.platform === 'darwin') {
      // No NVENC on a Mac: the media engine of Apple's chips is VideoToolbox.
      if (outWidth <= 4096 && (await hwEncoderWorks('h264_videotoolbox'))) return 'h264_videotoolbox'
      if (outWidth <= 8192 && (await hwEncoderWorks('hevc_videotoolbox'))) return 'hevc_videotoolbox'
      return 'libx264'
    }
    if (outWidth <= 4096 && (await hwEncoderWorks('h264_nvenc'))) return 'h264_nvenc'
    if (outWidth <= 8192 && (await hwEncoderWorks('hevc_nvenc'))) return 'hevc_nvenc'
    return 'libx264'
  }

  /** Returns 'done', 'canceled', or 'failed' (the caller then falls back to ncnn). */
  async function torchUpscaleJob(id, req, outputPath) {
    const entry = tasks.get(id)
    const meta = await probeVideoMeta(req.inputPath)
    if (isCanceled(id)) return 'canceled'
    if (!meta?.width || !meta.fpsNum) return 'failed'
    let script, weights
    try {
      script = fs.readFileSync(TORCH_SCRIPT, 'utf8')
      weights = await ensureWeights(id, req.model)
    } catch (err) {
      jobLog(id, `PyTorch engine unavailable: ${err.message}`)
      return 'failed'
    }
    if (isCanceled(id)) return 'canceled'
    // Resident AI workers can hold GPU memory; free it for the upscaler.
    demucsWorker.stop()
    whisperWorker.stop()
    updateTask(id, { status: 'running' })

    const outW = meta.width * req.scale
    let encoder = await pickVideoEncoder(outW)
    const dropOutput = () => fs.rmSync(outputPath, { force: true })
    for (let attempt = 0; attempt < 2; attempt++) {
      jobLog(id, `PyTorch engine: ${req.model} ×${req.scale}, ${encoder} encoder`)
      const job = { input: req.inputPath, output: outputPath, width: meta.width, height: meta.height, fps: `${meta.fpsNum}/${meta.fpsDen}`, frames: meta.frameCount, scale: req.scale, model: req.model, weights, encoder }
      entry.killGroup = true // on Windows, cancelling must also end the two ffmpegs the script starts
      try {
        await spawnTracked(demucsPython(), ['-c', script, '--job', JSON.stringify(job)], entry, {
          cwd: pythonCwd(),
          onStdout: (text) => {
            const m = [...text.matchAll(/PROGRESS ([\d.]+)/g)].pop()
            if (m) updateTask(id, { progress: Math.min(0.99, Number(m[1])) })
          },
        })
        let realSize = null
        try {
          realSize = fs.statSync(outputPath).size
        } catch {
          /* keep null */
        }
        updateTask(id, { status: 'done', progress: 1, label: path.basename(outputPath), ...(realSize != null ? { sizeBytes: realSize } : {}) })
        return 'done'
      } catch (err) {
        dropOutput() // a cancelled or failed run can leave a partial file
        if (isCanceled(id)) return 'canceled'
        jobLog(id, `PyTorch engine failed: ${err.message}`)
        if (encoder !== 'libx264' && attempt === 0) {
          encoder = 'libx264' // the GPU encoder can fail on drivers/ffmpeg builds that list it; retry on the CPU
          continue
        }
        return 'failed'
      }
    }
    return 'failed'
  }

  const ncnnVideoUpscaleJob = (id, req, outputPath) =>
    chunkedFrameJob(id, req, outputPath, {
      tempPrefix: 'opnduck-upscale-',
      tool: 'realesrgan-ncnn-vulkan',
      threadsKind: 'upscale',
      failLabel: 'Upscaling',
      outFactor: req.scale,
      outFactorFps: 1,
      outFactorWidth: req.scale, // output width = source width x this (picks the encoder)
      isScale: true,
      overlap: false,
      gpuArgs: (inDir, outDir) => ['-i', inDir, '-o', outDir, '-s', String(req.scale), '-n', req.model, '-v'],
    })

  const videoUpscaleJob = async (id, req, outputPath) => {
    if (await torchEngineReady()) {
      const result = await torchUpscaleJob(id, req, outputPath)
      if (result !== 'failed') return
      jobLog(id, 'Falling back to the ncnn engine…')
    }
    return ncnnVideoUpscaleJob(id, req, outputPath)
  }

  const interpolateJob = (id, req, outputPath) =>
    chunkedFrameJob(id, req, outputPath, {
      tempPrefix: 'opnduck-interpolate-',
      tool: 'rife-ncnn-vulkan',
      threadsKind: 'interpolate',
      failLabel: 'Interpolation',
      outFactor: req.multiplier,
      outFactorFps: req.multiplier,
      outFactorWidth: 1,
      isScale: false,
      overlap: true,
      // rife-v4.6: the tool's default model (rife-HD) can't make a custom frame count (-n), v4 models can.
      // With the next segment's first frame appended the output spans framesIn+1 inputs, so N*mult+1 frames
      // keep the spacing at 1/mult (the extra last one is dropped); the final segment has no neighbour.
      gpuArgs: (inDir, outDir, framesIn, hasNext) => [
        '-i', inDir, '-o', outDir, '-n', String(framesIn * req.multiplier + (hasNext ? 1 : 0)), '-m', 'rife-v4.6', '-v',
      ],
    })

  /**
   * Frame interpolation: the same three phases as video upscaling, with rife-ncnn-vulkan adding
   * in-between frames and ffmpeg reassembling at multiplier×fps. Duration is unchanged.
   */
  // @category: interpolate/frame-interpolation-pipeline
  handleStart('tasks:startInterpolate', async (_e, req) => {
    assertAbsolutePath(req.inputPath, 'inputPath')
    if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
    assertOneOf(req.multiplier, [2, 4], 'multiplier')
    const id = crypto.randomUUID()
    const destDir = req.destination || defaultDownloadDir()
    fs.mkdirSync(destDir, { recursive: true })

    // Frames are re-encoded with libx264/aac, which only fits an MP4 container — a .webm/.avi
    // input name would produce a mismatched file.
    const ext = 'mp4'
    const inputBase = path.basename(req.inputPath, path.extname(req.inputPath))
    const outputPath = uniqueOutputPath(destDir, `${inputBase}-${req.multiplier}x-frames`, ext)

    addTask(id, {
      state: {
        id,
        kind: 'interpolate',
        status: 'queued',
        progress: 0,
        label: path.basename(req.inputPath),
        format: 'RIFE',
        quality: `${req.multiplier}× frames`,
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
      },
      child: null,
      finalPath: outputPath,
    })
    broadcastTasks()

    // Return the id right away so the UI can show the job immediately; the pipeline runs on.
    runInterpolate(id, req, outputPath).catch((err) =>
      updateTask(id, { status: 'error', error: `Interpolation failed: ${err.message}` }),
    )
    return id
  })

  const runInterpolate = (id, req, outputPath) => runInPool(gpuPool, id, () => interpolateJob(id, req, outputPath))

  return { UPSCALE_MODELS, GPU_THREADS, gpuThreadArg, spawnGpuTool, upscaleArgs, runVideoUpscale, CHUNK_BUDGET_BYTES, framesPerChunk, chunkedFrameJob, TORCH_SCRIPT, TORCH_MODELS, sha256File, ensureWeights, torchEngineReady, encoderWorks, hwEncoderWorks, pickVideoEncoder, torchUpscaleJob, ncnnVideoUpscaleJob, videoUpscaleJob, interpolateJob, runInterpolate }
}

module.exports = { createGpuJobs }
