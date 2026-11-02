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
 * The relay path: listens to this pairing's private topic on an ntfy server (https://ntfy.sh by default, or the user's
 * own) and hands every message to the inbox. Messages are end-to-end encrypted, so the server only ever sees opaque
 * text. It reconnects by itself, and asks for what it missed (ntfy keeps 12 hours) so links sent while OPNduck was
 * closed arrive on the next start. No Electron; `fetch` is plain Node.
 */

const DEFAULT_SERVER = 'https://ntfy.sh'
const MAX_LINE = 64 * 1024

/** The server must be https (plain http only for this computer, for testing). Returns the clean base URL or throws. */
function validateServer(raw) {
  let u
  try {
    u = new URL(String(raw ?? '').trim())
  } catch {
    throw new Error('The relay server must be a full address, like https://ntfy.sh')
  }
  const local = ['localhost', '127.0.0.1'].includes(u.hostname)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('The relay server must use https://')
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) throw new Error('Use just the server address, with no path, login or options')
  return `${u.protocol}//${u.host}`
}

/** The wait before reconnect attempt `n` (0-based): 2 s doubling to 60 s, plus up to a quarter more at random. */
const backoffMs = (n, random = Math.random) => Math.round(Math.min(60000, 2000 * 2 ** n) * (1 + random() * 0.25))

/**
 * @param {object} deps
 * @param {{ receive(wire: string, channel: string): Promise<boolean>, keys(): { topic: string } }} deps.inbox
 * @param {() => { enabled: boolean, server: string, token: string }} deps.getConfig
 * @param {{ get(): string, set(id: string): void }} deps.lastId  the id of the last message seen (kept between runs)
 * @param {(status: object) => void} deps.onStatus
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 */
function createNtfyRelay({ inbox, getConfig, lastId, onStatus, fetchImpl = (...a) => fetch(...a), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), random = Math.random }) {
  let status = { state: 'off', error: '', server: '' }
  let run = 0 // bumps on every start/stop so an old loop knows to quit
  let abort = null

  const setStatus = (next) => {
    status = { ...status, ...next }
    onStatus({ ...status })
  }

  async function handleLine(line) {
    if (!line.trim()) return
    let ev
    try {
      ev = JSON.parse(line)
    } catch {
      return
    }
    if (ev.event === 'open') return setStatus({ state: 'connected', error: '' })
    if (ev.event !== 'message' || typeof ev.message !== 'string') return
    if (typeof ev.id === 'string') lastId.set(ev.id)
    await inbox.receive(ev.message, 'ntfy').catch(() => {})
  }

  /** One connection: returns when the stream ends or breaks. Sets `seen.connected` once the server accepted it. Throws on a refused or failed request. */
  async function connectOnce(myRun, seen) {
    const cfg = getConfig()
    const server = validateServer(cfg.server || DEFAULT_SERVER)
    const since = lastId.get() || '12h'
    abort = new AbortController()
    const headers = { Accept: 'application/x-ndjson', 'User-Agent': 'OPNduck' }
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`
    const res = await fetchImpl(`${server}/${inbox.keys().topic}/json?since=${encodeURIComponent(since)}`, { headers, signal: abort.signal })
    if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'The relay server refused the access token' : `The relay server answered ${res.status}`)
    seen.connected = true
    setStatus({ state: 'connected', error: '', server })
    let buffer = ''
    const decoder = new TextDecoder()
    for await (const chunk of res.body) {
      if (myRun !== run) return
      buffer += decoder.decode(chunk, { stream: true })
      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        await handleLine(line)
      }
      if (buffer.length > MAX_LINE) buffer = '' // a line that long is not ours
    }
  }

  async function loop(myRun) {
    let failures = 0
    while (myRun === run) {
      const seen = { connected: false }
      try {
        await connectOnce(myRun, seen)
      } catch (err) {
        if (myRun !== run) return
        setStatus({ state: 'error', error: err instanceof Error ? err.message : String(err) })
      }
      if (myRun !== run) return
      failures = seen.connected ? 0 : failures + 1 // a connection that worked starts the waiting over
      if (status.state !== 'error') setStatus({ state: 'reconnecting' })
      await sleep(backoffMs(Math.max(0, failures - 1), random))
      if (myRun === run && status.state === 'error') setStatus({ state: 'reconnecting' })
    }
  }

  /** (Re)starts or stops to match the config: call it whenever the settings change. */
  function apply() {
    run++
    abort?.abort()
    const cfg = getConfig()
    if (!cfg.enabled) return setStatus({ state: 'off', error: '' })
    try {
      validateServer(cfg.server || DEFAULT_SERVER)
    } catch (err) {
      return setStatus({ state: 'error', error: err.message })
    }
    setStatus({ state: 'connecting', error: '' })
    void loop(run)
  }

  function stop() {
    run++
    abort?.abort()
    setStatus({ state: 'off', error: '' })
  }

  return { apply, stop, status: () => ({ ...status }) }
}

module.exports = { createNtfyRelay, validateServer, backoffMs, DEFAULT_SERVER }
