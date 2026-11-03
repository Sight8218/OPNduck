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
 * Resumable uploads for the Engine API. A device announces a file (name, size), sends it in chunks, and can ask how
 * much arrived after a disconnect. A finished upload is a file in our own folder that a job can take as its input by
 * id: the device never names a path. No Electron.
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const CHUNK_SIZE = 8 * 1024 * 1024
const MAX_CHUNK = 16 * 1024 * 1024
const MAX_ACTIVE = 20
const ID_RE = /^[0-9a-f]{32}$/

/** A file name that is safe on disk: no folders, no control characters, at most 120 characters, keeps the extension. */
function safeName(name) {
  let n = String(name ?? '').replace(/\p{Cc}/gu, '').split(/[\\/]/).pop().replace(/^\.+/, '').trim()
  if (!n) n = 'upload'
  if (n === 'meta.json' || n === 'data.part') n = `_${n}` // would collide with the upload's own bookkeeping files
  const ext = path.extname(n).slice(0, 12)
  const base = n.slice(0, n.length - path.extname(n).length).slice(0, 120 - ext.length)
  return base + ext
}

const fail = (code, message, extra) => Object.assign(new Error(message), { code, ...extra })

function defaultFree(d) {
  const s = fs.statfsSync(d)
  return s.bavail * s.bsize
}

/**
 * @param {object} deps
 * @param {string} deps.dir  where uploads live (one folder each)
 * @param {number} [deps.maxBytes]  the largest file accepted (default 8 GB)
 * @param {number} [deps.retentionMs]  uploads older than this are deleted (default 48 h)
 * @param {(dir: string) => number} [deps.freeBytes]  free disk space in the folder
 * @param {() => number} [deps.now]
 */
function createUploads({ dir, maxBytes = 8 * 1024 ** 3, retentionMs = 48 * 3600 * 1000, freeBytes = defaultFree, now = Date.now }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })

  const metaPath = (id) => path.join(dir, id, 'meta.json')
  const partPath = (id) => path.join(dir, id, 'data.part')
  function readMeta(id) {
    if (!ID_RE.test(id)) return null
    try {
      return JSON.parse(fs.readFileSync(metaPath(id), 'utf8'))
    } catch {
      return null
    }
  }
  const writeMeta = (id, m) => fs.writeFileSync(metaPath(id), JSON.stringify(m), { mode: 0o600 })
  const finalPath = (id, m) => path.join(dir, id, m.name)
  const received = (id, m) => {
    try {
      return fs.statSync(m.complete ? finalPath(id, m) : partPath(id)).size
    } catch {
      return 0
    }
  }

  /** Starts an upload. Refuses a file that is too big, or that the disk could not hold. */
  function create({ name, size, sha256 }, deviceId) {
    if (!Number.isInteger(size) || size < 1) throw fail(400, 'size must be a whole number of bytes')
    if (size > maxBytes) throw fail(413, `Files over ${Math.round(maxBytes / 1024 ** 3)} GB are not accepted`)
    if (sha256 != null && !/^[0-9a-f]{64}$/i.test(String(sha256))) throw fail(400, 'sha256 must be 64 hex characters')
    sweep()
    const active = fs.readdirSync(dir).filter((id) => !readMeta(id)?.complete).length // finished uploads wait for their job and expire on their own
    if (active >= MAX_ACTIVE) throw fail(429, 'Too many uploads are waiting; finish or wait for the old ones to expire')
    if (freeBytes(dir) < size * 1.1 + 512 * 1024 ** 2) throw fail(507, 'Not enough free disk space for that file')
    const id = crypto.randomBytes(16).toString('hex')
    fs.mkdirSync(path.join(dir, id), { mode: 0o700 })
    writeMeta(id, { name: safeName(name), size, sha256: sha256 ? String(sha256).toLowerCase() : null, deviceId, createdAt: now(), complete: false })
    return { uploadId: id, chunkSize: CHUNK_SIZE }
  }

  /** How much of an upload has arrived, for a client that lost its connection. */
  function status(id, deviceId) {
    const m = readMeta(id)
    if (!m || m.deviceId !== deviceId) throw fail(404, 'No such upload')
    return { offset: received(id, m), size: m.size, complete: m.complete }
  }

  /**
   * Appends one chunk. `range` is the Content-Range header (`bytes start-end/total`), `body` a readable stream. The
   * chunk has to start exactly where the file ends, otherwise the answer says where it ends (409).
   */
  const busy = new Set()
  /** One chunk at a time per upload: two writers at the same offset would interleave. */
  async function append(id, deviceId, range, body) {
    if (busy.has(id)) throw fail(409, 'Another chunk of this upload is still arriving', { offset: received(id, readMeta(id) ?? {}) })
    busy.add(id)
    try {
      return await appendOne(id, deviceId, range, body)
    } finally {
      busy.delete(id)
    }
  }

  async function appendOne(id, deviceId, range, body) {
    const m = readMeta(id)
    if (!m || m.deviceId !== deviceId) throw fail(404, 'No such upload')
    if (m.complete) throw fail(409, 'That upload is already complete', { offset: m.size })
    const r = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(range ?? ''))
    if (!r) throw fail(400, 'Content-Range must look like "bytes 0-8388607/20000000"')
    const [start, end, total] = [Number(r[1]), Number(r[2]), Number(r[3])]
    if (total !== m.size || end < start || end >= total) throw fail(400, 'Content-Range does not match the upload')
    if (end - start + 1 > MAX_CHUNK) throw fail(413, 'Chunks are at most 16 MB')
    const have = received(id, m)
    if (start !== have) throw fail(409, 'The chunk does not start where the file ends', { offset: have })
    const expected = end - start + 1
    let got = 0
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(partPath(id), { flags: 'a', mode: 0o600 })
      body.on('data', (c) => {
        got += c.length
        if (got > expected) {
          body.destroy()
          out.destroy()
          // Bytes beyond the range may already be on disk: cut the file back to where this chunk began.
          out.once('close', () => {
            try {
              fs.truncateSync(partPath(id), have)
            } catch {
              /* nothing was written */
            }
            reject(fail(400, 'The chunk is longer than its Content-Range says'))
          })
        }
      })
      body.on('error', (e) => (out.destroy(), reject(e)))
      body.on('aborted', () => out.end(resolve)) // a dropped connection keeps what arrived; the client asks for the offset
      body.pipe(out)
      out.on('finish', resolve)
      out.on('error', reject)
    })
    const now2 = received(id, m)
    if (got !== expected) return { offset: now2, complete: false, short: true }
    if (now2 < m.size) return { offset: now2, complete: false }
    if (m.sha256) {
      const h = crypto.createHash('sha256')
      await new Promise((resolve, reject) => fs.createReadStream(partPath(id)).on('data', (c) => h.update(c)).on('end', resolve).on('error', reject))
      if (h.digest('hex') !== m.sha256) {
        fs.rmSync(partPath(id), { force: true })
        throw fail(422, 'The file arrived damaged (checksum mismatch); send it again', { offset: 0 })
      }
    }
    fs.renameSync(partPath(id), finalPath(id, m))
    writeMeta(id, { ...m, complete: true })
    return { offset: m.size, complete: true }
  }

  /** The path of a finished upload (for a job's input), or null. Only this module ever turns an id into a path. */
  function resolve(id, deviceId) {
    const m = readMeta(id)
    if (!m || !m.complete || (deviceId && m.deviceId !== deviceId)) return null
    const p = finalPath(id, m)
    return fs.existsSync(p) ? p : null
  }

  /** Deletes uploads older than the retention time. */
  function sweep() {
    let names
    try {
      names = fs.readdirSync(dir)
    } catch {
      return
    }
    for (const id of names) {
      const m = readMeta(id)
      if (!m || now() - m.createdAt > retentionMs) fs.rmSync(path.join(dir, id), { recursive: true, force: true })
    }
  }

  return { create, status, append, resolve, sweep, CHUNK_SIZE }
}

module.exports = { createUploads, safeName, CHUNK_SIZE, MAX_CHUNK }
