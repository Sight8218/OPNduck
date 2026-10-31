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

// OPNDUCK_TRACE=1 prints a startup timeline (ms since process start); scripts/perf-check uses it.
const trace = process.env.OPNDUCK_TRACE ? (label) => console.log(`[trace] ${label} ${Math.round(process.uptime() * 1000)}ms`) : () => {}
const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage } = require('electron')

// The last few hundred lines of main-process and renderer console output, for Settings -> Developer tools.
const appLog = []
const { format: formatLog } = require('node:util')
for (const level of ['log', 'info', 'warn', 'error']) {
  const original = console[level].bind(console)
  console[level] = (...args) => {
    appLog.push({ t: Date.now(), level, text: formatLog(...args).slice(0, 500) })
    if (appLog.length > 500) appLog.shift()
    original(...args)
  }
}
// Every IPC call (channel, duration, ok/error; never the arguments) for Settings -> Developer tools.
const ipcTrace = []
const QUIET_CHANNELS = /^(dev:|tasks:list$|tasks:logs$|tasks:logWatch$|queue:state$|settings:get$|mcp:info$)/
{
  const registerHandler = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, listener) =>
    registerHandler(channel, async (...args) => {
      const t0 = performance.now()
      let error = null
      try {
        return await listener(...args)
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
        throw err
      } finally {
        if (!QUIET_CHANNELS.test(channel)) {
          ipcTrace.push({ t: Date.now(), channel, ms: +(performance.now() - t0).toFixed(1), error })
          if (ipcTrace.length > 300) ipcTrace.shift()
        }
      }
    })
}
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { readOmarchyTheme, watchOmarchyTheme } = require('./omarchy.cjs')
const settings = require('./core/settings.cjs')
const { getSettings, setSettings, ytdlpBaseArgs, hasCookies } = settings
const { openLoginWindow, clearLogin, loginStatus, loginContents } = require('./login.cjs')
const { createSubscriptionManager } = require('./subscriptions.cjs')
const { createMcpServer } = require('./mcp.cjs')
const platform = require('./platform_electron.cjs')
settings.configure(platform)
const tools = require('./core/tools.cjs').createTools(platform)
const {
  ytdlpCommand, sofficeCommand, pythonCommand, demucsPython, whisperPython, pythonCwd,
  venvNvidiaLibDirs, cachedEngineCheck, clearEngineCache, VENV_DIR, VENV_PYTHON,
} = tools

const DEV_SERVER_URL = process.env.OPNDUCK_DEV_URL || 'http://localhost:1420'

function isDev() {
  // A distro package (the AUR one) runs the app with the system `electron`, which is never
  // "packaged"; its launcher sets OPNDUCK_PROD=1 so it loads the built files, not the dev server.
  return !app.isPackaged && process.env.OPNDUCK_PROD !== '1'
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
    // Electron 45: remembers the window's position, size and maximized state between launches.
    name: 'main',
    windowStatePersistence: true,
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

  win.webContents.once('did-finish-load', () => trace('renderer did-finish-load'))
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
  // With "keep running in the tray" the close button only hides the window.
  win.on('close', (event) => {
    if (!quitting && tray && getSettings().runInTray) {
      event.preventDefault()
      win.hide()
    }
  })

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

// Shared yt-dlp args (UTF-8 output, proxy, login cookies) come from ytdlpBaseArgs() in settings.cjs.
ipcMain.handle('settings:get', () => getSettings())
ipcMain.handle('settings:set', async (_e, patch) => {
  const next = setSettings(patch)
  if (patch && 'runInTray' in patch) applyTray()
  applyQueueLimits()
  if (patch && 'mcpServer' in patch) await applyMcp()
  return next
})

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

/* --- Tool detection and installs live in core/tools.cjs (no Electron); these are the IPC doors. --- */
ipcMain.handle('system:checkYtDlp', () => tools.checkYtDlp())
ipcMain.handle('system:installYtDlp', () => tools.installYtDlp())
ipcMain.handle('system:checkLibreOffice', () => tools.checkLibreOffice())
ipcMain.handle('system:checkFfmpeg', () => tools.checkFfmpeg())
ipcMain.handle('system:checkRealesrgan', () => tools.checkRealesrgan())
ipcMain.handle('system:checkRife', () => tools.checkRife())
ipcMain.handle('system:checkTorchEngine', () => tools.checkTorchEngine(torchEngineReady))
ipcMain.handle('system:checkDemucs', () => tools.checkDemucs())
ipcMain.handle('system:checkFasterWhisper', () => tools.checkFasterWhisper())
ipcMain.handle('system:installTool', (e, tool) =>
  tools.installTool(tool, (line) => {
    if (!e.sender.isDestroyed()) e.sender.send('system:installProgress', { tool, line })
  }),
)
ipcMain.handle('system:installCancel', () => tools.cancelInstall())

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
  const current = platform.version
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
    return platform.openExternal(u.href)
  }
})

/**
 * Spotify tracks are DRM-protected and yt-dlp can't fetch them. As an experimental workaround we
 * read the track's public page metadata (title, artist) and search YouTube for the same song.
 * This is not a download from Spotify, so callers must label the result as a match
 * (TaskState.experimentalMatch).
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

  return { query: `ytsearch1:${artist} - ${title}`, search: `${artist} - ${title}`, label: `${artist} - ${title}` }
}
// --- end: downloader/spotify-youtube-match ---

/* --- The task engine lives in core/tasks.cjs (no Electron); these are the IPC doors. --- */
// @category: downloader/task-orchestration-main-process
const engine = require('./core/tasks.cjs').createTaskEngine({ platform, getSettings, onFinished: (state, req) => notifyFinished(state, req) })
const {
  tasks, startHandlers, allPools, logWatched, logPending, TERMINAL, MAX_HISTORY,
  addTask, appendLog, jobLog, attachLog, defaultDownloadDir, broadcastTasks,
  scheduleHistorySave, saveHistory, loadHistory, markHistoryChanged, sanitizeBatch,
  updateTask, setQueuePaused, applyQueueLimits, runInPool, killTask, isCanceled,
} = engine
const { convertPool, gpuPool, whisperPool, downloadPool } = engine.pools
/** Registers a job-start IPC handler through the engine's wrapper (see wrapStart). */
function handleStart(channel, fn) {
  ipcMain.handle(channel, engine.wrapStart(channel, fn))
}
ipcMain.handle('queue:state', () => ({ paused: engine.queuePaused }))
ipcMain.handle('queue:setPaused', (_e, paused) => setQueuePaused(paused))
// "Run next": a queued job jumps the line within its own queue.
ipcMain.handle('tasks:runNext', (_e, id) => (typeof id === 'string' ? allPools.some((p) => p.prioritize(id)) : false))

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
/** Cover art + title/artist tags written into the file (yt-dlp does the work; WAV, MOV and FLAC get tags or nothing). */
function embedArgs(req) {
  if (!req.embedMeta) return []
  const args = ['--embed-metadata']
  // FLAC covers need the Python `mutagen` module (not always present), so FLAC gets tags only.
  if (req.format === 'MP3' || req.format === 'MP4' || req.format === 'MKV') {
    args.push('--embed-thumbnail', '--convert-thumbnails', 'jpg') // players want jpg/png covers, YouTube serves webp
  }
  return args
}

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
    return [...args, ...embedArgs(req), ...subs]
  }
  if (Object.hasOwn(VIDEO_EXT, req.format)) {
    const height = req.videoQuality && req.videoQuality !== 'best' ? Number(req.videoQuality) : null
    const selector = height ? `bv*[height<=${height}]+ba/b[height<=${height}]` : 'bv*+ba/b'
    return ['-f', selector, '--merge-output-format', VIDEO_EXT[req.format], ...embedArgs(req), ...subs]
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
      child = spawn(ytdlpCommand(), [...ytdlpBaseArgs(), '--flat-playlist', '--dump-single-json', '--no-warnings', '--playlist-end', '5000', '--', url])
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
      child = spawn(ytdlpCommand(), [...ytdlpBaseArgs(), '--dump-json', '--no-warnings', '--no-playlist', '--', effectiveUrl])
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
  if (req.embedMeta != null && typeof req.embedMeta !== 'boolean') throw new Error('Invalid embed option')
  // Spotify matches: YouTube ids already tried (and rejected) for this track.
  const VIDEO_ID_RE = /^[\w-]{6,20}$/
  if (req.matchExclude != null && (!Array.isArray(req.matchExclude) || req.matchExclude.length > 20 || !req.matchExclude.every((x) => typeof x === 'string' && VIDEO_ID_RE.test(x)))) {
    throw new Error('Invalid match exclusion list')
  }
  if (req.matchedId != null && !VIDEO_ID_RE.test(String(req.matchedId))) throw new Error('Invalid matched video id')
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
  if (spotify) {
    // Pick one concrete video (not just "search result #1") so "Run again" can skip it next time.
    const exclude = req.matchExclude ?? []
    const want = exclude.length + 5
    const found = await probeEntries(`ytsearch${want}:${spotify.search}`, want)
    if (isCanceled(id)) return id
    const pick = found?.entries.find((e) => !e.upcoming && !exclude.includes(e.id)) // premieres can't be downloaded yet
    if (pick) {
      spotify.query = pick.url
      req.matchedId = pick.id
    } else if (exclude.length) {
      updateTask(id, { status: 'error', error: 'No other YouTube match found for this track.' })
      return id
    }
  }
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
    child = spawn(ytdlpCommand(), args)
    attachLog(child, id)
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
  let streamBase = 0 // bytes of the yt-dlp streams already finished (progress weighting)
  let streamSize = 0 // size of the stream being downloaded now
  const isVideoFormat = Object.hasOwn(VIDEO_EXT, req.format)
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
          // yt-dlp reports each stream (video, then audio) as its own 0-100%. Weigh each by its size
          // against the whole download so the bar fills once, smoothly: finished streams + current one.
          const sizeMatch = line.match(/of\s+~?\s*([\d.]+)\s*(B|KiB|MiB|GiB)/)
          if (sizeMatch) streamSize = Number(sizeMatch[1]) * { B: 1, KiB: 1024, MiB: 1048576, GiB: 1073741824 }[sizeMatch[2]]
          const doneBytes = streamBase + pct * streamSize
          const known = Math.max(entry.state.sizeIsEstimate ? entry.state.sizeBytes ?? 0 : 0, streamBase + streamSize)
          // Without a size estimate, assume a video download still has a small audio stream to come.
          const total = known > streamBase + streamSize ? known : streamBase + streamSize * (streamBase === 0 && isVideoFormat ? 1.1 : 1)
          updateTask(id, { progress: Math.min(0.99, total > 0 ? doneBytes / total : pct) })
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
      if (/^\[download\] Destination:/.test(line) && streamSize > 0) {
        streamBase += streamSize // the previous stream finished; the next one starts counting on top of it
        streamSize = 0
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
      child = spawn(ytdlpCommand(), [...ytdlpBaseArgs(), '--flat-playlist', '--dump-single-json', '--no-warnings', '--playlist-end', String(limit), '--', url])
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
            upcoming: e.live_status === 'is_upcoming',
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
    file: path.join(platform.paths.userData, 'subscriptions.json'),
    seenDir: path.join(platform.paths.userData, 'subscriptions'),
    listEntries: probeEntries,
    startDownload: (req) => startHandlers.get('tasks:start')(null, req),
    whenTaskDone: (taskId, cb) => {
      const entry = tasks.get(taskId)
      if (!entry) return cb({ status: 'error' })
      if (TERMINAL.includes(entry.state.status)) return cb(entry.state)
      entry.onDone = cb
    },
    notify: (title, body) => {
      platform.notify({ title, body })
    },
    onChange: (list) => {
      platform.emit('subs:changed', list)
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

/** Cancels a queued or running task; false if there is nothing to cancel. */
function cancelTask(id) {
  const entry = tasks.get(id)
  if (!entry) return false
  // Don't rewrite the outcome of a task that already finished.
  if (!['queued', 'running'].includes(entry.state.status)) return false
  killTask(entry)
  updateTask(id, { status: 'canceled' })
  return true
}
ipcMain.on('tasks:cancel', (_e, id) => {
  cancelTask(id)
})

ipcMain.handle('tasks:rerun', (_e, id, opts) => {
  const entry = tasks.get(id)
  const start = entry && startHandlers.get(entry.channel)
  if (!start) return null
  let req = entry.req
  // Spotify matches: "find another video" retries the search without the video that was picked before.
  if (opts?.anotherMatch === true && req?.matchedId) {
    const { matchedId, ...rest } = req
    req = { ...rest, matchExclude: [...(req.matchExclude ?? []), matchedId].slice(-20) }
  }
  return start(null, req)
})
ipcMain.handle('tasks:openFolder', (_e, id) => {
  const entry = tasks.get(id)
  if (!entry) return
  if (entry.finalPath && fs.existsSync(entry.finalPath)) return platform.showInFolder(entry.finalPath)
  // req comes from an imported file for some entries, so it may hold anything: openPath() would
  // happily launch a file (script, .desktop, ...) with its default app. Only ever open a folder.
  const dest = entry.req?.destination
  let dir = defaultDownloadDir()
  try {
    if (typeof dest === 'string' && path.isAbsolute(dest) && fs.statSync(dest).isDirectory()) dir = dest
  } catch {
    /* missing or unreadable: fall back to the default folder */
  }
  platform.openPath(dir)
})
// Removes specific finished tasks from the history (running ones are never touched).
ipcMain.handle('tasks:remove', (_e, ids) => {
  if (!Array.isArray(ids)) return 0
  let removed = 0
  for (const id of ids.slice(0, 1000)) {
    const t = typeof id === 'string' ? tasks.get(id) : null
    if (t && TERMINAL.includes(t.state.status)) {
      tasks.delete(id)
      markHistoryChanged()
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
  markHistoryChanged()
  saveHistory()
  broadcastTasks()
})
/* --- Library export / import ---
 * Export writes the finished tasks (with the requests needed to run them again) as JSON. Import
 * reads such a file back: every field is re-validated here — a hand-edited or hostile file must
 * never smuggle in a channel, path or value the app wouldn't accept from its own UI. */
const TASK_KINDS = ['download', 'convert', 'upscale', 'interpolate', 'subtitles', 'audio-ai', 'trim']

function sanitizeImported(rows) {
  if (!Array.isArray(rows)) return []
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')
  const out = []
  for (const r of rows.slice(0, 1000)) {
    const st = r?.state
    if (!st || typeof st !== 'object' || !startHandlers.has(r.channel)) continue
    if (!r.req || typeof r.req !== 'object' || Array.isArray(r.req)) continue
    try {
      if (JSON.stringify(r.req).length > 20_000) continue
    } catch {
      continue // a BigInt or a cycle: not something our own export could have written
    }
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
    defaultPath: path.join(platform.paths.documents, `opnduck-library-${stamp}.json`),
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
      markHistoryChanged()
      added++
    }
  }
  if (added) {
    // Only MAX_HISTORY finished rows survive on disk anyway; don't let repeated imports grow memory past it.
    const finished = [...tasks.entries()].filter(([, t]) => TERMINAL.includes(t.state.status))
    for (const [id] of finished.slice(0, Math.max(0, finished.length - MAX_HISTORY))) tasks.delete(id)
    scheduleHistorySave()
    broadcastTasks()
  }
  return { added, started }
})

ipcMain.handle('tasks:logs', (_e, id) => (typeof id === 'string' ? [...(tasks.get(id)?.log?.lines ?? [])] : []))
ipcMain.handle('tasks:logWatch', (_e, id, on) => {
  if (typeof id !== 'string') return
  if (on) logWatched.add(id)
  else {
    logWatched.delete(id)
    logPending.delete(id)
  }
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

// --- end: converter/task-orchestration-main-process ---

/* --- Task orchestration (realesrgan-ncnn-vulkan image upscaling) --- */
// @category: upscaler/task-orchestration-main-process

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
// --- end: upscaler/task-orchestration-main-process ---

/**
 * Video upscaling: ffmpeg extracts the frames, realesrgan-ncnn-vulkan upscales them in batch,
 * ffmpeg reassembles them at the source fps and muxes the original audio back in. Slow and
 * disk-hungry on long clips; there is no shortcut around per-frame upscaling.
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

/** Lists numbered files of a directory in order. */
const listSorted = (dir) => fs.readdirSync(dir).sort()

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
const TORCH_SCRIPT = path.join(__dirname, 'torch_upscale.py')
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
/* --- end: chunked frame pipelines --- */

// --- end: upscaler/video-upscale-pipeline ---

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
// GPU Whisper finds its CUDA 12 libraries through the dynamic-linker path (PATH on Windows).
function whisperEnv() {
  const dirs = venvNvidiaLibDirs()
  if (!dirs.length) return {}
  const key = process.platform === 'win32' ? 'PATH' : 'LD_LIBRARY_PATH'
  return { [key]: [...dirs, process.env[key]].filter(Boolean).join(path.delimiter) }
}
const whisperWorker = createModelWorker({ python: () => whisperPython(), scriptPath: WHISPER_SCRIPT, env: whisperEnv })

handleStart('tasks:startSubtitles', (_e, req) => {
  assertAbsolutePath(req.inputPath, 'inputPath')
  if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
  assertOneOf(req.model, WHISPER_MODELS, 'model')
  assertOneOf(req.format, SUBTITLE_FORMATS, 'format')
  if (req.language !== 'auto' && !/^[a-z]{2,3}$/.test(req.language)) throw new Error(`Invalid language: ${req.language}`)
  if (req.translate != null && typeof req.translate !== 'boolean') throw new Error('Invalid translate option')
  const id = crypto.randomUUID()
  const destDir = req.destination || defaultDownloadDir()
  fs.mkdirSync(destDir, { recursive: true })

  const inputBase = path.basename(req.inputPath, path.extname(req.inputPath))
  // Translated subtitles get the usual language tag (movie.en.srt) so players pick them up as English.
  const outputPath = uniqueOutputPath(destDir, req.translate ? `${inputBase}.en` : inputBase, req.format)

  addTask(id, {
    state: {
      id,
      kind: 'subtitles',
      status: 'queued',
      progress: 0,
      label: path.basename(req.inputPath),
      format: req.format.toUpperCase(),
      quality: req.translate ? `Whisper ${req.model} → English` : `Whisper ${req.model}`,
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
    const entry = tasks.get(id)
    updateTask(id, { status: 'running' })
    let lineBuf = ''
    // The worker keeps the loaded Whisper model between files (see createModelWorker).
    whisperWorker.run(
      { input: req.inputPath, output: outputPath, model: req.model, language: req.language, format: req.format, translate: !!req.translate },
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
            if (lang) updateTask(id, { quality: `Whisper ${req.model} · ${lang[1]}${req.translate ? ' → English' : ''}` })
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

/* --- MCP server (Settings → MCP server): lets Claude Code and other MCP clients drive jobs --- */
// @category: mcp/mcp-main
let mcp = null
function needMcp() {
  mcp ??= createMcpServer({
    userDataDir: platform.paths.userData,
    tasks,
    startHandlers,
    cancelTask,
    setQueuePaused,
    probeMedia,
    log: (m) => console.log(m),
  })
  return mcp
}
/** Starts or stops the server to match the setting. */
async function applyMcp() {
  try {
    if (getSettings().mcpServer) await needMcp().start()
    else if (mcp) await mcp.stop()
  } catch (err) {
    console.error('mcp: could not change server state:', err instanceof Error ? err.message : err)
  }
}
function mcpInfo() {
  const server = needMcp()
  const bridge = path.join(__dirname, 'mcp_bridge.cjs')
  const packaged = platform.isPackaged
  const command = packaged ? process.execPath : 'node'
  const args = [bridge, server.infoFile]
  const env = packaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}
  const q = (x) => (/[\s"']/.test(x) ? JSON.stringify(x) : x)
  const envFlags = Object.entries(env).map(([k, v]) => `-e ${k}=${v}`)
  return {
    enabled: getSettings().mcpServer,
    running: server.running,
    port: server.port,
    command,
    args,
    env,
    claudeCommand: ['claude mcp add opnduck', ...envFlags, '--', q(command), ...args.map(q)].join(' '),
    // Any MCP client works: these are the same stdio server written in each client's own format.
    clients: [
      { name: 'Claude Code', kind: 'command', text: ['claude mcp add opnduck', ...envFlags, '--', q(command), ...args.map(q)].join(' ') },
      { name: 'Codex CLI', kind: 'command', text: ['codex mcp add opnduck', ...Object.entries(env).map(([k, v]) => `--env ${k}=${v}`), '--', q(command), ...args.map(q)].join(' ') },
      { name: 'Gemini CLI', kind: 'command', text: ['gemini mcp add', ...Object.entries(env).map(([k, v]) => `-e ${k}=${v}`), 'opnduck', q(command), ...args.map(q)].join(' ') },
      {
        name: 'Cursor, Claude Desktop, LM Studio, others (JSON)',
        kind: 'json',
        text: JSON.stringify({ mcpServers: { opnduck: { command, args, ...(packaged ? { env } : {}) } } }, null, 2),
      },
    ],
  }
}
ipcMain.handle('mcp:info', () => mcpInfo())
ipcMain.handle('mcp:resetToken', async () => {
  await needMcp().resetToken()
  return mcpInfo()
})

/* --- Developer tools (Settings, with dev mode on) --- */
// @category: dev/dev-tools-main
/** Makes text safe to paste in a bug report: home folder -> ~, credentials inside URLs hidden. */
function redact(text) {
  const home = os.homedir()
  // JSON text escapes backslashes, so a Windows home path needs its escaped form replaced too.
  return String(text).split(home.replace(/\\/g, '\\\\')).join('~').split(home).join('~').replace(/(\w+:\/\/)[^/\s@]+@/g, '$1***@')
}

/** First line of a command's output, or null if it can't run. Async so a hung tool can't freeze the UI. */
function commandLine(cmd, args, timeout = 5000) {
  return new Promise((resolve) => {
    require('node:child_process').execFile(cmd, args, { timeout, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) return resolve(null)
      resolve((stdout || stderr || '').split('\n')[0].trim() || null)
    })
  })
}

/** True if the program can be started at all (some tools exit non-zero on -h, so the exit code doesn't matter). */
function commandExists(cmd) {
  return new Promise((resolve) => {
    require('node:child_process').execFile(cmd, ['-h'], { timeout: 5000 }, (err) => resolve(!(err && (typeof err.code === 'string' || err.killed))))
  })
}

async function collectDevInfo() {
  const mem = process.getSystemMemoryInfo?.() ?? {}
  const [gpu, ytdlp, ffmpegLine, hasEsrgan, hasRife, py] = await Promise.all([
    commandLine('nvidia-smi', ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader']),
    commandLine(ytdlpCommand(), ['--version']),
    commandLine('ffmpeg', ['-version']),
    commandExists('realesrgan-ncnn-vulkan'),
    commandExists('rife-ncnn-vulkan'),
    commandLine(pythonCommand(), ['--version']),
  ])
  return {
    app: { version: platform.version, packaged: platform.isPackaged, userData: redact(platform.paths.userData), uptimeSec: Math.round(process.uptime()) },
    runtime: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, v8: process.versions.v8 },
    system: {
      platform: `${process.platform} ${process.arch}`,
      os: os.release(),
      cpu: `${os.cpus()[0]?.model ?? 'unknown'} x${os.cpus().length}`,
      ramGB: +(os.totalmem() / 1e9).toFixed(1),
      freeRamGB: mem.available ? +(mem.available / 1e6).toFixed(1) : +(os.freemem() / 1e9).toFixed(1),
      gpu: gpu ?? 'no NVIDIA GPU detected',
    },
    tools: {
      'yt-dlp': ytdlp ?? 'not found',
      ffmpeg: ffmpegLine?.replace(/^ffmpeg version /, '').split(' ')[0] ?? 'not found',
      realesrgan: hasEsrgan ? 'found' : 'not found',
      rife: hasRife ? 'found' : 'not found',
      python: py ?? 'not found',
      venv: fs.existsSync(VENV_PYTHON) ? redact(VENV_DIR) : 'not created',
      'GPU Whisper libs': venvNvidiaLibDirs().length ? 'installed' : 'not installed',
    },
    jobs: { tasks: tasks.size, running: [...tasks.values()].filter((t) => t.state.status === 'running').length, queuePaused: engine.queuePaused },
  }
}

/** The renderer reports Developer mode here; the dev:* channels refuse to run while it is off. */
let devEnabled = false
ipcMain.handle('dev:setEnabled', (_e, on) => {
  devEnabled = on === true
})
function devHandle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!devEnabled) throw new Error('Developer mode is off')
    return fn(e, ...args)
  })
}

devHandle('dev:info', async () => {
  const info = await collectDevInfo()
  info.tools.pytorchEngine = (await torchEngineReady()) ? 'CUDA available' : 'not available'
  return info
})
/** Per-process CPU and memory of the whole app (browser, GPU, renderer, utility). */
devHandle('dev:metrics', () =>
  app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, cpu: +m.cpu.percentCPUUsage.toFixed(1), memMB: Math.round((m.memory.workingSetSize || 0) / 1024) })),
)
devHandle('dev:logs', () => appLog.slice(-300).map((l) => ({ t: l.t, level: l.level, text: redact(l.text) })))
devHandle('dev:tasks', () =>
  JSON.parse(redact(JSON.stringify([...tasks.values()].map((t) => ({ channel: t.channel, state: t.state, req: t.req, finalPath: t.finalPath ?? null }))))),
)
devHandle('dev:diagnostics', async () => {
  const report = {
    generatedAt: new Date().toISOString(),
    ...(await collectDevInfo()),
    settings: JSON.parse(redact(JSON.stringify(getSettings()))),
    recentTasks: [...tasks.values()].slice(-15).map((t) => ({ kind: t.state.kind, status: t.state.status, format: t.state.format, error: t.state.error ?? null })),
    log: appLog.slice(-150).map((l) => `${new Date(l.t).toISOString()} ${l.level} ${redact(l.text)}`),
  }
  return JSON.stringify(report, null, 2)
})
devHandle('dev:openUserData', () => platform.openPath(platform.paths.userData))
devHandle('dev:toggleDevTools', (e) => e.sender.toggleDevTools())
devHandle('dev:reloadUI', (e) => e.sender.reloadIgnoringCache())
devHandle('dev:testNotification', () => {
  if (!platform.canNotify()) return false
  platform.notify({ title: 'OPNduck: test notification', body: 'If you can read this, notifications work.' })
  return true
})
/** A fake job that ticks to 100% over ~12 s (or fails at 60%), to try out the UI without real work. */
devHandle('dev:fakeJob', (_e, fail) => {
  const id = crypto.randomUUID()
  addTask(id, {
    state: { id, kind: 'convert', status: 'running', progress: 0, label: fail ? 'Dev test job (will fail)' : 'Dev test job', format: 'TEST', quality: 'simulated', sizeBytes: null, sizeIsEstimate: false, thumbnailUrl: null, experimentalMatch: null },
    child: null,
    finalPath: null,
  })
  let n = 0
  jobLog(id, 'Dev test job started (simulated, no real work)')
  const timer = setInterval(() => {
    n++
    jobLog(id, `step ${n}`)
    if (isCanceled(id)) return clearInterval(timer)
    if (fail && n >= 7) {
      clearInterval(timer)
      updateTask(id, { status: 'error', error: 'Simulated failure' })
    } else if (n >= 12) {
      clearInterval(timer)
      updateTask(id, { status: 'done', progress: 1 })
    } else updateTask(id, { progress: n / 12 })
  }, 1000)
  broadcastTasks()
  return id
})

devHandle('dev:clearEngineCache', () => clearEngineCache())
devHandle('dev:ipc', () => ipcTrace.slice(-200))
devHandle('dev:settings', () => ({
  path: redact(path.join(platform.paths.userData, 'settings.json')),
  json: JSON.stringify(JSON.parse(redact(JSON.stringify(getSettings()))), null, 2),
}))
devHandle('dev:showSettingsFile', () => platform.showInFolder(path.join(platform.paths.userData, 'settings.json')))
devHandle('dev:jobChannels', () => [...startHandlers.keys()])
/** Starts any job from a raw request (goes through the same validation as the UI's own start call). */
devHandle('dev:startJob', async (_e, channel, req) => {
  const start = typeof channel === 'string' ? startHandlers.get(channel) : null
  if (!start) throw new Error(`Unknown job channel: ${channel}`)
  return start(null, req)
})
/** Makes small sample files with ffmpeg, to test jobs without hunting for media. */
devHandle('dev:makeTestMedia', (_e, kind) => {
  const dir = path.join(platform.paths.userData, 'test-media')
  fs.mkdirSync(dir, { recursive: true })
  const specs = {
    video: ['sample-video.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']],
    audio: ['sample-audio.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=330:duration=10', '-c:a', 'libmp3lame']],
    image: ['sample-image.png', ['-f', 'lavfi', '-i', 'testsrc2=size=480x270', '-frames:v', '1']],
  }
  const spec = Object.hasOwn(specs, kind) ? specs[kind] : null
  if (!spec) return Promise.reject(new Error('Unknown sample kind'))
  const out = path.join(dir, spec[0])
  return new Promise((resolve, reject) => {
    require('node:child_process').execFile('ffmpeg', ['-y', '-loglevel', 'error', ...spec[1], out], { timeout: 60000 }, (err) =>
      err ? reject(new Error('ffmpeg could not make the sample file')) : resolve(out),
    )
  })
})
/** How long the main process's event loop was blocked recently (ms); high values mean UI jank from main-process work. */
const loopDelay = require('node:perf_hooks').monitorEventLoopDelay({ resolution: 20 })
loopDelay.enable()
devHandle('dev:loopLag', () => {
  const r = { meanMs: +(loopDelay.mean / 1e6).toFixed(1), p99Ms: +(loopDelay.percentile(99) / 1e6).toFixed(1), maxMs: +(loopDelay.max / 1e6).toFixed(1) }
  loopDelay.reset()
  return r
})

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
        resolve({ duration, width: v?.width ?? null, height: v?.height ?? null, hasVideo: !!v })
      } catch {
        resolve(null)
      }
    })
  })
}
ipcMain.handle('media:probe', (_e, inputPath) => (typeof inputPath === 'string' && path.isAbsolute(inputPath) ? probeMedia(inputPath) : null))

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
ipcMain.handle('media:frame', (_e, p, t, width) =>
  typeof p === 'string' && path.isAbsolute(p) && Number.isFinite(t) ? mediaFrame(p, t, Math.min(1280, Math.max(64, Number(width) || 640))) : null,
)
/** A strip of evenly spaced thumbnails (4 at a time) for the trimmer timeline. */
ipcMain.handle('media:thumbs', async (_e, p, duration, count) => {
  if (typeof p !== 'string' || !path.isAbsolute(p) || !Number.isFinite(duration) || duration <= 0) return []
  const n = Math.min(24, Math.max(2, Number(count) || 14))
  const out = new Array(n).fill(null)
  let next = 0
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < n) {
        const i = next++
        out[i] = await mediaFrame(p, ((i + 0.5) / n) * duration, 160)
      }
    }),
  )
  return out
})

const fmtClock = (sec) => {
  const t = Math.max(0, Math.round(sec))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const r = t % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

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
// --- end: trim/trim-pipeline ---

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

/** Work folders of jobs that were killed mid-run (quit, crash) are never cleaned up by the job itself.
 *  Only ones untouched for 2 hours go: a live job (even another running OPNduck) keeps writing to its own. */
function sweepStaleTempDirs() {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!/^opnduck-(doc|upscale|interpolate|audioai)-/.test(name)) continue
      const dir = path.join(os.tmpdir(), name)
      try {
        if (fs.statSync(dir).mtimeMs < cutoff) fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        /* gone already, or not ours to remove */
      }
    }
  } catch {
    /* unreadable temp dir: nothing to sweep */
  }
}

/* --- Tray + "job finished" notifications --- */
let tray = null
let quitting = false
function showMainWindow() {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
/** Creates or removes the tray icon to match the setting. */
function applyTray() {
  const want = getSettings().runInTray
  if (want && !tray) {
    try {
      tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')))
      tray.setToolTip('OPNduck')
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Show OPNduck', click: showMainWindow },
          { label: 'Check subscriptions now', click: () => void subscriptions?.checkNow() },
          { type: 'separator' },
          { label: 'Quit', click: () => app.quit() },
        ]),
      )
      tray.on('click', showMainWindow)
    } catch {
      tray = null // no tray support on this desktop: closing the window just quits as before
    }
  } else if (!want && tray) {
    tray.destroy()
    tray = null
    BrowserWindow.getAllWindows().forEach((w) => w.show()) // never strand a hidden window
  }
}

// Several jobs finishing together (a batch) become one notification.
const finishedBatch = { done: [], failed: [] }
let finishedTimer = null
function notifyFinished(state, req) {
  if (!getSettings().notifyOnFinish || !platform.canNotify()) return
  if (platform.isFocused()) return // you're looking at it
  if (req?.batch?.label?.startsWith('Subscription')) return // subscriptions announce their own new videos
  finishedBatch[state.status === 'done' ? 'done' : 'failed'].push(state)
  clearTimeout(finishedTimer)
  finishedTimer = setTimeout(() => {
    const { done, failed } = finishedBatch
    const n = done.length + failed.length
    let title, body
    if (n === 1) {
      const t = done[0] ?? failed[0]
      title = done.length ? 'OPNduck: finished' : 'OPNduck: a job failed'
      body = done.length ? t.label : `${t.label}: ${t.error ?? 'error'}`
    } else {
      title = `OPNduck: ${n} jobs finished`
      body = failed.length ? `${done.length} done, ${failed.length} failed` : 'All done'
    }
    finishedBatch.done = []
    finishedBatch.failed = []
    const only = n === 1 && done.length ? tasks.get(done[0].id) : null
    const canReveal = !!only?.finalPath && fs.existsSync(only.finalPath)
    // Electron 45 added notification action buttons on Linux.
    platform.notify({
      title,
      body: String(body).slice(0, 200),
      actions: canReveal ? ['Show in folder'] : [],
      onAction: () => canReveal && platform.showInFolder(only.finalPath),
      onClick: showMainWindow,
    })
  }, 2500)
}

/* --- Watch folder: convert new media files dropped into a chosen folder ---
 * Polls every 10 s (works the same on every OS, no fs.watch quirks). A file is picked up once its size
 * and modification time stopped changing between two polls, so half-copied files are left alone.
 * Each file is handled once; the list of handled files survives restarts. */
const WATCH_EXT = new Set(['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'mp3', 'wav', 'flac', 'm4a', 'ogg', 'opus', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'])
const watchSeenFile = () => path.join(platform.paths.userData, 'watch-seen.json')
let watchSeen = null
const watchPrev = new Map() // path -> "size:mtime" from the previous poll
function loadWatchSeen() {
  if (watchSeen) return watchSeen
  try {
    watchSeen = new Set(JSON.parse(fs.readFileSync(watchSeenFile(), 'utf8')))
  } catch {
    watchSeen = new Set()
  }
  return watchSeen
}
function pollWatchFolder() {
  const w = getSettings().watchFolder
  if (!w.enabled || !w.path) return
  let names
  try {
    names = fs.readdirSync(w.path)
  } catch {
    return // folder missing or unreadable: try again next time
  }
  const seen = loadWatchSeen()
  const start = startHandlers.get('tasks:startConvert')
  if (!start || !Object.hasOwn(FORMATS, w.container)) return
  let changed = false
  for (const name of names) {
    if (!WATCH_EXT.has(path.extname(name).slice(1).toLowerCase())) continue
    const full = path.join(w.path, name)
    let st
    try {
      st = fs.statSync(full)
    } catch {
      continue
    }
    if (!st.isFile()) continue
    const sig = `${st.size}:${st.mtimeMs}`
    const key = `${full}|${sig}`
    if (seen.has(key)) continue
    if (watchPrev.get(full) !== sig) {
      watchPrev.set(full, sig) // first sighting, or still being written: wait for the next poll
      continue
    }
    seen.add(key)
    changed = true
    const mode = FORMATS[w.container].kind === 'video' ? 'remux' : 'transcode'
    start(null, { inputPath: full, container: w.container, mode, destination: path.join(w.path, 'converted') }).catch(() => {
      /* a file that can't be converted shows up as a failed job if it got that far */
    })
  }
  if (changed) {
    try {
      fs.writeFileSync(watchSeenFile(), JSON.stringify([...seen].slice(-5000)))
    } catch {
      /* worst case: a file is converted again after a restart */
    }
  }
}
let watchTimer = null
function startWatchFolder() {
  clearInterval(watchTimer)
  watchTimer = setInterval(pollWatchFolder, 10_000)
  watchTimer.unref?.()
}

// One OPNduck per profile: launching it again just brings the open window forward instead of piling up processes.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()
else app.on('second-instance', () => showMainWindow())

trace('main.cjs loaded')
app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return
  trace('app ready')
  applyQueueLimits()
  startWatchFolder()
  sweepStaleTempDirs()
  trace('temp sweep done')
  loadHistory()
  trace('history loaded')
  startSubscriptions()
  trace('subscriptions started')
  void applyMcp()
  createWindow()
  applyTray()
  trace('window created')
  // Warm the engine checks once the window is up, so the cards don't wait on a Python start.
  setTimeout(() => {
    void torchEngineReady()
    void cachedEngineCheck('demucs', demucsPython(), 'import torch, demucs, soundfile')
    void cachedEngineCheck('whisper', whisperPython(), 'import faster_whisper')
  }, 1500)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  subscriptions?.stop()
  void mcp?.stop()
})

// Don't orphan ffmpeg/soffice/python on exit, and don't lose a result that finished inside
// the 400ms history-save debounce.
app.on('before-quit', () => {
  quitting = true
  whisperWorker.stop()
  demucsWorker.stop()
  for (const entry of tasks.values()) {
    if (entry.state.status === 'queued' || entry.state.status === 'running') killTask(entry)
  }
  saveHistory()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})