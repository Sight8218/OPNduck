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
 * The trimmer: cut a section out of a video or audio file, fast (stream copy) or precise (re-encode).
 * No Electron: everything it needs comes in through `ctx` (see core/*.cjs).
 */
const fs = require('node:fs')
const path = require('node:path')

function createTrim(ctx) {
  const {
    handleStart, assertAbsolutePath, assertOneOf, defaultDownloadDir, uniqueOutputPath, addTask, fmtClock, broadcastTasks, runInPool, convertPool, updateTask, tasks, probeMedia, isCanceled, spawnTracked,
  } = ctx

  handleStart('tasks:startTrim', async (_e, req) => {
    assertAbsolutePath(req.inputPath, 'inputPath')
    if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
    assertOneOf(req.mode, ['fast', 'precise'], 'mode')
    if (!Number.isFinite(req.start) || req.start < 0) throw new Error('Invalid start time')
    if (req.end != null && (!Number.isFinite(req.end) || req.end <= req.start)) throw new Error('The end must be after the start')
    const id = crypto.randomUUID()
    const destDir = req.destination || defaultDownloadDir()
    fs.mkdirSync(destDir, { recursive: true })

    const inExt = path.extname(req.inputPath).replace(/^\./, '').toLowerCase()
    // Stream copy keeps the container; re-encoding needs one that holds H.264/AAC (or a plain audio format).
    const keepExt = req.mode === 'fast' || ['mp4', 'mkv', 'mov', 'mp3', 'flac', 'wav', 'm4a', 'ogg', 'opus'].includes(inExt)
    const ext = keepExt && inExt ? inExt : 'mp4'
    const inputBase = path.basename(req.inputPath, path.extname(req.inputPath))
    const outputPath = uniqueOutputPath(destDir, `${inputBase}-trim`, ext)

    addTask(id, {
      state: {
        id,
        kind: 'trim',
        status: 'queued',
        progress: 0,
        label: path.basename(req.inputPath),
        format: req.mode === 'fast' ? 'Fast cut' : 'Precise',
        quality: `${fmtClock(req.start)} – ${req.end == null ? 'end' : fmtClock(req.end)}`,
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
      },
      child: null,
      finalPath: outputPath,
    })
    broadcastTasks()

    runInPool(convertPool, id, () => trimJob(id, req, outputPath)).catch((err) =>
      updateTask(id, { status: 'error', error: `Trim failed to start: ${err.message}` }),
    )
    return id
  })

  async function trimJob(id, req, outputPath) {
    const entry = tasks.get(id)
    updateTask(id, { status: 'running' })
    const info = await probeMedia(req.inputPath)
    if (isCanceled(id)) return
    if (!info) return updateTask(id, { status: 'error', error: "Couldn't read this file." })
    const end = Math.min(req.end ?? info.duration, info.duration)
    const length = end - req.start
    if (length <= 0) return updateTask(id, { status: 'error', error: 'The start is past the end of the file.' })

    // Fast: seek before the input and copy the streams (instant; the cut snaps to the nearest keyframe).
    // Precise: re-encode so the cut lands on the exact frame.
    const codec =
      req.mode === 'fast'
        ? ['-c', 'copy', '-avoid_negative_ts', 'make_zero']
        : info.hasVideo
          ? ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']
          : []
    const args = ['-y', '-ss', String(req.start), '-i', req.inputPath, '-t', String(length), ...codec, '-progress', 'pipe:1', '-nostats', outputPath]
    try {
      await spawnTracked('ffmpeg', args, entry, {
        onStdout: (text) => {
          const m = [...text.matchAll(/out_time_ms=(\d+)/g)].pop()
          if (m) updateTask(id, { progress: Math.min(0.99, Number(m[1]) / 1e6 / length) })
        },
      })
    } catch (err) {
      fs.rmSync(outputPath, { force: true })
      if (!isCanceled(id)) updateTask(id, { status: 'error', error: `Trim failed: ${err.message}` })
      return
    }
    let realSize = null
    try {
      realSize = fs.statSync(outputPath).size
    } catch {
      /* keep null */
    }
    updateTask(id, { status: 'done', progress: 1, label: path.basename(outputPath), ...(realSize != null ? { sizeBytes: realSize } : {}) })
  }

  return { trimJob }
}

module.exports = { createTrim }
