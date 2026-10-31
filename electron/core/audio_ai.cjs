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
 * AI Audio: vocal and stem separation with Demucs, plus voice isolation and echo clean-up.
 * No Electron: everything it needs comes in through `ctx` (see core/*.cjs).
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

function createAudioAi(ctx) {
  const {
    createModelWorker, demucsPython, handleStart, assertAbsolutePath, defaultDownloadDir, uniqueOutputPath, addTask, broadcastTasks, runInPool, gpuPool, convertPool, updateTask, tasks, isCanceled, probeVideoCodec, spawnTracked, platform,
  } = ctx

  /**
   * AI audio tools: Demucs splits a track into vocals / everything else, ffmpeg does the rest.
   *   no-vocals  → the instrumental (karaoke)         vocals → the isolated voice / acapella
   *   voice      → vocals + cleanup for clear speech  echo   → basic ffmpeg echo/noise reduction
   * "Remove background music" from speech is the `vocals` mode. The echo mode is deliberately
   * ffmpeg-only and basic: real dereverberation needs a different model than Demucs.
   * Pipeline: ffmpeg → 44.1 kHz stereo WAV → Demucs (python, GPU if available) → ffmpeg → output.
   */
  // @category: audio-ai/demucs-stem-separation
  const AUDIO_AI_MODES = {
    'no-vocals': { demucs: true, stem: 'no_vocals', suffix: 'instrumental', label: 'Remove vocals' },
    vocals: { demucs: true, stem: 'vocals', suffix: 'vocals', label: 'Extract vocals' },
    voice: {
      demucs: true,
      stem: 'vocals',
      suffix: 'voice',
      label: 'Isolate voice',
      filter: 'highpass=f=80,afftdn=nf=-28,loudnorm=I=-16:TP=-1.5:LRA=11',
    },
    echo: {
      demucs: false,
      suffix: 'cleaned',
      label: 'Reduce echo & noise',
      filter: 'highpass=f=100,afftdn=nr=18:nf=-35,agate=threshold=0.015:ratio=2:attack=10:release=300',
    },
  }

  const AUDIO_AI_FORMATS = {
    MP3: { ext: 'mp3', args: ['-c:a', 'libmp3lame', '-q:a', '0'] },
    FLAC: { ext: 'flac', args: ['-c:a', 'flac'] },
    WAV: { ext: 'wav', args: ['-c:a', 'pcm_s16le'] },
  }

  const VIDEO_INPUT_EXT = new Set(['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'm4v', 'wmv', 'ts', 'mpg', 'mpeg', '3gp'])

  const DEMUCS_SCRIPT = platform.scriptPath('demucs_separate.py')

  const demucsWorker = createModelWorker({ python: () => demucsPython(), scriptPath: DEMUCS_SCRIPT })

  handleStart('tasks:startAudioAi', (_e, req) => {
    assertAbsolutePath(req.inputPath, 'inputPath')
    if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
    if (!Object.hasOwn(AUDIO_AI_MODES, req.mode)) throw new Error(`Invalid mode: ${req.mode}`)
    if (!Object.hasOwn(AUDIO_AI_FORMATS, req.format)) throw new Error(`Invalid format: ${req.format}`)
    const mode = AUDIO_AI_MODES[req.mode]
    const fmt = AUDIO_AI_FORMATS[req.format]
    const isVideo = VIDEO_INPUT_EXT.has(path.extname(req.inputPath).slice(1).toLowerCase())
    const keepVideo = !!req.keepVideo && isVideo // put the processed audio back on the original picture

    const id = crypto.randomUUID()
    const destDir = req.destination || defaultDownloadDir()
    fs.mkdirSync(destDir, { recursive: true })
    const inputBase = path.basename(req.inputPath, path.extname(req.inputPath))
    const outputPath = uniqueOutputPath(destDir, `${inputBase} (${mode.suffix})`, keepVideo ? 'mp4' : fmt.ext)

    addTask(id, {
      state: {
        id,
        kind: 'audio-ai',
        status: 'queued',
        progress: 0,
        label: path.basename(req.inputPath),
        format: keepVideo ? 'MP4' : req.format,
        quality: mode.label,
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
      },
      child: null,
      finalPath: outputPath,
    })
    broadcastTasks()

    // Demucs competes for the GPU with the upscalers; the ffmpeg-only mode is light.
    runInPool(mode.demucs ? gpuPool : convertPool, id, () => audioAiJob(id, req, mode, fmt, keepVideo, outputPath)).catch((err) =>
      updateTask(id, { status: 'error', error: `Audio job failed to start: ${err.message}` }),
    )
    return id
  })

  const MP4_SAFE_VIDEO = new Set(['h264', 'hevc', 'av1', 'vp9', 'mpeg4', 'mpeg2video', 'mjpeg'])

  async function audioAiJob(id, req, mode, fmt, keepVideo, outputPath) {
    const entry = tasks.get(id)
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-audioai-'))
    const stemsDir = path.join(tempDir, 'stems')
    fs.mkdirSync(stemsDir)
    const inWav = path.join(tempDir, 'in.wav')
    const cleanup = () => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true })
      } catch {
        /* best-effort — a leftover temp dir isn't worth failing the task over */
      }
    }
    const fail = (label, err) => {
      if (!isCanceled(id)) updateTask(id, { status: 'error', error: `${label}: ${err.message}` })
      cleanup()
    }

    updateTask(id, { status: 'running', progress: 0.02 })

    // "Keep the video" is decided up front, not after the whole (slow) separation has run: the file
    // may have no real video stream, or a codec MP4 can't hold (then it's re-encoded instead of copied).
    let reencodeVideo = false
    if (keepVideo) {
      const codec = await probeVideoCodec(req.inputPath)
      if (!codec) {
        keepVideo = false
        const dir = path.dirname(outputPath)
        fs.rmSync(outputPath, { force: true }) // release the .mp4 name reserved when the job was queued
        outputPath = uniqueOutputPath(dir, path.basename(outputPath, '.mp4'), fmt.ext)
        entry.finalPath = outputPath
        updateTask(id, { format: req.format })
      } else if (!MP4_SAFE_VIDEO.has(codec)) {
        reencodeVideo = true
      }
    }
    try {
      // Demucs wants stereo 44.1 kHz; ffmpeg normalises whatever the source is (and drops any video).
      await spawnTracked('ffmpeg', ['-y', '-i', req.inputPath, '-map', '0:a:0', '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', inWav], entry)
    } catch (err) {
      return fail('Reading the audio failed', err)
    }
    if (isCanceled(id)) return cleanup()
    updateTask(id, { progress: 0.08 })

    let source = inWav
    if (mode.demucs) {
      try {
        // The worker keeps htdemucs loaded between files (see createModelWorker).
        await demucsWorker.run({ src: inWav, out: stemsDir }, entry, {
          onStderr: (text) => {
            // Demucs' tqdm bar: "  45%|████▌     | ...". Separation is ~85% of the work.
            const m = [...text.matchAll(/(\d{1,3})%\|/g)].pop()
            if (m) updateTask(id, { progress: Math.min(0.92, 0.08 + 0.84 * (Number(m[1]) / 100)) })
          },
        })
      } catch (err) {
        return fail('Separation failed', err)
      }
      if (isCanceled(id)) return cleanup()
      source = path.join(stemsDir, `${mode.stem}.wav`)
      if (!fs.existsSync(source)) return fail('Separation failed', new Error('Demucs produced no output'))
    }
    updateTask(id, { progress: 0.94 })

    const filter = mode.filter ? ['-af', mode.filter] : []
    const finalArgs = keepVideo
      ? ['-y', '-i', req.inputPath, '-i', source, ...filter, '-map', '0:v:0', '-map', '1:a:0', ...(reencodeVideo ? ['-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p'] : ['-c:v', 'copy']), '-c:a', 'aac', '-b:a', '256k', '-shortest', outputPath]
      : ['-y', '-i', source, ...filter, ...fmt.args, outputPath]
    try {
      await spawnTracked('ffmpeg', finalArgs, entry)
    } catch (err) {
      return fail('Writing the result failed', err)
    }
    cleanup()
    if (isCanceled(id)) return

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
  }

  return { AUDIO_AI_MODES, AUDIO_AI_FORMATS, VIDEO_INPUT_EXT, DEMUCS_SCRIPT, demucsWorker, MP4_SAFE_VIDEO, audioAiJob }
}

module.exports = { createAudioAi }
