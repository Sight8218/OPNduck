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
 * The downloader: yt-dlp downloads (video, audio, playlists, subtitles, Spotify-to-YouTube matching), link classification, size estimates and playlist probing.
 * No Electron: everything it needs comes in through `ctx` (see core/*.cjs).
 */
const { stripLinkLogin } = require('./redact.cjs')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/**
 * A link with a user name and password in it (http://user:pass@host/...) must not put them in yt-dlp's argument list,
 * where any local account can read them. The whole link goes into a private (0600) config file instead, and yt-dlp then
 * applies the login to that link's own origin only. (A global `--add-headers Authorization` would be sent to every
 * origin yt-dlp talks to, including media hosted elsewhere, so that is deliberately not used.)
 * Returns `tail` (what to append to the argument list: `-- <url>`, or nothing when the link is in the config file),
 * `args` (the config file option), `url` (the link without credentials, for labels and logs) and `cleanup`.
 */
function protectUrlCredentials(rawUrl) {
  const none = { url: rawUrl, tail: ['--', rawUrl], args: [], cleanup() {} }
  let u
  try {
    u = new URL(rawUrl)
  } catch {
    return none
  }
  if (!u.username && !u.password) return none
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-auth-'))
  fs.chmodSync(dir, 0o700)
  const file = path.join(dir, 'auth.conf')
  // yt-dlp reads one shell-quoted argument per config line; '#' would start a comment, so the link is double-quoted.
  const quoted = `"${u.toString().replace(/[\\"]/g, '\\$&')}"`
  fs.writeFileSync(file, quoted + '\n', { mode: 0o600 })
  u.username = ''
  u.password = ''
  return {
    url: u.toString(),
    tail: [],
    args: ['--config-locations', file],
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

const LOGIN_PAGE_MSG = 'A link with a login only works for a direct file link, not a web page. Open the file itself (…/video.mp4) or use a link without the login.'

/**
 * yt-dlp sends the link it was given, login included, as the Referer to any other origin a web page points at (its generic
 * extractor does that, and no option overrides it). So a link with a login may only go to yt-dlp when it is a plain file.
 * This looks at the link first (the login goes to that origin only, redirects to other origins carry nothing) and returns an
 * error text when it is a web page, or null when it is fine, has no login, or can't be reached (yt-dlp then reports why).
 */
async function loginLinkProblem(rawUrl) {
  let u
  try {
    u = new URL(rawUrl)
  } catch {
    return null
  }
  if (!u.username && !u.password) return null
  const auth = 'Basic ' + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64')
  const origin = u.origin
  u.username = ''
  u.password = ''
  let next = u.toString()
  try {
    for (let hop = 0; hop < 6; hop++) {
      const target = new URL(next)
      const headers = target.origin === origin ? { authorization: auth } : {}
      const res = await fetch(target, { method: 'GET', headers: { ...headers, range: 'bytes=0-0' }, redirect: 'manual', signal: AbortSignal.timeout(10_000) })
      const loc = res.headers.get('location')
      const type = (res.headers.get('content-type') || '').toLowerCase()
      res.body?.cancel().catch(() => {})
      if (res.status >= 300 && res.status < 400 && loc) {
        next = new URL(loc, target).toString()
        continue
      }
      if (res.status >= 400) return null
      return /^(text\/|application\/(xhtml|xml|json|ld\+json))/.test(type) ? LOGIN_PAGE_MSG : null
    }
  } catch {
    return null
  }
  return null
}

/** The link without credentials, for labels, logs and error text. */
function redactUrl(rawUrl) {
  try {
    const u = new URL(rawUrl)
    if (!u.username && !u.password) return rawUrl
    u.username = ''
    u.password = ''
    return u.toString()
  } catch {
    return rawUrl
  }
}

function createDownload(ctx) {
  const {
    parseHttpUrl, decodeHtmlEntities, ytdlpCommand, ytdlpBaseArgs, hasCookies, handleStart, assertAbsolutePath, defaultDownloadDir, addTask, broadcastTasks, updateTask, isCanceled, startHandlers, tasks, downloadPool, attachLog,
  } = ctx

  /**
   * Spotify tracks are DRM-protected and yt-dlp can't fetch them. As an experimental workaround we
   * read the track's public page metadata (title, artist) and search YouTube for the same song.
   * This is not a download from Spotify, so callers must label the result as a match
   * (TaskState.experimentalMatch).
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

    return { query: `ytsearch1:${artist} - ${title}`, search: `${artist} - ${title}`, label: `${artist} - ${title}`, artist, title }
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
      const auth = protectUrlCredentials(url)
      try {
        child = spawn(ytdlpCommand(), [...ytdlpBaseArgs(), ...auth.args, '--flat-playlist', '--dump-single-json', '--no-warnings', '--playlist-end', '5000', ...auth.tail])
      } catch {
        auth.cleanup()
        resolve(null)
        return
      }
      child.on('close', auth.cleanup)
      child.on('error', auth.cleanup)
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
            thumbnailUrl: pickSmallThumbnail(first?.thumbnails, first?.thumbnails?.[first.thumbnails.length - 1]?.url ?? null),
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
    const loginProblem = await loginLinkProblem(effectiveUrl)
    if (loginProblem) return { title: loginProblem, ...empty }

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
      const fallback = { title: redactUrl(req.url), approxSizeBytes: null, thumbnailUrl: null }
      let child
      const auth = protectUrlCredentials(effectiveUrl)
      try {
        child = spawn(ytdlpCommand(), [...ytdlpBaseArgs(), ...auth.args, '--dump-json', '--no-warnings', '--no-playlist', ...auth.tail])
      } catch {
        auth.cleanup()
        resolve(fallback)
        return
      }
      child.on('close', auth.cleanup)
      child.on('error', auth.cleanup)
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
            title: spotify ? `${spotify.label} (YouTube match)` : (info.title ?? redactUrl(req.url)),
            approxSizeBytes: estimateSize(info, req),
            thumbnailUrl: pickSmallThumbnail(info.thumbnails, info.thumbnail ?? null),
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
        label: redactUrl(req.url),
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
    const loginProblem = await loginLinkProblem(spotify?.query ?? req.url)
    if (loginProblem) {
      updateTask(id, { status: 'error', error: loginProblem })
      return id
    }
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
    if (spotify) {
      updateTask(id, { label: spotify.label, experimentalMatch: 'YT Match (Experimental)' })
      // Kept for the tagger: if the audio fingerprint finds nothing, the Spotify artist and title still name the song.
      const e = tasks.get(id)
      if (e) e.spotify = { artist: spotify.artist, title: spotify.title }
    }

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
    // Credentials in the link go to yt-dlp through a private config file, never the argument list.
    const auth = protectUrlCredentials(effectiveUrl)
    args.splice(-2, 2, ...auth.tail) // drops the trailing `-- <link>`: with credentials the link lives in the config file
    args.unshift(...auth.args)

    // Wait for a free download slot (the task shows as 'queued'); released when it finishes.
    await downloadPool.acquire()
    const slotEntry = tasks.get(id)
    if (!slotEntry || isCanceled(id)) {
      downloadPool.release()
      auth.cleanup()
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
      child.on('close', auth.cleanup)
      child.on('error', auth.cleanup)
      attachLog(child, id)
    } catch (err) {
      auth.cleanup()
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
          error: stripLinkLogin(stderrTail.trim().split('\n').pop() ?? '') || `yt-dlp exited with code ${code}`,
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
      const auth = protectUrlCredentials(url)
      try {
        child = spawn(ytdlpCommand(), [...ytdlpBaseArgs(), ...auth.args, '--flat-playlist', '--dump-single-json', '--no-warnings', '--playlist-end', String(limit), ...auth.tail])
      } catch {
        auth.cleanup()
        resolve(null)
        return
      }
      child.on('close', auth.cleanup)
      child.on('error', auth.cleanup)
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

  return { SPOTIFY_TRACK_RE, SPOTIFY_OTHER_RE, resolveSpotifyTrack, AUDIO_EXT, VIDEO_EXT, qualityLabel, subtitleArgs, embedArgs, formatArgs, YT_HOST_RE, CHANNEL_PATH_RE, classifyLink, listUrl, probePlaylist, probeInfo, extraInfo, LANG_RE, validateDownloadRequest, formatSize, bestAudioFormat, bestVideoFormat, estimateSize, probeEntries }
}

/** The thumbnails are shown at 72x40 (Library) and 56x32 (Downloader), so about 2x that is plenty: the smallest one at least
 *  160 px wide. yt-dlp's own `thumbnail` is the largest (often 1280x720), which the renderer would download and decode for
 *  every row. Falls back to the biggest one under 160 px, then to `fallback`. */
const THUMB_MIN_WIDTH = 160
function pickSmallThumbnail(thumbnails, fallback = null) {
  const list = (Array.isArray(thumbnails) ? thumbnails : []).filter((t) => t && typeof t.url === 'string' && /^https?:\/\//i.test(t.url) && Number(t.width) > 0)
  const big = list.filter((t) => t.width >= THUMB_MIN_WIDTH).sort((a, b) => a.width - b.width)[0]
  if (big) return big.url
  const small = list.sort((a, b) => b.width - a.width)[0]
  return small ? small.url : fallback
}

module.exports = { createDownload, pickSmallThumbnail, protectUrlCredentials }
