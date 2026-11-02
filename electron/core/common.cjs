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
 * Shared helpers for the jobs: argument checks, unique output names, ffprobe and ffmpeg helpers, tracked child processes and the long-lived model worker.
 * No Electron: everything it needs comes in through `ctx` (see core/*.cjs).
 */
const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')

function createCommon(ctx) {
  const {
    attachLog, pythonCwd, appendLog,
  } = ctx

  /** Parses a user-supplied link; only http(s) is allowed (yt-dlp would otherwise happily
   *  open file: and other schemes). Returns a URL or null. */
  function parseHttpUrl(str) {
    try {
      const u = new URL(String(str).trim())
      return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
    } catch {
      return null
    }
  }

  function decodeHtmlEntities(str) {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  }

  /** Input checks for renderer-supplied job requests (the window is sandboxed, but these end
   *  up as argv for child processes, so don't trust them blindly). */
  function assertAbsolutePath(p, what) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error(`${what} must be an absolute path`)
  }

  function assertOneOf(value, allowed, what) {
    if (!allowed.includes(value)) throw new Error(`Invalid ${what}: ${value}`)
  }

  /** Never overwrites an existing file — appends " (1)", " (2)", etc. like a browser download. */
  function uniqueOutputPath(destDir, baseName, ext) {
    // The path is chosen when a job is *queued*, long before it writes anything, so merely checking
    // existsSync lets two queued jobs with the same name (CD1/01.flac, CD2/01.flac) pick the same
    // output and overwrite each other. Reserve it with an empty placeholder instead (exclusive create);
    // updateTask() removes the placeholder again if the job fails or is canceled.
    for (let n = 0; ; n++) {
      const candidate = path.join(destDir, n === 0 ? `${baseName}.${ext}` : `${baseName} (${n}).${ext}`)
      try {
        fs.closeSync(fs.openSync(candidate, 'wx'))
        return candidate
      } catch (err) {
        if (err.code !== 'EEXIST') throw err
      }
    }
  }

  /** Source duration in seconds via ffprobe, or null if it can't be determined —
   *  needed to turn ffmpeg's `out_time_ms` progress output into a percentage. */
  function probeDuration(inputPath) {
    return new Promise((resolve) => {
      let child
      try {
        child = spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', inputPath])
      } catch {
        resolve(null)
        return
      }
      let out = ''
      child.stdout.on('data', (c) => {
        out += c
      })
      child.on('error', () => resolve(null))
      child.on('close', () => {
        try {
          const seconds = Number.parseFloat(JSON.parse(out).format?.duration)
          resolve(Number.isFinite(seconds) ? seconds : null)
        } catch {
          resolve(null)
        }
      })
    })
  }

  /** Runs one child process, wiring it into the task's cancel button (entry.child)
   *  and forwarding each output chunk to onChunk for progress parsing. Resolves on
   *  exit code 0, rejects with the tail of stderr (or stdout, if that's where a
   *  given tool logs) otherwise. */
  function spawnTracked(cmd, args, entry, { onStdout, onStderr, cwd } = {}) {
    return new Promise((resolve, reject) => {
      let child
      try {
        child = spawn(cmd, args, cwd ? { cwd } : undefined)
      } catch (err) {
        reject(err)
        return
      }
      entry.child = child
      attachLog(child, entry.state.id)
      let tail = ''
      child.stdout?.on('data', (chunk) => {
        const text = chunk.toString()
        tail = (tail + text).slice(-2000)
        onStdout?.(text)
      })
      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString()
        tail = (tail + text).slice(-2000)
        onStderr?.(text)
      })
      child.on('error', (err) => reject(err))
      child.on('close', (code, signal) => {
        if (signal || code !== 0) {
          reject(new Error(tail.trim().split('\n').pop() || `${cmd} exited with code ${code}`))
          return
        }
        resolve()
      })
    })
  }

  /**
   * A long-lived Python worker that keeps an AI model loaded between jobs (loading Demucs costs ~10 s,
   * a large Whisper model several). The script's `--serve` mode reads one JSON request per stdin line and
   * answers `@@DONE` or `@@FAIL <message>` on stdout; every other stdout line and all stderr belong to the
   * running request. Jobs reach it one at a time (the GPU/Whisper pools). It exits after `idleMs` without
   * work so an idle app doesn't hold GPU memory, and cancelling a job (which kills `entry.child`) just
   * kills the worker — the next job starts a fresh one.
   */
  function createModelWorker({ python, scriptPath, idleMs = 60_000, env = () => ({}) }) {
    let child = null
    let idleTimer = null

    // Each worker process carries its own `job` (the request it is serving). A process that was killed
    // by a cancel can take a moment to exit (CUDA teardown); its late events then settle *its* job, and
    // can never be mistaken for the next job, which runs on a new process.
    function start() {
      const script = fs.readFileSync(scriptPath, 'utf8') // read here: an external Python can't open a file inside app.asar
      const proc = spawn(python(), ['-c', script, '--serve'], {
        cwd: pythonCwd(), // `python -c` imports from the cwd; keep it away from user/shared folders
        env: { ...process.env, PYTHONUNBUFFERED: '1', ...env() },
      })
      child = proc
      proc.job = null
      let buf = ''
      let stderrTail = ''
      proc.stdout.on('data', (chunk) => {
        buf += chunk.toString()
        const lines = buf.split(/\r?\n/)
        buf = lines.pop()
        for (const line of lines) {
          const job = proc.job
          if (!job) continue
          if (line.startsWith('@@DONE')) job.resolve()
          else if (line.startsWith('@@FAIL')) job.reject(new Error(line.slice(6).trim() || 'The job failed.'))
          else job.onStdout?.(line + '\n')
        }
      })
      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString()
        stderrTail = (stderrTail + text).slice(-2000)
        proc.job?.onStderr?.(text)
      })
      proc.stdin.on('error', () => {
        /* the worker died; 'close' reports it */
      })
      proc.on('error', (err) => {
        if (child === proc) child = null
        proc.job?.reject(err)
      })
      proc.on('close', (code) => {
        if (child === proc) child = null
        proc.job?.reject(new Error(stderrTail.trim().split('\n').pop() || `The worker exited (code ${code}).`))
      })
      return proc
    }

    return {
      run(request, entry, { onStdout, onStderr } = {}) {
        clearTimeout(idleTimer)
        let proc
        return new Promise((resolve, reject) => {
          try {
            proc = child && !child.killed ? child : start() // a cancel kills the worker; never hand work to one that is dying
          } catch (err) {
            reject(err)
            return
          }
          entry.child = proc // tasks:cancel kills this
          proc.job = {
            resolve,
            reject,
            onStdout: (t) => {
              appendLog(entry.state.id, t, 'o')
              onStdout?.(t)
            },
            onStderr: (t) => {
              appendLog(entry.state.id, t, 'e')
              onStderr?.(t)
            },
          }
          proc.stdin.write(JSON.stringify(request) + '\n')
        }).finally(() => {
          if (!proc) return
          proc.job = null
          // Idle-exit only the worker that just went idle, and only if it is still the live one and
          // has no job: a canceled job's late cleanup must never time out the next job's worker.
          if (child === proc) {
            clearTimeout(idleTimer)
            idleTimer = setTimeout(() => {
              if (child === proc && !proc.job) proc.kill()
            }, idleMs)
            idleTimer.unref?.()
          }
        })
      },
      stop() {
        clearTimeout(idleTimer)
        child?.kill()
      },
    }
  }

  /** fps + frame count for the source video, or null if either can't be read. */
  function probeVideoMeta(inputPath) {
    return new Promise((resolve) => {
      let child
      try {
        child = spawn('ffprobe', [
          '-v', 'quiet',
          '-print_format', 'json',
          '-show_format',
          '-show_streams',
          '-select_streams', 'v:0',
          inputPath,
        ])
      } catch {
        resolve(null)
        return
      }
      let out = ''
      child.stdout.on('data', (c) => {
        out += c
      })
      child.on('error', () => resolve(null))
      child.on('close', () => {
        try {
          const info = JSON.parse(out)
          const stream = info.streams?.[0]
          const duration = Number.parseFloat(info.format?.duration)
          const [num, den] = String(stream?.r_frame_rate ?? '').split('/').map(Number)
          const fps = den ? num / den : null
          let frameCount = Number.parseInt(stream?.nb_frames, 10)
          if (!Number.isFinite(frameCount) && fps && duration) frameCount = Math.round(fps * duration)
          if (!fps || !Number.isFinite(frameCount) || frameCount <= 0) {
            resolve(null)
            return
          }
          resolve({ fps, frameCount, fpsNum: num, fpsDen: den, width: stream.width, height: stream.height })
        } catch {
          resolve(null)
        }
      })
    })
  }

  /** Lists numbered files of a directory in order. */
  const listSorted = (dir) => fs.readdirSync(dir).sort()

  /* --- Trim: cut a section out of a video or audio file --- */
  // @category: trim/trim-pipeline
  function probeMedia(inputPath) {
    return new Promise((resolve) => {
      let child
      try {
        child = spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', inputPath])
      } catch {
        resolve(null)
        return
      }
      let out = ''
      child.stdout.on('data', (c) => (out += c))
      child.on('error', () => resolve(null))
      child.on('close', () => {
        try {
          const info = JSON.parse(out)
          const v = info.streams?.find((x) => x.codec_type === 'video' && x.disposition?.attached_pic !== 1)
          const duration = Number.parseFloat(info.format?.duration)
          if (!Number.isFinite(duration)) return resolve(null)
          const rate = (v?.avg_frame_rate ?? '').split('/').map(Number)
          const fps = rate.length === 2 && rate[1] > 0 && rate[0] > 0 ? rate[0] / rate[1] : null
          resolve({
            duration,
            width: v?.width ?? null,
            height: v?.height ?? null,
            hasVideo: !!v,
            hasAudio: !!info.streams?.some((x) => x.codec_type === 'audio'),
            fps,
            bitrate: Number.parseInt(info.format?.bit_rate, 10) || null,
          })
        } catch {
          resolve(null)
        }
      })
    })
  }

  /** The tags, duration and whether it has a cover, read with ffprobe (null if it can't be read). */
  function probeTags(inputPath) {
    return new Promise((resolve) => {
      let child
      try {
        child = spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', inputPath])
      } catch {
        resolve(null)
        return
      }
      let out = ''
      child.stdout.on('data', (c) => (out += c))
      child.on('error', () => resolve(null))
      child.on('close', () => {
        try {
          const info = JSON.parse(out)
          // Containers disagree on where tags live and how they are cased: merge stream and format tags, lower-cased.
          const raw = {}
          for (const src of [info.format?.tags, ...(info.streams ?? []).filter((x) => x.codec_type === 'audio').map((x) => x.tags)]) {
            for (const [k, v] of Object.entries(src ?? {})) raw[k.toLowerCase()] ??= v
          }
          resolve({
            tags: raw,
            duration: Number.parseFloat(info.format?.duration) || null,
            hasCover: !!info.streams?.some((x) => x.disposition?.attached_pic === 1),
          })
        } catch {
          resolve(null)
        }
      })
    })
  }

  /** One JPEG frame of a file at time `t` seconds, as a data URL (null on failure). Used by the trimmer preview. */
  function mediaFrame(inputPath, t, width) {
    return new Promise((resolve) => {
      let child
      try {
        child = spawn('ffmpeg', ['-v', 'error', '-nostdin', '-ss', String(Math.max(0, t)), '-i', inputPath, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '5', '-'])
      } catch {
        resolve(null)
        return
      }
      const chunks = []
      const timer = setTimeout(() => child.kill(), 15_000)
      child.stdout.on('data', (c) => chunks.push(c))
      child.on('error', () => {
        clearTimeout(timer)
        resolve(null)
      })
      child.on('close', () => {
        clearTimeout(timer)
        const buf = Buffer.concat(chunks)
        resolve(buf.length ? `data:image/jpeg;base64,${buf.toString('base64')}` : null)
      })
    })
  }

  const fmtClock = (sec) => {
    const t = Math.max(0, Math.round(sec))
    const h = Math.floor(t / 3600)
    const m = Math.floor((t % 3600) / 60)
    const r = t % 60
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
  }

  /** Codec name of the first video stream, or null if there isn't one (audio-only .webm/.ts, cover art aside). */
  function probeVideoCodec(inputPath) {
    return new Promise((resolve) => {
      let child
      try {
        child = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', inputPath])
      } catch {
        resolve(null)
        return
      }
      let out = ''
      child.stdout.on('data', (c) => (out += c))
      child.on('error', () => resolve(null))
      child.on('close', () => resolve(out.trim().split('\n')[0] || null))
    })
  }

  return { parseHttpUrl, decodeHtmlEntities, assertAbsolutePath, assertOneOf, uniqueOutputPath, probeDuration, spawnTracked, probeVideoMeta, probeVideoCodec, probeMedia, probeTags, mediaFrame, createModelWorker, fmtClock, listSorted }
}

module.exports = { createCommon }
