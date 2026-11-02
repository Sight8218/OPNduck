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
 * The music tagger: find out which song a file is (an audio fingerprint looked up on AcoustID, then
 * MusicBrainz for the album details and the Cover Art Archive for the cover), and write the tags and cover
 * into the file. Nothing is looked up unless a caller asks (`identify`, or a tag job without tags).
 * No Electron: everything comes in through `ctx`. The pure helpers are exported for the tests.
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const AUDIO_EXTS = ['mp3', 'flac', 'm4a', 'ogg', 'opus']
const COVER_EXTS = ['mp3', 'flac', 'm4a'] // ffmpeg cannot embed a cover in Ogg/Opus; those get tags only
// An AcoustID *application* key. Public by design for open-source apps; it only counts requests per app.
const ACOUSTID_KEY = 'BFcaMFFlTd'
const MAX_COVER_BYTES = 5 * 1024 * 1024
const MAX_FILES = 500
const FIELD_MAX = 200

const userAgent = (version) => `OPNduck/${version} ( https://github.com/Sight8218/OPNduck )`
const extOf = (p) => path.extname(p).replace(/^\./, '').toLowerCase()

/** One request at a time, at least `gapMs` between the starts (MusicBrainz allows 1 per second). */
function createLimiter(gapMs, { now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last = -Infinity
  let chain = Promise.resolve()
  return {
    run(fn) {
      const next = chain.then(async () => {
        const wait = last + gapMs - now()
        if (wait > 0) await sleep(wait)
        last = now()
        return fn()
      })
      chain = next.catch(() => {})
      return next
    },
  }
}

/**
 * fetch that tries again after a network error (connections to MusicBrainz and the Cover Art Archive time out
 * now and then; up to 3 attempts). `init.timeoutMs` gives every attempt its own time limit.
 */
function withRetry(fetchImpl, { delayMs = 600, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const attempt = (url, init) => {
    const { timeoutMs, ...rest } = init ?? {}
    return fetchImpl(url, timeoutMs ? { ...rest, signal: AbortSignal.timeout(timeoutMs) } : rest)
  }
  return async (url, init) => {
    for (let n = 0; ; n++) {
      try {
        return await attempt(url, init)
      } catch (err) {
        if (init?.signal?.aborted || n >= 2) throw err
        await sleep(delayMs * (n + 1))
      }
    }
  }
}

/** ffprobe's tag dictionary (any key case, ID3/Vorbis/MP4 names) as { title, artist, album, year, track }. */
function normalizeTags(raw) {
  const t = {}
  for (const [k, v] of Object.entries(raw ?? {})) t[String(k).toLowerCase()] = String(v).trim()
  const year = /\d{4}/.exec(t.date ?? t.year ?? t.originaldate ?? t.originalyear ?? '')?.[0]
  const track = Number.parseInt(t.track ?? t.tracknumber ?? '', 10)
  return {
    title: t.title || null,
    artist: t.artist || t.album_artist || t.albumartist || null,
    album: t.album || null,
    year: year ? Number(year) : null,
    track: Number.isInteger(track) && track > 0 ? track : null,
  }
}

/** "01 - Artist - Title.mp3" -> { artist, title } (artist null when the name has no " - "). */
function parseFilename(fileName) {
  const base = path.basename(fileName, path.extname(fileName)).replace(/_/g, ' ').trim()
  const noNum = base.replace(/^\d{1,3}\s*[-.)]\s*/, '')
  const i = noNum.indexOf(' - ')
  if (i > 0) return { artist: noNum.slice(0, i).trim(), title: noNum.slice(i + 3).trim() }
  return noNum && !noNum.startsWith('.') ? { artist: null, title: noNum } : null
}

const joinArtists = (credit) => (credit ?? []).map((c) => (c.name ?? c.artist?.name ?? '') + (c.joinphrase ?? '')).join('').trim()

/** The release a recording is best filed under: a real album over a compilation or single, official over the rest, earliest first. */
function rankReleases(recording) {
  const typeRank = { Album: 0, EP: 1, Single: 2 }
  const score = (r) => {
    const group = r['release-group'] ?? {}
    return [
      (group['secondary-types'] ?? []).length > 0 ? 1 : 0,
      r.status === 'Official' ? 0 : 1,
      typeRank[group['primary-type']] ?? 3,
      r.date || '9999',
    ]
  }
  return [...(recording.releases ?? [])].sort((a, b) => {
    const x = score(a)
    const y = score(b)
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
    return 0
  })
}

/** The tags for a MusicBrainz recording lookup (with releases and media), or null if it has no title. */
function tagsFromRecording(recording, release = rankReleases(recording)[0]) {
  if (!recording?.title) return null
  const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
  let track = null
  for (const medium of release?.media ?? []) {
    const hit = (medium.tracks ?? []).find((t) => same(t.title, recording.title))
    if (hit) {
      track = Number.parseInt(hit.number ?? hit.position, 10) || null
      break
    }
  }
  const year = /^\d{4}/.exec(release?.date ?? recording['first-release-date'] ?? '')?.[0]
  return {
    title: recording.title,
    artist: joinArtists(recording['artist-credit']) || null,
    album: release?.title ?? null,
    year: year ? Number(year) : null,
    track,
    releaseId: release?.id ?? null,
  }
}

/** A name that is safe as one path segment: no separators, control or reserved characters, no leading dots, capped. */
function sanitizeName(s, max = 80) {
  const cleaned = String(s ?? '')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, max)
    .trim()
  if (!cleaned || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned)) return ''
  return cleaned
}

/** Where "organize" puts a file: <folder>/<Artist>/<Album>/<NN - >Title.ext, or null when the tags are not enough. */
function organizedPath(folder, tags, ext) {
  const artist = sanitizeName(tags.artist)
  const album = sanitizeName(tags.album)
  const title = sanitizeName(tags.title, 120)
  if (!artist || !album || !title) return null
  const nn = tags.track ? `${String(tags.track).padStart(2, '0')} - ` : ''
  return path.join(folder, artist, album, `${nn}${title}.${ext}`)
}

/** Checks a tags object coming from the renderer or MCP and returns a clean copy; throws a readable Error. */
function validateTags(tags) {
  if (tags == null || typeof tags !== 'object' || Array.isArray(tags)) throw new Error('tags must be an object')
  const out = {}
  for (const k of ['title', 'artist', 'album']) {
    if (tags[k] == null || tags[k] === '') continue
    if (typeof tags[k] !== 'string' || tags[k].length > FIELD_MAX || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(tags[k])) throw new Error(`Invalid ${k}`)
    out[k] = tags[k].trim()
  }
  if (tags.year != null) {
    if (!Number.isInteger(tags.year) || tags.year < 1000 || tags.year > 2999) throw new Error('Invalid year')
    out.year = tags.year
  }
  if (tags.track != null) {
    if (!Number.isInteger(tags.track) || tags.track < 1 || tags.track > 999) throw new Error('Invalid track number')
    out.track = tags.track
  }
  if (tags.coverUrl != null) {
    if (typeof tags.coverUrl !== 'string' || !/^https:\/\/coverartarchive\.org\/release\/[0-9a-f-]{36}\/front(-\d+)?$/.test(tags.coverUrl)) throw new Error('Invalid cover URL')
    out.coverUrl = tags.coverUrl
  }
  if (!Object.keys(out).some((k) => k !== 'coverUrl')) throw new Error('There are no tags to write')
  return out
}

/** ffmpeg arguments that stream-copy `input` into `output` with the tags (and `cover`, a JPEG path, when given). */
function tagWriteArgs({ input, output, tags, cover, ext }) {
  const meta = []
  for (const [k, v] of [['title', tags.title], ['artist', tags.artist], ['album', tags.album], ['date', tags.year], ['track', tags.track]]) {
    if (v != null && v !== '') meta.push('-metadata', `${k}=${v}`)
  }
  const withCover = !!cover && COVER_EXTS.includes(ext)
  const inputs = withCover ? ['-i', input, '-i', cover] : ['-i', input]
  const maps = withCover ? ['-map', '0:a', '-map', '1:v'] : ['-map', '0']
  const coverArgs = withCover ? ['-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)', '-disposition:v:0', 'attached_pic'] : []
  return ['-y', '-v', 'error', ...inputs, ...maps, '-c', 'copy', ...(ext === 'mp3' ? ['-id3v2_version', '3'] : []), ...meta, ...coverArgs, output]
}

/**
 * Looks one file up. `deps`: { probeTags(path) -> {tags, duration, hasCover}, fingerprint(path) -> {duration, fingerprint},
 * fetchImpl, limiters: { acoustid, musicbrainz }, version }. Never throws for "no match": returns found: null.
 */
async function identifyFile(deps, filePath) {
  try {
    return await identifyCore(deps, filePath)
  } catch (err) {
    if (/fetch failed|network|timeout|aborted|ENOTFOUND|ECONN/i.test(String(err?.message ?? err))) throw new Error("Couldn't reach the music services (AcoustID, MusicBrainz). Check your internet connection.")
    throw err
  }
}

async function identifyCore(deps, filePath) {
  const { probeTags, fingerprint, fetchImpl, limiters, version } = deps
  const headers = { 'User-Agent': userAgent(version), Accept: 'application/json' }
  const info = await probeTags(filePath)
  const current = { ...normalizeTags(info?.tags), hasCover: !!info?.hasCover }
  const fromName = parseFilename(filePath)
  const guess = fromName ? { title: fromName.title, artist: fromName.artist, album: null, year: null, track: null } : null
  const result = { path: filePath, current, found: null, confidence: 0, source: 'none' }

  let best = null
  const fp = await fingerprint(filePath)
  const res = await limiters.acoustid.run(() =>
    fetchImpl('https://api.acoustid.org/v2/lookup', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client: ACOUSTID_KEY, meta: 'recordings', duration: String(Math.round(fp.duration)), fingerprint: fp.fingerprint, format: 'json' }).toString(),
      timeoutMs: 12000,
    }),
  )
  const body = await res.json()
  if (body.status !== 'ok') throw new Error(body.error?.message ?? 'AcoustID refused the lookup')
  best = (body.results ?? []).filter((r) => r.recordings?.length).sort((a, b) => b.score - a.score)[0] ?? null
  if (best) best = { score: best.score, recording: best.recordings[0] }
  if (best) {
    const mbUrl = `https://musicbrainz.org/ws/2/recording/${encodeURIComponent(best.recording.id)}?inc=artists+releases+release-groups+media&fmt=json`
    const mb = await limiters.musicbrainz.run(() => fetchImpl(mbUrl, { headers, timeoutMs: 12000 }))
    if (mb.ok) {
      const recording = await mb.json()
      const ranked = rankReleases(recording)
      const found = tagsFromRecording(recording, ranked[0])
      if (found) {
        // The first release that really has a front cover wins (checked with one HEAD request each, three at most).
        for (const r of ranked.slice(0, 3)) {
          const url = `https://coverartarchive.org/release/${r.id}/front-1000`
          const head = await fetchImpl(url, { method: 'HEAD', headers: { 'User-Agent': headers['User-Agent'] }, timeoutMs: 12000 }).catch(() => null)
          if (head?.ok) {
            found.coverUrl = `https://coverartarchive.org/release/${r.id}/front-1000`
            if (r.id !== found.releaseId) Object.assign(found, tagsFromRecording(recording, r) ?? {}, { coverUrl: found.coverUrl })
            break
          }
        }
        return { ...result, found, confidence: Math.round(best.score * 100) / 100, source: 'acoustid' }
      }
    }
    // AcoustID knew the song but MusicBrainz could not be read: use what AcoustID said.
    const a = best.recording
    return {
      ...result,
      found: { title: a.title ?? null, artist: (a.artists ?? []).map((x) => x.name).join(', ') || null, album: null, year: null, track: null },
      confidence: Math.round(best.score * 100) / 100 * 0.8,
      source: 'acoustid',
    }
  }
  return guess ? { ...result, found: guess, confidence: 0.3, source: 'filename' } : result
}

/** Audio files in a folder and one level of subfolders, sorted, at most MAX_FILES. */
function listAudioFiles(folder) {
  const out = []
  const visit = (dir, depth) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (out.length >= MAX_FILES) return
      const full = path.join(dir, e.name)
      if (e.isFile() && AUDIO_EXTS.includes(extOf(e.name))) out.push(full)
      else if (e.isDirectory() && depth < 1 && !e.name.startsWith('.')) visit(full, depth + 1)
    }
  }
  visit(folder, 0)
  return out
}

function createTagger(ctx) {
  const {
    handleStart, assertAbsolutePath, uniqueOutputPath, addTask, broadcastTasks, runInPool, convertPool, updateTask, tasks, probeMedia, probeTags, isCanceled, spawnTracked, platform, fpcalcInstallHint,
  } = ctx
  const version = platform?.version ?? '0.0.0'
  const limiters = { acoustid: createLimiter(400), musicbrainz: createLimiter(1100) }

  /** Runs fpcalc and returns { duration, fingerprint }. */
  function fingerprint(file) {
    return new Promise((resolve, reject) => {
      let child
      try {
        child = spawn('fpcalc', ['-json', '-length', '120', file])
      } catch {
        return reject(new Error(`Chromaprint (fpcalc) is not installed. Install it with: ${fpcalcInstallHint()}`))
      }
      let out = ''
      const timer = setTimeout(() => child.kill('SIGKILL'), 30000)
      child.stdout.on('data', (c) => (out += c))
      child.on('error', (err) => {
        clearTimeout(timer)
        reject(err.code === 'ENOENT' ? new Error(`Chromaprint (fpcalc) is not installed. Install it with: ${fpcalcInstallHint()}`) : err)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        try {
          const j = JSON.parse(out)
          if (code !== 0 || !j.fingerprint) throw new Error('no fingerprint')
          resolve({ duration: Number(j.duration), fingerprint: String(j.fingerprint) })
        } catch {
          reject(new Error("Couldn't fingerprint this file."))
        }
      })
    })
  }

  const netFetch = withRetry((...a) => fetch(...a))
  const deps = { probeTags, fingerprint, fetchImpl: netFetch, limiters, version }
  const identify = (file) => {
    assertAbsolutePath(file, 'path')
    if (!AUDIO_EXTS.includes(extOf(file))) throw new Error(`Not a supported audio file (use ${AUDIO_EXTS.join(', ')})`)
    return identifyFile(deps, file)
  }

  handleStart('tasks:startTag', async (_e, req) => {
    assertAbsolutePath(req.inputPath, 'inputPath')
    const ext = extOf(req.inputPath)
    if (!AUDIO_EXTS.includes(ext)) throw new Error(`Not a supported audio file (use ${AUDIO_EXTS.join(', ')})`)
    let st
    try {
      st = fs.statSync(req.inputPath)
    } catch {
      throw new Error(`inputPath does not exist: ${req.inputPath}`)
    }
    if (!st.isFile()) throw new Error('inputPath is not a regular file')
    const tags = req.tags == null ? null : validateTags(req.tags)
    const minConfidence = req.minConfidence == null ? 0.9 : Number(req.minConfidence)
    if (!(minConfidence >= 0.5 && minConfidence <= 1)) throw new Error('minConfidence must be between 0.5 and 1')
    const id = crypto.randomUUID()
    addTask(id, {
      state: {
        id,
        kind: 'tag',
        status: 'queued',
        progress: 0,
        label: path.basename(req.inputPath),
        format: ext.toUpperCase(),
        quality: tags ? 'Reviewed tags' : 'Auto',
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
      },
      child: null,
      finalPath: req.inputPath,
    })
    broadcastTasks()
    runInPool(convertPool, id, () => tagJob(id, req, tags, minConfidence, ext)).catch((err) => updateTask(id, { status: 'error', error: `Tagging failed to start: ${err.message}` }))
    return id
  })

  async function tagJob(id, req, givenTags, minConfidence, ext) {
    const entry = tasks.get(id)
    updateTask(id, { status: 'running' })
    const input = req.inputPath
    const dir = path.dirname(input)
    const stamp = crypto.randomUUID().slice(0, 8)
    const tmpOut = path.join(dir, `.opnduck-tag-${stamp}.${ext}`)
    const tmpCover = path.join(dir, `.opnduck-cover-${stamp}.jpg`)
    const tmpRaw = path.join(dir, `.opnduck-cover-${stamp}.raw`)
    const cleanup = () => {
      for (const f of [tmpOut, tmpCover, tmpRaw]) fs.rmSync(f, { force: true })
    }
    try {
      let tags = givenTags
      let confidence = null
      if (!tags) {
        const r = await identifyFile(deps, input)
        if (isCanceled(id)) return
        confidence = r.confidence
        if (!r.found || r.source === 'none' || r.source === 'filename' || r.confidence < minConfidence) {
          return updateTask(id, { status: 'done', progress: 1, label: `${path.basename(input)} (not changed)`, quality: r.found ? `Not sure enough (${Math.round(r.confidence * 100)}%)` : 'No match' })
        }
        tags = validateTags(r.found)
      }
      updateTask(id, { progress: 0.2 })

      let cover = null
      if (tags.coverUrl && COVER_EXTS.includes(ext)) {
        try {
          // archive.org (where the covers live) answers 5xx now and then: one retry.
          const get = () => netFetch(tags.coverUrl, { headers: { 'User-Agent': userAgent(version) }, timeoutMs: 20000, redirect: 'follow' })
          let res = await get()
          if (!res.ok && res.status >= 500) res = await get()
          const host = new URL(res.url).hostname
          if (res.ok && (host === 'coverartarchive.org' || host.endsWith('archive.org'))) {
            const buf = Buffer.from(await res.arrayBuffer())
            if (buf.length > 0 && buf.length <= MAX_COVER_BYTES) {
              fs.writeFileSync(tmpRaw, buf)
              await spawnTracked('ffmpeg', ['-y', '-v', 'error', '-i', tmpRaw, '-vf', "scale='min(1000,iw)':-2", '-frames:v', '1', '-q:v', '3', tmpCover], entry)
              cover = tmpCover
            }
          }
        } catch {
          if (isCanceled(id)) return
          cover = null // a missing cover must not stop the tags
        }
      }
      if (isCanceled(id)) return
      updateTask(id, { progress: 0.5 })

      await spawnTracked('ffmpeg', tagWriteArgs({ input, output: tmpOut, tags, cover, ext }), entry)
      // Only replace the original when the new file is a complete copy of it.
      const [a, b] = await Promise.all([probeMedia(input), probeMedia(tmpOut)])
      if (!a || !b || Math.abs(a.duration - b.duration) > 0.5) throw new Error('The tagged copy did not match the original, so nothing was changed.')
      fs.chmodSync(tmpOut, fs.statSync(input).mode)

      let finalPath = input
      if (req.organize) {
        const target = organizedPath(dir, tags, ext)
        const here = path.resolve(input)
        if (target && path.resolve(target) !== here && !here.startsWith(path.dirname(path.resolve(target)) + path.sep)) {
          fs.mkdirSync(path.dirname(target), { recursive: true })
          const reserved = uniqueOutputPath(path.dirname(target), path.basename(target, path.extname(target)), ext)
          fs.renameSync(tmpOut, reserved)
          fs.rmSync(input, { force: true })
          finalPath = reserved
        }
      }
      if (finalPath === input) fs.renameSync(tmpOut, input)
      entry.finalPath = finalPath
      const label = [tags.artist, tags.title].filter(Boolean).join(' - ') || path.basename(finalPath)
      updateTask(id, {
        status: 'done',
        progress: 1,
        label,
        quality: `${confidence == null ? 'Reviewed' : `${Math.round(confidence * 100)}%`}${cover ? ' · cover' : tags.coverUrl && COVER_EXTS.includes(ext) ? ' · no cover (download failed)' : ''}`,
        sizeBytes: fs.statSync(finalPath).size,
      })
    } catch (err) {
      if (!isCanceled(id)) updateTask(id, { status: 'error', error: `Tagging failed: ${err.message}` })
    } finally {
      cleanup()
    }
  }

  return { identifyTrack: identify, listAudioFiles, tagJob }
}

module.exports = {
  createTagger, createLimiter, withRetry, normalizeTags, parseFilename, rankReleases, tagsFromRecording, sanitizeName, organizedPath, validateTags, tagWriteArgs, identifyFile, listAudioFiles, AUDIO_EXTS, COVER_EXTS, ACOUSTID_KEY,
}
