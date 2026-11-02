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
 * The one place every link that comes from another device passes through (the opnduck:// link, the direct server,
 * the relay). It checks the message, remembers what it has seen, and then either puts the link in a list for the
 * user to accept ("ask", the default) or starts the download ("auto"). A remote message can only ever carry a
 * link: the format, quality and folder always come from local settings. No Electron: the shell passes in what it needs.
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const E = require('./envelope.cjs')

const MAX_SEEN = 500
const MAX_PENDING = 50
const MAX_URL = 2048
const MAX_AGE_MS = 24 * 3600 * 1000
const MAX_FUTURE_MS = 5 * 60 * 1000
const RATE_PER_MIN = 30
const RECIPE_TARGET = /^recipe:[A-Za-z0-9:_-]{1,60}$/

const fromText = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40) || 'Another device'
const parseUrl = (s) => {
  if (typeof s !== 'string' || s.length === 0 || s.length > MAX_URL) return null
  try {
    const u = new URL(s.trim())
    return ['http:', 'https:'].includes(u.protocol) && u.hostname ? u : null
  } catch {
    return null
  }
}

/**
 * @param {object} deps
 * @param {string} deps.file  userData/remote.json (holds the pairing secret: written with mode 0600)
 * @param {(req: object, via: string) => Promise<string>} deps.startDownload  starts a download request (the shell tags it "via link")
 * @param {(note: { title: string, body: string }) => void} deps.notify  a system notification that focuses the window when clicked
 * @param {() => void} deps.onChange  the pending list or state changed
 * @param {() => { remoteEnabled: boolean, remoteMode: string, remoteFormat: string, remoteVideoQuality: string, remoteAudioQuality: string }} deps.getSettings
 * @param {(id: string) => ({ input: string } | null)} [deps.getRecipe]
 * @param {(id: string, input: string) => Promise<unknown>} [deps.runRecipe]
 * @param {() => number} [deps.now]
 */
function createRemoteInbox({ file, startDownload, notify, onChange, getSettings, getRecipe, runRecipe, now = Date.now }) {
  let state = { secret: '', lastIds: [], pending: [], relay: { server: '', token: '', lastId: '' } }
  const stamps = []
  let overRateLogged = false

  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'))
    state = {
      secret: typeof s.secret === 'string' ? s.secret : '',
      lastIds: Array.isArray(s.lastIds) ? s.lastIds.filter((x) => typeof x === 'string').slice(-MAX_SEEN) : [],
      relay: { server: String(s.relay?.server ?? ''), token: String(s.relay?.token ?? ''), lastId: String(s.relay?.lastId ?? '') },
      pending: Array.isArray(s.pending) ? s.pending.filter((p) => p && parseUrl(p.url) && typeof p.id === 'string').slice(-MAX_PENDING) : [],
    }
  } catch {
    /* first run, or an unreadable file: start empty */
  }

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 })
    fs.chmodSync(tmp, 0o600)
    fs.renameSync(tmp, file)
  }

  /** The pairing secret, made on first use. It never leaves this module except inside a pair link. */
  function secret() {
    if (!state.secret) {
      state.secret = E.newSecret().toString('base64url')
      save()
    }
    return Buffer.from(state.secret, 'base64url')
  }

  /** New secret: every paired device stops working. The topic, token and key all change. */
  function resetPairing() {
    state.secret = E.newSecret().toString('base64url')
    state.lastIds = []
    state.relay.lastId = '' // the topic changes with the secret, so the old position means nothing
    save()
    onChange()
  }

  const rateOk = () => {
    const t = now()
    while (stamps.length && t - stamps[0] > 60000) stamps.shift()
    if (stamps.length >= RATE_PER_MIN) {
      if (!overRateLogged) console.error('remote: too many messages per minute, dropping the extra ones')
      overRateLogged = true
      return false
    }
    overRateLogged = false
    stamps.push(t)
    return true
  }

  /** The download request for a link: the link plus the user's own defaults, nothing from the sender. */
  function requestFor(url) {
    const s = getSettings()
    const audio = ['MP3', 'FLAC', 'WAV'].includes(s.remoteFormat)
    return {
      url,
      format: s.remoteFormat,
      ...(audio ? { audioQuality: s.remoteAudioQuality } : { videoQuality: s.remoteVideoQuality }),
      playlist: 'single',
      embedMeta: true,
    }
  }

  async function run(item) {
    if (item.target.startsWith('recipe:')) return runRecipe(item.target.slice(7), item.url)
    return startDownload(requestFor(item.url), item.channel)
  }

  function addPending(item) {
    if (state.pending.some((p) => p.url === item.url && p.target === item.target)) return null
    state.pending.push(item)
    if (state.pending.length > MAX_PENDING) state.pending.shift()
    save()
    notify({ title: `Link from ${item.from}`, body: new URL(item.url).hostname + (item.target === 'download' ? '' : ` (${item.target})`) })
    onChange()
    return item
  }

  /** The target must be a plain download, or an existing recipe that starts from a link. */
  function goodTarget(t) {
    if (t === 'download') return true
    if (typeof t !== 'string' || !RECIPE_TARGET.test(t) || !getRecipe) return false
    const r = getRecipe(t.slice(7))
    return !!r && r.input === 'url'
  }

  /**
   * One sealed message from any channel. Returns true when it was accepted (queued, started or waiting for a click)
   * and false when it was dropped. Junk is dropped silently: relay topics are public, so anything can arrive.
   */
  async function receive(wire, channel) {
    if (!getSettings().remoteEnabled) return false
    const env = E.open(wire, E.deriveKeys(secret()).encKey)
    if (!env || env.v !== E.VERSION) return false
    const t = now()
    if (typeof env.ts !== 'number' || t - env.ts > MAX_AGE_MS || env.ts - t > MAX_FUTURE_MS) return false
    if (typeof env.id !== 'string' || env.id.length < 8 || env.id.length > 64 || state.lastIds.includes(env.id)) return false
    if (!parseUrl(env.url)) return false
    const target = env.target ?? 'download'
    if (!goodTarget(target)) return false
    if (!rateOk()) return false
    state.lastIds.push(env.id)
    if (state.lastIds.length > MAX_SEEN) state.lastIds.shift()
    const item = { id: crypto.randomUUID(), url: parseUrl(env.url).href, from: fromText(env.from), channel: String(channel), target, at: t }
    if (getSettings().remoteMode === 'auto') {
      save()
      try {
        await run(item)
      } catch (err) {
        console.error('remote: could not start a received link:', err instanceof Error ? err.message : err)
        return false
      }
      onChange()
      return true
    }
    return !!addPending(item)
  }

  /**
   * A link from an opnduck:// address. Any web page can open one, so it never starts a download by itself:
   * it always waits for a click, whatever the "when a link arrives" setting says.
   */
  function addLink(rawUrl, channel = 'link') {
    if (!getSettings().remoteEnabled || !rateOk()) return false
    const u = parseUrl(rawUrl)
    if (!u) return false
    return !!addPending({ id: crypto.randomUUID(), url: u.href, from: 'A link', channel: String(channel), target: 'download', at: now() })
  }

  const list = () => state.pending.map((p) => ({ ...p }))

  async function accept(id) {
    const i = state.pending.findIndex((p) => p.id === id)
    if (i < 0) throw new Error('That link is no longer waiting')
    const [item] = state.pending.splice(i, 1)
    save()
    onChange()
    try {
      await run(item)
    } catch (err) {
      state.pending.splice(i, 0, item) // put it back so the click is not lost
      save()
      onChange()
      throw err
    }
    return true
  }

  function dismiss(id) {
    const before = state.pending.length
    state.pending = state.pending.filter((p) => p.id !== id)
    if (state.pending.length !== before) {
      save()
      onChange()
    }
    return state.pending.length !== before
  }

  /** The relay's own bits, kept next to the secret in the same private file. */
  const relay = {
    get: () => ({ server: state.relay.server, token: state.relay.token }),
    set: ({ server, token }) => {
      state.relay.server = String(server ?? '')
      state.relay.token = String(token ?? '')
      state.relay.lastId = ''
      save()
    },
    lastId: { get: () => state.relay.lastId, set: (id) => ((state.relay.lastId = String(id).slice(0, 64)), save()) },
  }

  return { relay, receive, addLink, list, accept, dismiss, secret, resetPairing, keys: () => E.deriveKeys(secret()) }
}

module.exports = { createRemoteInbox, parseUrl, MAX_URL, RATE_PER_MIN }
