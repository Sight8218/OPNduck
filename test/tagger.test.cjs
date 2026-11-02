const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const T = require('../electron/core/tagger.cjs')
const { buildStartRequest } = require('../electron/mcp_tools.cjs')

test('normalizeTags reads ID3, Vorbis and MP4 style names in any case', () => {
  assert.deepEqual(T.normalizeTags({ TITLE: ' Hi ', ARTIST: 'A', ALBUM: 'B', DATE: '1999-05-01', TRACKNUMBER: '3/12' }), { title: 'Hi', artist: 'A', album: 'B', year: 1999, track: 3 })
  assert.deepEqual(T.normalizeTags({ title: 'x', album_artist: 'AA', year: '2020', track: '7' }), { title: 'x', artist: 'AA', album: null, year: 2020, track: 7 })
  assert.deepEqual(T.normalizeTags(undefined), { title: null, artist: null, album: null, year: null, track: null })
  assert.equal(T.normalizeTags({ track: '0' }).track, null)
})

test('parseFilename splits "Artist - Title" and drops track numbers and underscores', () => {
  assert.deepEqual(T.parseFilename('/m/01 - Rosa Linn - Snap.mp3'), { artist: 'Rosa Linn', title: 'Snap' })
  assert.deepEqual(T.parseFilename('/m/Gyllene_Tider - Sommartider.flac'), { artist: 'Gyllene Tider', title: 'Sommartider' })
  assert.deepEqual(T.parseFilename('/m/Sommartider.mp3'), { artist: null, title: 'Sommartider' })
  assert.equal(T.parseFilename('/m/.mp3'), null)
})

const rec = (releases) => ({ id: 'r1', title: 'Song', 'artist-credit': [{ name: 'A', joinphrase: ' & ' }, { name: 'B', joinphrase: '' }], 'first-release-date': '2001-02-03', releases })
const rel = (id, title, status, date, type, secondary = [], tracks = [{ title: 'Song', position: 4 }]) => ({ id, title, status, date, 'release-group': { 'primary-type': type, 'secondary-types': secondary }, media: [{ tracks }] })

test('rankReleases prefers a real album, official, then the earliest date', () => {
  const r = rec([
    rel('comp', 'Hits', 'Official', '1999-01-01', 'Album', ['Compilation']),
    rel('single', 'Song', 'Official', '2000-01-01', 'Single'),
    rel('boot', 'Album', 'Bootleg', '2001-01-01', 'Album'),
    rel('late', 'Album', 'Official', '2005-01-01', 'Album'),
    rel('early', 'Album', 'Official', '2002-01-01', 'Album'),
  ])
  assert.deepEqual(T.rankReleases(r).map((x) => x.id), ['early', 'late', 'single', 'boot', 'comp'])
})

test('tagsFromRecording joins artists, picks the year and the track number by title', () => {
  const r = rec([rel('a', 'Album', 'Official', '2002-05-05', 'Album', [], [{ title: 'Other', position: 1 }, { title: 'song', position: 4, number: '4' }])])
  assert.deepEqual(T.tagsFromRecording(r), { title: 'Song', artist: 'A & B', album: 'Album', year: 2002, track: 4, releaseId: 'a' })
  assert.equal(T.tagsFromRecording({ releases: [] }), null)
  assert.equal(T.tagsFromRecording(rec([])).album, null)
  assert.equal(T.tagsFromRecording(rec([])).year, 2001, 'falls back to the first release date')
})

test('sanitizeName makes one safe path segment', () => {
  assert.equal(T.sanitizeName('AC/DC: Back <in> Black?'), 'AC DC Back in Black')
  assert.equal(T.sanitizeName('../../etc'), 'etc')
  assert.equal(T.sanitizeName('...'), '')
  assert.equal(T.sanitizeName('CON'), '')
  assert.equal(T.sanitizeName('x'.repeat(300)).length, 80)
  assert.equal(T.sanitizeName('trailing. '), 'trailing')
})

test('organizedPath builds Artist/Album/NN - Title.ext and refuses incomplete tags', () => {
  assert.equal(T.organizedPath('/m', { artist: 'A', album: 'B', title: 'T', track: 3 }, 'mp3'), path.join('/m', 'A', 'B', '03 - T.mp3'))
  assert.equal(T.organizedPath('/m', { artist: 'A', album: 'B', title: 'T' }, 'flac'), path.join('/m', 'A', 'B', 'T.flac'))
  assert.equal(T.organizedPath('/m', { artist: 'A', title: 'T' }, 'mp3'), null)
  const p = T.organizedPath('/m', { artist: '../..', album: 'x/../y', title: 'a/b' }, 'mp3')
  assert.ok(p === null || path.resolve(p).startsWith(path.resolve('/m') + path.sep))
})

test('validateTags accepts good tags and refuses bad ones', () => {
  assert.deepEqual(T.validateTags({ title: ' T ', artist: 'A', year: 2001, track: 3 }), { title: 'T', artist: 'A', year: 2001, track: 3 })
  const id = '6e354098-4ffa-468a-ab77-978ac15c2c84'
  assert.equal(T.validateTags({ title: 'x', coverUrl: `https://coverartarchive.org/release/${id}/front-1000` }).coverUrl.endsWith('front-1000'), true)
  for (const bad of [null, [], {}, { coverUrl: 'https://coverartarchive.org/release/' + id + '/front-1000' }, { title: 'x', coverUrl: 'https://evil.com/a.jpg' }, { title: 'x', coverUrl: 'http://coverartarchive.org/release/' + id + '/front' }, { title: 'x'.repeat(201) }, { title: 'a\u0000b' }, { title: 'x', year: 1 }, { title: 'x', year: 2000.5 }, { title: 'x', track: 0 }, { title: 'x', track: 1000 }, { title: 5 }]) {
    assert.throws(() => T.validateTags(bad), undefined, JSON.stringify(bad))
  }
})

test('tagWriteArgs: MP3 with a cover copies the audio, maps the picture and marks it attached', () => {
  const a = T.tagWriteArgs({ input: 'in.mp3', output: 'out.mp3', cover: 'c.jpg', ext: 'mp3', tags: { title: 'T', artist: 'A', album: 'B', year: 2001, track: 3 } })
  const s = a.join(' ')
  assert.ok(s.includes('-map 0:a -map 1:v') && s.includes('-c copy') && s.includes('-id3v2_version 3') && s.includes('attached_pic'))
  assert.ok(s.includes('title=T') && s.includes('artist=A') && s.includes('album=B') && s.includes('date=2001') && s.includes('track=3'))
  assert.equal(a[a.length - 1], 'out.mp3')
})

test('tagWriteArgs: no cover keeps every stream; FLAC and M4A have no id3 flag; Opus never gets a cover', () => {
  const none = T.tagWriteArgs({ input: 'in.flac', output: 'o.flac', ext: 'flac', tags: { title: 'T' } })
  assert.ok(none.join(' ').includes('-map 0') && !none.includes('-i') === false && !none.join(' ').includes('attached_pic') && !none.join(' ').includes('id3v2'))
  const opus = T.tagWriteArgs({ input: 'in.opus', output: 'o.opus', cover: 'c.jpg', ext: 'opus', tags: { title: 'T' } })
  assert.equal(opus.filter((x) => x === '-i').length, 1)
  assert.ok(!opus.join(' ').includes('attached_pic'))
  const m4a = T.tagWriteArgs({ input: 'in.m4a', output: 'o.m4a', cover: 'c.jpg', ext: 'm4a', tags: { title: 'T' } })
  assert.ok(m4a.join(' ').includes('attached_pic') && !m4a.join(' ').includes('id3v2'))
  assert.ok(!T.tagWriteArgs({ input: 'i.mp3', output: 'o.mp3', ext: 'mp3', tags: { title: 'a=b; -y' } }).includes('a=b; -y'), 'a value is never its own argument')
})

test('createLimiter spaces request starts and runs them one at a time', async () => {
  let t = 0
  const waits = []
  const lim = T.createLimiter(1000, { now: () => t, sleep: async (ms) => { waits.push(ms); t += ms } })
  const order = []
  await Promise.all([lim.run(async () => order.push(1)), lim.run(async () => order.push(2)), lim.run(async () => order.push(3))])
  assert.deepEqual(order, [1, 2, 3])
  assert.deepEqual(waits, [1000, 1000])
  assert.equal(await lim.run(async () => 'x').catch(() => 'bad'), 'x')
  const failing = T.createLimiter(0)
  await assert.rejects(failing.run(async () => { throw new Error('boom') }), /boom/)
  assert.equal(await failing.run(async () => 'still works'), 'still works')
})

test('withRetry tries three times, then gives up, but not after an abort', async () => {
  let n = 0
  const flaky = T.withRetry(async () => { if (++n < 3) throw new Error('fetch failed'); return 'ok' }, { sleep: async () => {} })
  assert.equal(await flaky('u'), 'ok')
  assert.equal(n, 3)
  let m = 0
  await assert.rejects(T.withRetry(async () => { m++; throw new Error('fetch failed') }, { sleep: async () => {} })('u'), /fetch failed/)
  assert.equal(m, 3)
  let k = 0
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(T.withRetry(async () => { k++; throw new Error('x') }, { sleep: async () => {} })('u', { signal: ac.signal }), /x/)
  assert.equal(k, 1)
})

const json = (body, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body })

function fakeDeps({ acoustid, mb, cover = true, tags = {} } = {}) {
  const calls = []
  return {
    calls,
    deps: {
      probeTags: async () => ({ tags, duration: 200, hasCover: false }),
      fingerprint: async () => ({ duration: 200.4, fingerprint: 'AQAAfake' }),
      fetchImpl: async (url, init = {}) => {
        calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body, ua: init.headers?.['User-Agent'] })
        if (String(url).startsWith('https://api.acoustid.org')) return json(acoustid)
        if (String(url).startsWith('https://musicbrainz.org')) return json(mb, mb != null)
        return { ok: cover }
      },
      limiters: { acoustid: T.createLimiter(0), musicbrainz: T.createLimiter(0) },
      version: '9.9.9',
    },
  }
}

test('identifyFile: fingerprint -> AcoustID -> MusicBrainz -> cover check, with the right requests', async () => {
  const { deps, calls } = fakeDeps({
    acoustid: { status: 'ok', results: [{ score: 0.5, recordings: [{ id: 'low' }] }, { score: 0.97, recordings: [{ id: 'best', title: 'Song' }] }] },
    mb: rec([rel('a', 'Album', 'Official', '2002-05-05', 'Album')]),
    tags: { TITLE: 'Old title' },
  })
  const r = await T.identifyFile(deps, '/m/x.mp3')
  assert.equal(r.source, 'acoustid')
  assert.equal(r.confidence, 0.97)
  assert.deepEqual([r.found.title, r.found.artist, r.found.album, r.found.year, r.found.track], ['Song', 'A & B', 'Album', 2002, 4])
  assert.equal(r.found.coverUrl, 'https://coverartarchive.org/release/a/front-1000')
  assert.equal(r.current.title, 'Old title')
  const a = calls[0]
  assert.equal(a.method, 'POST')
  const form = new URLSearchParams(a.body)
  assert.equal(form.get('client'), T.ACOUSTID_KEY)
  assert.equal(form.get('duration'), '200')
  assert.equal(form.get('fingerprint'), 'AQAAfake')
  assert.ok(calls[1].url.includes('/ws/2/recording/best?inc='))
  assert.match(calls[1].ua, /^OPNduck\/9\.9\.9 \( https:\/\/github\.com\/Sight8218\/OPNduck \)$/)
  assert.equal(calls[2].method, 'HEAD')
})

test('identifyFile: no AcoustID match falls back to the file name at 30%, or to nothing', async () => {
  const { deps } = fakeDeps({ acoustid: { status: 'ok', results: [] } })
  const r = await T.identifyFile(deps, '/m/Artist - Title.mp3')
  assert.deepEqual([r.source, r.confidence, r.found.artist, r.found.title], ['filename', 0.3, 'Artist', 'Title'])
  const none = await T.identifyFile(deps, '/m/.mp3')
  assert.deepEqual([none.source, none.found], ['none', null])
})

test('identifyFile: MusicBrainz down uses AcoustID alone at a lower confidence; no cover means no coverUrl', async () => {
  const down = fakeDeps({ acoustid: { status: 'ok', results: [{ score: 1, recordings: [{ id: 'x', title: 'S', artists: [{ name: 'Q' }] }] }] }, mb: null })
  const r = await T.identifyFile(down.deps, '/m/a.mp3')
  assert.deepEqual([r.found.title, r.found.artist, r.found.album], ['S', 'Q', null])
  assert.ok(r.confidence < 0.9)
  const nocover = fakeDeps({ acoustid: { status: 'ok', results: [{ score: 0.95, recordings: [{ id: 'x' }] }] }, mb: rec([rel('a', 'Album', 'Official', '2002', 'Album')]), cover: false })
  assert.equal((await T.identifyFile(nocover.deps, '/m/a.mp3')).found.coverUrl, undefined)
})

test('identifyFile: an AcoustID error and a network failure become readable errors', async () => {
  const bad = fakeDeps({ acoustid: { status: 'error', error: { message: 'invalid API key' } } })
  await assert.rejects(T.identifyFile(bad.deps, '/m/a.mp3'), /invalid API key/)
  const offline = fakeDeps({})
  offline.deps.fetchImpl = async () => { throw new TypeError('fetch failed') }
  await assert.rejects(T.identifyFile(offline.deps, '/m/a.mp3'), /Couldn't reach the music services/)
})

test('listAudioFiles finds audio in a folder and one level below, sorted, skipping hidden folders', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-tag-'))
  fs.mkdirSync(path.join(d, 'Album'))
  fs.mkdirSync(path.join(d, 'Album', 'Deep'))
  fs.mkdirSync(path.join(d, '.hidden'))
  for (const f of ['b.mp3', 'a.flac', 'note.txt', 'Album/1.m4a', 'Album/Deep/2.mp3', '.hidden/3.mp3']) fs.writeFileSync(path.join(d, f), '')
  assert.deepEqual(T.listAudioFiles(d).map((p) => path.relative(d, p)), ['a.flac', 'Album/1.m4a', 'b.mp3'])
})

test('the MCP tool tag_music validates its arguments and defaults', () => {
  const ok = buildStartRequest('tag_music', { inputPath: '/x/a.mp3' })
  assert.equal(ok.channel, 'tasks:startTag')
  assert.deepEqual([ok.req.organize, ok.req.minConfidence], [false, 0.9])
  assert.throws(() => buildStartRequest('tag_music', { inputPath: '/x/a.mp3', minConfidence: 0.1 }))
  assert.throws(() => buildStartRequest('tag_music', { inputPath: '/x/a.mp3', tags: { title: 'x' } }), 'tags are not accepted from MCP callers')
})
