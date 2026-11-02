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
// The same message format as electron/core/remote/envelope.cjs, for browsers (WebCrypto): used by the phone page
// (gh-pages /send/) and the browser extension. The file test/vectors/envelope.json pins both implementations.
const enc = new TextEncoder()
const AAD = enc.encode('opnduck-v1')

export const VERSION = 1

export const toB64u = (bytes) => {
  let s = ''
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const fromB64u = (text) => {
  const s = atob(String(text).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(text).length + 3) % 4))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** { topic, encKey (CryptoKey), authToken } for a 32-byte secret: HKDF-SHA256, empty salt, the fixed info strings. */
export async function deriveKeys(secret) {
  if (!(secret instanceof Uint8Array) || secret.length !== 32) throw new Error('The pairing secret must be 32 bytes')
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits'])
  const bits = (info) => crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) }, base, 256)
  return {
    topic: `opnduck_${hex((await bits('opnduck-topic-v1')).slice(0, 16))}`,
    encKey: await crypto.subtle.importKey('raw', await bits('opnduck-enc-v1'), 'AES-GCM', false, ['encrypt', 'decrypt']),
    authToken: toB64u(await bits('opnduck-auth-v1')),
  }
}

/** base64url(iv || ciphertext || tag). `iv` is for the test vector only. */
export async function seal(envelope, encKey, iv = crypto.getRandomValues(new Uint8Array(12))) {
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, encKey, enc.encode(JSON.stringify(envelope))))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return toB64u(out)
}

/** Opens a sealed message (used by the tests); null for anything wrong. */
export async function open(wire, encKey) {
  try {
    const raw = fromB64u(wire)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: AAD, tagLength: 128 }, encKey, raw.slice(12))
    return JSON.parse(new TextDecoder().decode(plain))
  } catch {
    return null
  }
}

/** A pair link, or just the part after #p=. Returns { secret, relay, relayToken, direct, name } or null. */
export function parsePairLink(text) {
  try {
    const part = String(text).trim().split('#p=').pop()
    const p = JSON.parse(new TextDecoder().decode(fromB64u(part)))
    const secret = fromB64u(String(p.k))
    if (p.v !== VERSION || secret.length !== 32) return null
    return { secret, relay: String(p.s ?? ''), relayToken: String(p.a ?? ''), direct: String(p.d ?? ''), name: String(p.n ?? '') }
  } catch {
    return null
  }
}

/** The first http(s) link in some shared text (many apps put the link inside the text), or ''. */
export function firstUrl(...texts) {
  for (const t of texts) {
    const m = /https?:\/\/[^\s<>"']+/i.exec(String(t ?? ''))
    if (m) return m[0].replace(/[.,;:!?)\]]+$/, '')
  }
  return ''
}

/** The message for a link, ready to send. */
export const makeEnvelope = (url, from, target = 'download') => ({ v: VERSION, id: crypto.randomUUID(), ts: Date.now(), url, target, from })

/**
 * Sends a link to the paired computer: through each direct address that answers its health check within 1.5 seconds
 * (`pair.local`, this computer, then `pair.direct`, over Tailscale), else through the relay.
 * Returns 'local', 'direct' or 'relay'; throws a readable Error if none works.
 */
export async function sendLink(pair, url, from, fetchImpl = fetch) {
  const keys = await deriveKeys(pair.secret)
  const wire = await seal(makeEnvelope(url, from), keys.encKey)
  for (const [how, base] of [['local', pair.local], ['direct', pair.direct]]) {
    if (!base) continue
    try {
      const health = await fetchImpl(`${base}/v1/health`, { signal: AbortSignal.timeout(1500) })
      if (!health.ok) continue
      const r = await fetchImpl(`${base}/v1/send`, { method: 'POST', headers: { Authorization: `Bearer ${keys.authToken}` }, body: wire })
      if (r.status === 202) return how
    } catch {
      /* not reachable from here: try the next way */
    }
  }
  const relay = pair.relay || 'https://ntfy.sh'
  const headers = pair.relayToken ? { Authorization: `Bearer ${pair.relayToken}` } : {}
  let r
  try {
    r = await fetchImpl(`${relay}/${keys.topic}`, { method: 'POST', headers, body: wire })
  } catch {
    throw new Error("Couldn't reach OPNduck or the relay. Check your connection.")
  }
  if (!r.ok) throw new Error(`The relay answered ${r.status}`)
  return 'relay'
}
