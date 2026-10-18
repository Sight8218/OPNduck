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
 * The built-in sign-in window: a separate, locked-down browser window where the user logs in to a
 * site themselves (OPNduck never sees or stores a password). When the window is closed the
 * partition's cookies are exported to a Netscape cookies.txt that yt-dlp can use, which is what
 * lets it reach private videos, Watch Later/Liked lists and age-restricted media.
 *
 * Isolation: its own persistent session partition (no shared state with the app window), no
 * preload, sandboxed, no permission grants, https-only navigation. The cookie file holds live
 * session tokens, so it is written with mode 0600 and removed again by "Sign out".
 */
const fs = require('node:fs')
const path = require('node:path')
const { BrowserWindow, session } = require('electron')
const { loginCookieFile } = require('./settings.cjs')

const PARTITION = 'persist:opnduck-login'
const DEFAULT_URL = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F'

/** https only; plain http only for loopback (used by tests and local dev servers). */
function isAllowedLoginUrl(raw) {
  try {
    const u = new URL(raw)
    if (u.protocol === 'https:') return true
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

/** Cookies → Netscape cookies.txt text. HttpOnly cookies use the `#HttpOnly_` prefix curl/yt-dlp read. */
function toNetscape(cookies) {
  const lines = ['# Netscape HTTP Cookie File', '# Written by OPNduck from its sign-in window. Contains session secrets — keep private.']
  for (const c of cookies) {
    if (!c.name || /[\t\r\n]/.test(c.name + c.value + c.domain + c.path)) continue // never emit a malformed row
    const domain = c.domain || ''
    const subdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE'
    const expiry = c.session || !c.expirationDate ? 0 : Math.floor(c.expirationDate)
    lines.push(
      [`${c.httpOnly ? '#HttpOnly_' : ''}${domain}`, subdomains, c.path || '/', c.secure ? 'TRUE' : 'FALSE', String(expiry), c.name, c.value].join('\t'),
    )
  }
  return lines.join('\n') + '\n'
}

/** Writes with mode 0600 even if the file already existed with looser permissions. */
function writePrivate(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, text, { mode: 0o600 })
  fs.chmodSync(tmp, 0o600)
  fs.renameSync(tmp, file)
}

async function exportCookies() {
  const cookies = await session.fromPartition(PARTITION).cookies.get({})
  writePrivate(loginCookieFile(), toNetscape(cookies))
  return cookies.length
}

/** Web contents that belong to the sign-in window — main.cjs exempts them from its
 *  "never navigate away from the app" guard, which would otherwise block the login redirects. */
const loginContents = new WeakSet()

let openWindow = null
const downloadsBlocked = new WeakSet()

/**
 * Opens the sign-in window and resolves when the user closes it, after exporting the cookies.
 * `parent` makes it a child of the app window. Only one can be open at a time.
 */
function openLoginWindow(parent, url) {
  const target = url && isAllowedLoginUrl(url) ? url : DEFAULT_URL
  if (openWindow && !openWindow.isDestroyed()) {
    openWindow.focus()
    return Promise.resolve({ ok: false, cookies: 0, error: 'The sign-in window is already open.' })
  }
  const ses = session.fromPartition(PARTITION)
  // Sites such as Google refuse sign-in from a browser that calls itself "Electron"; present
  // the plain Chromium identity instead. (Some sites still block embedded sign-in — the UI says
  // to use the browser-cookies option then.)
  ses.setUserAgent(
    `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`,
  )
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))

  const win = new BrowserWindow({
    width: 520,
    height: 720,
    title: 'Sign in — OPNduck',
    parent: parent ?? undefined,
    autoHideMenuBar: true,
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  openWindow = win
  loginContents.add(win.webContents)

  // Stay on http(s): block everything else, and open pop-ups (OAuth hand-offs) in the same window.
  win.webContents.on('will-navigate', (event, navUrl) => {
    if (!isAllowedLoginUrl(navUrl)) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url: popup }) => {
    if (isAllowedLoginUrl(popup)) win.loadURL(popup)
    return { action: 'deny' }
  })
  // Redirects don't fire 'will-navigate'; without this a site could bounce the window to a
  // non-web scheme (intent:, custom app protocols) that the check above is meant to stop.
  win.webContents.on('will-redirect', (event, redirectUrl) => {
    if (!isAllowedLoginUrl(redirectUrl)) event.preventDefault()
  })
  if (!downloadsBlocked.has(ses)) {
    // Registered once per session, not once per window: the session outlives every window.
    downloadsBlocked.add(ses)
    ses.on('will-download', (event) => event.preventDefault())
  }

  win.loadURL(target).catch(() => {
    /* a failed load shows Chromium's error page inside the window; nothing to do */
  })

  return new Promise((resolve) => {
    // 'closed' (not 'close'): it fires however the window goes away — the user's X button, or the
    // site closing its own window after sign-in, which never emits 'close'. The session outlives
    // the window, so the cookies are still readable here.
    win.on('closed', () => {
      openWindow = null
      exportCookies()
        .then((count) => resolve({ ok: true, cookies: count }))
        .catch((err) => resolve({ ok: false, cookies: 0, error: err.message }))
    })
  })
}

/** Forget the login completely: the browser session's data and the exported cookie file. */
async function clearLogin() {
  if (openWindow && !openWindow.isDestroyed()) openWindow.close()
  const ses = session.fromPartition(PARTITION)
  await ses.clearStorageData()
  await ses.clearCache()
  try {
    fs.rmSync(loginCookieFile(), { force: true })
  } catch {
    /* already gone */
  }
}

function loginStatus() {
  try {
    const st = fs.statSync(loginCookieFile())
    const text = fs.readFileSync(loginCookieFile(), 'utf8')
    const count = text.split('\n').filter((l) => l && (!l.startsWith('#') || l.startsWith('#HttpOnly_'))).length
    return { signedIn: count > 0, cookies: count, updatedAt: st.mtimeMs }
  } catch {
    return { signedIn: false, cookies: 0, updatedAt: null }
  }
}

module.exports = { openLoginWindow, clearLogin, loginStatus, loginContents, toNetscape, isAllowedLoginUrl }
