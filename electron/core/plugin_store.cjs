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
'use strict'

/**
 * The plugin store client (no Electron). Reads the plugin index (a JSON file in the opnduck-plugins
 * repository), and installs an entry: downloads the archive of the pinned commit, checks its SHA-256
 * against the index, unpacks it safely, checks the manifest matches the entry, swaps the folder in
 * place and hands it to the plugin host, OFF. Nothing here turns a plugin on; the user does that
 * after seeing its permissions.
 *
 * Index (`index.json`): { "plugins": [ { id, name, version, author, description, repo, commit, sha256,
 * permissions, verified, network?, subdir? } ] }. `repo` is a https://github.com/<owner>/<name> URL,
 * `commit` a full 40-hex commit, and `sha256` the SHA-256 of the UNCOMPRESSED tar of that commit:
 *   curl -L https://codeload.github.com/<owner>/<name>/tar.gz/<commit> | gunzip | sha256sum
 * (the tar is hashed, not the .tar.gz, because gzip output is not byte-stable).
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { ID_RE, SEMVER_RE, CORE_IDS, PERMISSIONS, validateManifest, isSafeRelPath, isInside, resolveEntry } = require('./plugins.cjs')

const DEFAULT_INDEX_URL = 'https://raw.githubusercontent.com/Sight8218/opnduck-plugins/main/index.json'
const DEFAULT_ARCHIVE_BASE = 'https://codeload.github.com'
const INDEX_TTL_MS = 60 * 60 * 1000
const MAX_INDEX_BYTES = 2 * 1024 * 1024
const MAX_INDEX_ENTRIES = 500
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
const MAX_TAR_BYTES = 100 * 1024 * 1024
const MAX_FILES = 2000
const MAX_UNPACKED_BYTES = 50 * 1024 * 1024
const MAX_FILE_BYTES = 20 * 1024 * 1024
const REPO_RE = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/
const COMMIT_RE = /^[0-9a-f]{40}$/
const HASH_RE = /^[0-9a-f]{64}$/

const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max

/** Keeps the well-formed entries of an index document. A bad entry is dropped, not fatal. */
function parseIndex(doc) {
  const list = Array.isArray(doc?.plugins) ? doc.plugins.slice(0, MAX_INDEX_ENTRIES) : []
  const seen = new Set()
  const out = []
  for (const e of list) {
    if (!e || typeof e !== 'object') continue
    const m = REPO_RE.exec(e.repo ?? '')
    const permsOk = Array.isArray(e.permissions) && e.permissions.every((p) => PERMISSIONS.includes(p))
    const subdirOk = e.subdir === undefined || (str(e.subdir, 200) && isSafeRelPath(e.subdir))
    const netOk = e.network === undefined || (Array.isArray(e.network) && e.network.length <= 50 && e.network.every((h) => str(h, 253)))
    if (!str(e.id, 40) || !ID_RE.test(e.id) || CORE_IDS.includes(e.id) || e.id in Object.prototype || seen.has(e.id)) continue
    if (!str(e.name, 80) || !str(e.version, 64) || !SEMVER_RE.test(e.version) || !str(e.author, 80) || !str(e.description, 500)) continue
    if (!m || !COMMIT_RE.test(e.commit ?? '') || !HASH_RE.test(e.sha256 ?? '') || !permsOk || !subdirOk || !netOk) continue
    seen.add(e.id)
    out.push({
      id: e.id, name: e.name, version: e.version, author: e.author, description: e.description,
      repo: e.repo, commit: e.commit, sha256: e.sha256, permissions: [...new Set(e.permissions)],
      network: e.network ?? [], verified: e.verified === true, ...(e.subdir ? { subdir: e.subdir } : {}),
    })
  }
  return out
}

/** The pax extended header records ("<len> key=value\n" ...) as an object. */
function parsePax(buf) {
  const out = {}
  let i = 0
  while (i < buf.length) {
    const sp = buf.indexOf(0x20, i)
    if (sp < 0) break
    const len = Number(buf.toString('latin1', i, sp))
    if (!Number.isInteger(len) || len <= sp - i || i + len > buf.length) break
    const rec = buf.toString('utf8', sp + 1, i + len - 1)
    const eq = rec.indexOf('=')
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1)
    i += len
  }
  return out
}

const field = (block, from, len) => {
  const raw = block.subarray(from, from + len)
  const nul = raw.indexOf(0)
  return raw.toString('utf8', 0, nul < 0 ? len : nul)
}
const octal = (block, from, len) => {
  const t = field(block, from, len).trim()
  if (!/^[0-7]*$/.test(t)) throw new Error('Archive is corrupt (bad number)')
  return t ? parseInt(t, 8) : 0
}

/**
 * Unpacks a tar into `destDir`, which must be empty or missing. Drops the archive's top folder
 * (GitHub's `<repo>-<commit>/`), and with `subdir` keeps only that folder. Accepts regular files and
 * folders ONLY: a link, device or any odd entry fails the whole archive. Refuses `..`, absolute paths,
 * backslashes, duplicate files and anything over the size limits. Files are written without exec bits.
 */
function extractTar(tar, destDir, { subdir } = {}) {
  fs.mkdirSync(destDir, { recursive: true })
  const root = fs.realpathSync(destDir)
  const prefix = subdir ? `${subdir.replace(/\/+$/, '')}/` : ''
  let pos = 0
  let pax = {}
  let globalLongName = null
  let files = 0
  let total = 0
  let extracted = 0
  while (pos < tar.length) {
    if (pos + 512 > tar.length) throw new Error('Archive is truncated')
    const block = tar.subarray(pos, pos + 512)
    if (block.every((b) => b === 0)) break
    const size = octal(block, 124, 12)
    const type = String.fromCharCode(block[156] || 0x30)
    const body = pos + 512
    if (body + size > tar.length) throw new Error('Archive is truncated')
    const next = body + Math.ceil(size / 512) * 512
    if (type === 'g') {
      pos = next
      continue
    }
    if (type === 'x') {
      pax = parsePax(tar.subarray(body, body + size))
      pos = next
      continue
    }
    if (type === 'L') {
      globalLongName = tar.toString('utf8', body, body + size).replace(/\0.*$/, '')
      pos = next
      continue
    }
    const magic = field(block, 257, 6)
    const base = field(block, 0, 100)
    const pre = magic.startsWith('ustar') ? field(block, 345, 155) : ''
    const name = pax.path ?? globalLongName ?? (pre ? `${pre}/${base}` : base)
    pax = {}
    globalLongName = null
    pos = next
    if (type !== '0' && type !== '5') throw new Error(`Archive holds a link or special file (${name}), refusing it`)
    if (name.includes('\\') || name.includes('\0') || path.isAbsolute(name) || name.startsWith('/')) throw new Error(`Unsafe path in archive: ${name.slice(0, 80)}`)
    const parts = name.split('/').filter((p) => p !== '')
    if (parts.some((p) => p === '..' || p === '.')) throw new Error(`Unsafe path in archive: ${name.slice(0, 80)}`)
    parts.shift() // the top folder
    let rel = parts.join('/')
    if (prefix) {
      if (type === '5' && `${rel}/` === prefix) continue
      if (!`${rel}/`.startsWith(prefix) && rel !== prefix.slice(0, -1)) continue
      rel = rel.slice(prefix.length)
    }
    if (!rel) continue
    if (!isSafeRelPath(rel)) throw new Error(`Unsafe path in archive: ${name.slice(0, 80)}`)
    const full = path.resolve(root, rel)
    if (!isInside(root, full)) throw new Error(`Unsafe path in archive: ${name.slice(0, 80)}`)
    if (type === '5') {
      fs.mkdirSync(full, { recursive: true, mode: 0o755 })
      continue
    }
    if (size > MAX_FILE_BYTES) throw new Error(`File in archive is too large: ${rel}`)
    if (++files > MAX_FILES) throw new Error('Archive has too many files')
    total += size
    if (total > MAX_UNPACKED_BYTES) throw new Error('Archive is too large when unpacked')
    fs.mkdirSync(path.dirname(full), { recursive: true, mode: 0o755 })
    // 'wx': a file may not replace another (duplicate entry) or follow a link made earlier in the same archive.
    fs.writeFileSync(full, tar.subarray(body, body + size), { flag: 'wx', mode: 0o644 })
    extracted++
  }
  if (!extracted) throw new Error('Archive holds no files')
  return { files: extracted, bytes: total }
}

/** Reads a fetch response body, failing past `max` bytes. */
async function readCapped(res, max) {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) throw new Error('Download is too large')
  const chunks = []
  let n = 0
  for await (const c of res.body) {
    n += c.length
    if (n > max) throw new Error('Download is too large')
    chunks.push(Buffer.from(c))
  }
  return Buffer.concat(chunks)
}

/**
 * @param {object} deps
 * @param {{ dir: string, list(): object[], disable(id: string): Promise<any>, adopt(id: string, meta: object): Promise<any> }} deps.host
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {string} [deps.indexUrl]
 * @param {string} [deps.archiveBase]  where `<owner>/<repo>/tar.gz/<commit>` is fetched from
 * @param {() => number} [deps.now]
 * @param {(line: string) => void} [deps.log]
 */
function createPluginStore({ host, fetchImpl = globalThis.fetch, indexUrl = DEFAULT_INDEX_URL, archiveBase = DEFAULT_ARCHIVE_BASE, now = Date.now, log = () => {} }) {
  const cacheFile = path.join(host.dir, '.store-index.json')
  let busy = false

  // Redirects are followed by hand: a hop to another host is refused before any request goes out.
  const get = async (url, max) => {
    const first = new URL(url)
    let current = first
    for (let hop = 0; hop <= 5; hop++) {
      if (current.host !== first.host || (first.protocol === 'https:' && current.protocol !== 'https:')) throw new Error('Unexpected download location')
      const res = await fetchImpl(current.href, { redirect: 'manual', signal: AbortSignal.timeout(60_000), headers: { 'User-Agent': 'OPNduck' } })
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        await res.body?.cancel?.().catch?.(() => {})
        current = new URL(res.headers.get('location'), current)
        continue
      }
      if (!res.ok) throw new Error(`Could not download (${res.status})`)
      return readCapped(res, max)
    }
    throw new Error('Too many redirects')
  }

  /** Removes install leftovers from a crash (an hour or older, so another running copy's work is safe). */
  function sweepStale() {
    try {
      for (const d of fs.readdirSync(host.dir, { withFileTypes: true })) {
        if (!d.isDirectory() || !/^\.(install|old)-/.test(d.name)) continue
        const full = path.join(host.dir, d.name)
        if (now() - fs.statSync(full).mtimeMs > 3600_000) fs.rmSync(full, { recursive: true, force: true })
      }
    } catch {
      /* best effort */
    }
  }

  function readCache() {
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
      return { fetchedAt: Number(c.fetchedAt) || 0, entries: parseIndex(c.index) }
    } catch {
      return null
    }
  }

  /** The index, from the cache while it is fresh. Offline, a stale cache is returned with `offline: true`. */
  async function index({ force = false } = {}) {
    const cached = readCache()
    if (!force && cached && now() - cached.fetchedAt < INDEX_TTL_MS) return { entries: cached.entries, fetchedAt: cached.fetchedAt, offline: false, error: '' }
    try {
      const doc = JSON.parse((await get(indexUrl, MAX_INDEX_BYTES)).toString('utf8'))
      const entries = parseIndex(doc)
      fs.mkdirSync(host.dir, { recursive: true })
      fs.writeFileSync(cacheFile, JSON.stringify({ fetchedAt: now(), index: { plugins: entries } }))
      return { entries, fetchedAt: now(), offline: false, error: '' }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      if (cached) return { entries: cached.entries, fetchedAt: cached.fetchedAt, offline: true, error }
      return { entries: [], fetchedAt: 0, offline: true, error }
    }
  }

  /** Index entries, each with what is installed: `installed` is the installed version or ''. */
  async function list(opts) {
    const idx = await index(opts)
    const have = new Map(host.list().map((p) => [p.id, p]))
    return {
      ...idx,
      entries: idx.entries.map((e) => {
        const p = have.get(e.id)
        return { ...e, installed: p?.manifest?.version ?? '', installedFrom: p ? p.source : '' }
      }),
    }
  }

  function archiveUrl(entry) {
    const [, owner, name] = REPO_RE.exec(entry.repo)
    return `${archiveBase}/${owner}/${name}/tar.gz/${entry.commit}`
  }

  /** Downloads, verifies and installs `id` from the index. The plugin lands OFF and unapproved. */
  async function install(id) {
    if (busy) throw new Error('Another plugin install is running')
    busy = true
    sweepStale()
    const tag = crypto.randomBytes(6).toString('hex')
    const tmp = path.join(host.dir, `.install-${tag}`)
    const old = path.join(host.dir, `.old-${tag}`)
    try {
      const entry = (await index()).entries.find((e) => e.id === id)
      if (!entry) throw new Error('That plugin is not in the store')
      const current = host.list().find((p) => p.id === id)
      if (current && current.source !== 'store') throw new Error('A plugin with this id is already installed from a folder. Remove it first.')

      const gz = await get(archiveUrl(entry), MAX_DOWNLOAD_BYTES)
      let tar
      try {
        tar = zlib.gunzipSync(gz, { maxOutputLength: MAX_TAR_BYTES })
      } catch {
        throw new Error('The download is not a valid archive')
      }
      if (crypto.createHash('sha256').update(tar).digest('hex') !== entry.sha256) {
        throw new Error('The download does not match the checksum in the store, so it was discarded.')
      }

      extractTar(tar, tmp, { subdir: entry.subdir })
      const manifestResult = validateManifest(JSON.parse(fs.readFileSync(path.join(tmp, 'plugin.json'), 'utf8')))
      if (!manifestResult.ok) throw new Error(`The plugin's manifest is not valid: ${manifestResult.errors[0]}`)
      const m = manifestResult.manifest
      const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x))
      if (m.id !== entry.id || m.version !== entry.version) throw new Error('The plugin does not match its store entry (id or version)')
      if (!same(m.permissions, entry.permissions)) throw new Error('The plugin asks for different permissions than its store entry says')
      if (!same(m.network, entry.network)) throw new Error('The plugin lists different network sites than its store entry says')
      for (const e of [m.ui?.entry, m.backend?.entry]) if (e) resolveEntry(tmp, e)

      const target = path.join(host.dir, id)
      if (current) await host.disable(id).catch(() => {})
      let hadOld = false
      if (fs.existsSync(target)) {
        if (fs.lstatSync(target).isSymbolicLink()) throw new Error('Refusing to replace a symlinked plugin folder')
        fs.renameSync(target, old)
        hadOld = true
      }
      try {
        fs.renameSync(tmp, target)
      } catch (err) {
        if (hadOld) fs.renameSync(old, target)
        throw err
      }
      try {
        const summary = await host.adopt(id, { verified: entry.verified, source: 'store' })
        fs.rmSync(old, { recursive: true, force: true })
        log(`plugins: installed ${id} ${entry.version} from the store`)
        return summary
      } catch (err) {
        // Put the previous version back so a failed install never leaves the plugin missing.
        fs.rmSync(target, { recursive: true, force: true })
        if (hadOld) fs.renameSync(old, target)
        await host.adopt(id, { verified: current?.verified, source: current?.source ?? 'store' }).catch(() => {})
        throw err
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
      busy = false
    }
  }

  return { index, list, install }
}

module.exports = { DEFAULT_INDEX_URL, parseIndex, extractTar, createPluginStore }
