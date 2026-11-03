const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const G = require('../electron/core/grade.cjs')

test('LUT files: the right size and number of rows, every look is valid, bad files are refused', () => {
  for (const [id, look] of Object.entries(G.LOOKS)) {
    const text = G.cubeText(look.fn, 9, look.label)
    assert.equal(G.validateCube(text), 9, id)
    const rows = text.trim().split('\n').slice(2).map((l) => l.split(' ').map(Number))
    assert.ok(rows.every((r) => r.length === 3 && r.every((v) => v >= 0 && v <= 1)), `${id}: every value inside 0..1`)
  }
  assert.throws(() => G.validateCube('hello'), /not a 3D LUT/)
  assert.throws(() => G.validateCube('LUT_3D_SIZE 3\n0 0 0\n'), /27 colour rows/)
  assert.throws(() => G.validateCube('LUT_3D_SIZE 500\n'), /not a 3D LUT/)
  const identity = G.cubeText((c) => c, 5)
  assert.match(identity, /^TITLE "OPNduck"\nLUT_3D_SIZE 5\n0 0 0\n0.25 0 0\n/, 'red changes fastest')
})

test('looks do what their names say: black and white has no colour, the fade lifts the blacks, teal and orange splits the tones', () => {
  const bw = G.LOOKS.bw_rich.fn([0.8, 0.2, 0.1])
  assert.ok(bw[0] === bw[1] && bw[1] === bw[2])
  assert.ok(G.LOOKS.vintage_fade.fn([0, 0, 0])[0] > 0.04)
  const dark = G.LOOKS.teal_orange.fn([0.1, 0.1, 0.1])
  const bright = G.LOOKS.teal_orange.fn([0.9, 0.9, 0.9])
  assert.ok(dark[2] > dark[0], 'shadows lean blue-green')
  assert.ok(bright[0] > bright[2], 'highlights lean orange')
})

test('measurements are averaged over frames, and the auto fix reacts to a flat, dark, blue picture', () => {
  const text = ['YMIN=40', 'YMAX=200', 'YAVG=60', 'UAVG=150', 'VAVG=120', 'YMIN=44', 'YMAX=204', 'YAVG=64', 'UAVG=152', 'VAVG=122'].map((l) => `lavfi.signalstats.${l}`).join('\n')
  const s = G.parseStats(text)
  assert.deepEqual([s.ymin, s.ymax, s.yavg], [42, 202, 62])
  assert.equal(G.parseStats('nothing'), null)
  const fix = G.autoFix(s)
  assert.ok(fix.values.exposure > 0, 'dark: brighter')
  assert.ok(fix.values.blackPoint > 0.05, 'levels stretched')
  assert.ok(fix.values.temperature > 0, 'blue cast: warmer')
  assert.ok(fix.values.tint > 0, 'a greenish cast (V below 128) gets more magenta')
  assert.ok(fix.why.length >= 3 && fix.why.every((w) => w.setting && w.because))
  const fine = G.autoFix({ ymin: 16, ymax: 235, yavg: 110, uavg: 128, vavg: 128 })
  assert.deepEqual(fine.values, { exposure: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0, blackPoint: 0, whitePoint: 1 })
  assert.deepEqual(fine.why, [])
})

test('the filter chain: nothing for neutral values, the right filters in a fixed order otherwise, a look at partial strength blends', () => {
  assert.deepEqual(G.buildFilters({}), [])
  const f = G.buildFilters({ blackPoint: 0.05, whitePoint: 0.95, exposure: 1, temperature: 0.4, tint: -0.2, contrast: 1.1, saturation: 0.8 }, { lut: "/tmp/a b's.cube", intensity: 1 })
  assert.deepEqual(f.map((x) => x.split('=')[0]), ['colorlevels', 'lutrgb', 'colorbalance', 'eq', 'lut3d'])
  assert.match(f[1], /val\*2/)
  assert.match(f[4], /lut3d=file='\/tmp\/a b'\\''s\.cube'/)
  const half = G.buildFilters({}, { lut: '/tmp/x.cube', intensity: 0.5 })
  assert.match(half[0], /^split\[o\]\[l\];\[l\]lut3d=.*\[g\];\[o\]\[g\]blend=all_expr='A\*0\.5\+B\*0\.5'$/)
  assert.deepEqual(G.buildFilters({}, { lut: '/tmp/x.cube', intensity: 0 }), [])
  assert.match(G.buildFilters({ exposure: 1 }, { tonemap: true })[0], /^zscale=t=linear/)
  assert.deepEqual(G.normalizeValues({ exposure: 9, saturation: -4 }).exposure, 2)
  assert.equal(G.normalizeValues({ saturation: -4 }).saturation, 0)
  assert.throws(() => G.normalizeValues({ tint: 'x' }), /must be a number/)
})

test('Lab conversion round-trips, and the colour transfer moves the mean and spread onto the reference', () => {
  for (const c of [[0, 0, 0], [1, 1, 1], [0.8, 0.2, 0.1], [0.1, 0.5, 0.9]]) {
    const back = G.labToRgb(G.rgbToLab(c))
    c.forEach((v, i) => assert.ok(Math.abs(v - back[i]) < 0.01, JSON.stringify([c, back])))
  }
  assert.ok(Math.abs(G.rgbToLab([1, 1, 1])[0] - 100) < 0.1)
  const px = (r, g, b, n) => Uint8Array.from({ length: n * 3 }, (_, i) => [r, g, b][i % 3])
  const mixed = (a, b) => Uint8Array.from([...a, ...b])
  const src = G.labStats(mixed(px(60, 60, 60, 50), px(120, 120, 120, 50)))
  const ref = G.labStats(mixed(px(180, 120, 60, 50), px(250, 190, 130, 50)))
  const out = G.transferFn(src, ref)(G.labToRgb(src.mean))
  const [L, a, b] = G.rgbToLab(out)
  assert.ok(Math.abs(L - ref.mean[0]) < 3 && Math.abs(a - ref.mean[1]) < 3 && Math.abs(b - ref.mean[2]) < 3, `mean maps to the reference mean: ${[L, a, b]} vs ${ref.mean}`)
})

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
async function core() {
  const { createCore } = require('../electron/core/index.cjs')
  const { createNodePlatform } = require('../electron/core/platform.cjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-'))
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
const meanColor = (f) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-vf', 'scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  return [...r.stdout]
}
const clip = (dir, name, color) => {
  const f = path.join(dir, name)
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:size=160x120:rate=10:d=3`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f])
  return f
}

test('real files: auto fix brightens a dark bluish clip and warms it; a look and the preview work; a missing change is refused', { skip: !hasFfmpeg }, async () => {
  const { c, dir } = await core()
  const g = c.modules.grade
  const dark = clip(dir, 'dark.mp4', '0x142030')
  const auto = await g.autoGrade(dark)
  assert.ok(auto.values.exposure > 0 && auto.values.temperature > 0, JSON.stringify(auto.values))
  const id = await c.startJob('tasks:startGrade', { inputPath: dark, auto: true, destination: dir })
  const s = await waitDone(c, id)
  assert.equal(s.status, 'done', s.error)
  const [r0, , b0] = meanColor(dark)
  const [r1, g1, b1] = meanColor(c.engine.tasks.get(id).finalPath)
  assert.ok(r1 > r0 + 10 && g1 > 0, `brighter: ${[r0, b0]} -> ${[r1, b1]}`)
  assert.ok(r1 / (b1 + 1) > r0 / (b0 + 1), 'warmer: relatively more red than before')

  const looks = g.listLooks()
  assert.ok(looks.length >= 6 && looks[0].id === 'warm_film')
  const bw = await waitDone(c, await c.startJob('tasks:startGrade', { inputPath: clip(dir, 'red.mp4', 'red'), look: 'bw_rich', destination: dir }))
  assert.equal(bw.status, 'done', bw.error)
  const [R, G, B] = meanColor(c.engine.tasks.get([...c.engine.tasks.keys()].pop()).finalPath)
  assert.ok(Math.abs(R - G) < 6 && Math.abs(G - B) < 6, `black and white: ${[R, G, B]}`)

  const prev = await g.previewGrade({ inputPath: dark, values: { exposure: 1 }, width: 160 })
  assert.ok(prev.before?.startsWith('data:image/jpeg') && prev.after?.startsWith('data:image/jpeg') && prev.before !== prev.after)
  const half = await g.previewGrade({ inputPath: dark, look: 'warm_film', intensity: 0.5, width: 160 })
  assert.ok(half.after, 'a look at half strength renders')

  const none = await c.startJob('tasks:startGrade', { inputPath: dark, destination: dir }).catch((e) => e.message)
  assert.match(none, /Nothing to change/)
  await assert.rejects(c.startJob('tasks:startGrade', { inputPath: dark, look: '../../etc/passwd' }), /Unknown look/)
  c.shutdown()
})

test('real files: importing a LUT, and matching one clip to a reference picture', { skip: !hasFfmpeg }, async () => {
  const { c, dir } = await core()
  const g = c.modules.grade
  const mine = path.join(dir, 'My Look.cube')
  fs.writeFileSync(mine, G.cubeText(([r, gg, b]) => [b, gg, r], 5))
  const id = g.importLut(mine)
  assert.equal(id, 'user-My Look')
  assert.ok(g.listLooks().some((l) => l.id === id && l.own))
  fs.writeFileSync(path.join(dir, 'bad.cube'), 'not a lut')
  assert.throws(() => g.importLut(path.join(dir, 'bad.cube')), /not a 3D LUT/)

  const grey = clip(dir, 'grey.mp4', 'gray')
  const orange = clip(dir, 'orange.mp4', 'orange')
  const matchId = await g.matchLook(grey, orange)
  assert.match(matchId, /^match-[0-9a-f]{16}$/)
  const done = await waitDone(c, await c.startJob('tasks:startGrade', { inputPath: grey, look: matchId, destination: dir }))
  assert.equal(done.status, 'done', done.error)
  const [R, , B] = meanColor(c.engine.tasks.get([...c.engine.tasks.keys()].pop()).finalPath)
  assert.ok(R > B + 20, `grey now leans orange: R=${R} B=${B}`)
  c.shutdown()
})

test('the AI look picker: the answer is held to a schema, clamped, and a made-up look is dropped', async () => {
  const L = require('../electron/core/ai/looks.cjs')
  const ok = L.parseLook('```json\n{"look":"teal_orange","intensity":2,"temperature":0.3,"tint":-5,"exposure":0.5,"contrast":1.2,"saturation":0.9,"why":"Moody"}\n```')
  assert.deepEqual([ok.look, ok.intensity, ok.tint, ok.temperature], ['teal_orange', 1, -1, 0.3])
  assert.equal(L.parseLook('{"look":"hacker","why":"x"}').look, '')
  assert.deepEqual(L.parseLook('{"look":""}').contrast, 1)
  assert.throws(() => L.parseLook('I think warm.'), /did not answer with a look/)
  assert.deepEqual(L.lookSchema.properties.look.enum, L.LOOK_IDS)
  assert.ok(L.LOOK_IDS.slice(1).every((id) => Object.hasOwn(G.LOOKS, id)), 'every look the model may name exists')
  let sent
  const ai = { async *chat(o) { sent = o; yield { type: 'text', delta: '{"look":"warm_film","intensity":0.6,"temperature":0.2,"tint":0,"exposure":0,"contrast":1.1,"saturation":1,"why":"70s"}' } } }
  const r = await L.pickLook(ai, { frames: ['data:image/jpeg;base64,AAAA'], prompt: 'a warm 70s film' })
  assert.equal(r.look, 'warm_film')
  assert.equal(sent.jsonSchema, L.lookSchema)
  assert.match(sent.messages[1].content, /warm 70s film/)
  assert.equal(sent.messages[1].images.length, 1)
})
