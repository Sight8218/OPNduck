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
 * @param {() => number} [deps.now]
 */
function createDevices({ file, now = Date.now }) {
  let devices = []
  const codes = new Map() // code -> expiry
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'))?.devices
    if (Array.isArray(list)) devices = list.filter((d) => d && typeof d.id === 'string' && typeof d.tokenHash === 'string')
  } catch {
    /* first run */
  }

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ devices }), { mode: 0o600 })
    fs.chmodSync(tmp, 0o600)
    fs.renameSync(tmp, file)
  }

  function sweep() {
    const t = now()
    for (const [c, exp] of codes) if (exp <= t) codes.delete(c)
  }

  /** A one-time pairing code, good for 5 minutes. The newest few stay valid, older ones are dropped. */
  function newPairCode() {
    sweep()
    while (codes.size >= MAX_CODES) codes.delete(codes.keys().next().value)
    const code = crypto.randomBytes(18).toString('base64url')
    codes.set(code, now() + CODE_TTL_MS)
    return code
  }

  /** Trades a valid code for a device token (shown once). Returns null for a wrong, used or expired code. */
  function pair({ code, deviceName, deviceKind }) {
    sweep()
    if (typeof code !== 'string' || !codes.has(code)) return null
    codes.delete(code) // single use, whatever happens next
    if (devices.length >= MAX_DEVICES) throw new Error('Too many paired devices: remove one first')
    const name = typeof deviceName === 'string' ? deviceName.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60) : ''
    const kind = KINDS.includes(deviceKind) ? deviceKind : 'phone'
    const token = crypto.randomBytes(32).toString('base64url')
    const device = { id: crypto.randomUUID(), name: name || 'Device', kind, tokenHash: hash(token), createdAt: now(), lastSeen: 0 }
    devices.push(device)
    save()
    return { deviceId: device.id, deviceToken: token }
  }

  /** The device a bearer token belongs to, or null. */
  function authenticate(token) {
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

  const list = () => devices.map(({ id, name, kind, createdAt, lastSeen }) => ({ id, name, kind, createdAt, lastSeen }))

  function revoke(id) {
    const before = devices.length
    devices = devices.filter((d) => d.id !== id)
    if (devices.length === before) return false
    save()
    return true
  }

  return { newPairCode, pair, authenticate, list, revoke }
}

module.exports = { createDevices, CODE_TTL_MS }
