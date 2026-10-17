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
const os = require('node:os')
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { readOmarchyTheme, watchOmarchyTheme } = require('./omarchy.cjs')

const DEV_SERVER_URL = process.env.OPNDUCK_DEV_URL || 'http://localhost:1420'

function isDev() {
  return !app.isPackaged
}

/** Where the frontend lives: Vite dev server in dev, built files in prod. Returns
 *  { url } or { file } — a bare filesystem path must go through loadFile(), not loadURL():
 *  newer Electron builds refuse to navigate to a path that isn't a real URL, which left
 *  the packaged window blank/transparent. */
function rendererTarget() {
  if (isDev()) return { url: DEV_SERVER_URL }
  const index = path.join(__dirname, '..', 'dist', 'index.html')
  return fs.existsSync(index) ? { file: index } : { url: DEV_SERVER_URL }
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

  const target = rendererTarget()
  if (target.file) win.loadFile(target.file)
  else win.loadURL(target.url)

  // "Sync with Omarchy" theme option: push live Omarchy theme changes to
  // this window for as long as it's open. Total no-op on non-Omarchy
  // systems — watchOmarchyTheme never fires in that case.
  const stopWatchingOmarchy = watchOmarchyTheme((theme) => {
    if (!win.isDestroyed()) win.webContents.send('omarchy:theme-changed', theme)
  })
  win.on('closed', stopWatchingOmarchy)

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

/** yt-dlp prints in the console code page on Windows when piped (e.g. cp1252), which garbles
 *  non-ASCII titles in the paths parsed from its output; force UTF-8 everywhere. */
const YTDLP_ENCODING = ['--encoding', 'utf-8']

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

/** LibreOffice (soffice) does the document conversions — same detect-and-guide idea. */
function libreOfficeInstallHint() {
  if (process.platform === 'win32') return 'winget install TheDocumentFoundation.LibreOffice'
  if (process.platform === 'darwin') return 'brew install --cask libreoffice'
  return 'sudo pacman -S libreoffice-fresh   (or your distro\'s package manager)'
}

/** On Windows neither winget nor the LibreOffice installer adds it to PATH, so also look
 *  in the default install folders. soffice.com is the console launcher: soffice.exe is a
 *  GUI program that prints nothing to a pipe. */
function sofficeCommand() {
  if (process.platform !== 'win32') return 'soffice'
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
    if (!base) continue
    const candidate = path.join(base, 'LibreOffice', 'program', 'soffice.com')
    if (fs.existsSync(candidate)) return candidate
  }
  return 'soffice'
}

ipcMain.handle('system:checkLibreOffice', () => {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(sofficeCommand(), ['--version'])
    } catch {
      resolve({ available: false, installHint: libreOfficeInstallHint() })
      return
    }
    child.on('error', () => resolve({ available: false, installHint: libreOfficeInstallHint() }))
    child.on('close', (code) => resolve({ available: code === 0, installHint: libreOfficeInstallHint() }))
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
 * realesrgan-ncnn-vulkan is essentially never pre-installed anywhere (no
 * winget/brew formula confirmed to exist for it) — Arch has an AUR package;
 * everyone else gets pointed at the upstream releases page rather than a
 * fabricated command.
 */
function realesrganInstallHint() {
  if (process.platform === 'linux') return 'yay -S realesrgan-ncnn-vulkan-bin   (AUR; or see the link below on other distros)'
  return 'Download from https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/releases'
}

ipcMain.handle('system:checkRealesrgan', () => {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('realesrgan-ncnn-vulkan', ['-h'])
    } catch {
      resolve({ available: false, installHint: realesrganInstallHint() })
      return
    }
    // Unlike yt-dlp/ffmpeg, this binary exits non-zero even for -h — any exit
    // at all (vs. an 'error' event, which only fires when the binary is
    // genuinely missing) means it was found and ran.
    child.on('error', () => resolve({ available: false, installHint: realesrganInstallHint() }))
    child.on('close', () => resolve({ available: true, installHint: realesrganInstallHint() }))
  })
})

/** Same situation as realesrgan-ncnn-vulkan — essentially never pre-installed. */
function rifeInstallHint() {
  if (process.platform === 'linux') return 'yay -S rife-ncnn-vulkan-bin   (AUR; or see the link below on other distros)'
  return 'Download from https://github.com/nihui/rife-ncnn-vulkan/releases'
}

ipcMain.handle('system:checkRife', () => {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('rife-ncnn-vulkan', ['-h'])
    } catch {
      resolve({ available: false, installHint: rifeInstallHint() })
      return
    }
    child.on('error', () => resolve({ available: false, installHint: rifeInstallHint() }))
    child.on('close', () => resolve({ available: true, installHint: rifeInstallHint() }))
  })
})

/**
 * faster-whisper is a Python library, not a binary — so the check is whether the
 * user's Python can import it. OPNDUCK_PYTHON points at a specific interpreter
 * (e.g. a venv's), for distros like Arch where a global pip install is refused.
 */
function pythonCommand() {
  return process.env.OPNDUCK_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
}

function fasterWhisperInstallHint() {
  if (process.platform === 'win32') return 'python -m pip install faster-whisper'
  if (process.platform === 'darwin') return 'python3 -m pip install faster-whisper'
  return 'yay -S python-faster-whisper   (AUR; or pip install faster-whisper in a venv and set OPNDUCK_PYTHON to its python)'
}

ipcMain.handle('system:checkFasterWhisper', () => {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(pythonCommand(), ['-c', 'import faster_whisper'])
    } catch {
      resolve({ available: false, installHint: fasterWhisperInstallHint() })
      return
    }
    // 'error' = no Python at all; a non-zero exit = Python without the module.
    child.on('error', () => resolve({ available: false, installHint: fasterWhisperInstallHint() }))
    child.on('close', (code) => resolve({ available: code === 0, installHint: fasterWhisperInstallHint() }))
  })
})

ipcMain.handle('omarchy:get', () => readOmarchyTheme())

/* --- Update check: asks GitHub for the newest published release and compares versions. ---
 * Deliberately notify-only: OPNduck's builds are unsigned, so rather than silently
 * replacing itself it opens the release page and lets the user choose what to install. */
const RELEASES_API = 'https://api.github.com/repos/Sight8218/OPNduck/releases?per_page=10'
const RELEASES_PAGE_PATH = '/Sight8218/OPNduck/releases'

function versionParts(v) {
  const m = String(v).match(/(\d+)\.(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
/** True when version a is strictly newer than b (pre-release suffixes like -Alpha are ignored). */
function isNewerVersion(a, b) {
  const x = versionParts(a)
  const y = versionParts(b)
  if (!x || !y) return false
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

ipcMain.handle('updates:check', async () => {
  const current = app.getVersion()
  try {
    const res = await fetch(RELEASES_API, {
      headers: { 'User-Agent': 'OPNduck-update-check', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const releases = (await res.json()).filter((r) => !r.draft && versionParts(r.tag_name))
    // Every OPNduck release is a pre-release for now, so /releases/latest (which skips
    // pre-releases) isn't usable — pick the highest version ourselves.
    releases.sort((a, b) => (isNewerVersion(a.tag_name, b.tag_name) ? -1 : isNewerVersion(b.tag_name, a.tag_name) ? 1 : 0))
    const top = releases[0]
    if (!top) return { current, latest: null, newer: false, error: null }
    return {
      current,
      latest: { tag: top.tag_name, name: top.name || top.tag_name, url: top.html_url, notes: String(top.body || '').slice(0, 1500) },
      newer: isNewerVersion(top.tag_name, current),
      error: null,
    }
  } catch (err) {
    return { current, latest: null, newer: false, error: err.message }
  }
})
ipcMain.handle('updates:openRelease', (_e, url) => {
  // Compare parsed parts: a bare startsWith() would also accept look-alike prefixes.
  const u = parseHttpUrl(url)
  if (u && u.protocol === 'https:' && u.hostname === 'github.com' && (u.pathname + '/').startsWith(RELEASES_PAGE_PATH + '/')) {
    return shell.openExternal(u.href)
  }
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
const UPSCALE_MODELS = ['realesr-animevideov3', 'realesrgan-x4plus', 'realesrgan-x4plus-anime']

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
  // The regex matches anywhere in the string — require the link itself to be on
  // open.spotify.com so a crafted URL can't make the main process fetch elsewhere.
  const parsed = parseHttpUrl(url)
  if (!parsed || parsed.hostname !== 'open.spotify.com') return null

  let html
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    html = await res.text()
  } catch (err) {
    return { error: `Couldn't reach Spotify to identify the track: ${err.message}` }
  }

  const rawTitle = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1]
  const rawDesc = html.match(/<meta property="og:description" content="([^"]*)"/)?.[1]
  const title = rawTitle && decodeHtmlEntities(rawTitle)
  const desc = rawDesc && decodeHtmlEntities(rawDesc)
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

// Progress callbacks can fire many times a second (ffmpeg, upscalers); every broadcast makes
// the renderer re-render each subscribed card, so coalesce them to at most one per 120ms
// (trailing edge — the latest snapshot always goes out).
let broadcastTimer = null
function broadcastTasks() {
  if (broadcastTimer) return
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null
    const snapshot = [...tasks.values()].map((t) => t.state)
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('tasks:update', snapshot)
  }, 120)
}

/* --- History: finished tasks persist across restarts, with the request needed to re-run them --- */
const TERMINAL = ['done', 'error', 'canceled']
const MAX_HISTORY = 200
const startHandlers = new Map() // IPC channel -> start function, so a stored request can be re-run

function historyFile() {
  return path.join(app.getPath('userData'), 'history.json')
}

let saveTimer = null
function scheduleHistorySave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveHistory, 400)
}
function saveHistory() {
  try {
    const finished = [...tasks.values()]
      .filter((t) => TERMINAL.includes(t.state.status) && t.channel)
      .slice(-MAX_HISTORY)
      .map((t) => ({ state: t.state, channel: t.channel, req: t.req, finalPath: t.finalPath ?? null }))
    fs.mkdirSync(path.dirname(historyFile()), { recursive: true })
    // Write-then-rename so a crash mid-write can't leave a truncated history.json.
    const tmp = `${historyFile()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(finished))
    fs.renameSync(tmp, historyFile())
  } catch {
    /* history is a convenience — never let a disk error break a job */
  }
}
function loadHistory() {
  try {
    const rows = JSON.parse(fs.readFileSync(historyFile(), 'utf8'))
    if (!Array.isArray(rows)) return
    for (const r of rows.slice(-MAX_HISTORY)) {
      if (typeof r?.state?.id !== 'string' || !TERMINAL.includes(r.state.status)) continue
      tasks.set(r.state.id, { state: r.state, child: null, finalPath: r.finalPath, channel: r.channel, req: r.req })
    }
  } catch {
    /* no history yet */
  }
}

/** Registers a job-start IPC handler and remembers (channel, request) on the task it
 *  creates, which is what lets the Library "Run again" button replay it. */
function handleStart(channel, fn) {
  const wrapped = async (e, req) => {
    const id = await fn(e, req)
    const entry = tasks.get(id)
    if (entry) {
      entry.channel = channel
      entry.req = req
    }
    return id
  }
  startHandlers.set(channel, wrapped)
  ipcMain.handle(channel, wrapped)
}

function updateTask(id, patch) {
  const entry = tasks.get(id)
  if (!entry) return
  // A finished task never changes outcome: a cancel that races a normal exit (or a late
  // 'error'/'close' event after a kill) must not flip 'canceled' to 'done' or vice versa.
  if (patch.status && TERMINAL.includes(entry.state.status)) return
  Object.assign(entry.state, patch)
  if (TERMINAL.includes(entry.state.status)) scheduleHistorySave()
  // A finished conversion frees its concurrency slot for the next queued one.
  if (entry.releaseSlot && TERMINAL.includes(entry.state.status)) entry.releaseSlot()
  broadcastTasks()
}

/** Batch conversions would otherwise spawn one ffmpeg/soffice per file all at once. */
const CONVERT_CONCURRENCY = 2
let convertActive = 0
const convertWaiters = []
function acquireConvertSlot() {
  if (convertActive < CONVERT_CONCURRENCY) {
    convertActive++
    return Promise.resolve()
  }
  return new Promise((resolve) => convertWaiters.push(resolve))
}
function releaseConvertSlot() {
  const next = convertWaiters.shift()
  if (next) next() // hand the slot straight over
  else convertActive--
}

/** Kill a job's process, including children: soffice is a launcher whose real worker
 *  (soffice.bin) would otherwise be orphaned. Detached jobs lead their own group. */
function killTask(entry) {
  const child = entry.child
  if (!child) return
  try {
    if (entry.killGroup && process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM')
    else if (entry.killGroup && process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'])
    else child.kill()
  } catch {
    child.kill()
  }
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
 * Classifies a URL as a YouTube playlist link. 'only' = a pure playlist page
 * (always the whole list); 'mixed' = a video that happens to carry a list
 * param (user picks single vs whole list); null = not a playlist. YouTube's
 * auto-generated "Mix" lists (list=RD...) are endless, so they're never
 * treated as playlists — those links just download the one video.
 */
function playlistKind(url) {
  let u
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (!/(^|\.)youtube\.com$|^youtu\.be$/.test(u.hostname)) return null
  const list = u.searchParams.get('list')
  if (!list || list.startsWith('RD')) return null
  if (u.pathname === '/playlist') return 'only'
  return u.searchParams.get('v') || u.hostname === 'youtu.be' ? 'mixed' : null
}

/** Title + video count of a playlist without downloading anything (--flat-playlist is fast). */
function probePlaylist(url) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('yt-dlp', [...YTDLP_ENCODING, '--flat-playlist', '--dump-single-json', '--no-warnings', '--playlist-end', '5000', '--', url])
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
        const entries = Array.isArray(info.entries) ? info.entries : []
        const first = entries.find((e) => e?.thumbnails?.length)
        resolve({
          title: info.title ?? 'Playlist',
          count: entries.length,
          thumbnailUrl: first?.thumbnails?.[first.thumbnails.length - 1]?.url ?? null,
        })
      } catch {
        resolve(null)
      }
    })
  })
}

/**
 * Best-effort title/filesize/thumbnail lookup via `yt-dlp --dump-json` — no
 * download. Shared by the renderer's pre-submit preview AND by tasks:start
 * itself, so a task always gets this info regardless of whether the UI's
 * debounced preview had time to resolve before Run Task was clicked.
 */
async function probeInfo(req) {
  if (!parseHttpUrl(req.url)) {
    return { title: 'Only http(s) links are supported', approxSizeBytes: null, thumbnailUrl: null, playlist: null }
  }
  const spotify = await resolveSpotifyTrack(req.url)
  if (spotify?.error) return { title: spotify.error, approxSizeBytes: null, thumbnailUrl: null, playlist: null }
  const effectiveUrl = spotify?.query ?? req.url

  const kind = spotify ? null : playlistKind(req.url)
  // Playlist lookup runs alongside the single-video lookup below instead of
  // before it, so a playlist link doesn't take the sum of both round trips.
  const playlistPromise = kind ? probePlaylist(req.url) : Promise.resolve(null)
  const playlist = kind === 'only' ? await playlistPromise : null
  const playlistInfo = playlist ? { title: playlist.title, count: playlist.count, ambiguous: kind === 'mixed' } : null
  // A pure playlist page has no single video to size up — a total would mean
  // probing every entry. The UI shows the video count instead.
  if (kind === 'only' && playlist) {
    return { title: playlist.title, approxSizeBytes: null, thumbnailUrl: playlist.thumbnailUrl, playlist: playlistInfo }
  }

  const single = await new Promise((resolve) => {
    let child
    try {
      child = spawn('yt-dlp', [...YTDLP_ENCODING, '--dump-json', '--no-warnings', '--no-playlist', '--', effectiveUrl])
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
  const mixedPlaylist = kind === 'mixed' ? await playlistPromise : null
  return {
    ...single,
    playlist: mixedPlaylist ? { title: mixedPlaylist.title, count: mixedPlaylist.count, ambiguous: true } : null,
  }
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

handleStart('tasks:start', async (_e, req) => {
  if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
  if (req.audioQuality != null) {
    if (typeof req.audioQuality !== 'string' || !/^(best|\d{1,3}k?)$/i.test(req.audioQuality)) {
      throw new Error(`Invalid audio quality: ${req.audioQuality}`)
    }
  }
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

  if (!parseHttpUrl(req.url)) {
    updateTask(id, { status: 'error', error: 'Only http(s) links are supported.' })
    return id
  }
  const spotify = await resolveSpotifyTrack(req.url)
  if (spotify?.error) {
    updateTask(id, { status: 'error', error: spotify.error })
    return id
  }
  if (isCanceled(id)) return id // canceled while the Spotify lookup was running
  const effectiveUrl = spotify?.query ?? req.url

  // Whole-playlist mode: pure playlist pages always, "video inside a playlist"
  // links only when the user explicitly chose the whole list.
  const kind = spotify ? null : playlistKind(req.url)
  const wholePlaylist = kind === 'only' || (kind === 'mixed' && req.playlist === 'all')
  if (wholePlaylist) updateTask(id, { sizeBytes: null, playlist: { index: 0, total: 0 } })
  if (spotify) updateTask(id, { label: spotify.label, experimentalMatch: 'YT Match (Experimental)' })

  // Backfill size/thumbnail if the renderer's own preview never got to run
  // (Run Task clicked before that ~700ms debounce), or came back empty. This
  // runs concurrently with the download itself, which can finish first and
  // replace sizeBytes with the real file size — never clobber that with a
  // late-arriving estimate.
  if (!wholePlaylist && (req.approxSizeBytes == null || !req.thumbnailUrl)) {
    probeInfo(req).then((info) => {
      const entry = tasks.get(id)
      if (!entry) return
      const patch = {}
      if (entry.state.sizeIsEstimate && info.approxSizeBytes != null) patch.sizeBytes = info.approxSizeBytes
      if (!entry.state.thumbnailUrl && info.thumbnailUrl) patch.thumbnailUrl = info.thumbnailUrl
      if (Object.keys(patch).length) updateTask(id, patch)
    })
  }

  // yt-dlp treats the -o value as a template, so a literal '%' in the
  // destination folder name must be escaped or it breaks/garbles the path.
  const outDirTemplate = destDir.replace(/%/g, '%%')
  const args = wholePlaylist
    ? [
        ...YTDLP_ENCODING,
        ...formatArgs(req),
        '--newline',
        '--yes-playlist',
        // One unavailable/private video shouldn't abort the other 99.
        '--ignore-errors',
        '-o',
        path.join(outDirTemplate, '%(playlist_title|Playlist)s', '%(playlist_index)03d - %(title)s.%(ext)s'),
        '--',
        effectiveUrl,
      ]
    : [
        ...YTDLP_ENCODING,
        ...formatArgs(req),
        '--newline',
        '--no-playlist',
        '-o',
        path.join(outDirTemplate, '%(title)s.%(ext)s'),
        '--',
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
  let skipped = 0
  const files = new Set()
  let stdoutBuf = ''
  child.stdout.on('data', (chunk) => {
    // Lines can straddle chunk boundaries — only parse complete ones.
    stdoutBuf += chunk.toString()
    const lines = stdoutBuf.split(/\r?\n/)
    stdoutBuf = lines.pop() ?? ''
    for (const line of lines) {
      const item = line.match(/\[download\] Downloading (?:item|video) (\d+) of (\d+)/)
      if (item && wholePlaylist) {
        updateTask(id, { playlist: { index: Number(item[1]), total: Number(item[2]) } })
        continue
      }
      const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/)
      if (match) {
        const pct = Math.min(1, Number(match[1]) / 100)
        const pl = entry.state.playlist
        if (wholePlaylist && pl?.total) {
          // Overall progress across the list. Never move backwards: each video
          // downloads its video and audio streams separately, so pct restarts.
          const overall = (Math.max(0, pl.index - 1) + pct) / pl.total
          updateTask(id, { progress: Math.max(entry.state.progress, Math.min(0.999, overall)) })
        } else if (!wholePlaylist) {
          updateTask(id, { progress: pct })
        }
      }
      const dest = line.match(/(?:Destination|Merging formats into):?\s+"?([^"\n]+)"?/)
      if (dest) {
        entry.finalPath = dest[1].trim()
        files.add(entry.finalPath)
        updateTask(id, { label: path.basename(entry.finalPath) })
      }
    }
  })
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString()
    stderrTail = (stderrTail + text).slice(-2000)
    skipped += (text.match(/^ERROR:/gm) ?? []).length
  })
  child.on('error', (err) => {
    updateTask(id, { status: 'error', error: `yt-dlp not found on PATH (${err.message})` })
  })
  child.on('close', (code, signal) => {
    if (!tasks.has(id)) return
    // A spawn failure (ENOENT) fires 'error' and then 'close'(-2); keep the clearer 'error' message.
    if (entry.state.status === 'canceled' || entry.state.status === 'error') return
    // With --ignore-errors yt-dlp exits 1 if ANY video failed, even when the
    // rest downloaded fine — that's a partial success, not a failed task.
    const partial = wholePlaylist && !signal && code === 1 && files.size > 0
    if (signal || (code !== 0 && !partial)) {
      updateTask(id, {
        status: 'error',
        error: stderrTail.trim().split('\n').pop() || `yt-dlp exited with code ${code}`,
      })
      return
    }
    let realSize = null
    if (wholePlaylist) {
      // Intermediate stream files are deleted after merging, so only the ones
      // that still exist count toward the playlist's real total.
      let total = 0
      for (const f of files) {
        try {
          total += fs.statSync(f).size
        } catch {
          /* intermediate file already cleaned up */
        }
      }
      realSize = total || null
    } else {
      try {
        if (entry.finalPath) realSize = fs.statSync(entry.finalPath).size
      } catch {
        /* keep the pre-download estimate if the final path can't be read */
      }
    }
    const pl = entry.state.playlist
    updateTask(id, {
      status: 'done',
      progress: 1,
      ...(partial && pl?.total
        ? { label: `${pl.total - skipped}/${pl.total} downloaded — ${skipped} skipped (unavailable)` }
        : {}),
      ...(realSize != null ? { sizeBytes: realSize, sizeIsEstimate: false } : {}),
    })
  })

  return id
})

ipcMain.on('tasks:cancel', (_e, id) => {
  const entry = tasks.get(id)
  if (!entry) return
  // Don't rewrite the outcome of a task that already finished.
  if (!['queued', 'running'].includes(entry.state.status)) return
  killTask(entry)
  updateTask(id, { status: 'canceled' })
})

ipcMain.handle('tasks:rerun', (_e, id) => {
  const entry = tasks.get(id)
  const start = entry && startHandlers.get(entry.channel)
  return start ? start(null, entry.req) : null
})
ipcMain.handle('tasks:openFolder', (_e, id) => {
  const entry = tasks.get(id)
  if (!entry) return
  if (entry.finalPath && fs.existsSync(entry.finalPath)) shell.showItemInFolder(entry.finalPath)
  else shell.openPath(entry.req?.destination || defaultDownloadDir())
})
ipcMain.handle('tasks:clearFinished', () => {
  for (const [id, t] of tasks) if (TERMINAL.includes(t.state.status)) tasks.delete(id)
  saveHistory()
  broadcastTasks()
})
ipcMain.handle('tasks:list', () => [...tasks.values()].map((t) => t.state))
ipcMain.handle('tasks:defaultDownloadDir', () => defaultDownloadDir())
// --- end: downloader/task-orchestration-main-process ---

/* --- Task orchestration (ffmpeg conversions) --- */
// @category: converter/task-orchestration-main-process
const SCALE_ICO = "scale='min(256,iw)':'min(256,ih)':force_original_aspect_ratio=decrease"

/** Per-format output extension, kind and fixed ffmpeg encode args — no separate codec
 *  pickers. Video formats map every stream; audio drops video (-vn) and keeps the
 *  first audio track; image formats write a single frame. */
const FORMATS = {
  MP4: { ext: 'mp4', kind: 'video', args: ['-c:v', 'libx264', '-c:a', 'aac'] },
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

  // Return right away so every job shows up as 'queued'; the work itself waits for a slot.
  runConvert(id, req, fmt, outputPath).catch((err) =>
    updateTask(id, { status: 'error', error: `Conversion failed to start: ${err.message}` }),
  )
  return id
})

async function runConvert(id, req, fmt, outputPath) {
  await acquireConvertSlot()
  const entry0 = tasks.get(id)
  if (!entry0) return releaseConvertSlot()
  let released = false
  entry0.releaseSlot = () => {
    if (!released) {
      released = true
      releaseConvertSlot()
    }
  }
  if (isCanceled(id)) return entry0.releaseSlot()

  if (fmt.kind === 'doc') {
    runDocConvert(id, req, fmt, outputPath)
    return
  }

  const duration = await probeDuration(req.inputPath)
  if (isCanceled(id)) return // canceled while the duration probe was running

  let child
  try {
    child = spawn('ffmpeg', convertArgs(req, outputPath))
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

// --- end: converter/task-orchestration-main-process ---

/* --- Task orchestration (realesrgan-ncnn-vulkan image upscaling) --- */
// @category: upscaler/task-orchestration-main-process

/** realesrgan-x4plus and -anime only support 4x; realesr-animevideov3 (the
 *  default) supports 2x/3x/4x — the renderer is responsible for not letting
 *  the user pick an invalid scale/model pair in the first place. No -m flag:
 *  the binary finds its own bundled/packaged models without help, verified
 *  against both a manual build layout and this system's AUR package. */
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

  tasks.set(id, {
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

  let child
  try {
    child = spawn('realesrgan-ncnn-vulkan', upscaleArgs(req, outputPath))
  } catch (err) {
    updateTask(id, { status: 'error', error: `Failed to start realesrgan-ncnn-vulkan: ${err.message}` })
    return id
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

  return id
})
// --- end: upscaler/task-orchestration-main-process ---

/**
 * Video upscaling — no single tool does this. The pipeline is:
 *   1. ffmpeg extracts every frame to lossless PNGs.
 *   2. realesrgan-ncnn-vulkan upscales the whole frame folder in one batch
 *      call (it natively supports -i dir -o dir).
 *   3. ffmpeg reassembles the upscaled frames at the source's original fps
 *      and muxes the source's original audio back in.
 * Real videos mean real frame counts (a 2-minute 30fps clip is ~3600
 * frames) — this is slow and uses real disk space for the temp frames,
 * by design; there's no shortcut around per-frame AI upscaling.
 */
// @category: upscaler/video-upscale-pipeline

/** Runs one child process, wiring it into the task's cancel button (entry.child)
 *  and forwarding each output chunk to onChunk for progress parsing. Resolves on
 *  exit code 0, rejects with the tail of stderr (or stdout, if that's where a
 *  given tool logs) otherwise. */
function spawnTracked(cmd, args, entry, { onStdout, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(cmd, args)
    } catch (err) {
      reject(err)
      return
    }
    entry.child = child
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
        resolve({ fps, frameCount })
      } catch {
        resolve(null)
      }
    })
  })
}

function isCanceled(id) {
  return tasks.get(id)?.state.status === 'canceled'
}

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

  tasks.set(id, {
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

async function runVideoUpscale(id, req, outputPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-upscale-'))
  const framesDir = path.join(tempDir, 'frames')
  const upscaledDir = path.join(tempDir, 'upscaled')
  fs.mkdirSync(framesDir, { recursive: true })
  fs.mkdirSync(upscaledDir, { recursive: true })
  const cleanup = () => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      /* best-effort — a leftover temp dir isn't worth failing the task over */
    }
  }

  const meta = await probeVideoMeta(req.inputPath)
  if (isCanceled(id)) {
    cleanup()
    return
  }
  if (!meta) {
    updateTask(id, { status: 'error', error: "Couldn't read this video's frame rate/frame count." })
    cleanup()
    return
  }

  const entry = tasks.get(id)
  updateTask(id, { status: 'running' })

  // Phase budget: extraction 0-20%, upscaling 20-90%, reassembly 90-100%.
  try {
    await spawnTracked(
      'ffmpeg',
      ['-y', '-i', req.inputPath, '-progress', 'pipe:1', '-nostats', path.join(framesDir, '%08d.png')],
      entry,
      {
        onStdout: (text) => {
          const m = text.match(/frame=\s*(\d+)/)
          if (m) updateTask(id, { progress: Math.min(0.2, (0.2 * Number(m[1])) / meta.frameCount) })
        },
      },
    )
  } catch (err) {
    // A cancel mid-phase kills entry.child, which makes spawnTracked's
    // promise reject just like a real failure would — don't let that
    // overwrite the 'canceled' status tasks:cancel already set.
    if (!isCanceled(id)) updateTask(id, { status: 'error', error: `Frame extraction failed: ${err.message}` })
    cleanup()
    return
  }
  if (isCanceled(id)) {
    cleanup()
    return
  }

  try {
    let doneCount = 0
    await spawnTracked(
      'realesrgan-ncnn-vulkan',
      ['-i', framesDir, '-o', upscaledDir, '-s', String(req.scale), '-n', req.model, '-v'],
      entry,
      {
        onStderr: (text) => {
          // "-> ... done" lines mark whole-frame completion — far more useful
          // for overall video progress than the per-tile percentage lines,
          // which restart for every individual frame.
          const matches = text.match(/ done\r?\n/g)
          if (matches) {
            doneCount += matches.length
            updateTask(id, { progress: Math.min(0.9, 0.2 + (0.7 * doneCount) / meta.frameCount) })
          }
        },
      },
    )
  } catch (err) {
    if (!isCanceled(id)) updateTask(id, { status: 'error', error: `Upscaling failed: ${err.message}` })
    cleanup()
    return
  }
  if (isCanceled(id)) {
    cleanup()
    return
  }

  try {
    await spawnTracked(
      'ffmpeg',
      [
        '-y',
        '-framerate', String(meta.fps),
        '-i', path.join(upscaledDir, '%08d.png'),
        '-i', req.inputPath,
        '-map', '0:v',
        '-map', '1:a?',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-shortest',
        '-progress', 'pipe:1',
        '-nostats',
        outputPath,
      ],
      entry,
      {
        onStdout: (text) => {
          const m = text.match(/frame=\s*(\d+)/)
          if (m) updateTask(id, { progress: Math.min(1, 0.9 + (0.1 * Number(m[1])) / meta.frameCount) })
        },
      },
    )
  } catch (err) {
    if (!isCanceled(id)) updateTask(id, { status: 'error', error: `Reassembly failed: ${err.message}` })
    cleanup()
    return
  }

  cleanup()

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

  return
}

// --- end: upscaler/video-upscale-pipeline ---

/**
 * Frame interpolation — same three-phase shape as video upscaling, swapping
 * realesrgan-ncnn-vulkan for rife-ncnn-vulkan:
 *   1. ffmpeg extracts every frame to lossless PNGs.
 *   2. rife-ncnn-vulkan interpolates the whole frame folder in one batch call,
 *      generating extra in-between frames (-n sets the target frame count).
 *   3. ffmpeg reassembles the interpolated frames at multiplier×fps and muxes
 *      the source's original audio back in — duration is unchanged, motion
 *      is just smoother.
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

  tasks.set(id, {
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

async function runInterpolate(id, req, outputPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-interpolate-'))
  const framesDir = path.join(tempDir, 'frames')
  const interpolatedDir = path.join(tempDir, 'interpolated')
  fs.mkdirSync(framesDir, { recursive: true })
  fs.mkdirSync(interpolatedDir, { recursive: true })
  const cleanup = () => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      /* best-effort — a leftover temp dir isn't worth failing the task over */
    }
  }

  const meta = await probeVideoMeta(req.inputPath)
  if (isCanceled(id)) {
    cleanup()
    return
  }
  if (!meta) {
    updateTask(id, { status: 'error', error: "Couldn't read this video's frame rate/frame count." })
    cleanup()
    return
  }

  const entry = tasks.get(id)
  updateTask(id, { status: 'running' })
  const targetFrameCount = meta.frameCount * req.multiplier

  // Phase budget: extraction 0-20%, interpolation 20-90%, reassembly 90-100%.
  try {
    await spawnTracked(
      'ffmpeg',
      ['-y', '-i', req.inputPath, '-progress', 'pipe:1', '-nostats', path.join(framesDir, '%08d.png')],
      entry,
      {
        onStdout: (text) => {
          const m = text.match(/frame=\s*(\d+)/)
          if (m) updateTask(id, { progress: Math.min(0.2, (0.2 * Number(m[1])) / meta.frameCount) })
        },
      },
    )
  } catch (err) {
    // A cancel mid-phase kills entry.child, which makes spawnTracked's
    // promise reject just like a real failure would — don't let that
    // overwrite the 'canceled' status tasks:cancel already set.
    if (!isCanceled(id)) updateTask(id, { status: 'error', error: `Frame extraction failed: ${err.message}` })
    cleanup()
    return
  }
  if (isCanceled(id)) {
    cleanup()
    return
  }

  try {
    let doneCount = 0
    await spawnTracked(
      'rife-ncnn-vulkan',
      ['-i', framesDir, '-o', interpolatedDir, '-n', String(targetFrameCount), '-v'],
      entry,
      {
        onStderr: (text) => {
          const matches = text.match(/ done\r?\n/g)
          if (matches) {
            doneCount += matches.length
            updateTask(id, { progress: Math.min(0.9, 0.2 + (0.7 * doneCount) / targetFrameCount) })
          }
        },
      },
    )
  } catch (err) {
    if (!isCanceled(id)) updateTask(id, { status: 'error', error: `Interpolation failed: ${err.message}` })
    cleanup()
    return
  }
  if (isCanceled(id)) {
    cleanup()
    return
  }

  try {
    await spawnTracked(
      'ffmpeg',
      [
        '-y',
        '-framerate', String(meta.fps * req.multiplier),
        '-i', path.join(interpolatedDir, '%08d.png'),
        '-i', req.inputPath,
        '-map', '0:v',
        '-map', '1:a?',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-shortest',
        '-progress', 'pipe:1',
        '-nostats',
        outputPath,
      ],
      entry,
      {
        onStdout: (text) => {
          const m = text.match(/frame=\s*(\d+)/)
          if (m) updateTask(id, { progress: Math.min(1, 0.9 + (0.1 * Number(m[1])) / targetFrameCount) })
        },
      },
    )
  } catch (err) {
    if (!isCanceled(id)) updateTask(id, { status: 'error', error: `Reassembly failed: ${err.message}` })
    cleanup()
    return
  }

  cleanup()

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

  return
}

// --- end: interpolate/frame-interpolation-pipeline ---

/**
 * Subtitle generation — faster-whisper transcribes the source's speech into an
 * .srt/.vtt written beside the other outputs, named after the source so video
 * players pick it up automatically. faster-whisper decodes audio itself (PyAV),
 * so ffmpeg isn't needed. The first run of each model downloads it from
 * Hugging Face into the user's cache; after that everything is offline.
 */
// @category: subtitles/whisper-transcription
const WHISPER_MODELS = ['tiny', 'base', 'small', 'medium']
const SUBTITLE_FORMATS = ['srt', 'vtt']
const WHISPER_SCRIPT = path.join(__dirname, 'whisper_subtitles.py')

handleStart('tasks:startSubtitles', (_e, req) => {
  assertAbsolutePath(req.inputPath, 'inputPath')
  if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
  assertOneOf(req.model, WHISPER_MODELS, 'model')
  assertOneOf(req.format, SUBTITLE_FORMATS, 'format')
  if (req.language !== 'auto' && !/^[a-z]{2,3}$/.test(req.language)) throw new Error(`Invalid language: ${req.language}`)
  const id = crypto.randomUUID()
  const destDir = req.destination || defaultDownloadDir()
  fs.mkdirSync(destDir, { recursive: true })

  const inputBase = path.basename(req.inputPath, path.extname(req.inputPath))
  const outputPath = uniqueOutputPath(destDir, inputBase, req.format)

  tasks.set(id, {
    state: {
      id,
      kind: 'subtitles',
      status: 'queued',
      progress: 0,
      label: path.basename(req.inputPath),
      format: req.format.toUpperCase(),
      quality: `Whisper ${req.model}`,
      sizeBytes: null,
      sizeIsEstimate: false,
      thumbnailUrl: null,
      experimentalMatch: null,
    },
    child: null,
    finalPath: outputPath,
  })
  broadcastTasks()

  // Read here rather than passed as a path: inside a packaged app.asar, Node can
  // read the script but an external Python can't open it.
  let script
  try {
    script = fs.readFileSync(WHISPER_SCRIPT, 'utf8')
  } catch (err) {
    updateTask(id, { status: 'error', error: `Subtitle script missing: ${err.message}` })
    return id
  }

  const entry = tasks.get(id)
  updateTask(id, { status: 'running' })
  let lineBuf = ''
  spawnTracked(
    pythonCommand(),
    ['-c', script, req.inputPath, outputPath, req.model, req.language, req.format],
    entry,
    {
      onStdout: (text) => {
        lineBuf += text
        const lines = lineBuf.split(/\r?\n/)
        lineBuf = lines.pop()
        for (const line of lines) {
          const progress = line.match(/^PROGRESS ([\d.]+)/)
          if (progress) updateTask(id, { progress: Math.min(1, Number(progress[1])) })
          const lang = line.match(/^LANG (\S+)/)
          if (lang) updateTask(id, { quality: `Whisper ${req.model} · ${lang[1]}` })
        }
      },
    },
  )
    .then(() => {
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
    .catch((err) => {
      if (isCanceled(id)) return
      const missing = err.code === 'ENOENT'
      updateTask(id, {
        status: 'error',
        error: missing ? `${pythonCommand()} not found on PATH — faster-whisper needs Python 3` : err.message,
      })
    })

  return id
})
// --- end: subtitles/whisper-transcription ---

/* --- External links open in the OS browser, not inside the app window --- */
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url)
    return { action: 'deny' }
  })
})

app.whenReady().then(() => {
  loadHistory()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Don't orphan ffmpeg/soffice/python on exit, and don't lose a result that finished inside
// the 400ms history-save debounce.
app.on('before-quit', () => {
  clearTimeout(saveTimer)
  for (const entry of tasks.values()) {
    if (entry.state.status === 'queued' || entry.state.status === 'running') killTask(entry)
  }
  saveHistory()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})