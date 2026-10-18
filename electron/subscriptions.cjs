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
 * Subscriptions: "download new uploads from this channel/playlist automatically".
 *
 * Only runs while OPNduck is open — it checks shortly after launch and then hourly, so videos
 * uploaded while the app was closed are picked up on the next start. For each subscription it asks
 * yt-dlp for the newest entries (flat, no download) and starts a normal download task for every
 * entry it hasn't seen. An entry is only marked "seen" once its download actually succeeded, so a
 * failed one is retried on the next check instead of being lost.
 *
 * Everything outside this file (yt-dlp, the task system, notifications) is injected, which keeps
 * the logic testable without a network or Electron.
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const MAX_SUBSCRIPTIONS = 50
const ENTRIES_PER_CHECK = 15
const MAX_BACKFILL = 25

function createSubscriptionManager(deps) {
  const {
    file, // subscriptions.json
    seenDir, // folder of <id>.txt seen-lists
    listEntries, // (url, limit) => Promise<{ title, entries: [{ id, url }] } | null>
    startDownload, // (request) => Promise<taskId>
    whenTaskDone, // (taskId, cb(state)) => void
    notify = () => {},
    onChange = () => {},
    defaultDir, // () => default download folder
    intervalMs = 60 * 60 * 1000,
    firstDelayMs = 30 * 1000,
  } = deps

  let subs = load()
  const seenCache = new Map()
  const inflight = new Set() // `${subId}:${entryId}` currently downloading
  let timer = null
  let firstTimer = null
  let checking = false

  function load() {
    try {
      const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
      return Array.isArray(rows) ? rows.filter((r) => r && typeof r.id === 'string' && typeof r.url === 'string').slice(0, MAX_SUBSCRIPTIONS) : []
    } catch {
      return []
    }
  }

  function persist() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(subs, null, 2))
      fs.renameSync(tmp, file)
    } catch {
      /* a disk error must never break checking */
    }
    onChange(list())
  }

  const seenFile = (id) => path.join(seenDir, `${id.replace(/[^A-Za-z0-9-]/g, '')}.txt`)

  function seen(id) {
    if (!seenCache.has(id)) {
      let set = new Set()
      try {
        set = new Set(fs.readFileSync(seenFile(id), 'utf8').split('\n').filter(Boolean))
      } catch {
        /* none yet */
      }
      seenCache.set(id, set)
    }
    return seenCache.get(id)
  }

  function markSeen(id, entryIds) {
    const set = seen(id)
    const fresh = entryIds.filter((e) => !set.has(e))
    if (!fresh.length) return
    fresh.forEach((e) => set.add(e))
    try {
      fs.mkdirSync(seenDir, { recursive: true })
      fs.appendFileSync(seenFile(id), fresh.join('\n') + '\n')
    } catch {
      /* worst case: an entry is offered again after a restart */
    }
  }

  /** Copy for the UI (no internals). */
  function list() {
    return subs.map((s) => ({ ...s }))
  }

  /**
   * Adds a subscription. By default only FUTURE uploads are downloaded: everything on the list
   * right now is marked seen. `backfill` (0–25) downloads that many of the newest videos now.
   */
  async function add(input) {
    if (subs.length >= MAX_SUBSCRIPTIONS) throw new Error(`You can have at most ${MAX_SUBSCRIPTIONS} subscriptions.`)
    if (subs.some((s) => s.url === input.url)) throw new Error('You are already subscribed to that.')
    const backfill = Math.min(MAX_BACKFILL, Math.max(0, Number.isInteger(input.backfill) ? input.backfill : 0))
    const found = await listEntries(input.url, Math.max(ENTRIES_PER_CHECK, backfill))
    if (!found || !found.entries.length) throw new Error("Couldn't read that list — check the link (private lists need a sign-in).")
    const sub = {
      id: crypto.randomUUID(),
      url: input.url,
      title: String(found.title || input.url).slice(0, 120),
      format: input.format,
      videoQuality: input.videoQuality,
      audioQuality: input.audioQuality,
      destination: input.destination || '',
      enabled: true,
      createdAt: Date.now(),
      lastCheckedAt: null,
      lastResult: null,
    }
    // Entries come newest first: the first `backfill` stay unseen (downloaded below), the rest are history.
    markSeen(sub.id, found.entries.slice(backfill).map((e) => e.id))
    subs.push(sub)
    persist()
    if (backfill > 0) await checkOne(sub)
    return { ...sub }
  }

  function remove(id) {
    subs = subs.filter((s) => s.id !== id)
    seenCache.delete(id)
    try {
      fs.rmSync(seenFile(id), { force: true })
    } catch {
      /* already gone */
    }
    persist()
  }

  function setEnabled(id, enabled) {
    const s = subs.find((x) => x.id === id)
    if (s) {
      s.enabled = !!enabled
      persist()
    }
  }

  /** Checks one subscription now. Returns how many downloads it started. */
  async function checkOne(sub) {
    const found = await listEntries(sub.url, ENTRIES_PER_CHECK)
    sub.lastCheckedAt = Date.now()
    if (!found) {
      sub.lastResult = { ok: false, started: 0, error: "Couldn't read the list (offline, or it needs a sign-in)." }
      persist()
      return 0
    }
    const set = seen(sub.id)
    const fresh = found.entries.filter((e) => !set.has(e.id) && !inflight.has(`${sub.id}:${e.id}`))
    // Oldest first, so they land in upload order.
    fresh.reverse()
    let started = 0
    const batch = fresh.length > 1 ? { id: crypto.randomUUID(), label: `Subscription: ${sub.title}`, size: fresh.length } : undefined
    const destination = sub.destination || path.join(defaultDir(), sub.title.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Subscription')
    for (const entry of fresh) {
      const key = `${sub.id}:${entry.id}`
      try {
        const taskId = await startDownload({
          url: entry.url,
          format: sub.format,
          videoQuality: sub.videoQuality,
          audioQuality: sub.audioQuality,
          destination,
          playlist: 'single',
          batch,
        })
        inflight.add(key)
        started++
        whenTaskDone(taskId, (state) => {
          inflight.delete(key)
          if (state.status === 'done') markSeen(sub.id, [entry.id]) // failures stay unseen → retried next check
        })
      } catch {
        /* a request that fails validation is retried next check */
      }
    }
    sub.lastResult = { ok: true, started, error: null }
    persist()
    if (started > 0) notify(`OPNduck: ${started} new ${started === 1 ? 'video' : 'videos'}`, `Downloading from ${sub.title}`)
    return started
  }

  /** Checks every enabled subscription (or just one). Safe to call while a check is running. */
  async function checkNow(id) {
    if (checking) return { started: 0, busy: true }
    checking = true
    let started = 0
    try {
      for (const sub of subs.filter((s) => s.enabled && (!id || s.id === id))) started += await checkOne(sub)
    } finally {
      checking = false
    }
    return { started, busy: false }
  }

  function start() {
    stop()
    firstTimer = setTimeout(() => void checkNow(), firstDelayMs)
    timer = setInterval(() => void checkNow(), intervalMs)
    firstTimer.unref?.()
    timer.unref?.()
  }

  function stop() {
    clearTimeout(firstTimer)
    clearInterval(timer)
    firstTimer = timer = null
  }

  return { list, add, remove, setEnabled, checkNow, start, stop }
}

module.exports = { createSubscriptionManager, MAX_SUBSCRIPTIONS, ENTRIES_PER_CHECK }
