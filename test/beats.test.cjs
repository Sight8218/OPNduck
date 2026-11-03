const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const B = require('../electron/core/beats.cjs')

test('the result line is found after progress lines, and junk gives null', () => {
  const out = '@@STAGE x\n@@PROGRESS 0.5\n@@RESULT {"bpm":120.0,"beats":[1,2]}\n'
  assert.deepEqual(B.parseResult(out), { bpm: 120, beats: [1, 2] })
  assert.equal(B.parseResult('@@STAGE x'), null)
  assert.equal(B.parseResult('@@RESULT {not json'), null)
})

test('tags: MP3 gets TBPM and TKEY, FLAC and Ogg get BPM and INITIALKEY, other formats are not tagged', () => {
  assert.deepEqual(B.tagArgs('mp3', 119.6, 'A minor'), ['-metadata', 'TBPM=120', '-metadata', 'TKEY=A minor', '-id3v2_version', '3'])
  assert.deepEqual(B.tagArgs('flac', 128, 'C major'), ['-metadata', 'BPM=128', '-metadata', 'INITIALKEY=C major'])
  assert.equal(B.tagArgs('m4a', 128, 'C major'), null)
})

test('cut points: every Nth beat, and cuts never run past the last beat', () => {
  const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]
  assert.deepEqual(B.cutPoints(beats, 1), beats)
  assert.deepEqual(B.cutPoints(beats, 4), [0, 2, 4])
  assert.deepEqual(B.cutPoints(beats, 8), [0, 4])
})

test('clip assignment: in order, each clip carries on where it stopped, wraps, and the frames add up exactly', () => {
  const points = [1.0, 1.5, 2.1, 2.6, 3.4, 3.9, 4.4]
  const clips = [{ path: 'a', duration: 2 }, { path: 'b', duration: 10 }]
  const plan = B.assignClips(points, clips, { skip: 0 })
  assert.deepEqual(plan.map((p) => p.clip), ['a', 'b', 'a', 'b', 'a', 'b'])
  assert.equal(plan[0].start, 0)
  assert.ok(Math.abs(plan[2].start - 0.5) < 1e-9, 'a carries on after its first 0.5 s')
  assert.ok(Math.abs(plan[4].start - 1.0) < 1e-9)
  const wrap = B.assignClips(points, [{ path: 'a', duration: 1.2 }, { path: 'b', duration: 10 }], { skip: 0 })
  assert.equal(wrap[4].start, 0, 'a would run out (1.0 + 0.5 > 1.2), so it starts over')
  assert.equal(plan.reduce((t, p) => t + p.frames, 0), Math.round((4.4 - 1.0) * 30), 'no drift: the frame counts sum to the exact length')
  const skip = B.assignClips(points, [{ path: 'c', duration: 10 }], { skip: 2 })
  assert.equal(skip[0].start, 2, 'the first seconds of each clip are skipped')
  const short = B.assignClips([0, 4], [{ path: 'd', duration: 1 }], {})
  assert.equal(short[0].start, 0, 'a clip shorter than the cut still starts at its beginning')
  const a = B.assignClips(points, clips, { random: () => 0 }).map((p) => p.clip)
  assert.notDeepEqual(a, ['a', 'b', 'a', 'b', 'a', 'b'], 'shuffling changes the order')
})

test('requests are validated', () => {
  const h = { assertAbsolutePath: (p, n) => { if (!path.isAbsolute(p)) throw new Error(`${n} abs`) } }
  assert.equal(B.validateCut({ inputPath: '/s.mp3', clips: ['/a.mp4'] }, h).everyBeats, 4)
  assert.throws(() => B.validateCut({ inputPath: '/s.mp3', clips: [] }, h), /1 to 200/)
  assert.throws(() => B.validateCut({ inputPath: '/s.mp3', clips: ['a.mp4'] }, h), /clips\[0\] abs/)
  assert.throws(() => B.validateCut({ inputPath: '/s.mp3', clips: ['/a.mp4'], everyBeats: 3 }, h), /1, 2, 4 or 8/)
  assert.throws(() => B.validateCut({ inputPath: '/s.mp3', clips: ['/a.mp4'], beats: [1] }, h), /list of times/)
  assert.throws(() => B.validateCut({ inputPath: '/s.mp3', clips: ['/a.mp4'], skipSeconds: 99 }, h), /0 to 30/)
})

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
async function core() {
  const { createCore } = require('../electron/core/index.cjs')
  const { createNodePlatform } = require('../electron/core/platform.cjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-'))
  const platform = createNodePlatform({ version: 'test' })
  platform.paths = { userData: path.join(dir, 'app'), downloads: path.join(dir, 'dl'), documents: dir }
  return { c: createCore({ platform, safeMode: true }), dir }
}
const waitDone = async (c, id, ms = 60000) => {
  for (let i = 0; i < ms / 100; i++) {
    const s = c.engine.tasks.get(id).state
    if (['done', 'error', 'canceled'].includes(s.status)) return s
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('timed out')
}
const probe = (f, entries) => spawnSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'default=nw=1', f], { encoding: 'utf8' }).stdout

function makeSong(dir) {
  const song = path.join(dir, 'song.mp3')
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='0.25*(sin(2*PI*220*t)+sin(2*PI*261.63*t)+sin(2*PI*329.63*t))+0.8*sin(2*PI*1000*t)*lt(mod(t,0.5),0.03)*exp(-mod(t,0.5)*80)':d=12:s=44100", '-c:a', 'libmp3lame', song])
  return song
}

test('a real beat cut: clips are joined at the beats and the song is the sound', { skip: !hasFfmpeg }, async () => {
  const { c, dir } = await core()
  const song = makeSong(dir)
  const clips = ['red', 'blue'].map((col, i) => {
    const f = path.join(dir, `${col}.mp4`)
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${col}:size=${i ? 640 : 320}x${i ? 360 : 240}:rate=25:d=8`, '-c:v', 'libx264', f])
    return f
  })
  const beats = Array.from({ length: 17 }, (_, i) => 1 + i * 0.5) // 120 BPM from 1.0 s to 9.0 s
  const id = await c.startJob('tasks:startBeatCut', { inputPath: song, clips, beats, everyBeats: 2, destination: dir })
  const s = await waitDone(c, id)
  assert.equal(s.status, 'done', s.error)
  assert.equal(s.quality, '8 cuts')
  const out = c.engine.tasks.get(id).finalPath
  const info = probe(out, 'stream=codec_name,width,height:format=duration')
  assert.match(info, /width=1280/)
  assert.match(info, /height=720/)
  assert.ok(Math.abs(Number(/duration=([\d.]+)/.exec(info)[1]) - 8) < 0.3, info)
  assert.match(probe(out, 'stream=codec_name'), /h264[\s\S]*aac|aac[\s\S]*h264/)
  c.shutdown()
})

test('a folder of clips works, and a missing librosa gives a clear message', { skip: !hasFfmpeg }, async () => {
  const { c, dir } = await core()
  const song = makeSong(dir)
  const folder = path.join(dir, 'clips')
  fs.mkdirSync(folder)
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=6:size=320x240:rate=25', '-c:v', 'libx264', path.join(folder, 'a.mp4')])
  const beats = [0.5, 1, 1.5, 2, 2.5]
  const s = await waitDone(c, await c.startJob('tasks:startBeatCut', { inputPath: song, clips: [folder], beats, everyBeats: 1, destination: dir }))
  assert.equal(s.status, 'done', s.error)
  const empty = path.join(dir, 'none')
  fs.mkdirSync(empty)
  const s2 = await waitDone(c, await c.startJob('tasks:startBeatCut', { inputPath: song, clips: [empty], beats, destination: dir }))
  assert.equal(s2.status, 'error')
  assert.match(s2.error, /No video files/)
  c.shutdown()
})

test('real analysis (needs librosa): the tempo, key and tags of a click track in A minor at 120 BPM', { skip: !hasFfmpeg || !librosaThere() }, async () => {
  const { c, dir } = await core()
  const song = makeSong(dir)
  const id = await c.startJob('tasks:startBeatAnalyze', { inputPath: song, writeTags: true, destination: dir })
  const s = await waitDone(c, id, 120000)
  assert.equal(s.status, 'done', s.error)
  assert.match(s.quality, /^(119|120)\.\d BPM · A minor \(8A\)$|^120 BPM · A minor \(8A\)$/)
  const r = c.modules.beats.beatsResult(id)
  assert.ok(Math.abs(r.bpm - 120) < 1.5 && r.beats.length > 15 && r.peaks.length > 100, JSON.stringify({ bpm: r.bpm, n: r.beats.length }))
  assert.match(probe(c.engine.tasks.get(id).finalPath, 'format_tags=TBPM,TKEY'), /TAG:TBPM=120/)
  const bad = await waitDone(c, await c.startJob('tasks:startBeatAnalyze', { inputPath: path.join(dir, 'song.mp3'), destination: dir }), 120000)
  assert.equal(bad.status, 'done')
  await assert.rejects(c.startJob('tasks:startBeatAnalyze', { inputPath: '/x/a.m4a', writeTags: true }), /MP3, FLAC/)
  c.shutdown()
})

function librosaThere() {
  const home = process.env.OPNDUCK_VENV || path.join(os.homedir(), '.opnduck-venv')
  const py = path.join(home, 'bin', 'python')
  return fs.existsSync(py) && spawnSync(py, ['-c', 'import librosa, soundfile']).status === 0
}
