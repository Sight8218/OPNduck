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
const { app } = require('electron')

/** Browsers yt-dlp can read cookies from (its own allow-list, minus Safari). */
const COOKIE_BROWSERS = ['firefox', 'chromium', 'chrome', 'edge', 'brave', 'opera', 'vivaldi']

const DEFAULTS = {
  /** '' = no proxy. Otherwise http(s)/socks4/socks5 URL handed to yt-dlp --proxy. */
  proxy: '',
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
  return path.join(app.getPath('userData'), 'login-cookies.txt')
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json')
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
  const c = next.cookies
  if (!c || !['none', 'browser', 'file', 'login'].includes(c.mode)) throw new Error('Invalid cookie source')
  if (!COOKIE_BROWSERS.includes(c.browser)) throw new Error('Unsupported browser for cookies')
  // yt-dlp's BROWSER:PROFILE syntax uses ':' as a separator, so a profile can't contain one.
  if (typeof c.profile !== 'string' || c.profile.includes(':') || /[\0\r\n]/.test(c.profile)) {
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
  const merged = { ...DEFAULTS, ...stored, cookies: { ...DEFAULTS.cookies, ...(stored.cookies || {}) } }
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

module.exports = { getSettings, setSettings, ytdlpBaseArgs, hasCookies, loginCookieFile, COOKIE_BROWSERS }
