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
 * The converter: the format table, ffmpeg and LibreOffice conversions, and the tasks:startConvert job.
 * No Electron: everything it needs comes in through `ctx` (see core/*.cjs).
 */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const { spawn } = require('node:child_process')

function createConvert(ctx) {
  const {
    sofficeCommand, attachLog, updateTask, tasks, handleStart, assertAbsolutePath, defaultDownloadDir, uniqueOutputPath, addTask, broadcastTasks, runInPool, convertPool, probeDuration, isCanceled,
  } = ctx

  /* --- Task orchestration (ffmpeg conversions) --- */
  // @category: converter/task-orchestration-main-process
  const SCALE_ICO = "scale='min(256,iw)':'min(256,ih)':force_original_aspect_ratio=decrease"

  /** Per-format output extension, kind and fixed ffmpeg encode args — no separate codec
   *  pickers. Video formats map every stream; audio drops video (-vn) and keeps the
   *  first audio track; image formats write a single frame. */
  const FORMATS = {
    MP4: { ext: 'mp4', kind: 'video', args: ['-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart'] }, // faststart: plays while it loads and in picky phone galleries
    MKV: { ext: 'mkv', kind: 'video', args: ['-c:v', 'libx264', '-c:a', 'aac'] },
    MOV: { ext: 'mov', kind: 'video', args: ['-c:v', 'libx264', '-c:a', 'aac'] },
    WEBM: { ext: 'webm', kind: 'video', args: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-c:a', 'libopus'] },
    AVI: { ext: 'avi', kind: 'video', args: ['-c:v', 'mpeg4', '-q:v', '3', '-c:a', 'libmp3lame'] },
    GIF: { ext: 'gif', kind: 'gif', args: ['-vf', 'fps=12,scale=480:-1:flags=lanczos', '-loop', '0'] },
    MP3: { ext: 'mp3', kind: 'audio', args: ['-c:a', 'libmp3lame', '-q:a', '0'] },
    FLAC: { ext: 'flac', kind: 'audio', args: ['-c:a', 'flac'] },
    WAV: { ext: 'wav', kind: 'audio', args: ['-c:a', 'pcm_s16le'] },
    OGG: { ext: 'ogg', kind: 'audio', args: ['-c:a', 'libvorbis', '-q:a', '6'] },
    M4A: { ext: 'm4a', kind: 'audio', args: ['-c:a', 'aac', '-b:a', '256k'] },
    OPUS: { ext: 'opus', kind: 'audio', args: ['-c:a', 'libopus', '-b:a', '160k'] },
    // Documents go through LibreOffice: `filter` is the --convert-to filter spec.
    PDF: { ext: 'pdf', kind: 'doc', filter: 'pdf' },
    DOCX: { ext: 'docx', kind: 'doc', filter: 'docx' },
    ODT: { ext: 'odt', kind: 'doc', filter: 'odt' },
    RTF: { ext: 'rtf', kind: 'doc', filter: 'rtf' },
    TXT: { ext: 'txt', kind: 'doc', filter: 'txt:Text (encoded):UTF8' },
    HTML: { ext: 'html', kind: 'doc', filter: 'html' },
    PNG: { ext: 'png', kind: 'image', args: [] },
    JPG: { ext: 'jpg', kind: 'image', args: ['-q:v', '2'] },
    WEBP: { ext: 'webp', kind: 'image', args: ['-c:v', 'libwebp', '-q:v', '90'] },
    AVIF: { ext: 'avif', kind: 'image', args: ['-c:v', 'libaom-av1', '-still-picture', '1', '-crf', '28'] },
    BMP: { ext: 'bmp', kind: 'image', args: [] },
    TIFF: { ext: 'tiff', kind: 'image', args: [] },
    ICO: { ext: 'ico', kind: 'image', args: ['-vf', SCALE_ICO] },
  }

  /** -progress pipe:1 -nostats makes ffmpeg emit clean `key=value` lines on stdout instead
   *  of the human-readable stats line on stderr, which is far more fragile to parse.
   *  Remux (stream copy) only applies to video containers; everything else re-encodes. */
  function convertArgs(req, outputPath) {
    const fmt = FORMATS[req.container]
    const tail = ['-progress', 'pipe:1', '-nostats', outputPath]
    const base = ['-y', '-i', req.inputPath]
    switch (fmt.kind) {
      case 'video':
        return req.mode === 'remux'
          ? [...base, '-map', '0', '-c', 'copy', ...tail]
          : [...base, '-map', '0:v?', '-map', '0:a?', ...fmt.args, ...tail]
      case 'gif':
        return [...base, '-map', '0:v:0', ...fmt.args, ...tail]
      case 'audio':
        return [...base, '-vn', '-map', '0:a:0', ...fmt.args, ...tail]
      default:
        return [...base, '-frames:v', '1', '-update', '1', ...fmt.args, ...tail]
    }
  }

  /** Document conversion via headless LibreOffice. It names its own output (<input
   *  basename>.<ext>) and shares a profile lock across instances, so each job gets its
   *  own throwaway profile + output dir and the result is moved to the final path. */
  function runDocConvert(id, req, fmt, outputPath) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-doc-'))
    const cleanup = () => fs.rmSync(work, { recursive: true, force: true })
    const profile = pathToFileURL(path.join(work, 'profile')).href
    let child
    try {
      child = spawn(sofficeCommand(), [
        `-env:UserInstallation=${profile}`,
        '--headless',
        '--convert-to',
        fmt.filter,
        '--outdir',
        work,
        req.inputPath,
      ], { detached: process.platform !== 'win32' })
      attachLog(child, id)
    } catch (err) {
      cleanup()
      updateTask(id, { status: 'error', error: `Failed to start LibreOffice: ${err.message}` })
      return id
    }
    const entry = tasks.get(id)
    entry.child = child
    entry.killGroup = true
    updateTask(id, { status: 'running', progress: 0.1 })

    let output = ''
    child.stdout.on('data', (c) => (output = (output + c).slice(-2000)))
    child.stderr.on('data', (c) => (output = (output + c).slice(-2000)))
    child.on('error', (err) => {
      cleanup()
      updateTask(id, { status: 'error', error: `LibreOffice (soffice) not found on PATH (${err.message})` })
    })
    child.on('close', (code, signal) => {
      if (!tasks.has(id) || entry.state.status === 'canceled' || entry.state.status === 'error') return cleanup()
      const produced = path.join(work, `${path.basename(req.inputPath, path.extname(req.inputPath))}.${fmt.ext}`)
      if (signal || code !== 0 || !fs.existsSync(produced)) {
        cleanup()
        updateTask(id, {
          status: 'error',
          error: output.trim().split('\n').pop() || `LibreOffice exited with code ${code}`,
        })
        return
      }
      let realSize = null
      try {
        fs.copyFileSync(produced, outputPath)
        realSize = fs.statSync(outputPath).size
      } catch (err) {
        cleanup()
        updateTask(id, { status: 'error', error: `Couldn't write ${path.basename(outputPath)}: ${err.message}` })
        return
      }
      cleanup()
      updateTask(id, {
        status: 'done',
        progress: 1,
        label: path.basename(outputPath),
        ...(realSize != null ? { sizeBytes: realSize, sizeIsEstimate: false } : {}),
      })
    })
    return id
  }

  handleStart('tasks:startConvert', async (_e, req) => {
    assertAbsolutePath(req.inputPath, 'inputPath')
    if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
    const id = crypto.randomUUID()
    const destDir = req.destination || defaultDownloadDir()
    fs.mkdirSync(destDir, { recursive: true })

    const fmt = Object.hasOwn(FORMATS, req.container) ? FORMATS[req.container] : null
    if (!fmt) throw new Error(`Unsupported format: ${req.container}`)
    const ext = fmt.ext
    // Remux only makes sense for video containers; other targets always re-encode.
    if (fmt.kind !== 'video') req.mode = 'transcode'
    const inputBase = path.basename(req.inputPath, path.extname(req.inputPath))
    const outputPath = uniqueOutputPath(destDir, inputBase, ext)

    addTask(id, {
      state: {
        id,
        kind: 'convert',
        status: 'queued',
        progress: 0,
        label: path.basename(req.inputPath),
        format: req.container,
        quality: req.mode === 'remux' ? 'Remux' : 'Transcode',
        sizeBytes: null,
        sizeIsEstimate: true,
        thumbnailUrl: null,
      },
      child: null,
      finalPath: outputPath,
    })
    broadcastTasks()

    // Return right away so every job shows up as 'queued'; the work itself waits for a slot.
    runConvert(id, req, fmt, outputPath).catch((err) =>
      updateTask(id, { status: 'error', error: `Conversion failed to start: ${err.message}` }),
    )
    return id
  })

  async function runConvert(id, req, fmt, outputPath) {
    await runInPool(convertPool, id, () => convertJob(id, req, fmt, outputPath))
  }

  async function convertJob(id, req, fmt, outputPath) {
    if (fmt.kind === 'doc') {
      runDocConvert(id, req, fmt, outputPath)
      return
    }

    const duration = await probeDuration(req.inputPath)
    if (isCanceled(id)) return // canceled while the duration probe was running

    let child
    try {
      child = spawn('ffmpeg', convertArgs(req, outputPath))
      attachLog(child, id)
    } catch (err) {
      updateTask(id, { status: 'error', error: `Failed to start ffmpeg: ${err.message}` })
      return
    }

    const entry = tasks.get(id)
    entry.child = child
    updateTask(id, { status: 'running' })

    let stderrTail = ''
    let stdoutBuf = ''
    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString()
      const lines = stdoutBuf.split('\n')
      stdoutBuf = lines.pop() ?? ''
      for (const line of lines) {
        const match = line.match(/^out_time_ms=(\d+)/)
        if (match && duration) {
          updateTask(id, { progress: Math.min(1, Number(match[1]) / 1e6 / duration) })
        }
      }
    })
    child.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000)
    })
    child.on('error', (err) => {
      updateTask(id, { status: 'error', error: `ffmpeg not found on PATH (${err.message})` })
    })
    child.on('close', (code, signal) => {
      if (!tasks.has(id)) return
      // A spawn failure (ENOENT) fires 'error' and then 'close'(-2); keep the clearer 'error' message.
      if (entry.state.status === 'canceled' || entry.state.status === 'error') return
      if (signal || code !== 0) {
        updateTask(id, {
          status: 'error',
          error: stderrTail.trim().split('\n').pop() || `ffmpeg exited with code ${code}`,
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
        ...(realSize != null ? { sizeBytes: realSize, sizeIsEstimate: false } : {}),
      })
    })

    return
  }

  return { SCALE_ICO, FORMATS, convertArgs, runDocConvert, runConvert, convertJob }
}

module.exports = { createConvert }
