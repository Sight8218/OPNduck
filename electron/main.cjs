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

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')

const DEV_SERVER_URL = process.env.OPNDUCK_DEV_URL || 'http://localhost:1420'

function isDev() {
  return !app.isPackaged
}

/** Absolute URL of the frontend to load: Vite dev server in dev, built files in prod. */
function rendererURL() {
  if (isDev()) return DEV_SERVER_URL
  const index = path.join(__dirname, '..', 'dist', 'index.html')
  return fs.existsSync(index) ? index : DEV_SERVER_URL
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    title: 'OPNduck',
    // transparent: true eliminates the gray compositor edge on frameless windows
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // BrowserWindow's minWidth/minHeight are unreliable for frameless/transparent
  // windows on some Linux compositors (Wayland/Hyprland included) — the WM's
  // own resize gesture can shrink the window past them anyway. Clamping here
  // enforces the minimum regardless of what the compositor honors.
  win.on('will-resize', (event, newBounds) => {
    if (newBounds.width < 940 || newBounds.height < 600) event.preventDefault()
  })

  // Forward renderer console output to the main process's own stdout/stderr —
  // otherwise a packaged app's console.error is invisible with no devtools
  // window to open, which is exactly the situation that let the file://
  // BrowserRouter/absolute-icon-path bugs ship unnoticed.
  win.webContents.on('console-message', (event) => {
    const levels = ['log', 'warning', 'error', 'debug']
    console.log(`[renderer:${levels[event.level] ?? event.level}]`, event.message)
  })

  win.loadURL(rendererURL())
  return win
}

/* --- Window controls --- */
ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
ipcMain.on('window:maximize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!w) return
  if (w.isMaximized()) w.unmaximize()
  else w.maximize()
})
ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())

/* --- Native dialogs --- */
ipcMain.handle('dialog:pickFile', async (e, opts) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const filters = opts?.extensions?.length
    ? [{ name: 'Files', extensions: opts.extensions }]
    : undefined
  const res = await dialog.showOpenDialog(win ?? undefined, { properties: ['openFile'], filters })
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
})

ipcMain.handle('dialog:pickFiles', async (e, opts) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const filters = opts?.extensions?.length
    ? [{ name: 'Files', extensions: opts.extensions }]
    : undefined
  const res = await dialog.showOpenDialog(win ?? undefined, {
    properties: ['openFile', 'multiSelections'],
    filters,
  })
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths
})

ipcMain.handle('dialog:pickFolder', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const res = await dialog.showOpenDialog(win ?? undefined, { properties: ['openDirectory'] })
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
})

/**
 * yt-dlp isn't bundled — it's expected on PATH. Instead of only surfacing
 * that as a cryptic per-download failure, the Downloader card checks this
 * up front and shows a plain install command for the user's OS.
 */
function ytDlpInstallHint() {
  if (process.platform === 'win32') return 'winget install yt-dlp.yt-dlp'
  if (process.platform === 'darwin') return 'brew install yt-dlp'
  return 'sudo pacman -S yt-dlp   (or: pip install -U yt-dlp)'
}

ipcMain.handle('system:checkYtDlp', () => {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('yt-dlp', ['--version'])
    } catch {
      resolve({ available: false, installHint: ytDlpInstallHint() })
      return
    }
    child.on('error', () => resolve({ available: false, installHint: ytDlpInstallHint() }))
    child.on('close', (code) => resolve({ available: code === 0, installHint: ytDlpInstallHint() }))
  })
})

/** Same idea as yt-dlp: ffmpeg isn't bundled either. */
function ffmpegInstallHint() {
  if (process.platform === 'win32') return 'winget install Gyan.FFmpeg'
  if (process.platform === 'darwin') return 'brew install ffmpeg'
  return 'sudo pacman -S ffmpeg   (or your distro\'s package manager)'
}

ipcMain.handle('system:checkFfmpeg', () => {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('ffmpeg', ['-version'])
    } catch {
      resolve({ available: false, installHint: ffmpegInstallHint() })
      return
    }
    child.on('error', () => resolve({ available: false, installHint: ffmpegInstallHint() }))
    child.on('close', (code) => resolve({ available: code === 0, installHint: ffmpegInstallHint() }))
  })
})

/**
 * Spotify tracks are DRM-protected — yt-dlp has no Spotify extractor and
 * never will (there's no legitimate way to pull audio directly off it).
 * Best-effort experimental workaround: read the track's own public page
 * metadata — title and the "Artist · Album · Song · Year" line from its
 * og: tags, the same info a link-preview embed would show, no auth and no
 * DRM touched — then search YouTube for the same song via yt-dlp's built-in
 * ytsearch. This is NOT a download from Spotify; every caller must label
 * the result accordingly (TaskState.experimentalMatch) rather than implying
 * it came from Spotify.
 */
// @category: downloader/spotify-youtube-match
const SPOTIFY_TRACK_RE = /open\.spotify\.com\/(?:intl-\w+\/)?track\/[a-zA-Z0-9]+/
const SPOTIFY_OTHER_RE = /open\.spotify\.com\/(?:intl-\w+\/)?(album|playlist|artist|show|episode)\//

/** Returns null for a non-Spotify URL, { error } for an unsupported Spotify
 *  link type or a lookup failure, or { query, label } once resolved. */
async function resolveSpotifyTrack(url) {
  const other = url.match(SPOTIFY_OTHER_RE)
  if (other) {
    return {
      error: `Spotify ${other[1]} links aren't supported yet — only single tracks (experimental YouTube match).`,
    }
  }
  if (!SPOTIFY_TRACK_RE.test(url)) return null

  let html
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    html = await res.text()
  } catch (err) {
    return { error: `Couldn't reach Spotify to identify the track: ${err.message}` }
  }

  const title = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1]
  const desc = html.match(/<meta property="og:description" content="([^"]*)"/)?.[1]
  const artist = desc?.split(' · ')[0]
  if (!title || !artist) {
    return { error: "Couldn't read this track's info from Spotify — the page format may have changed." }
  }

  return { query: `ytsearch1:${artist} - ${title}`, label: `${artist} - ${title}` }
}
// --- end: downloader/spotify-youtube-match ---

/* --- Task orchestration (yt-dlp downloads) --- */
// @category: downloader/task-orchestration-main-process
const tasks = new Map() // taskId -> { state: TaskState, child: ChildProcess|null }

function defaultDownloadDir() {
  return path.join(app.getPath('downloads'), 'OPNduck')
}

function broadcastTasks() {
  const snapshot = [...tasks.values()].map((t) => t.state)
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('tasks:update', snapshot)
}

function updateTask(id, patch) {
  const entry = tasks.get(id)
  if (!entry) return
  Object.assign(entry.state, patch)
  broadcastTasks()
}

const AUDIO_EXT = { MP3: 'mp3', FLAC: 'flac', WAV: 'wav' }
const VIDEO_EXT = { MP4: 'mp4', MKV: 'mkv', MOV: 'mov' }

/** Human label shown in the UI/tags for whichever quality field applies to this format. */
function qualityLabel(req) {
  if (req.format in AUDIO_EXT) {
    if (req.format !== 'MP3') return 'Lossless'
    return !req.audioQuality || req.audioQuality === 'best' ? 'Best' : req.audioQuality
  }
  return !req.videoQuality || req.videoQuality === 'best' ? 'Best' : `${req.videoQuality}p`
}

/** Maps a Downloader format + quality choice to yt-dlp CLI args. */
function formatArgs(req) {
  if (req.format in AUDIO_EXT) {
    const args = ['-x', '--audio-format', AUDIO_EXT[req.format]]
    if (req.format === 'MP3') {
      args.push('--audio-quality', req.audioQuality && req.audioQuality !== 'best' ? req.audioQuality : '0')
    }
    return args
  }
  if (req.format in VIDEO_EXT) {
    const height = req.videoQuality && req.videoQuality !== 'best' ? Number(req.videoQuality) : null
    const selector = height ? `bv*[height<=${height}]+ba/b[height<=${height}]` : 'bv*+ba/b'
    return ['-f', selector, '--merge-output-format', VIDEO_EXT[req.format]]
  }
  throw new Error(`Unsupported format: ${req.format}`)
}

/**
 * Best-effort title/filesize/thumbnail lookup via `yt-dlp --dump-json` — no
 * download. Shared by the renderer's pre-submit preview AND by tasks:start
 * itself, so a task always gets this info regardless of whether the UI's
 * debounced preview had time to resolve before Run Task was clicked.
 */
async function probeInfo(req) {
  const spotify = await resolveSpotifyTrack(req.url)
  if (spotify?.error) return { title: spotify.error, approxSizeBytes: null, thumbnailUrl: null }
  const effectiveUrl = spotify?.query ?? req.url

  return new Promise((resolve) => {
    let child
    try {
      child = spawn('yt-dlp', ['--dump-json', '--no-warnings', '--no-playlist', effectiveUrl])
    } catch {
      resolve({ title: req.url, approxSizeBytes: null, thumbnailUrl: null })
      return
    }
    let out = ''
    child.stdout.on('data', (c) => {
      out += c
    })
    child.on('error', () => resolve({ title: req.url, approxSizeBytes: null, thumbnailUrl: null }))
    child.on('close', () => {
      try {
        const info = JSON.parse(out.trim().split('\n')[0])
        resolve({
          title: spotify ? `${spotify.label} (YouTube match)` : (info.title ?? req.url),
          approxSizeBytes: estimateSize(info, req),
          thumbnailUrl: info.thumbnail ?? null,
        })
      } catch {
        resolve({ title: req.url, approxSizeBytes: null, thumbnailUrl: null })
      }
    })
  })
}

ipcMain.handle('tasks:probe', (_e, req) => probeInfo(req))

function formatSize(f) {
  return f?.filesize ?? f?.filesize_approx ?? null
}

function bestAudioFormat(formats) {
  const audios = formats.filter((f) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none')
  return audios.reduce((best, f) => ((f.tbr || 0) > (best?.tbr || 0) ? f : best), null)
}

function bestVideoFormat(formats, maxHeight) {
  const videos = formats.filter((f) => f.vcodec && f.vcodec !== 'none' && f.height)
  const pool = maxHeight ? videos.filter((f) => f.height <= maxHeight) : videos
  const candidates = pool.length ? pool : videos
  return candidates.reduce((best, f) => ((f.height || 0) > (best?.height || 0) ? f : best), null)
}

/** Approximates final size from yt-dlp's --dump-json format list. Lossless/re-encoded
 *  audio can't be read straight off a source format, so those use bitrate * duration. */
function estimateSize(info, req) {
  const formats = info.formats || []
  const duration = info.duration

  if (req.format in AUDIO_EXT) {
    if (req.format === 'FLAC' && duration) return Math.round(((1000 * 1000) / 8) * duration)
    if (req.format === 'WAV' && duration) return Math.round(((1411 * 1000) / 8) * duration)
    if (req.audioQuality && req.audioQuality !== 'best' && duration) {
      const kbps = Number(req.audioQuality.replace(/k$/i, ''))
      return Math.round(((kbps * 1000) / 8) * duration)
    }
    return formatSize(bestAudioFormat(formats))
  }

  const maxHeight = req.videoQuality && req.videoQuality !== 'best' ? Number(req.videoQuality) : null
  const video = bestVideoFormat(formats, maxHeight)
  const audio = bestAudioFormat(formats)
  const vSize = formatSize(video)
  const aSize = formatSize(audio)
  return vSize == null && aSize == null ? null : (vSize ?? 0) + (aSize ?? 0)
}

ipcMain.handle('tasks:start', async (_e, req) => {
  const id = crypto.randomUUID()
  const destDir = req.destination || defaultDownloadDir()
  fs.mkdirSync(destDir, { recursive: true })

  tasks.set(id, {
    state: {
      id,
      kind: 'download',
      status: 'queued',
      progress: 0,
      label: req.url,
      format: req.format,
      quality: qualityLabel(req),
      sizeBytes: req.approxSizeBytes ?? null,
      sizeIsEstimate: true,
      thumbnailUrl: req.thumbnailUrl ?? null,
      experimentalMatch: null,
    },
    child: null,
    finalPath: null,
  })
  broadcastTasks()

  const spotify = await resolveSpotifyTrack(req.url)
  if (spotify?.error) {
    updateTask(id, { status: 'error', error: spotify.error })
    return id
  }
  const effectiveUrl = spotify?.query ?? req.url
  if (spotify) updateTask(id, { label: spotify.label, experimentalMatch: 'YT Match (Experimental)' })

  // Backfill size/thumbnail if the renderer's own preview never got to run
  // (Run Task clicked before that ~700ms debounce), or came back empty. This
  // runs concurrently with the download itself, which can finish first and
  // replace sizeBytes with the real file size — never clobber that with a
  // late-arriving estimate.
  if (req.approxSizeBytes == null || !req.thumbnailUrl) {
    probeInfo(req).then((info) => {
      const entry = tasks.get(id)
      if (!entry) return
      const patch = {}
      if (entry.state.sizeIsEstimate && info.approxSizeBytes != null) patch.sizeBytes = info.approxSizeBytes
      if (!entry.state.thumbnailUrl && info.thumbnailUrl) patch.thumbnailUrl = info.thumbnailUrl
      if (Object.keys(patch).length) updateTask(id, patch)
    })
  }

  const args = [
    ...formatArgs(req),
    '--newline',
    '-o',
    path.join(destDir, '%(title)s.%(ext)s'),
    effectiveUrl,
  ]

  let child
  try {
    child = spawn('yt-dlp', args)
  } catch (err) {
    updateTask(id, { status: 'error', error: `Failed to start yt-dlp: ${err.message}` })
    return id
  }

  const entry = tasks.get(id)
  entry.child = child
  updateTask(id, { status: 'running' })

  let stderrTail = ''
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString()
    const match = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/)
    if (match) updateTask(id, { progress: Math.min(1, Number(match[1]) / 100) })
    const dest = text.match(/(?:Destination|Merging formats into):?\s+"?([^"\n]+)"?/)
    if (dest) {
      entry.finalPath = dest[1].trim()
      updateTask(id, { label: path.basename(entry.finalPath) })
    }
  })
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000)
  })
  child.on('error', (err) => {
    updateTask(id, { status: 'error', error: `yt-dlp not found on PATH (${err.message})` })
  })
  child.on('close', (code, signal) => {
    if (!tasks.has(id)) return
    if (entry.state.status === 'canceled') return
    if (signal || code !== 0) {
      updateTask(id, {
        status: 'error',
        error: stderrTail.trim().split('\n').pop() || `yt-dlp exited with code ${code}`,
      })
      return
    }
    let realSize = null
    try {
      if (entry.finalPath) realSize = fs.statSync(entry.finalPath).size
    } catch {
      /* keep the pre-download estimate if the final path can't be read */
    }
    updateTask(id, {
      status: 'done',
      progress: 1,
      ...(realSize != null ? { sizeBytes: realSize, sizeIsEstimate: false } : {}),
    })
  })

  return id
})

ipcMain.on('tasks:cancel', (_e, id) => {
  const entry = tasks.get(id)
  if (!entry) return
  entry.child?.kill()
  updateTask(id, { status: 'canceled' })
})

ipcMain.handle('tasks:list', () => [...tasks.values()].map((t) => t.state))
ipcMain.handle('tasks:defaultDownloadDir', () => defaultDownloadDir())
// --- end: downloader/task-orchestration-main-process ---

/* --- Task orchestration (ffmpeg conversions) --- */
// @category: converter/task-orchestration-main-process
const CONTAINER_EXT = { MP4: 'mp4', MKV: 'mkv', WEBM: 'webm', MOV: 'mov' }

/** One fixed codec pair per container for transcode mode — no separate codec pickers. */
const TRANSCODE_CODECS = {
  MP4: { v: 'libx264', a: 'aac' },
  MKV: { v: 'libx264', a: 'aac' },
  MOV: { v: 'libx264', a: 'aac' },
  WEBM: { v: 'libvpx-vp9', a: 'libopus' },
}

/** Never overwrites an existing file — appends " (1)", " (2)", etc. like a browser download. */
function uniqueOutputPath(destDir, baseName, ext) {
  let candidate = path.join(destDir, `${baseName}.${ext}`)
  for (let n = 1; fs.existsSync(candidate); n++) {
    candidate = path.join(destDir, `${baseName} (${n}).${ext}`)
  }
  return candidate
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

/** -map 0 keeps every stream (not just the first video/audio track). -progress pipe:1
 *  -nostats makes ffmpeg emit clean `key=value` lines on stdout instead of the
 *  human-readable stats line on stderr, which is far more fragile to parse. */
function convertArgs(req, outputPath) {
  const base = ['-y', '-i', req.inputPath, '-map', '0']
  if (req.mode === 'remux') return [...base, '-c', 'copy', '-progress', 'pipe:1', '-nostats', outputPath]
  const codecs = TRANSCODE_CODECS[req.container]
  return [...base, '-c:v', codecs.v, '-c:a', codecs.a, '-progress', 'pipe:1', '-nostats', outputPath]
}

ipcMain.handle('tasks:startConvert', async (_e, req) => {
  const id = crypto.randomUUID()
  const destDir = req.destination || defaultDownloadDir()
  fs.mkdirSync(destDir, { recursive: true })

  const ext = CONTAINER_EXT[req.container]
  if (!ext) throw new Error(`Unsupported container: ${req.container}`)
  const inputBase = path.basename(req.inputPath, path.extname(req.inputPath))
  const outputPath = uniqueOutputPath(destDir, inputBase, ext)

  tasks.set(id, {
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

  const duration = await probeDuration(req.inputPath)
  if (!tasks.has(id)) return id // canceled while the duration probe was running

  let child
  try {
    child = spawn('ffmpeg', convertArgs(req, outputPath))
  } catch (err) {
    updateTask(id, { status: 'error', error: `Failed to start ffmpeg: ${err.message}` })
    return id
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
    if (entry.state.status === 'canceled') return
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

  return id
})
// --- end: converter/task-orchestration-main-process ---

/* --- External links open in the OS browser, not inside the app window --- */
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url)
    return { action: 'deny' }
  })
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})