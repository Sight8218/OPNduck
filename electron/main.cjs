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
const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, protocol, safeStorage } = require('electron')

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
const crypto = require('node:crypto')
const { readOmarchyTheme, watchOmarchyTheme } = require('./omarchy.cjs')
const settings = require('./core/settings.cjs')
const { getSettings, setSettings } = settings
const { openLoginWindow, clearLogin, loginStatus, loginContents } = require('./login.cjs')
const { createSubscriptionManager } = require('./subscriptions.cjs')
const { createMcpServer } = require('./mcp.cjs')
const platform = require('./platform_electron.cjs')
const core = require('./core/index.cjs').createCore({
  platform,
  onFinished: (state, req) => notifyFinished(state, req),
  registerStart: (channel, wrapped) => ipcMain.handle(channel, wrapped),
  pickPath: pickPluginPath,
})
const { tools, engine, modules } = core
const {
  ytdlpCommand, pythonCommand, demucsPython, whisperPython,
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

/* --- Plugins (host: core/plugins.cjs; spec: PLUGINS.md) --- */
// A plugin card's script, styles and images are served from its own folder by this scheme. The scheme must be
// registered before the app is ready; the handler (below, in whenReady) only serves files of running plugins.
protocol.registerSchemesAsPrivileged([{ scheme: 'opnduck-plugin', privileges: { standard: true, secure: true, corsEnabled: true } }])

/** The file dialog behind `files.pick`: whatever the user picks becomes readable/writable for that plugin only. */
async function pickPluginPath({ save, directory, filters, plugin }) {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const cleanFilters = (Array.isArray(filters) ? filters : [])
    .filter((f) => f && typeof f.name === 'string' && Array.isArray(f.extensions) && f.extensions.every((x) => typeof x === 'string' && /^[A-Za-z0-9]{1,10}$/.test(x)))
    .map((f) => ({ name: f.name.slice(0, 60), extensions: f.extensions }))
  const title = `${String(plugin).slice(0, 60)}: ${save ? 'choose where to save' : directory ? 'choose a folder' : 'choose a file'}`
  if (save) {
    const res = await dialog.showSaveDialog(win ?? undefined, { title, filters: cleanFilters })
    return res.canceled || !res.filePath ? null : res.filePath
  }
  const res = await dialog.showOpenDialog(win ?? undefined, { title, filters: cleanFilters, properties: [directory ? 'openDirectory' : 'openFile'] })
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
}

ipcMain.handle('plugins:list', () => core.plugins.list())
ipcMain.handle('plugins:enable', (_e, id, approved) => core.plugins.enable(String(id), approved))
ipcMain.handle('plugins:disable', (_e, id) => core.plugins.disable(String(id)))
ipcMain.handle('plugins:remove', (_e, id) => core.plugins.remove(String(id)))
ipcMain.handle('plugins:rescan', () => core.plugins.init())
ipcMain.handle('plugins:storeList', (_e, force) => core.pluginStore.list({ force: force === true }))
ipcMain.handle('plugins:storeInstall', (_e, id) => core.pluginStore.install(String(id)))
// A card's calls: only the card-safe part of the plugin API is reachable from here (see UI_METHODS in plugins.cjs).
ipcMain.handle('plugins:call', (_e, id, method, args) => core.plugins.callFromUi(String(id), String(method), Array.isArray(args) ? args : []))
ipcMain.handle('plugins:openFolder', () => {
  fs.mkdirSync(core.plugins.dir, { recursive: true })
  platform.openPath(core.plugins.dir)
})

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
  if (patch && ('remoteEnabled' in patch || 'remoteMode' in patch)) platform.emit('remote:changed', null)
  if (patch && ('remoteEnabled' in patch || 'remoteBind' in patch || 'remotePort' in patch || 'shareEngine' in patch)) await applyEngineApi()
  if (patch && ('remoteEnabled' in patch || 'remoteRelay' in patch)) applyRelay()
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
ipcMain.handle('system:checkFpcalc', () => tools.checkFpcalc())
// Music tagger: look one file up (read-only; the card calls it file by file), and list the audio in a folder.
// Auto settings: measure a file and suggest settings for a tool, with reasons (read-only, nothing is started).
// Recipes (chains of tools): the Recipes page lists, edits and runs them.
ipcMain.handle('recipes:list', () => core.recipes.list())
ipcMain.handle('recipes:tools', () => core.recipes.tools())
ipcMain.handle('recipes:filesIn', (_e, folder, input) => core.recipes.filesIn(folder, String(input)))
ipcMain.handle('recipes:save', (_e, recipe) => core.recipes.save(recipe))
ipcMain.handle('recipes:remove', (_e, id) => core.recipes.remove(String(id)))
ipcMain.handle('recipes:duplicate', (_e, id) => core.recipes.duplicate(String(id)))
ipcMain.handle('recipes:run', (_e, id, input, opts) => core.recipes.run(String(id), String(input), { destination: typeof opts?.destination === 'string' ? opts.destination : undefined, keepIntermediate: opts?.keepIntermediate === true }))
ipcMain.handle('recipes:resume', (_e, runId) => core.recipes.resume(String(runId)))
ipcMain.handle('auto:suggest', async (_e, tool, filePath, opts) => {
  if (typeof tool !== 'string' || typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Invalid request')
  const facts = await modules.analyze.analyzeMedia(filePath)
  if (!facts) throw new Error("Couldn't read that file.")
  return { facts, ...require('./core/autosettings.cjs').suggest(tool, facts, { container: typeof opts?.container === 'string' ? opts.container : undefined }) }
})
ipcMain.handle('tagger:identify', (_e, filePath) => (typeof filePath === 'string' ? modules.tagger.identifyTrack(filePath) : Promise.reject(new Error('Invalid path'))))
ipcMain.handle('tagger:listAudio', (_e, folder) => (typeof folder === 'string' && path.isAbsolute(folder) ? modules.tagger.listAudioFiles(folder) : []))
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

// --- end: downloader/spotify-youtube-match ---

/* --- The task engine and the job modules live in core/ (no Electron); the rest of this file is the IPC doors. --- */
// @category: downloader/task-orchestration-main-process
const {
  tasks, startHandlers, allPools, logWatched, logPending, TERMINAL, MAX_HISTORY,
  addTask, jobLog, defaultDownloadDir, broadcastTasks,
  scheduleHistorySave, saveHistory, loadHistory, markHistoryChanged, sanitizeBatch,
  updateTask, setQueuePaused, applyQueueLimits, killTask, isCanceled,
  cancelTask, rerunTask, revealTask, taskFile, removeTasks, clearFinished,
} = engine
ipcMain.handle('queue:state', () => ({ paused: engine.queuePaused }))
ipcMain.handle('queue:setPaused', (_e, paused) => setQueuePaused(paused))
// "Run next": a queued job jumps the line within its own queue.
ipcMain.handle('tasks:runNext', (_e, id) => (typeof id === 'string' ? allPools.some((p) => p.prioritize(id)) : false))

const { parseHttpUrl, assertAbsolutePath, probeMedia, mediaFrame } = modules.common
const { FORMATS } = modules.convert
const { demucsWorker } = modules.audioAi
const { whisperWorker } = modules.subtitles
const { torchEngineReady } = modules.gpu
const { probePlaylist, probeInfo, probeEntries, validateDownloadRequest, classifyLink } = modules.download

ipcMain.handle('tasks:probe', (_e, req) => {
  req.url = String(req.url ?? '').trim()
  return probeInfo(req)
})

// Subscriptions (auto-download new uploads) — see subscriptions.cjs. Created once the app is ready
// because it needs userData; IPC before that point is rejected.
/* --- Send to OPNduck: links from other devices (see core/remote/) --- */
// @category: remote/inbox-main
const { createRemoteInbox } = require('./core/remote/inbox.cjs')
let remoteInbox = null
function needRemote() {
  remoteInbox ??= createRemoteInbox({
    file: path.join(platform.paths.userData, 'remote.json'),
    // The only way a received link becomes a job: the normal download handler, tagged so the Library shows "via link".
    startDownload: async (req, via) => {
      const id = await startHandlers.get('tasks:start')(null, req)
      const entry = tasks.get(id)
      if (entry) entry.state.source = 'link'
      console.log(`remote: started a download from a link (${via})`)
      return id
    },
    notify: ({ title, body }) => platform.notify({ title, body, onClick: showMainWindow }),
    onChange: () => platform.emit('remote:changed', null),
    getSettings,
    getRecipe: (id) => core.recipes.get(id),
    runRecipe: (id, input) => core.recipes.run(id, input),
  })
  return remoteInbox
}
/** An opnduck://send?url=<link> address (from a web page, a launcher or the command line). It only ever waits for a click. */
function handleOpnduckUrl(raw) {
  try {
    const u = new URL(String(raw))
    if (u.protocol !== 'opnduck:' || u.hostname !== 'send') return
    const link = u.searchParams.get('url')
    if (link && needRemote().addLink(link, 'opnduck')) showMainWindow()
  } catch {
    /* not a link we understand */
  }
}
const opnduckUrlIn = (argv) => argv.find((a) => typeof a === 'string' && a.startsWith('opnduck://'))
ipcMain.handle('remote:state', () => {
  const r = needRemote()
  const s = getSettings()
  return { enabled: s.remoteEnabled, mode: s.remoteMode, pending: r.list() }
})
const tailscale = require('./core/remote/tailscale.cjs')
const { createEngineApi } = require('../engine-api/server.cjs')
const { buildPairLink } = require('./core/remote/envelope.cjs')
const { createDevices } = require('../engine-api/devices.cjs')
const { createUploads } = require('../engine-api/uploads.cjs')
const { createV1 } = require('../engine-api/v1.cjs')
const { createInfo } = require('../engine-api/info.cjs')
const { buildEnginePairLink } = require('../engine-api/pairlink.cjs')
const { createServers } = require('./core/remote/servers.cjs')
let engineApi = null
let sharing = null // { devices, uploads, v1 }: made the first time this PC's engine is shared
function needSharing() {
  if (sharing) return sharing
  const dir = path.join(platform.paths.userData, 'engine')
  const devices = createDevices({ file: path.join(dir, 'devices.json'), codesFile: path.join(dir, 'pair-codes.json') })
  const uploads = createUploads({ dir: path.join(dir, 'uploads') })
  const info = createInfo({ outputDir: () => defaultDownloadDir(), ytdlpCommand: () => core.ctx.ytdlpCommand?.() ?? 'yt-dlp' })
  const real = createV1({ engine, platform, devices, uploads, name: () => os.hostname(), version: platform.version, info, log: (m) => console.log(m) })
  // The routes exist only while sharing is switched on; with it off the server answers only health checks and Send to OPNduck.
  const v1 = {
    handle: (req, res, ctx) => (getSettings().shareEngine ? real.handle(req, res, ctx) : ctx.reply(404, { error: 'Not found' })),
    closeAll: () => real.closeAll(),
  }
  return (sharing = { devices, uploads, v1 })
}
/** Starts or stops the link server to match the settings (off unless Send to OPNduck or engine sharing is on and a bind mode is chosen). */
async function applyEngineApi() {
  const s = getSettings()
  const inbox = needRemote()
  engineApi ??= createEngineApi({ inbox, name: () => os.hostname(), v1: needSharing().v1, log: (m) => console.log(m) })
  if (!(s.remoteEnabled || s.shareEngine) || s.remoteBind === 'off') await engineApi.stop()
  else {
    const ts = s.remoteBind === 'tailscale' ? await tailscale.status() : null
    await engineApi.start({ mode: s.remoteBind, port: s.remotePort, tailscaleIp: ts?.ip ?? null })
  }
  platform.emit('remote:changed', null)
}
const { createNtfyRelay, validateServer, DEFAULT_SERVER } = require('./core/remote/ntfy.cjs')
let ntfyRelay = null
/** Starts or stops the relay listener to match the settings; call after any change to them or to the relay address. */
function applyRelay() {
  const inbox = needRemote()
  ntfyRelay ??= createNtfyRelay({
    inbox,
    getConfig: () => ({ enabled: getSettings().remoteEnabled && getSettings().remoteRelay, ...inbox.relay.get() }),
    lastId: inbox.relay.lastId,
    onStatus: () => platform.emit('remote:changed', null),
  })
  ntfyRelay.apply()
}
ipcMain.handle('remote:relay', () => ({ ...needRemote().relay.get(), status: ntfyRelay?.status() ?? { state: 'off', error: '', server: '' }, defaultServer: DEFAULT_SERVER }))
ipcMain.handle('remote:setRelay', (_e, server, token) => {
  const clean = server ? validateServer(server) : ''
  needRemote().relay.set({ server: clean === DEFAULT_SERVER ? '' : clean, token: String(token ?? '').slice(0, 200) })
  applyRelay()
  return true
})
ipcMain.handle('remote:server', () => ({ ...(engineApi?.status() ?? { running: false, port: null, addresses: [], error: '' }), bind: getSettings().remoteBind }))
// The pair link holds the secret: it only goes to this app's own window, to show as a QR code or be copied by the user.
ipcMain.handle('remote:pairing', () => ({ link: buildPairLink({ secret: needRemote().secret(), relay: needRemote().relay.get().server || DEFAULT_SERVER, relayToken: needRemote().relay.get().token, direct: getSettings().remoteDirectUrl, name: os.hostname() }) }))
ipcMain.handle('remote:resetPairing', () => {
  needRemote().resetPairing()
  applyRelay() // the topic changed with the secret
  return true
})
/* --- Servers this app can use, and sharing this PC's engine with other devices --- */
const SEALED = 'safe:'
const servers = createServers({
  file: path.join(platform.paths.userData, 'servers.json'),
  // The OS keyring holds the key. Without one (a bare Linux session) the token is stored as is, in a file only this user can read.
  seal: (text) => (safeStorage.isEncryptionAvailable() ? SEALED + safeStorage.encryptString(text).toString('base64') : `plain:${text}`),
  unseal: (sealed) => (sealed.startsWith(SEALED) ? safeStorage.decryptString(Buffer.from(sealed.slice(SEALED.length), 'base64')) : sealed.replace(/^plain:/, '')),
})
// Jobs the person (or the per-kind default in Settings > Servers) sends to a server run as mirror tasks in this queue.
const { createHosts } = require('./core/remote/hosts.cjs')
const hosts = createHosts({ engine, servers, defaultDownloadDir, uniqueOutputPath: core.ctx.uniqueOutputPath })
for (const [channel, fn] of [...engine.startHandlers]) {
  const routed = hosts.route(channel, fn)
  if (routed === fn) continue
  engine.startHandlers.set(channel, routed) // run again, recipes, MCP and links all start jobs through this map
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, routed)
}
ipcMain.handle('servers:list', () => ({ servers: servers.list(), defaults: servers.defaults(), encrypted: safeStorage.isEncryptionAvailable() }))
ipcMain.handle('servers:add', async (_e, link) => {
  const s = await servers.add(String(link))
  platform.emit('servers:changed', null)
  return s
})
ipcMain.handle('servers:check', (_e, id) => servers.check(String(id)))
ipcMain.handle('servers:remove', (_e, id) => {
  const ok = servers.remove(String(id))
  platform.emit('servers:changed', null)
  return ok
})
ipcMain.handle('servers:setDefault', (_e, kind, where) => {
  servers.setDefault(String(kind), String(where))
  platform.emit('servers:changed', null)
  return servers.defaults()
})
/** Where other devices can reach this PC's engine, first the best one: the Tailscale HTTPS address, then the addresses it listens on. */
async function engineUrls() {
  const s = getSettings()
  const st = engineApi?.status()
  if (!st?.running) return []
  const urls = []
  if (s.remoteDirectUrl) urls.push(s.remoteDirectUrl.replace(/\/+$/, ''))
  for (const a of st.addresses) if (a !== '0.0.0.0') urls.push(`http://${a}:${st.port}`)
  if (st.addresses.includes('0.0.0.0')) for (const addrs of Object.values(os.networkInterfaces())) for (const i of addrs ?? []) if (i.family === 'IPv4' && !i.internal) urls.push(`http://${i.address}:${st.port}`)
  return [...new Set(urls)].sort((x, y) => Number(/^http:\/\/127\./.test(x)) - Number(/^http:\/\/127\./.test(y)))
}
ipcMain.handle('share:state', async () => {
  const sh = needSharing()
  const st = engineApi?.status() ?? { running: false, port: null, addresses: [], error: '' }
  return { enabled: getSettings().shareEngine, listening: st.running, bind: getSettings().remoteBind, error: st.error, urls: await engineUrls(), devices: sh.devices.list() }
})
// A new one-time pair link holds a code that lets a device in: it goes only to this app's window, as a QR code or to copy.
ipcMain.handle('share:pairLink', async () => {
  if (!getSettings().shareEngine) throw new Error('Turn on sharing first')
  const urls = await engineUrls()
  if (!urls.length) throw new Error('Choose who can connect (this computer, Tailscale or your network) first')
  return { link: buildEnginePairLink({ baseUrl: urls[0], code: needSharing().devices.newPairCode(), name: os.hostname() }) }
})
ipcMain.handle('share:revoke', (_e, id) => {
  const ok = needSharing().devices.revoke(String(id))
  platform.emit('servers:changed', null)
  return ok
})
ipcMain.handle('remote:tailscale', () => tailscale.status())
ipcMain.handle('remote:tailscaleServe', async (_e, on) => {
  if (on !== true) {
    const r = await tailscale.serveOff()
    if (r.ok) setSettings({ remoteDirectUrl: '' })
    platform.emit('remote:changed', null)
    return r
  }
  const st = engineApi?.status()
  if (!st?.running) return { ok: false, error: 'Turn on the link server first (choose "This computer and Tailscale").', command: '' }
  const ts = await tailscale.status()
  const r = await tailscale.serveOn(st.port, ts.dnsName)
  if (r.ok) setSettings({ remoteDirectUrl: r.url })
  platform.emit('remote:changed', null)
  return r
})
ipcMain.handle('remote:accept', (_e, id) => needRemote().accept(String(id)))
ipcMain.handle('remote:dismiss', (_e, id) => needRemote().dismiss(String(id)))

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
ipcMain.on('tasks:cancel', (_e, id) => {
  cancelTask(id)
})
ipcMain.handle('tasks:rerun', (_e, id, opts) => rerunTask(id, opts))
ipcMain.handle('tasks:openFolder', (_e, id) => revealTask(id))
ipcMain.handle('tasks:file', (_e, id) => taskFile(String(id)))
// Removes specific finished tasks from the history (running ones are never touched).
ipcMain.handle('tasks:remove', (_e, ids) => removeTasks(ids))
ipcMain.handle('tasks:clearFinished', () => clearFinished())
/* --- Library export / import ---
 * Export writes the finished tasks (with the requests needed to run them again) as JSON. Import
 * reads such a file back: every field is re-validated here — a hand-edited or hostile file must
 * never smuggle in a channel, path or value the app wouldn't accept from its own UI. */
const TASK_KINDS = ['download', 'convert', 'upscale', 'interpolate', 'subtitles', 'audio-ai', 'trim', 'compress', 'tag', 'gif']

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

// --- end: converter/task-orchestration-main-process ---

/* --- Task orchestration (realesrgan-ncnn-vulkan image upscaling) --- */
// @category: upscaler/task-orchestration-main-process

// --- end: upscaler/task-orchestration-main-process ---

/**
 * Video upscaling: ffmpeg extracts the frames, realesrgan-ncnn-vulkan upscales them in batch,
 * ffmpeg reassembles them at the source fps and muxes the original audio back in. Slow and
 * disk-hungry on long clips; there is no shortcut around per-frame upscaling.
 */
// @category: upscaler/video-upscale-pipeline

/* --- end: chunked frame pipelines --- */

// --- end: upscaler/video-upscale-pipeline ---

// --- end: interpolate/frame-interpolation-pipeline ---

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
    analyzeMedia: modules.analyze.analyzeMedia,
    recipes: core.recipes,
    plugins: core.plugins,
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

ipcMain.handle('media:probe', (_e, inputPath) => (typeof inputPath === 'string' && path.isAbsolute(inputPath) ? probeMedia(inputPath) : null))

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

// --- end: trim/trim-pipeline ---

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
  // A plugin card lives in a sandboxed subframe and may only ever show its own plugin's files. Without this a card
  // could send its frame to a web address and carry data out in the URL.
  contents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return
    if (!event.url.startsWith('opnduck-plugin://') && event.url !== 'about:blank') event.preventDefault()
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
    core.plugins.emit('watch-folder:file', { name })
    const recipe = w.recipe ? core.recipes.get(w.recipe) : null
    if (recipe) {
      // A recipe takes over from the plain conversion; a file it can't take (wrong kind of media) is left alone.
      if (core.recipes.accepts(recipe, full)) core.recipes.run(recipe.id, full, { destination: path.join(w.path, 'recipe-results') }).catch(() => {})
      continue
    }
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
else {
  app.on('second-instance', (_e, argv) => {
    const link = opnduckUrlIn(argv)
    if (link && app.isReady()) handleOpnduckUrl(link)
    showMainWindow()
  })
  app.on('open-url', (event, url) => {
    event.preventDefault() // macOS delivers opnduck:// here
    if (app.isReady()) handleOpnduckUrl(url)
  })
}

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
  // opnduck:// as a link handler (AppImage and dev builds register it at runtime; the packages also list it in their desktop entry).
  app.setAsDefaultProtocolClient('opnduck')
  needRemote()
  void applyEngineApi()
  applyRelay()
  trace('subscriptions started')
  void applyMcp()
  // A card runs in a sandboxed iframe on this scheme. Reserved paths (__frame.html, __frame.js, __app/*) are the
  // card page and the app's stylesheet; anything else is a file from the plugin's own folder.
  const pluginFrame = require('./core/plugin_frame.cjs')
  const distDir = path.join(__dirname, '..', 'dist')
  protocol.handle('opnduck-plugin', (req) => {
    const plain = { 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
    try {
      const url = new URL(req.url)
      const id = url.hostname
      const rel = decodeURIComponent(url.pathname).replace(/^\//, '')
      if (rel.startsWith('__')) {
        const p = core.plugins.list().find((x) => x.id === id)
        if (!p || p.status !== 'running' || !p.manifest?.ui) return new Response('Not found', { status: 404 })
        if (rel === '__frame.html') {
          return new Response(pluginFrame.frameHtml(pluginFrame.appCssName(distDir)), { headers: { ...plain, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': pluginFrame.FRAME_CSP } })
        }
        if (rel === '__frame.js') return new Response(fs.readFileSync(path.join(__dirname, 'plugin_frame', 'frame.js')), { headers: { ...plain, 'content-type': 'text/javascript' } })
        if (rel.startsWith('__app/')) {
          const { data, type } = pluginFrame.appAsset(distDir, rel.slice(6))
          return new Response(data, { headers: { ...plain, 'content-type': type } })
        }
        return new Response('Not found', { status: 404 })
      }
      const { data, type } = core.plugins.readAsset(id, rel)
      return new Response(data, { headers: { ...plain, 'content-type': type } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  createWindow()
  const launchLink = opnduckUrlIn(process.argv) // the app was started by an opnduck:// link
  if (launchLink) handleOpnduckUrl(launchLink)
  void core.plugins.init() // after the window exists: a plugin's activate() must never delay startup
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
  void engineApi?.stop()
  ntfyRelay?.stop()
  void mcp?.stop()
  void core.plugins.shutdown()
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