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
 * Settings the main process itself must read (a proxy and cookie source for yt-dlp probes and
 * downloads, later the subscription scheduler). Everything else lives in the renderer's
 * localStorage; this is a small validated JSON file in userData so the main process never has
 * to trust a value passed along with each request.
 */
const fs = require('node:fs')
const path = require('node:path')
const { userDataDir } = require('./platform.cjs')

/** Where settings live. Defaults to the platform's user-data folder; the desktop app passes its own via configure(). */
let dataDir = userDataDir
function configure(platform) {
  dataDir = () => platform.paths.userData
}

/** Browsers yt-dlp can read cookies from (its own allow-list, minus Safari). */
const COOKIE_BROWSERS = ['firefox', 'chromium', 'chrome', 'edge', 'brave', 'opera', 'vivaldi']

const DEFAULTS = {
  /** '' = no proxy. Otherwise http(s)/socks4/socks5 URL handed to yt-dlp --proxy. */
  proxy: '',
  /** GPU job threading for the upscaler/interpolator: 'auto' overlaps loading, processing and saving
   *  frames (faster); 'low' uses the tools' conservative defaults for GPUs with little memory. */
  gpuThreads: 'auto',
  /** Video upscaling engine: 'auto' = PyTorch when it can run (faster, streams frames), else ncnn; 'ncnn' = always ncnn. */
  upscaleEngine: 'auto',
  /** Desktop notification when jobs finish while the window isn't focused. */
  notifyOnFinish: true,
  /** Closing the window keeps OPNduck running in the system tray (subscriptions keep checking). */
  runInTray: false,
  /** Parallel yt-dlp downloads / ffmpeg+LibreOffice conversions. */
  /** Watch folder: new media files dropped in `path` are converted to `container` (into a "converted" subfolder). */
  watchFolder: { enabled: false, path: '', container: 'MP4', recipe: '' },
  /** Smart scheduling for heavy jobs (conversions, GPU work, transcription); see core/schedule.cjs. Everything is off by default. */
  schedule: {
    window: false, from: '23:00', to: '07:00', // only start heavy jobs between these times
    battery: false, // hold heavy jobs while running on battery
    heat: false, maxC: 85, // pause GPU jobs above this temperature
    idle: false, idleMinutes: 10, // start heavy jobs only after this long away
    downloads: false, // the rules above also hold downloads
    whenDone: 'nothing', // 'nothing' | 'notify' | 'sleep' | 'shutdown' once the queue is empty
    powerConfirmed: false, // sleep and shut down stay off until the person has confirmed once in Settings
  },
  /** The AI runtime (see core/ai/): which model answers and how. Off until a provider is chosen. */
  ai: {
    provider: 'off', // 'off' | 'local' (OPNduck's own model) | 'ollama' | 'lmstudio' | 'machine' (another computer) | 'cloud' (the person's own API key)
    model: '',
    machineUrl: '', // the other computer's OpenAI-compatible address
    cloud: 'anthropic',
    customUrl: '', // for the "custom" cloud provider
    effort: 'medium', // 'low' | 'medium' | 'high'
    reasoning: 'auto', // 'auto' (from effort) | 'on' | 'off'
    vision: false, // send images to the model
    temperature: 0.7,
    keepChats: true,
    localModel: 'ministral-3-3b', // for the 'local' provider
    context: 16384, // Chat sends about 5,000 tokens of tool descriptions with every question, so 8k runs out after a few turns
    ctxChosen: false, // true once the person picked a memory size themselves
    gpu: 'auto', // 'auto' (all layers on the GPU) | 'cpu'
    startOnLaunch: false,
    idleEject: 15, // minutes without a question before the local model is ejected; 0 = never
    monthlyTokenLimit: 0, // cloud providers: stop at this many tokens a month; 0 = no limit
    dir: '', // where the local engine and models are kept; '' = the app's data folder
  },
  maxDownloads: 3,
  maxConversions: 2,
  /** Encoder for AI video jobs: 'auto' = GPU (NVENC) when it works, 'cpu' = x264. */
  videoEncoder: 'auto',
  /** Colours of the terminal app (a theme name such as 'blarange' or 'nord'). */
  tuiTheme: 'blarange',
  /** Local MCP server so tools like Claude Code can start and watch jobs (see mcp.cjs). Off by default. */
  mcpServer: false,
  /** Start with every plugin skipped (applies on the next start). */
  pluginsSafeMode: false,
  /** Look up and tag new audio downloads by themselves (sends each song's fingerprint and title to AcoustID, MusicBrainz and the Cover Art Archive). Off until the user turns it on. */
  autoTagAudio: false,
  /** Send to OPNduck: accept links from other devices (off until turned on), and what happens when one arrives. */
  remoteEnabled: false,
  remoteMode: 'ask',
  /** What a link sent from another device downloads as. Only the link comes from the sender; these are local choices. */
  /** Where the link server listens: off (default), this computer only, this computer and the Tailscale address, or the whole LAN. */
  /** Listen to the encrypted relay channel (ntfy) for links while Send to OPNduck is on. */
  remoteRelay: true,
  /** Let other OPNduck apps (and the phone app) use this computer's engine, through the same link server. */
  shareEngine: false,
  remoteBind: 'off',
  remotePort: 47821,
  /** The https:// address Tailscale serves the link server on, once the user enabled it (goes into the pair link). */
  remoteDirectUrl: '',
  remoteFormat: 'MP4',
  remoteVideoQuality: 'best',
  remoteAudioQuality: 'best',
  cookies: {
    /** 'none' | 'browser' (read from an installed browser) | 'file' (Netscape cookies.txt) |
     *  'login' (cookies saved from OPNduck's own sign-in window, see login.cjs). */
    mode: 'none',
    browser: 'firefox',
    /** Optional browser profile: a profile name, or an absolute folder (e.g. for Brave Origin). */
    profile: '',
    file: '',
  },
}

/** Where the built-in sign-in window's cookies are written (mode 0600). */
function loginCookieFile() {
  return path.join(dataDir(), 'login-cookies.txt')
}

function settingsFile() {
  return path.join(dataDir(), 'settings.json')
}

/** Throws a user-readable Error for anything that isn't a valid settings shape. */
function validate(next) {
  if (typeof next.proxy !== 'string') throw new Error('Proxy must be text')
  if (next.proxy !== '') {
    let u
    try {
      u = new URL(next.proxy)
    } catch {
      throw new Error('Proxy must look like http://host:port or socks5://host:port')
    }
    if (!['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'].includes(u.protocol) || !u.hostname) {
      throw new Error('Proxy must start with http://, https://, socks4:// or socks5://')
    }
  }
  if (!['auto', 'low'].includes(next.gpuThreads)) throw new Error('Invalid GPU performance mode')
  if (!['auto', 'ncnn'].includes(next.upscaleEngine)) throw new Error('Invalid upscale engine')
  if (!Number.isInteger(next.maxDownloads) || next.maxDownloads < 1 || next.maxDownloads > 6) throw new Error('Parallel downloads must be 1 to 6')
  if (!Number.isInteger(next.maxConversions) || next.maxConversions < 1 || next.maxConversions > 4) throw new Error('Parallel conversions must be 1 to 4')
  const w = next.watchFolder
  if (!w || typeof w.enabled !== 'boolean' || typeof w.path !== 'string' || typeof w.container !== 'string' || !/^[A-Z0-9]{2,5}$/.test(w.container)) throw new Error('Invalid watch folder')
  if (w.recipe !== undefined && (typeof w.recipe !== 'string' || w.recipe.length > 100)) throw new Error('Invalid watch folder recipe')
  if (w.path !== '' && !path.isAbsolute(w.path)) throw new Error('The watch folder must be an absolute path')
  if (w.enabled && !w.path) throw new Error('Choose a folder to watch first')
  const ai = next.ai
  if (!ai || typeof ai !== 'object') throw new Error('Invalid AI setting')
  if (!['off', 'local', 'ollama', 'lmstudio', 'machine', 'cloud'].includes(ai.provider)) throw new Error('Invalid AI provider')
  if (!['low', 'medium', 'high'].includes(ai.effort)) throw new Error('Effort must be low, medium or high')
  if (!['auto', 'on', 'off'].includes(ai.reasoning)) throw new Error('Reasoning must be auto, on or off')
  if (typeof ai.vision !== 'boolean' || typeof ai.keepChats !== 'boolean') throw new Error('Invalid AI setting')
  if (!Number.isFinite(ai.temperature) || ai.temperature < 0 || ai.temperature > 1.5) throw new Error('Temperature must be 0 to 1.5')
  if (!['ministral-3-3b', 'qwen3-1.7b'].includes(ai.localModel)) throw new Error('Unknown local model')
  if (![4096, 8192, 16384, 32768].includes(ai.context)) throw new Error('Context must be 4096, 8192, 16384 or 32768')
  if (!['auto', 'cpu'].includes(ai.gpu)) throw new Error('GPU must be auto or cpu')
  if (!Number.isInteger(ai.monthlyTokenLimit) || ai.monthlyTokenLimit < 0 || ai.monthlyTokenLimit > 1e9) throw new Error('The monthly limit must be 0 (none) or a number of tokens')
  if (typeof ai.startOnLaunch !== 'boolean') throw new Error('Invalid AI setting')
  if (![0, 5, 15, 30, 60].includes(ai.idleEject)) throw new Error('Idle eject must be 0, 5, 15, 30 or 60 minutes')
  if (typeof ai.dir !== 'string' || (ai.dir !== '' && !path.isAbsolute(ai.dir))) throw new Error('The AI folder must be an absolute path')
  for (const k of ['model', 'machineUrl', 'customUrl', 'cloud']) if (typeof ai[k] !== 'string' || ai[k].length > 300) throw new Error(`Invalid AI ${k}`)
  for (const k of ['machineUrl', 'customUrl']) if (ai[k] && !/^https?:\/\/[^\s]+$/.test(ai[k])) throw new Error('Addresses start with https:// (or http:// on this computer or Tailscale)')
  const sc = next.schedule
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/
  if (!sc || ['window', 'battery', 'heat', 'idle', 'downloads', 'powerConfirmed'].some((k) => typeof sc[k] !== 'boolean')) throw new Error('Invalid scheduling setting')
  if (!clock.test(sc.from) || !clock.test(sc.to)) throw new Error('Times look like 23:00')
  if (!Number.isInteger(sc.maxC) || sc.maxC < 60 || sc.maxC > 100) throw new Error('The temperature limit must be 60 to 100 °C')
  if (!Number.isInteger(sc.idleMinutes) || sc.idleMinutes < 1 || sc.idleMinutes > 240) throw new Error('Away time must be 1 to 240 minutes')
  if (!['nothing', 'notify', 'sleep', 'shutdown'].includes(sc.whenDone)) throw new Error('Invalid "when the queue finishes" setting')
  if (['sleep', 'shutdown'].includes(sc.whenDone) && !sc.powerConfirmed) throw new Error('Confirm that OPNduck may sleep or shut down this computer first')
  if (typeof next.notifyOnFinish !== 'boolean' || typeof next.runInTray !== 'boolean') throw new Error('Invalid notification setting')
  if (!['auto', 'cpu'].includes(next.videoEncoder)) throw new Error('Invalid video encoder')
  if (typeof next.mcpServer !== 'boolean') throw new Error('Invalid MCP server setting')
  if (typeof next.pluginsSafeMode !== 'boolean') throw new Error('Invalid plugin safe mode setting')
  if (typeof next.autoTagAudio !== 'boolean') throw new Error('Invalid music tagging setting')
  if (typeof next.remoteEnabled !== 'boolean') throw new Error('Invalid Send to OPNduck setting')
  if (!['ask', 'auto'].includes(next.remoteMode)) throw new Error('"When a link arrives" must be ask or auto')
  if (typeof next.remoteRelay !== 'boolean') throw new Error('Invalid relay setting')
  if (typeof next.shareEngine !== 'boolean') throw new Error('Invalid engine sharing setting')
  if (!['off', 'localhost', 'tailscale', 'lan'].includes(next.remoteBind)) throw new Error('Invalid link server setting')
  if (!Number.isInteger(next.remotePort) || next.remotePort < 1024 || next.remotePort > 65525) throw new Error('The link server port must be 1024 to 65525')
  if (typeof next.remoteDirectUrl !== 'string' || (next.remoteDirectUrl !== '' && !/^https:\/\/[a-z0-9.-]+(:\d{2,5})?$/i.test(next.remoteDirectUrl))) throw new Error('Invalid direct address')
  if (!['MP4', 'MKV', 'WEBM', 'MOV', 'AVI', 'MP3', 'FLAC', 'WAV'].includes(next.remoteFormat)) throw new Error('Invalid format for links from other devices')
  if (typeof next.remoteVideoQuality !== 'string' || !/^(best|\d{3,4})$/.test(next.remoteVideoQuality)) throw new Error('Invalid video quality for links from other devices')
  if (typeof next.remoteAudioQuality !== 'string' || !/^(best|\d{1,3}k?)$/i.test(next.remoteAudioQuality)) throw new Error('Invalid audio quality for links from other devices')
  if (typeof next.tuiTheme !== 'string' || !/^[a-z0-9-]{1,40}$/.test(next.tuiTheme)) throw new Error('Invalid terminal theme')
  const c = next.cookies
  if (!c || !['none', 'browser', 'file', 'login'].includes(c.mode)) throw new Error('Invalid cookie source')
  if (!COOKIE_BROWSERS.includes(c.browser)) throw new Error('Unsupported browser for cookies')
  // yt-dlp's BROWSER:PROFILE::CONTAINER syntax: a single ':' inside the profile is fine (a Windows
  // drive letter, C:\...), but '::' would start a container, so it's refused.
  if (typeof c.profile !== 'string' || c.profile.includes('::') || /[\0\r\n]/.test(c.profile)) {
    throw new Error('Invalid browser profile')
  }
  if (c.profile !== '' && !/^[A-Za-z0-9 ._-]+$/.test(c.profile) && !path.isAbsolute(c.profile)) {
    throw new Error('A browser profile must be a plain name or an absolute folder path')
  }
  if (c.mode === 'file' && (typeof c.file !== 'string' || !path.isAbsolute(c.file))) {
    throw new Error('The cookies file must be an absolute path')
  }
}

let cache = null

function read() {
  if (cache) return cache
  let stored = {}
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed
  } catch {
    /* first run, or unreadable — fall back to defaults */
  }
  const merged = { ...DEFAULTS, ...stored, cookies: { ...DEFAULTS.cookies, ...(stored.cookies || {}) }, schedule: { ...DEFAULTS.schedule, ...(stored.schedule || {}) }, ai: { ...DEFAULTS.ai, ...(stored.ai || {}) } }
  if (merged.ai.context === 8192 && !merged.ai.ctxChosen) merged.ai.context = 16384 // the old default; not a choice
  try {
    validate(merged)
    cache = merged
  } catch {
    cache = structuredClone(DEFAULTS) // a hand-edited bad file must never break downloads
  }
  return cache
}

/** Returns a copy, so callers can't mutate the cache. */
function getSettings() {
  return structuredClone(read())
}

/** Applies a partial update (cookies merged one level deep), validates, saves atomically. */
function setSettings(patch) {
  if (!patch || typeof patch !== 'object') throw new Error('Invalid settings update')
  const current = read()
  const next = {
    proxy: patch.proxy !== undefined ? String(patch.proxy).trim() : current.proxy,
    gpuThreads: patch.gpuThreads !== undefined ? patch.gpuThreads : current.gpuThreads,
    upscaleEngine: patch.upscaleEngine !== undefined ? patch.upscaleEngine : current.upscaleEngine,
    notifyOnFinish: patch.notifyOnFinish !== undefined ? patch.notifyOnFinish : current.notifyOnFinish,
    runInTray: patch.runInTray !== undefined ? patch.runInTray : current.runInTray,
    ai: patch.ai !== undefined ? { ...current.ai, ...patch.ai } : current.ai,
    schedule: patch.schedule !== undefined ? { ...current.schedule, ...patch.schedule } : current.schedule,
    watchFolder: patch.watchFolder !== undefined ? { ...current.watchFolder, ...patch.watchFolder } : current.watchFolder,
    maxDownloads: patch.maxDownloads !== undefined ? patch.maxDownloads : current.maxDownloads,
    maxConversions: patch.maxConversions !== undefined ? patch.maxConversions : current.maxConversions,
    videoEncoder: patch.videoEncoder !== undefined ? patch.videoEncoder : current.videoEncoder,
    mcpServer: patch.mcpServer !== undefined ? patch.mcpServer : current.mcpServer,
    pluginsSafeMode: patch.pluginsSafeMode !== undefined ? patch.pluginsSafeMode : current.pluginsSafeMode,
    autoTagAudio: patch.autoTagAudio !== undefined ? patch.autoTagAudio : current.autoTagAudio,
    remoteEnabled: patch.remoteEnabled !== undefined ? patch.remoteEnabled : current.remoteEnabled,
    remoteMode: patch.remoteMode !== undefined ? patch.remoteMode : current.remoteMode,
    remoteRelay: patch.remoteRelay !== undefined ? patch.remoteRelay : current.remoteRelay,
    shareEngine: patch.shareEngine !== undefined ? patch.shareEngine : current.shareEngine,
    remoteBind: patch.remoteBind !== undefined ? patch.remoteBind : current.remoteBind,
    remotePort: patch.remotePort !== undefined ? patch.remotePort : current.remotePort,
    remoteDirectUrl: patch.remoteDirectUrl !== undefined ? patch.remoteDirectUrl : current.remoteDirectUrl,
    remoteFormat: patch.remoteFormat !== undefined ? patch.remoteFormat : current.remoteFormat,
    remoteVideoQuality: patch.remoteVideoQuality !== undefined ? patch.remoteVideoQuality : current.remoteVideoQuality,
    remoteAudioQuality: patch.remoteAudioQuality !== undefined ? patch.remoteAudioQuality : current.remoteAudioQuality,
    tuiTheme: patch.tuiTheme !== undefined ? patch.tuiTheme : current.tuiTheme,
    cookies: { ...current.cookies, ...(patch.cookies && typeof patch.cookies === 'object' ? patch.cookies : {}) },
  }
  validate(next)
  cache = next
  const file = settingsFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
  fs.renameSync(tmp, file)
  return getSettings()
}

/** yt-dlp args every probe and download shares, so previews behave exactly like the real run. */
function ytdlpBaseArgs() {
  const s = read()
  const args = ['--encoding', 'utf-8'] // Windows pipes use the console code page otherwise
  if (s.proxy) args.push('--proxy', s.proxy)
  if (s.cookies.mode === 'browser') {
    args.push('--cookies-from-browser', s.cookies.profile ? `${s.cookies.browser}:${s.cookies.profile}` : s.cookies.browser)
  } else if (s.cookies.mode === 'file' && s.cookies.file) args.push('--cookies', s.cookies.file)
  else if (s.cookies.mode === 'login' && fs.existsSync(loginCookieFile())) args.push('--cookies', loginCookieFile())
  return args
}

/** True when the user has told OPNduck where to get login cookies. */
function hasCookies() {
  const s = read()
  return (
    s.cookies.mode === 'browser' ||
    (s.cookies.mode === 'file' && !!s.cookies.file) ||
    (s.cookies.mode === 'login' && fs.existsSync(loginCookieFile()))
  )
}

module.exports = { validate, configure, getSettings, setSettings, ytdlpBaseArgs, hasCookies, loginCookieFile }
