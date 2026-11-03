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
 * Paired devices for the Engine API. A device gets a random 32-byte token when it pairs with a one-time code; only the
 * SHA-256 of the token is stored, so a copy of the file cannot be used to sign in. No Electron.
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const CODE_TTL_MS = 5 * 60 * 1000
const MAX_CODES = 5
const MAX_DEVICES = 50
const KINDS = ['desktop', 'phone', 'extension']

const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex')

/**
 * @param {object} deps
 * @param {string} deps.file  where devices are kept (written with mode 0600)
 * @param {string} [deps.codesFile]  where pairing codes are kept, so another process (the server's `pair` command) can make
 *   them for a running server. Without it they live in memory only. Only hashes of the codes are stored.
 * @param {() => number} [deps.now]
 */
function createDevices({ file, codesFile = null, now = Date.now }) {
  let devices = []
  let loadedAt = -1 // mtime of the devices file we last read: another process may have changed it
  const codes = new Map() // sha256(code) -> expiry

  function writeSecret(f, data) {
    fs.mkdirSync(path.dirname(f), { recursive: true })
    const tmp = `${f}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 })
    fs.chmodSync(tmp, 0o600)
    fs.renameSync(tmp, f)
  }

  function load() {
    try {
      const mtime = fs.statSync(file).mtimeMs
      if (mtime === loadedAt) return
      const list = JSON.parse(fs.readFileSync(file, 'utf8'))?.devices
      devices = Array.isArray(list) ? list.filter((d) => d && typeof d.id === 'string' && typeof d.tokenHash === 'string') : []
      loadedAt = mtime
    } catch {
      /* first run, or the file is being replaced: keep what we have */
    }
  }
  load()

  function save() {
    writeSecret(file, { devices })
    loadedAt = fs.statSync(file).mtimeMs
  }

  function loadCodes() {
    if (!codesFile) return
    codes.clear()
    try {
      for (const [h, v] of Object.entries(JSON.parse(fs.readFileSync(codesFile, 'utf8')))) {
        if (typeof v === 'number') codes.set(h, { exp: v, kind: 'phone' }) // older file: no kind was recorded
        else if (v && typeof v.exp === 'number' && KINDS.includes(v.kind)) codes.set(h, v)
      }
    } catch {
      /* none yet */
    }
  }
  const saveCodes = () => codesFile && writeSecret(codesFile, Object.fromEntries(codes))

  function sweep() {
    loadCodes()
    const t = now()
    for (const [c, v] of codes) if (v.exp <= t) codes.delete(c)
  }

  /**
   * A one-time pairing code, good for 5 minutes. The newest few stay valid, older ones are dropped. The kind of device
   * is decided here, by whoever makes the code, never by the device: only 'desktop' devices can see every job and
   * manage the other devices.
   */
  function newPairCode(kind = 'phone') {
    if (!KINDS.includes(kind)) throw new Error(`Unknown device kind: ${kind}`)
    sweep()
    while (codes.size >= MAX_CODES) codes.delete(codes.keys().next().value)
    const code = crypto.randomBytes(18).toString('base64url')
    codes.set(hash(code), { exp: now() + CODE_TTL_MS, kind })
    saveCodes()
    return code
  }

  /** Trades a valid code for a device token (shown once). Returns null for a wrong, used or expired code. */
  function pair({ code, deviceName }) {
    sweep()
    if (typeof code !== 'string' || !codes.has(hash(code))) return null
    const kind = codes.get(hash(code)).kind
    codes.delete(hash(code)) // single use, whatever happens next
    saveCodes()
    load()
    if (devices.length >= MAX_DEVICES) throw new Error('Too many paired devices: remove one first')
    const name = typeof deviceName === 'string' ? deviceName.replace(/\p{Cc}/gu, ' ').trim().slice(0, 60) : ''
    const token = crypto.randomBytes(32).toString('base64url')
    const device = { id: crypto.randomUUID(), name: name || 'Device', kind, tokenHash: hash(token), createdAt: now(), lastSeen: 0 }
    devices.push(device)
    save()
    return { deviceId: device.id, deviceToken: token }
  }

  /** The device a bearer token belongs to, or null. */
  function authenticate(token) {
    load()
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null
    const h = Buffer.from(hash(token))
    const found = devices.find((d) => {
      const g = Buffer.from(d.tokenHash)
      return g.length === h.length && crypto.timingSafeEqual(g, h)
    })
    if (found && now() - found.lastSeen > 60000) {
      found.lastSeen = now() // not written to disk on every request; it is only a hint for the device list
    }
    return found ?? null
  }

  const list = () => (load(), devices).map(({ id, name, kind, createdAt, lastSeen }) => ({ id, name, kind, createdAt, lastSeen }))

  function revoke(id) {
    load()
    const before = devices.length
    devices = devices.filter((d) => d.id !== id)
    if (devices.length === before) return false
    save()
    return true
  }

  return { newPairCode, pair, authenticate, list, revoke }
}

module.exports = { createDevices, CODE_TTL_MS }
