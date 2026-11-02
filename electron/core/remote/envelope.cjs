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
 * The message format shared by every way a link reaches OPNduck (direct, relay, the phone page, the browser
 * extension). One pairing secret K is turned into three values with HKDF-SHA256 (empty salt, fixed info strings, so
 * Node and the browser's WebCrypto derive the same bytes), and a message is a small JSON envelope sealed with
 * AES-256-GCM. The test vector in test/vectors/envelope.json pins the format for every implementation.
 * No Electron: node:crypto only.
 */
const crypto = require('node:crypto')

const VERSION = 1
const AAD = Buffer.from('opnduck-v1')
const PAIR_BASE = 'https://sight8218.github.io/OPNduck/send/'
const IV_LEN = 12
const TAG_LEN = 16
const MAX_ENVELOPE_CHARS = 8 * 1024

const b64u = (buf) => Buffer.from(buf).toString('base64url')

/** A new random 32-byte pairing secret. */
const newSecret = () => crypto.randomBytes(32)

/** topic (the ntfy topic name), encKey (32 bytes) and authToken (the Bearer token) for a secret. */
function deriveKeys(secret) {
  if (!Buffer.isBuffer(secret) || secret.length !== 32) throw new Error('The pairing secret must be 32 bytes')
  const hk = (info) => Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.alloc(0), info, 32))
  return {
    topic: `opnduck_${hk('opnduck-topic-v1').subarray(0, 16).toString('hex')}`,
    encKey: hk('opnduck-enc-v1'),
    authToken: b64u(hk('opnduck-auth-v1')),
  }
}

/** Seals an envelope object: base64url(iv || ciphertext || tag). `iv` is for the test vector only. */
function seal(envelope, encKey, iv = crypto.randomBytes(IV_LEN)) {
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv)
  cipher.setAAD(AAD)
  const ct = Buffer.concat([cipher.update(JSON.stringify(envelope), 'utf8'), cipher.final()])
  return b64u(Buffer.concat([iv, ct, cipher.getAuthTag()]))
}

/** Opens a sealed envelope. Returns the object, or null for anything wrong (junk, a wrong key, a tampered message). */
function open(wire, encKey) {
  try {
    if (typeof wire !== 'string' || wire.length === 0 || wire.length > MAX_ENVELOPE_CHARS || !/^[A-Za-z0-9_-]+$/.test(wire)) return null
    const raw = Buffer.from(wire, 'base64url')
    if (raw.length < IV_LEN + TAG_LEN + 2) return null
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, raw.subarray(0, IV_LEN))
    decipher.setAAD(AAD)
    decipher.setAuthTag(raw.subarray(raw.length - TAG_LEN))
    const plain = Buffer.concat([decipher.update(raw.subarray(IV_LEN, raw.length - TAG_LEN)), decipher.final()]).toString('utf8')
    const obj = JSON.parse(plain)
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null
  } catch {
    return null
  }
}

/** The link a phone or extension is paired with. The secret sits in the URL fragment, so it is never sent to a server. */
function buildPairLink({ secret, relay = 'https://ntfy.sh', relayToken = '', direct = '', name = 'OPNduck' }) {
  const payload = { v: VERSION, k: b64u(secret), s: relay, a: relayToken, d: direct, n: name }
  return `${PAIR_BASE}#p=${b64u(JSON.stringify(payload))}`
}

/** Reads a pair link, or just the part after #p=. Returns { secret, relay, relayToken, direct, name } or null. */
function parsePairLink(text) {
  try {
    const part = String(text).trim().split('#p=').pop()
    const p = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    const secret = Buffer.from(String(p.k), 'base64url')
    if (p.v !== VERSION || secret.length !== 32) return null
    return { secret, relay: String(p.s ?? ''), relayToken: String(p.a ?? ''), direct: String(p.d ?? ''), name: String(p.n ?? '') }
  } catch {
    return null
  }
}

module.exports = { VERSION, MAX_ENVELOPE_CHARS, PAIR_BASE, newSecret, deriveKeys, seal, open, buildPairLink, parsePairLink }
