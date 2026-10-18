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

const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { readOmarchyTheme, watchOmarchyTheme } = require('./omarchy.cjs')
const { getSettings, setSettings, ytdlpBaseArgs, hasCookies } = require('./settings.cjs')
const { openLoginWindow, clearLogin, loginStatus, loginContents } = require('./login.cjs')
const { createSubscriptionManager } = require('./subscriptions.cjs')

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

// Shared yt-dlp args (UTF-8 output, proxy, login cookies) come from ytdlpBaseArgs() in settings.cjs.
ipcMain.handle('settings:get', () => getSettings())
ipcMain.handle('settings:set', (_e, patch) => setSettings(patch))

// Built-in sign-in window (see login.cjs): the user logs in themselves, OPNduck keeps only cookies.
ipcMain.handle('login:open', async (e, url) => {
  const result = await openLoginWindow(BrowserWindow.fromWebContents(e.sender), url)
  // Signing in is a clear signal the user wants those cookies used from now on.
  if (result.ok && result.cookies > 0) setSettings({ cookies: { mode: 'login' } })
  return result
})
ipcMain.handle('login:status', () => loginStatus())
ipcMain.handle('login:clear', async () => {
  await clearLogin()
  if (getSettings().cookies.mode === 'login') setSettings({ cookies: { mode: 'none' } })
})
// Reads the signed-in-only Watch Later list through the current cookie source: if that works,
// private videos, Liked and age-restricted media will too.
ipcMain.handle('login:test', async () => {
  const list = await probePlaylist('https://www.youtube.com/playlist?list=WL')
  if (!list) {
    return { ok: false, message: "Couldn't read Watch Later — you're not signed in, or the cookies expired." }
  }
  return { ok: true, message: `Signed in — Watch Later is readable (${list.count} videos).` }
})

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

/**
 * The Python that runs Demucs. OPNDUCK_PYTHON wins; otherwise the venv the install hint creates
 * (~/.opnduck-venv) is used automatically if it exists, so there's nothing to configure; otherwise
 * the system Python. Kept separate from pythonCommand() because the venv holds torch/demucs but
 * not necessarily faster-whisper, which the Subtitles card looks for in the regular Python.
 */
function demucsPython() {
  if (process.env.OPNDUCK_PYTHON) return process.env.OPNDUCK_PYTHON
  const venv =
    process.platform === 'win32'
      ? path.join(os.homedir(), 'opnduck-venv', 'Scripts', 'python.exe')
      : path.join(os.homedir(), '.opnduck-venv', 'bin', 'python')
  return fs.existsSync(venv) ? venv : pythonCommand()
}

function fasterWhisperInstallHint() {
  if (process.platform === 'win32') return 'python -m pip install faster-whisper'
  if (process.platform === 'darwin') return 'python3 -m pip install faster-whisper'
  return 'yay -S python-faster-whisper   (AUR; or pip install faster-whisper in a venv and set OPNDUCK_PYTHON to its python)'
}

/** Where Python runs from: `python -c` puts the cwd on sys.path, so never a shared/user folder. */
function pythonCwd() {
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function demucsInstallHint() {
  if (process.platform === 'win32') return 'python -m venv %USERPROFILE%\\opnduck-venv  &&  %USERPROFILE%\\opnduck-venv\\Scripts\\pip install torch demucs soundfile   (OPNduck finds that venv by itself — just restart it)'
  return 'python -m venv ~/.opnduck-venv && ~/.opnduck-venv/bin/pip install torch demucs soundfile   (OPNduck finds that venv by itself — just restart it)'
}

ipcMain.handle('system:checkDemucs', () => {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(demucsPython(), ['-c', 'import torch, demucs, soundfile'], { cwd: pythonCwd() })
    } catch {
      resolve({ available: false, installHint: demucsInstallHint() })
      return
    }
    child.on('error', () => resolve({ available: false, installHint: demucsInstallHint() }))
    child.on('close', (code) => resolve({ available: code === 0, installHint: demucsInstallHint() }))
  })
})

ipcMain.handle('system:checkFasterWhisper', () => {
  return new Promise((resolve) => {
    let child
    try {
      // cwd = tmpdir: `python -c` puts the cwd on sys.path, so never run it from a folder
      // that could hold a planted faster_whisper.py.
      child = spawn(pythonCommand(), ['-c', 'import faster_whisper'], { cwd: pythonCwd() })
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
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) })
    // A redirect off open.spotify.com is not something to scrape.
    if (new URL(res.url).hostname !== 'open.spotify.com') return { error: "Spotify redirected somewhere unexpected — can't read this track." }
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

/** Registers a new task, stamping when it was created (the Library sorts on it). */
function addTask(id, entry) {
  entry.state.createdAt = Date.now()
  tasks.set(id, entry)
}

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
const MAX_HISTORY = 500
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

/** A batch tag from a request: `{ id, label, size }` or null if it isn't a sane one. */
function sanitizeBatch(b) {
  if (!b || typeof b !== 'object') return null
  const { id, label, size } = b
  if (typeof id !== 'string' || id.length < 1 || id.length > 80) return null
  if (typeof label !== 'string' || label.length > 120) return null
  if (!Number.isInteger(size) || size < 2 || size > 1000) return null
  return { id, label, size }
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
      // Jobs started together (a batch of files, or a download plus its audio tracks) share a
      // group, which the Library shows as one collapsible block.
      entry.state.group = sanitizeBatch(req?.batch)
      broadcastTasks() // a task waiting in a queue wouldn't otherwise show its group until it starts
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
  // A job that never produced output leaves behind the empty placeholder uniqueOutputPath() made.
  if (entry.state.status !== 'done' && entry.finalPath && TERMINAL.includes(entry.state.status)) {
    try {
      if (fs.statSync(entry.finalPath).size === 0) fs.rmSync(entry.finalPath, { force: true })
    } catch {
      /* nothing there */
    }
  }
  if (entry.onDone && TERMINAL.includes(entry.state.status)) {
    const cb = entry.onDone
    entry.onDone = null
    cb(entry.state)
  }
  broadcastTasks()
}

/** A counting semaphore: queued jobs wait here for a slot instead of all starting at once. */
function makePool(limit) {
  let active = 0
  const waiters = []
  return {
    acquire() {
      if (active < limit) {
        active++
        return Promise.resolve()
      }
      return new Promise((resolve) => waiters.push(resolve))
    },
    release() {
      const next = waiters.shift()
      if (next) next() // hand the slot straight over
      else active--
    },
  }
}
// Batches would otherwise spawn one process per file at once: ffmpeg/soffice conversions are
// light (2 at a time); upscalers/interpolation fight over one GPU and Whisper loads a whole
// model per process (1 at a time each).
const convertPool = makePool(2)
const gpuPool = makePool(1)
const whisperPool = makePool(1)
// yt-dlp downloads: a big batch, "Retry failed" or several subscriptions must not start 1000 at once.
const downloadPool = makePool(3)

/** Runs `work` once the pool has a free slot. The slot is released by updateTask() when the
 *  task reaches a terminal state, or immediately if the task was canceled while waiting. */
async function runInPool(pool, id, work) {
  await pool.acquire()
  const entry = tasks.get(id)
  if (!entry || isCanceled(id)) return pool.release()
  let released = false
  entry.releaseSlot = () => {
    if (!released) {
      released = true
      pool.release()
    }
  }
  try {
    await work()
  } catch (err) {
    updateTask(id, { status: 'error', error: `Failed to start: ${err.message}` })
  }
}

/** Kill a job's process, including children: soffice is a launcher whose real worker
 *  (soffice.bin) would otherwise be orphaned. Detached jobs lead their own group. */
function killTask(entry) {
  const child = entry.child
  if (!child) return
  try {
    if (entry.killGroup && process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM')
    else if (entry.killGroup && process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']).on('error', () => child.kill())
    else child.kill()
  } catch {
    child.kill()
  }
}

const AUDIO_EXT = { MP3: 'mp3', FLAC: 'flac', WAV: 'wav' }
const VIDEO_EXT = { MP4: 'mp4', MKV: 'mkv', MOV: 'mov' }

/** Human label shown in the UI/tags for whichever quality field applies to this format. */
function qualityLabel(req) {
  if (req.audioLang) return `Audio · ${req.audioLang}`
  if (req.format in AUDIO_EXT) {
    if (req.format !== 'MP3') return 'Lossless'
    return !req.audioQuality || req.audioQuality === 'best' ? 'Best' : req.audioQuality
  }
  return !req.videoQuality || req.videoQuality === 'best' ? 'Best' : `${req.videoQuality}p`
}

/** Subtitle flags for a request (empty when the user didn't ask for any). */
function subtitleArgs(req) {
  const subs = req.subs
  if (!subs || subs.mode === 'off' || subs.langs.length === 0) return []
  const args = ['--sub-langs', subs.langs.join(','), '--convert-subs', 'srt']
  if (subs.mode === 'manual' || subs.mode === 'both') args.push('--write-subs')
  if (subs.mode === 'auto' || subs.mode === 'both') args.push('--write-auto-subs')
  // Embedding only makes sense when there's a video container to put them in.
  if (subs.embed && !subs.only && Object.hasOwn(VIDEO_EXT, req.format)) args.push('--embed-subs')
  if (subs.only) args.push('--skip-download')
  return args
}

/** Maps a Downloader format + quality choice to yt-dlp CLI args. */
function formatArgs(req) {
  const subs = subtitleArgs(req)
  // "Subtitles only": no media at all, so no -f / -x / merge flags.
  if (req.subs?.only && subs.length) return subs
  if (Object.hasOwn(AUDIO_EXT, req.format)) {
    const args = ['-x', '--audio-format', AUDIO_EXT[req.format]]
    if (req.audioLang) args.push('-f', `ba[language^=${req.audioLang}]/ba`) // one dubbed/language track
    if (req.format === 'MP3') {
      args.push('--audio-quality', req.audioQuality && req.audioQuality !== 'best' ? req.audioQuality : '0')
    }
    return [...args, ...subs]
  }
  if (Object.hasOwn(VIDEO_EXT, req.format)) {
    const height = req.videoQuality && req.videoQuality !== 'best' ? Number(req.videoQuality) : null
    const selector = height ? `bv*[height<=${height}]+ba/b[height<=${height}]` : 'bv*+ba/b'
    return ['-f', selector, '--merge-output-format', VIDEO_EXT[req.format], ...subs]
  }
  throw new Error(`Unsupported format: ${req.format}`)
}

const YT_HOST_RE = /(^|\.)youtube\.com$|^youtu\.be$/
const CHANNEL_PATH_RE = /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)(\/(videos|shorts|streams|live|playlists))?\/?$/

/**
 * Classifies a pasted link as a list of videos.
 *  kind 'only'  = always a whole list (playlist page, channel, search results, Watch Later/Liked)
 *  kind 'mixed' = a video that also carries a list param (the user picks single vs whole list)
 *  kind null    = just a video
 * `url` is what yt-dlp should be given for the list (channel roots get /videos appended so we
 * get the uploads, not a list of tabs); search pages give a `query` instead (turned into a
 * `ytsearchN:` URL by listUrl()). YouTube's auto-generated "Mix" lists (list=RD...) are endless,
 * so they're never lists — those links just download the one video.
 * `needsLogin` marks lists YouTube only shows to a signed-in account (WL/LL/LM).
 */
function classifyLink(rawUrl) {
  const none = { kind: null, type: null, url: rawUrl, query: null, needsLogin: false }
  let u
  try {
    u = new URL(rawUrl)
  } catch {
    return none
  }
  if (!YT_HOST_RE.test(u.hostname)) return none
  const list = u.searchParams.get('list')
  const loginList = list === 'WL' || list === 'LL' || list === 'LM'

  if (u.pathname === '/results' && u.searchParams.get('search_query')) {
    return { kind: 'only', type: 'search', url: rawUrl, query: u.searchParams.get('search_query'), needsLogin: false }
  }
  if (CHANNEL_PATH_RE.test(u.pathname)) {
    const hasTab = /\/(videos|shorts|streams|live|playlists)\/?$/.test(u.pathname)
    const url = hasTab ? rawUrl : `${u.origin}${u.pathname.replace(/\/$/, '')}/videos`
    return { kind: 'only', type: 'channel', url, query: null, needsLogin: false }
  }
  if (list && !list.startsWith('RD')) {
    if (u.pathname === '/playlist') {
      const type = list === 'WL' ? 'watchlater' : loginList ? 'liked' : 'playlist'
      return { kind: 'only', type, url: rawUrl, query: null, needsLogin: loginList }
    }
    if (u.searchParams.get('v') || u.hostname === 'youtu.be') {
      return { kind: 'mixed', type: 'playlist', url: rawUrl, query: null, needsLogin: loginList }
    }
  }
  return none
}

/** The URL yt-dlp should actually be given for a classified list. */
function listUrl(link, limit) {
  if (link.type === 'search') return `ytsearch${Math.min(limit || 20, 100)}:${link.query}`
  return link.url
}

/** Title + video count of a playlist without downloading anything (--flat-playlist is fast). */
function probePlaylist(url) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('yt-dlp', [...ytdlpBaseArgs(), '--flat-playlist', '--dump-single-json', '--no-warnings', '--playlist-end', '5000', '--', url])
    } catch {
      resolve(null)
      return
    }
    let out = ''
    // A channel can hold thousands of videos; never let a link check hang the UI.
    const timer = setTimeout(() => child.kill(), 45_000)
    child.stdout.on('data', (c) => {
      out += c
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', () => {
      clearTimeout(timer)
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
  const empty = { approxSizeBytes: null, thumbnailUrl: null, playlist: null }
  if (!parseHttpUrl(req.url)) return { title: 'Only http(s) links are supported', ...empty }
  const spotify = await resolveSpotifyTrack(req.url)
  if (spotify?.error) return { title: spotify.error, ...empty }
  const effectiveUrl = spotify?.query ?? req.url

  const link = spotify ? classifyLink('') : classifyLink(req.url)
  const kind = link.kind
  const loginMissing = link.needsLogin && !hasCookies()
  // Playlist lookup runs alongside the single-video lookup below instead of
  // before it, so a playlist link doesn't take the sum of both round trips.
  const playlistPromise = kind ? probePlaylist(listUrl(link, req.limit)) : Promise.resolve(null)
  const playlist = kind === 'only' ? await playlistPromise : null
  const playlistInfo = playlist
    ? { title: playlist.title, count: playlist.count, ambiguous: false, type: link.type, needsLogin: loginMissing }
    : null
  // A pure list page has no single video to size up — a total would mean probing every entry.
  // The UI shows the video count instead.
  if (kind === 'only') {
    if (playlist) return { title: playlist.title, approxSizeBytes: null, thumbnailUrl: playlist.thumbnailUrl, playlist: playlistInfo }
    // The list couldn't be read (most often: it needs a signed-in account). Say so instead of
    // quietly treating a list URL as a single video.
    return {
      title: loginMissing ? 'This list needs you to be signed in' : "Couldn't read this list",
      approxSizeBytes: null,
      thumbnailUrl: null,
      playlist: { title: loginMissing ? 'Sign-in required' : 'Unavailable', count: 0, ambiguous: false, type: link.type, needsLogin: loginMissing },
    }
  }

  const single = await new Promise((resolve) => {
    const fallback = { title: req.url, approxSizeBytes: null, thumbnailUrl: null }
    let child
    try {
      child = spawn('yt-dlp', [...ytdlpBaseArgs(), '--dump-json', '--no-warnings', '--no-playlist', '--', effectiveUrl])
    } catch {
      resolve(fallback)
      return
    }
    let out = ''
    // A dead proxy or a stuck cookie-keyring prompt must not leave a yt-dlp running per link edit.
    const timer = setTimeout(() => child.kill(), 60_000)
    child.stdout.on('data', (c) => {
      out += c
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve(fallback)
    })
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const info = JSON.parse(out.trim().split('\n')[0])
        resolve({
          title: spotify ? `${spotify.label} (YouTube match)` : (info.title ?? req.url),
          approxSizeBytes: estimateSize(info, req),
          thumbnailUrl: info.thumbnail ?? null,
          ...extraInfo(info),
        })
      } catch {
        resolve(fallback)
      }
    })
  })
  const mixedPlaylist = kind === 'mixed' ? await playlistPromise : null
  return {
    ...single,
    playlist: mixedPlaylist
      ? { title: mixedPlaylist.title, count: mixedPlaylist.count, ambiguous: true, type: link.type, needsLogin: loginMissing }
      : null,
  }
}

/** The options a video actually offers, so the UI only shows choices that exist: subtitle
 *  languages (uploaded vs auto-generated), separate-language audio tracks, 360°/3D. */
function extraInfo(info) {
  const subtitleLangs = Object.keys(info.subtitles || {}).filter((k) => k !== 'live_chat')
  // YouTube lists ~150 auto-translations; offer the original-language track plus common ones.
  const COMMON = ['en', 'sv', 'es', 'de', 'fr', 'pt', 'it', 'nl', 'ru', 'ja', 'ko', 'zh-Hans', 'ar', 'tr', 'pl']
  const autoLangs = Object.keys(info.automatic_captions || {}).filter((k) => k.endsWith('-orig') || COMMON.includes(k))
  const audioLangs = [
    ...new Set(
      (info.formats || [])
        .filter((f) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none' && f.language)
        .map((f) => String(f.language)),
    ),
  ]
  const flags = []
  if (info.projection && info.projection !== 'rectangular') flags.push('360')
  if (info.stereo_mode || (info.formats || []).some((f) => /3d/i.test(String(f.format_note || '')))) flags.push('3d')
  return { subtitleLangs, autoLangs, audioLangs, flags }
}

/** Checks a Downloader request up front, so a bad one is rejected instead of leaving a task
 *  stuck in 'queued' after it has already been created. Also trims the URL. */
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

function validateDownloadRequest(req) {
  req.url = String(req.url ?? '').trim()
  if (!Object.hasOwn(AUDIO_EXT, req.format) && !Object.hasOwn(VIDEO_EXT, req.format)) {
    throw new Error(`Unsupported format: ${req.format}`)
  }
  if (req.videoQuality != null && req.videoQuality !== 'best' && !/^\d{3,4}$/.test(String(req.videoQuality))) {
    throw new Error(`Invalid video quality: ${req.videoQuality}`)
  }
  // "First N" of a list/channel/search.
  if (req.limit != null && !(Number.isInteger(req.limit) && req.limit >= 1 && req.limit <= 5000)) {
    throw new Error(`Invalid list limit: ${req.limit}`)
  }
  if (req.subs != null) {
    const subs = req.subs
    if (!['off', 'manual', 'auto', 'both'].includes(subs.mode)) throw new Error(`Invalid subtitle mode: ${subs.mode}`)
    if (!Array.isArray(subs.langs) || subs.langs.length > 20 || !subs.langs.every((l) => typeof l === 'string' && LANG_RE.test(l))) {
      throw new Error('Invalid subtitle languages')
    }
  }
  if (req.audioTracks != null) {
    if (!Array.isArray(req.audioTracks) || req.audioTracks.length > 10 || !req.audioTracks.every((l) => typeof l === 'string' && LANG_RE.test(l))) {
      throw new Error('Invalid audio track languages')
    }
  }
  if (req.audioLang != null && !LANG_RE.test(String(req.audioLang))) throw new Error('Invalid audio language')
}

ipcMain.handle('tasks:probe', (_e, req) => {
  req.url = String(req.url ?? '').trim()
  return probeInfo(req)
})

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
  validateDownloadRequest(req)
  if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
  if (req.audioQuality != null) {
    if (typeof req.audioQuality !== 'string' || !/^(best|\d{1,3}k?)$/i.test(req.audioQuality)) {
      throw new Error(`Invalid audio quality: ${req.audioQuality}`)
    }
  }
  const id = crypto.randomUUID()
  const destDir = req.destination || defaultDownloadDir()
  fs.mkdirSync(destDir, { recursive: true })
  // A download plus its separate audio-track files reads as one group in the Library.
  if (req.audioTracks?.length && !req.audioLang && (!req.batch || String(req.batch.id).startsWith('tracks-'))) {
    req.batch = { id: `tracks-${id}`, label: 'Download + audio tracks', size: 1 + req.audioTracks.length }
  }

  addTask(id, {
    state: {
      id,
      kind: 'download',
      status: 'queued',
      progress: 0,
      label: req.url,
      format: req.format,
      quality: qualityLabel(req),
      sizeBytes: Number.isFinite(req.approxSizeBytes) && req.approxSizeBytes >= 0 ? req.approxSizeBytes : null,
      sizeIsEstimate: true,
      thumbnailUrl: typeof req.thumbnailUrl === 'string' && parseHttpUrl(req.thumbnailUrl) ? req.thumbnailUrl : null,
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
  // Whole-list mode: list pages (playlist, channel, search, Watch Later/Liked) always, a
  // "video inside a playlist" link only when the user explicitly chose the whole list.
  const link = spotify ? classifyLink('') : classifyLink(req.url)
  const kind = link.kind
  const wholePlaylist = kind === 'only' || (kind === 'mixed' && req.playlist === 'all')
  if (wholePlaylist && link.needsLogin && !hasCookies()) {
    updateTask(id, { status: 'error', error: 'This list needs you to be signed in. Set a cookie source in Settings → Downloads.' })
    return id
  }
  const effectiveUrl = spotify?.query ?? (wholePlaylist && kind === 'only' ? listUrl(link, req.limit) : req.url)
  if (wholePlaylist) updateTask(id, { sizeBytes: null, playlist: { index: 0, total: 0 } })

  // Extra dubbed/language audio tracks become their own small audio tasks, so each shows up
  // (and can be re-run) separately in the Library.
  // (Not for whole lists: each child would download the entire list again.)
  if (req.audioTracks?.length && !req.audioLang && !wholePlaylist) {
    const startOne = startHandlers.get('tasks:start')
    for (const lang of req.audioTracks) {
      startOne(null, {
        ...req,
        format: 'MP3',
        audioQuality: 'best',
        videoQuality: undefined,
        audioTracks: undefined,
        subs: undefined,
        audioLang: lang,
        playlist: 'single',
        approxSizeBytes: null,
        thumbnailUrl: req.thumbnailUrl ?? null,
      }).catch(() => {
        /* a failed track start is reported on its own task; never block the main download */
      })
    }
  }
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
  // "First N" of a list (search results already carry N inside their ytsearchN: URL).
  const limitArgs = wholePlaylist && req.limit && link.type !== 'search' ? ['--playlist-end', String(req.limit)] : []
  const fileTemplate = req.audioLang ? '%(title)s [%(language)s].%(ext)s' : '%(title)s.%(ext)s'
  const args = wholePlaylist
    ? [
        ...ytdlpBaseArgs(),
        ...formatArgs(req),
        '--newline',
        '--yes-playlist',
        ...limitArgs,
        // One unavailable/private video shouldn't abort the other 99.
        '--ignore-errors',
        '-o',
        path.join(outDirTemplate, '%(playlist_title|Playlist)s', '%(playlist_index)03d - %(title)s.%(ext)s'),
        '--',
        effectiveUrl,
      ]
    : [
        ...ytdlpBaseArgs(),
        ...formatArgs(req),
        '--newline',
        '--no-playlist',
        '-o',
        path.join(outDirTemplate, fileTemplate),
        '--',
        effectiveUrl,
      ]

  // Wait for a free download slot (the task shows as 'queued'); released when it finishes.
  await downloadPool.acquire()
  const slotEntry = tasks.get(id)
  if (!slotEntry || isCanceled(id)) {
    downloadPool.release()
    return id
  }
  let slotReleased = false
  slotEntry.releaseSlot = () => {
    if (!slotReleased) {
      slotReleased = true
      downloadPool.release()
    }
  }

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
      // Subtitles-only jobs have no media file: the subtitle file is the result.
      const subFile = req.subs?.only ? line.match(/Writing video subtitles to:\s+(.+)$/) : null
      if (subFile) {
        // yt-dlp writes the original (.vtt etc.) and converts to .srt, deleting the original.
        entry.finalPath = subFile[1].trim().replace(/\.[^./\\]+$/, '.srt')
        files.add(entry.finalPath)
        updateTask(id, { label: path.basename(entry.finalPath) })
      }
      const dest = line.match(/(?:Destination|Merging formats into):?\s+"?([^"\n]+)"?/)
      if (dest && !req.subs?.only) {
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

/** Newest entries of a list (flat, nothing downloaded): title + `{ id, url }` per video. */
function probeEntries(rawUrl, limit) {
  const link = classifyLink(rawUrl)
  const url = link.kind === 'only' ? listUrl(link, limit) : rawUrl
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('yt-dlp', [...ytdlpBaseArgs(), '--flat-playlist', '--dump-single-json', '--no-warnings', '--playlist-end', String(limit), '--', url])
    } catch {
      resolve(null)
      return
    }
    let out = ''
    const timer = setTimeout(() => child.kill(), 60_000)
    child.stdout.on('data', (c) => {
      out += c
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const info = JSON.parse(out)
        // A single video is not a list you can subscribe to.
        if (info._type !== 'playlist' || !Array.isArray(info.entries)) return resolve(null)
        const entries = info.entries
          .filter((e) => e && typeof e.id === 'string')
          .map((e) => ({
            id: e.id,
            url: parseHttpUrl(e.url) ? e.url : parseHttpUrl(e.webpage_url) ? e.webpage_url : `https://www.youtube.com/watch?v=${e.id}`,
          }))
        resolve({ title: info.title ?? 'Subscription', entries })
      } catch {
        resolve(null)
      }
    })
  })
}

// Subscriptions (auto-download new uploads) — see subscriptions.cjs. Created once the app is ready
// because it needs userData; IPC before that point is rejected.
let subscriptions = null
function startSubscriptions() {
  subscriptions = createSubscriptionManager({
    file: path.join(app.getPath('userData'), 'subscriptions.json'),
    seenDir: path.join(app.getPath('userData'), 'subscriptions'),
    listEntries: probeEntries,
    startDownload: (req) => startHandlers.get('tasks:start')(null, req),
    whenTaskDone: (taskId, cb) => {
      const entry = tasks.get(taskId)
      if (!entry) return cb({ status: 'error' })
      if (TERMINAL.includes(entry.state.status)) return cb(entry.state)
      entry.onDone = cb
    },
    notify: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body }).show()
    },
    onChange: (list) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('subs:changed', list)
    },
    defaultDir: defaultDownloadDir,
  })
  subscriptions.start()
}
const needSubs = () => {
  if (!subscriptions) throw new Error('Subscriptions are still starting up — try again in a moment.')
  return subscriptions
}
ipcMain.handle('subs:list', () => (subscriptions ? subscriptions.list() : []))
ipcMain.handle('subs:add', async (_e, input) => {
  if (!input || typeof input !== 'object') throw new Error('Invalid subscription')
  const url = String(input.url ?? '').trim()
  if (!parseHttpUrl(url)) throw new Error('Subscriptions need an http(s) link to a channel or playlist.')
  // Validate format/quality exactly like a download request would be.
  const probeReq = { url, format: input.format, videoQuality: input.videoQuality, audioQuality: input.audioQuality }
  validateDownloadRequest(probeReq)
  if (input.audioQuality != null && !/^(best|\d{1,3}k?)$/i.test(String(input.audioQuality))) throw new Error('Invalid audio quality')
  if (input.destination) assertAbsolutePath(input.destination, 'destination')
  // A video link that merely carries a list → subscribe to the list itself.
  const link = classifyLink(url)
  const listLink = link.kind === 'mixed' ? `https://www.youtube.com/playlist?list=${encodeURIComponent(new URL(url).searchParams.get('list') ?? '')}` : url
  return needSubs().add({
    url: listLink,
    format: probeReq.format,
    videoQuality: probeReq.videoQuality,
    audioQuality: probeReq.audioQuality,
    destination: input.destination || '',
    backfill: input.backfill,
  })
})
ipcMain.handle('subs:remove', (_e, id) => needSubs().remove(String(id)))
ipcMain.handle('subs:setEnabled', (_e, id, enabled) => needSubs().setEnabled(String(id), !!enabled))
ipcMain.handle('subs:checkNow', (_e, id) => needSubs().checkNow(id ? String(id) : undefined))

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
  if (entry.finalPath && fs.existsSync(entry.finalPath)) return shell.showItemInFolder(entry.finalPath)
  // req comes from an imported file for some entries, so it may hold anything: openPath() would
  // happily launch a file (script, .desktop, ...) with its default app. Only ever open a folder.
  const dest = entry.req?.destination
  let dir = defaultDownloadDir()
  try {
    if (typeof dest === 'string' && path.isAbsolute(dest) && fs.statSync(dest).isDirectory()) dir = dest
  } catch {
    /* missing or unreadable: fall back to the default folder */
  }
  shell.openPath(dir)
})
// Removes specific finished tasks from the history (running ones are never touched).
ipcMain.handle('tasks:remove', (_e, ids) => {
  if (!Array.isArray(ids)) return 0
  let removed = 0
  for (const id of ids.slice(0, 1000)) {
    const t = typeof id === 'string' ? tasks.get(id) : null
    if (t && TERMINAL.includes(t.state.status)) {
      tasks.delete(id)
      removed++
    }
  }
  if (removed) {
    saveHistory()
    broadcastTasks()
  }
  return removed
})
ipcMain.handle('tasks:clearFinished', () => {
  for (const [id, t] of tasks) if (TERMINAL.includes(t.state.status)) tasks.delete(id)
  saveHistory()
  broadcastTasks()
})
/* --- Library export / import ---
 * Export writes the finished tasks (with the requests needed to run them again) as JSON. Import
 * reads such a file back: every field is re-validated here — a hand-edited or hostile file must
 * never smuggle in a channel, path or value the app wouldn't accept from its own UI. */
const TASK_KINDS = ['download', 'convert', 'upscale', 'interpolate', 'subtitles', 'audio-ai']

function sanitizeImported(rows) {
  if (!Array.isArray(rows)) return []
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')
  const out = []
  for (const r of rows.slice(0, 1000)) {
    const st = r?.state
    if (!st || typeof st !== 'object' || !startHandlers.has(r.channel)) continue
    if (!r.req || typeof r.req !== 'object' || Array.isArray(r.req) || JSON.stringify(r.req).length > 20_000) continue
    out.push({
      channel: r.channel,
      req: r.req,
      state: {
        id: crypto.randomUUID(),
        kind: TASK_KINDS.includes(st.kind) ? st.kind : 'download',
        status: TERMINAL.includes(st.status) ? st.status : 'canceled',
        progress: Number.isFinite(st.progress) ? Math.min(1, Math.max(0, st.progress)) : 0,
        label: str(st.label, 300),
        ...(typeof st.error === 'string' ? { error: st.error.slice(0, 500) } : {}),
        format: str(st.format, 40),
        quality: str(st.quality, 60),
        sizeBytes: Number.isFinite(st.sizeBytes) && st.sizeBytes >= 0 ? st.sizeBytes : null,
        sizeIsEstimate: false,
        thumbnailUrl: typeof st.thumbnailUrl === 'string' && parseHttpUrl(st.thumbnailUrl) ? st.thumbnailUrl : null,
        experimentalMatch: typeof st.experimentalMatch === 'string' ? st.experimentalMatch.slice(0, 80) : null,
        createdAt: Number.isFinite(st.createdAt) ? st.createdAt : Date.now(),
        group: sanitizeBatch(st.group),
      },
    })
  }
  return out
}

ipcMain.handle('library:export', async (e) => {
  const rows = [...tasks.values()]
    .filter((t) => TERMINAL.includes(t.state.status) && t.channel)
    .map((t) => ({ state: { ...t.state }, channel: t.channel, req: t.req }))
  const stamp = new Date().toISOString().slice(0, 10)
  const res = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender) ?? undefined, {
    defaultPath: path.join(app.getPath('documents'), `opnduck-library-${stamp}.json`),
    filters: [{ name: 'OPNduck library', extensions: ['json'] }],
  })
  if (res.canceled || !res.filePath) return { ok: false, count: 0 }
  fs.writeFileSync(res.filePath, JSON.stringify({ app: 'OPNduck', version: 1, exportedAt: Date.now(), tasks: rows }, null, 2))
  return { ok: true, count: rows.length, path: res.filePath }
})

ipcMain.handle('library:import', async (e) => {
  const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender) ?? undefined, {
    properties: ['openFile'],
    filters: [{ name: 'OPNduck library', extensions: ['json'] }],
  })
  if (res.canceled || res.filePaths.length === 0) return { ok: false, entries: [] }
  try {
    const file = res.filePaths[0]
    if (fs.statSync(file).size > 5 * 1024 * 1024) return { ok: false, entries: [], error: 'That file is too large to be an OPNduck library export.' }
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (data?.app !== 'OPNduck' || data?.version !== 1) return { ok: false, entries: [], error: "That isn't an OPNduck library export." }
    const entries = sanitizeImported(data.tasks)
    return entries.length ? { ok: true, entries } : { ok: false, entries: [], error: 'No usable entries were found in that file.' }
  } catch (err) {
    return { ok: false, entries: [], error: `Couldn't read that file (${err.message}).` }
  }
})

/** Adds imported entries to the history, or (run=true) starts each as a new job. */
ipcMain.handle('library:importApply', async (_e, entries, run) => {
  const clean = sanitizeImported(entries) // the renderer is not trusted: validate again
  let added = 0
  let started = 0
  for (const entry of clean) {
    if (run) {
      try {
        await startHandlers.get(entry.channel)(null, entry.req)
        started++
      } catch {
        /* a request that no longer validates is skipped */
      }
    } else {
      tasks.set(entry.state.id, { state: entry.state, child: null, finalPath: null, channel: entry.channel, req: entry.req })
      added++
    }
  }
  if (added) {
    scheduleHistorySave()
    broadcastTasks()
  }
  return { added, started }
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

async function videoUpscaleJob(id, req, outputPath) {
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

async function interpolateJob(id, req, outputPath) {
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

  addTask(id, {
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

  runInPool(whisperPool, id, () => {
    // Read here rather than passed as a path: inside a packaged app.asar, Node can
    // read the script but an external Python can't open it.
    let script
    try {
      script = fs.readFileSync(WHISPER_SCRIPT, 'utf8')
    } catch (err) {
      updateTask(id, { status: 'error', error: `Subtitle script missing: ${err.message}` })
      return
    }

    const entry = tasks.get(id)
    updateTask(id, { status: 'running' })
    let lineBuf = ''
    spawnTracked(
      pythonCommand(),
      ['-c', script, req.inputPath, outputPath, req.model, req.language, req.format],
      entry,
      {
        cwd: pythonCwd(), // `python -c` imports from the cwd; keep it out of user/shared folders
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

  })
  return id
})
// --- end: subtitles/whisper-transcription ---

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
const DEMUCS_SCRIPT = path.join(__dirname, 'demucs_separate.py')

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
    let script
    try {
      script = fs.readFileSync(DEMUCS_SCRIPT, 'utf8') // read here: an external Python can't open a file inside app.asar
    } catch (err) {
      return fail('Audio script missing', err)
    }
    try {
      await spawnTracked(demucsPython(), ['-c', script, inWav, stemsDir], entry, {
        cwd: pythonCwd(), // `python -c` imports from the cwd; keep it away from user/shared folders
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
// --- end: audio-ai/demucs-stem-separation ---

/* --- External links open in the OS browser, not inside the app window --- */
app.on('web-contents-created', (_e, contents) => {
  // The window should only ever show the app itself — block any navigation away from it
  // (a stray link, a dropped file) instead of replacing the whole UI.
  contents.on('will-navigate', (event, url) => {
    if (loginContents.has(contents)) return // the sign-in window has its own rules (login.cjs)
    try {
      const target = new URL(url)
      const current = new URL(contents.getURL())
      const same = target.protocol === 'file:' ? current.protocol === 'file:' && target.pathname === current.pathname : target.origin === current.origin
      if (!same) event.preventDefault()
    } catch {
      event.preventDefault()
    }
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url)
    return { action: 'deny' }
  })
})

app.whenReady().then(() => {
  loadHistory()
  startSubscriptions()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => subscriptions?.stop())

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