const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const R = require('../electron/core/restore.cjs')

test('idet output: interlaced when more frames are interlaced than progressive', () => {
  const text = '[Parsed_idet_0 @ 0x1] Multi frame detection: TFF: 180 BFF: 0 Progressive: 20 Undetermined: 0'
  assert.deepEqual(R.parseIdet(text), { tff: 180, bff: 0, progressive: 20 })
  assert.equal(R.looksInterlaced(R.parseIdet(text)), true)
  assert.equal(R.looksInterlaced({ tff: 3, bff: 2, progressive: 495 }), false)
  assert.equal(R.looksInterlaced(null), false)
  assert.equal(R.parseIdet('nothing'), null)
})

test('the filter chain goes deinterlace, then noise, then colors; auto only deinterlaces when needed', () => {
  const o = { deinterlace: 'auto', denoise: 'medium', fixColors: true }
  assert.deepEqual(R.buildChain(o, true), ['bwdif=mode=send_frame:parity=auto:deint=all', 'hqdn3d=4:3:6:4.5', 'normalize=blackpt=black:whitept=white:smoothing=50'])
  assert.deepEqual(R.buildChain(o, false), ['hqdn3d=4:3:6:4.5', 'normalize=blackpt=black:whitept=white:smoothing=50'])
  assert.deepEqual(R.buildChain({ deinterlace: 'on', denoise: 'off', fixColors: false }, false), ['bwdif=mode=send_frame:parity=auto:deint=all'])
  assert.deepEqual(R.buildChain({ deinterlace: 'off', denoise: 'off', fixColors: false }, true), [])
  assert.match(R.buildChain({ deinterlace: 'off', denoise: 'strong', fixColors: false }, false)[0], /^nlmeans/)
  assert.match(R.detectFilter('/tmp/a b.trf'), /^vidstabdetect=.*result=\/tmp\/a b\.trf$/)
  assert.match(R.transformFilter('/tmp/m.trf'), /^vidstabtransform=input=\/tmp\/m\.trf:.*,unsharp=/)
})

test('requests are validated, and "nothing to do" is refused', () => {
  const h = { assertAbsolutePath: (p) => { if (!path.isAbsolute(p)) throw new Error('abs') }, assertOneOf: (v, l, n) => { if (!l.includes(v)) throw new Error(`${n} bad`) } }
  assert.equal(R.validate({ inputPath: '/a.mp4' }, h).deinterlace, 'auto', 'auto is the default and counts as something to do')
  assert.throws(() => R.validate({ inputPath: '/a.mp4', deinterlace: 'off' }, h), /Nothing to do/)
  assert.throws(() => R.validate({ inputPath: '/a.mp4', denoise: 'max' }, h), /denoise/)
  assert.throws(() => R.validate({ inputPath: '/a.mp4', stabilize: 'yes' }, h), /true or false/)
  assert.ok(R.validate({ inputPath: '/a.mp4', deinterlace: 'off', upscale: true }, h))
})

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const hasVidstab = hasFfmpeg && /vidstabdetect/.test(spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' }).stdout)

async function core() {
  const { createCore } = require('../electron/core/index.cjs')
  const { createNodePlatform } = require('../electron/core/platform.cjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-'))
  const platform = createNodePlatform({ version: 'test' })
  platform.paths = { userData: path.join(dir, 'app'), downloads: path.join(dir, 'dl'), documents: dir }
  return { c: createCore({ platform, safeMode: true }), dir }
}
const waitDone = async (c, id) => {
  for (let i = 0; i < 300; i++) {
    const s = c.engine.tasks.get(id).state
    if (['done', 'error', 'canceled'].includes(s.status)) return s
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('timed out')
}
const dims = (f) => spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,field_order', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout.trim()

test('real files: an interlaced clip is detected and fixed, a progressive one says there is nothing to do', { skip: !hasFfmpeg }, async () => {
  const { c, dir } = await core()
  const interlaced = path.join(dir, 'old.mp4')
  const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=duration=3:size=320x240:rate=25', '-vf', 'tinterlace=interleave_top', '-flags', '+ilme+ildct', '-c:v', 'libx264', interlaced])
  assert.equal(made.status, 0, String(made.stderr))
  const prev = await c.modules.restore.previewRestore({ inputPath: interlaced, width: 320 })
  assert.equal(prev.interlaced, true)
  assert.ok(prev.before?.startsWith('data:image/jpeg') && prev.after?.startsWith('data:image/jpeg'))
  const id = await c.startJob('tasks:startRestore', { inputPath: interlaced, denoise: 'light', fixColors: true, destination: dir })
  const s = await waitDone(c, id)
  assert.equal(s.status, 'done', s.error)
  assert.equal(s.quality, 'deinterlace, denoise, colors')
  assert.match(dims(c.engine.tasks.get(id).finalPath), /^320,240/)
  const progressive = path.join(dir, 'new.mp4')
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'smptebars=duration=2:size=160x120:rate=25', '-c:v', 'libx264', progressive])
  const s2 = await waitDone(c, await c.startJob('tasks:startRestore', { inputPath: progressive, destination: dir }))
  assert.equal(s2.status, 'error')
  assert.match(s2.error, /not interlaced/)
  c.shutdown()
})

test('real file: shaky footage is stabilized in two passes and keeps its size', { skip: !hasVidstab }, async () => {
  const { c, dir } = await core()
  const shaky = path.join(dir, 'shaky.mp4')
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=duration=3:size=360x270:rate=25', '-vf', "crop=w=320:h=240:x='20+10*sin(n*1.7)':y='15+8*cos(n*2.3)'", '-c:v', 'libx264', shaky])
  assert.equal(r.status, 0, String(r.stderr))
  const id = await c.startJob('tasks:startRestore', { inputPath: shaky, deinterlace: 'off', stabilize: true, destination: dir })
  const s = await waitDone(c, id)
  assert.equal(s.status, 'done', s.error)
  assert.match(dims(c.engine.tasks.get(id).finalPath), /^320,240/)
  c.shutdown()
})

test('with upscale or interpolate the fixes run first and the follow-ups join the same group', { skip: !hasFfmpeg }, async () => {
  const { c, dir } = await core()
  const input = path.join(dir, 'a.mp4')
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=duration=2:size=160x120:rate=25', '-c:v', 'libx264', input])
  const id = await c.startJob('tasks:startRestore', { inputPath: input, deinterlace: 'off', fixColors: true, upscale: true, interpolate: true, destination: dir })
  const first = c.engine.tasks.get(id)
  assert.equal(first.state.kind, 'restore')
  assert.equal(first.state.group?.size, 3, 'restore, upscale and interpolate are one group')
  await waitDone(c, id)
  const inGroup = () => [...c.engine.tasks.values()].filter((t) => t.state.group?.id === first.state.group.id)
  for (let i = 0; i < 100 && inGroup().length < 3; i++) await new Promise((r) => setTimeout(r, 100)) // the follow-ups start when the first step ends (or are listed as skipped when a step fails)
  assert.equal(inGroup().length, 3)
  c.shutdown()
})
