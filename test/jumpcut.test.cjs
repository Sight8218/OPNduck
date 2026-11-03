const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const J = require('../electron/core/jumpcut.cjs')

test('silencedetect output becomes silences, including one still open at the end', () => {
  const text = 'x\n[silencedetect @ 0x1] silence_start: 2.001\n[silencedetect @ 0x1] silence_end: 4.002 | silence_duration: 2.001\n[silencedetect @ 0x1] silence_start: 9.5\n'
  assert.deepEqual(J.parseSilences(text, 12), [{ start: 2.001, end: 4.002 }, { start: 9.5, end: 12 }])
  assert.deepEqual(J.parseSilences('nothing', 5), [])
})

test('keep-segments: the gaps between silences, padded, merged when close, tiny ones dropped', () => {
  const silences = [{ start: 2, end: 4 }, { start: 4.2, end: 6 }]
  assert.deepEqual(J.keepSegments(silences, 8, { padding: 0, mergeGap: 0.3 }), [{ start: 0, end: 2 }, { start: 4, end: 4.2 }, { start: 6, end: 8 }])
  assert.deepEqual(J.keepSegments(silences, 8, { padding: 0, mergeGap: 1.9 }), [{ start: 0, end: 2 }, { start: 4, end: 8 }], 'parts less than mergeGap apart join')
  const padded = J.keepSegments([{ start: 2, end: 4 }], 8, { padding: 0.15, mergeGap: 0.3 })
  assert.deepEqual(padded.map((s) => [s.start, s.end]), [[0, 2.15], [3.85, 8]])
  // two parts 0.2 s apart (after padding they touch) become one
  assert.equal(J.keepSegments([{ start: 2, end: 2.1 }], 8, { padding: 0.15, mergeGap: 0.3 }).length, 1)
  assert.deepEqual(J.keepSegments([{ start: 0, end: 8 }], 8), [], 'all silence leaves nothing')
  assert.deepEqual(J.keepSegments([], 8), [{ start: 0, end: 8 }])
})

test('the filter graph cuts video and audio with the same parts and re-times both', () => {
  const segs = [{ start: 0, end: 2.15 }, { start: 3.85, end: 8 }]
  const g = J.buildGraph({ segments: segs, hasVideo: true, hasAudio: true, audioOnly: false, loudnorm: '' })
  assert.match(g.graph, /\[0:v\]select='between\(t,0,2\.15\)\+between\(t,3\.85,8\)',setpts=N\/FRAME_RATE\/TB\[v\]/)
  assert.match(g.graph, /\[0:a\]aselect='between\(t,0,2\.15\)\+between\(t,3\.85,8\)',asetpts=N\/SR\/TB\[a\]/)
  assert.deepEqual(g.maps, ['-map', '[v]', '-map', '[a]'])
  const a = J.buildGraph({ segments: null, hasVideo: true, hasAudio: true, audioOnly: true, loudnorm: 'loudnorm=I=-14' })
  assert.equal(a.graph, '[0:a]loudnorm=I=-14[a]')
  assert.deepEqual(a.maps, ['-map', '[a]'])
})

test('loudnorm: first pass prints json, second pass uses the measured numbers and is linear', () => {
  assert.match(J.loudnormFilter(-14), /^loudnorm=I=-14:TP=-1\.5:LRA=11:print_format=json$/)
  const second = J.loudnormFilter(-23, { input_i: '-20.1', input_tp: '-3.0', input_lra: '5.2', input_thresh: '-30.7', target_offset: '0.4' })
  assert.equal(second, 'loudnorm=I=-23:TP=-1.5:LRA=11:measured_I=-20.1:measured_TP=-3.0:measured_LRA=5.2:measured_thresh=-30.7:offset=0.4:linear=true')
  const out = 'junk\n{\n\t"input_i" : "-20.10",\n\t"input_tp" : "-3.00",\n\t"input_lra" : "5.20",\n\t"input_thresh" : "-30.70",\n\t"output_i" : "-23.1",\n\t"target_offset" : "0.40"\n}\n'
  assert.equal(J.parseLoudnorm(out).input_i, '-20.10')
  assert.equal(J.parseLoudnorm('no json here'), null)
})

test('requests are validated: paths, ranges, and "nothing to do"', () => {
  const h = { assertAbsolutePath: (p) => { if (!path.isAbsolute(p)) throw new Error('abs') }, assertOneOf: (v, l, n) => { if (!l.includes(v)) throw new Error(`${n} bad`) } }
  assert.equal(J.validate({ inputPath: '/a.mp4' }, h).thresholdDb, -30)
  assert.throws(() => J.validate({ inputPath: 'a.mp4' }, h), /abs/)
  assert.throws(() => J.validate({ inputPath: '/a.mp4', thresholdDb: 5 }, h), /-80 and -10/)
  assert.throws(() => J.validate({ inputPath: '/a.mp4', minSilence: 0 }, h), /0.1 to 10/)
  assert.throws(() => J.validate({ inputPath: '/a.mp4', normalize: 'loud' }, h), /normalize/)
  assert.throws(() => J.validate({ inputPath: '/a.mp4', cut: false }, h), /Nothing to do/)
  assert.ok(J.validate({ inputPath: '/a.mp4', cut: false, normalize: 'podcast' }, h))
})

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

async function core() {
  const { createCore } = require('../electron/core/index.cjs')
  const { createNodePlatform } = require('../electron/core/platform.cjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-'))
  const platform = createNodePlatform({ version: 'test' })
  platform.paths = { userData: path.join(dir, 'app'), downloads: path.join(dir, 'dl'), documents: dir }
  const c = createCore({ platform, safeMode: true })
  return { c, dir }
}
const waitDone = async (c, id) => {
  for (let i = 0; i < 200; i++) {
    const s = c.engine.tasks.get(id).state
    if (['done', 'error', 'canceled'].includes(s.status)) return s
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('timed out')
}
const probeDuration = (f) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout)
const meanLufs = (f) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-af', 'loudnorm=I=-14:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' })
  return Number(/"input_i"\s*:\s*"(-?[\d.]+)"/.exec(r.stderr)[1])
}

test('a real file: 2 s tone, 2 s silence, 2 s tone loses about the silence, and normalizing hits the target', { skip: !hasFfmpeg }, async () => {
  const { c, dir } = await core()
  const input = path.join(dir, 'talk.mp4')
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=6:size=160x120:rate=15', '-f', 'lavfi', '-i', "aevalsrc='if(between(t,2,4),0,0.2*sin(2*PI*440*t))':d=6:s=44100", '-c:v', 'libx264', '-c:a', 'aac', '-shortest', input])
  assert.equal(r.status, 0, String(r.stderr))
  const analysis = await c.modules.jumpcut.analyzeJumpCut({ inputPath: input })
  assert.ok(Math.abs(analysis.removedSeconds - 1.7) < 0.3, JSON.stringify(analysis))
  assert.equal(analysis.parts, 2)
  const out = path.join(dir, 'out')
  const id = await c.startJob('tasks:startJumpCut', { inputPath: input, destination: out })
  const state = await waitDone(c, id)
  assert.equal(state.status, 'done', state.error)
  const file = c.engine.tasks.get(id).finalPath
  assert.ok(Math.abs(probeDuration(file) - 4.3) < 0.4, `duration ${probeDuration(file)}`)
  const id2 = await c.startJob('tasks:startJumpCut', { inputPath: input, destination: out, cut: false, normalize: 'podcast' })
  const s2 = await waitDone(c, id2)
  assert.equal(s2.status, 'done', s2.error)
  const lufs = meanLufs(c.engine.tasks.get(id2).finalPath)
  assert.ok(Math.abs(lufs - -14) < 1.5, `loudness ${lufs}`)
  const id3 = await c.startJob('tasks:startJumpCut', { inputPath: input, destination: out, audioOnly: true, thresholdDb: -30 })
  assert.equal((await waitDone(c, id3)).status, 'done')
  assert.match(c.engine.tasks.get(id3).finalPath, /\.mp3$/)
  c.shutdown()
})

test('a file with nothing to cut, and one that is all silence, give clear messages', { skip: !hasFfmpeg }, async () => {
  const { c, dir } = await core()
  const tone = path.join(dir, 'tone.mp3')
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', tone])
  const a = await waitDone(c, await c.startJob('tasks:startJumpCut', { inputPath: tone, destination: dir }))
  assert.equal(a.status, 'error')
  assert.match(a.error, /No silences found/)
  const quiet = path.join(dir, 'quiet.mp3')
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '3', quiet])
  const b = await waitDone(c, await c.startJob('tasks:startJumpCut', { inputPath: quiet, destination: dir }))
  assert.equal(b.status, 'error')
  assert.match(b.error, /Everything counts as silence/)
  c.shutdown()
})
