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
 * The OPNduck servers this app can send jobs to (OPNduck Server, or another desktop that shares its engine). Each one
 * is a base address plus the token the server gave us when we paired; the token is sealed (Electron safeStorage on the
 * desktop) before it touches the disk. No Electron: the shell passes in seal/unseal.
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { parseEnginePairLink } = require('../../../engine-api/pairlink.cjs')

const MAX_SERVERS = 10
const KINDS = ['download', 'convert', 'upscale_image', 'upscale_video', 'interpolate', 'subtitles', 'trim', 'compress', 'make_gif', 'audio_ai']

/** How well the connection to an address is protected: 'https', 'loopback', 'tailnet' (WireGuard already encrypts it) or 'lan-http' (not encrypted). */
function transportOf(baseUrl) {
  const u = new URL(baseUrl)
  if (u.protocol === 'https:') return 'https'
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1' || /^127\./.test(host)) return 'loopback'
  if (net.isIPv4(host)) {
    const [a, b] = host.split('.').map(Number)
    if (a === 100 && b >= 64 && b <= 127) return 'tailnet'
  }
  if (/\.ts\.net$/i.test(host)) return 'tailnet'
  return 'lan-http'
}

/**
 * @param {object} deps
 * @param {string} deps.file
 * @param {(text: string) => string} deps.seal    makes a token safe to store
 * @param {(sealed: string) => string} deps.unseal
 * @param {typeof fetch} [deps.fetchFn]
 * @param {() => string} [deps.deviceName]
 */
function createServers({ file, seal, unseal, fetchFn = fetch, deviceName = () => os.hostname() }) {
  let state = { servers: [], defaults: {} }
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'))
    state = {
      servers: Array.isArray(s.servers) ? s.servers.filter((x) => x && typeof x.id === 'string' && typeof x.baseUrl === 'string' && typeof x.token === 'string') : [],
      defaults: s.defaults && typeof s.defaults === 'object' ? s.defaults : {},
    }
  } catch {
    /* none yet */
  }

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 })
    fs.chmodSync(tmp, 0o600)
    fs.renameSync(tmp, file)
  }

  const view = (s) => ({ id: s.id, name: s.name, baseUrl: s.baseUrl, transport: transportOf(s.baseUrl) })
  const find = (id) => {
    const s = state.servers.find((x) => x.id === id)
    if (!s) throw new Error('No such server')
    return s
  }

  /** A JSON request to a server, signed in as this device. Throws a readable message. */
  async function request(id, method, route, body, { timeoutMs = 8000 } = {}) {
    const s = find(id)
    let res
    try {
      res = await fetchFn(s.baseUrl + route, {
        method,
        headers: { Authorization: `Bearer ${unseal(s.token)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw new Error(`${s.name} cannot be reached`)
    }
    const json = await res.json().catch(() => null)
    if (res.status === 401) throw new Error(`${s.name} no longer accepts this computer. Remove it and pair again`)
    if (!res.ok) throw new Error(json?.error || `${s.name} answered ${res.status}`)
    return json
  }

  /** Pairs with a server from its pair link (`opnduck://pair?...`). */
  async function add(linkText) {
    const link = parseEnginePairLink(linkText)
    if (!link) throw new Error('That is not an OPNduck server pair link. It starts with opnduck://pair')
    if (state.servers.length >= MAX_SERVERS) throw new Error(`At most ${MAX_SERVERS} servers`)
    if (state.servers.some((s) => s.baseUrl === link.baseUrl)) throw new Error('This server is already added')
    let res
    try {
      res = await fetchFn(`${link.baseUrl}/v1/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: link.code, deviceName: deviceName(), deviceKind: 'desktop' }),
        signal: AbortSignal.timeout(10000),
      })
    } catch {
      throw new Error(`Cannot reach ${link.baseUrl}. Is the server running, and is this computer on the same network or tailnet?`)
    }
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.deviceToken) throw new Error(res.status === 403 ? 'The pairing code is wrong, used or older than 5 minutes. Make a new one with "opnduck-server pair"' : json?.error || `The server answered ${res.status}`)
    const server = { id: crypto.randomUUID(), name: link.name || new URL(link.baseUrl).hostname, baseUrl: link.baseUrl, token: seal(json.deviceToken) }
    state.servers.push(server)
    save()
    return view(server)
  }

  /** Is the server reachable, is it the version we speak, and what can it do? Never throws. */
  async function check(id) {
    try {
      const info = await request(id, 'GET', '/v1/info', null, { timeoutMs: 5000 })
      if (info.apiVersion !== 1) return { online: true, mismatch: true, version: info.version, error: `It speaks API version ${info.apiVersion}; this app speaks 1. Update the older one.` }
      return { online: true, mismatch: false, version: info.version, kinds: info.kinds, gpus: info.gpus ?? [], freeDiskBytes: info.freeDiskBytes ?? null, tools: info.tools ?? {}, uploads: info.uploads === true }
    } catch (err) {
      return { online: false, mismatch: false, error: err.message }
    }
  }

  function remove(id) {
    const before = state.servers.length
    state.servers = state.servers.filter((s) => s.id !== id)
    for (const [k, v] of Object.entries(state.defaults)) if (v === id) delete state.defaults[k]
    if (state.servers.length === before) return false
    save()
    return true
  }

  /** Where a kind of job runs by default: 'ask', 'local', or a server id. */
  function setDefault(kind, where) {
    if (!KINDS.includes(kind)) throw new Error('Unknown job kind')
    if (where !== 'ask' && where !== 'local') find(where)
    state.defaults[kind] = where
    save()
  }

  return {
    list: () => state.servers.map(view),
    defaults: () => ({ ...state.defaults }),
    add,
    check,
    remove,
    setDefault,
    request,
    token: (id) => unseal(find(id).token),
    get: (id) => view(find(id)),
  }
}

module.exports = { createServers, transportOf, KINDS }
