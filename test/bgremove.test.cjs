const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const B = require('../electron/core/bg_remove.cjs')

test('requests are validated: output kinds, colours, the background picture, formats', () => {
  const h = { assertAbsolutePath: (p, n) => { if (!path.isAbsolute(String(p))) throw new Error(`${n} abs`) }, assertOneOf: (v, l, n) => { if (!l.includes(v)) throw new Error(`${n} bad`) } }
  assert.equal(B.validate({ inputPath: '/a.mp4' }, h).output, 'transparent')
  assert.throws(() => B.validate({ inputPath: '/a.mp4', output: 'hologram' }, h), /output bad/)
  assert.throws(() => B.validate({ inputPath: '/a.mp4', output: 'color', color: 'green' }, h), /#00ff00/)
  assert.throws(() => B.validate({ inputPath: '/a.mp4', output: 'image' }, h), /backgroundImage abs/)
  assert.throws(() => B.validate({ inputPath: '/a.mp4', output: 'image', backgroundImage: '/b.txt' }, h), /must be a picture/)
  assert.throws(() => B.validate({ inputPath: '/a.mp4', model: 'evil' }, h), /model bad/)
  assert.ok(B.validate({ inputPath: '/a.mp4', output: 'image', backgroundImage: '/b.jpg', format: 'mov' }, h))
  assert.match(B.compositeGraph('blur').graph, /boxblur/)
})

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const venv = path.join(process.env.OPNDUCK_VENV || path.join(os.homedir(), '.opnduck-venv'), 'bin', 'python')
const hasRembg = hasFfmpeg && fs.existsSync(venv) && spawnSync(venv, ['-c', 'import rembg, onnxruntime, PIL']).status === 0

async function core() {
  const { createCore } = require('../electron/core/index.cjs')
  const { createNodePlatform } = require('../electron/core/platform.cjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgr-'))
  const platform = createNodePlatform({ version: 'test' })
  platform.paths = { userData: path.join(dir, 'app'), downloads: path.join(dir, 'dl'), documents: dir }
  return { c: createCore({ platform, safeMode: true }), dir }
}
const waitDone = async (c, id) => {
  for (let i = 0; i < 900; i++) {
    const s = c.engine.tasks.get(id).state
    if (['done', 'error', 'canceled'].includes(s.status)) return s
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('timed out')
}
const rgba = (f, w, h) => spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-vf', `scale=${w}:${h}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1e8 }).stdout

test('a picture: the subject is cut out (transparent), or placed on a colour, a blur or another picture', { skip: !hasRembg }, async () => {
  const { c, dir } = await core()
  const pic = path.join(dir, 'p.png')
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x3070a0:s=320x240', '-vf', 'drawbox=x=100:y=60:w=120:h=130:color=0xf0c090:t=fill,drawbox=x=130:y=80:w=20:h=20:color=black:t=fill,drawbox=x=170:y=80:w=20:h=20:color=black:t=fill', '-frames:v', '1', pic])
  const bg = path.join(dir, 'bg.png')
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', bg])
  const run = async (req) => {
    const id = await c.startJob('tasks:startBgRemove', { inputPath: pic, destination: dir, ...req })
    const s = await waitDone(c, id)
    assert.equal(s.status, 'done', s.error)
    return c.engine.tasks.get(id).finalPath
  }
  const t = rgba(await run({}), 320, 240)
  const alphaOf = (buf, x, y) => buf[(y * 320 + x) * 4 + 3]
  assert.ok(alphaOf(t, 160, 120) > 200, 'the subject stays')
  assert.ok(alphaOf(t, 5, 5) < 50, 'the background is transparent')
  const green = rgba(await run({ output: 'color', color: '#00ff00' }), 320, 240)
  const px = (5 * 320 + 5) * 4
  assert.ok(green[px] < 6 && green[px + 1] > 248 && green[px + 3] === 255, `a flat green behind it: ${[...green.subarray(px, px + 4)]}`)
  const onPic = rgba(await run({ output: 'image', backgroundImage: bg }), 320, 240)
  assert.ok(onPic[(5 * 320 + 5) * 4] > 200 && onPic[(5 * 320 + 5) * 4 + 1] < 60, 'the picture behind it is red')
  assert.ok(rgba(await run({ output: 'blur' }), 320, 240).length > 0)
  c.shutdown()
})

test('a video: a transparent WebM with an alpha channel, or an MP4 on a colour; sizes with an odd number are fixed', { skip: !hasRembg }, async () => {
  const { c, dir } = await core()
  const v = path.join(dir, 'v.mp4')
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x3070a0:s=321x241:r=10:d=2', '-f', 'lavfi', '-i', 'sine=duration=2', '-vf', "drawbox=x='60+t*40':y=60:w=120:h=130:color=0xf0c090:t=fill", '-c:v', 'libx264', '-pix_fmt', 'yuv444p', '-c:a', 'aac', '-shortest', v])
  c.noteFile(v)
  const t = await waitDone(c, await c.startJob('tasks:startBgRemove', { inputPath: v, destination: dir }))
  assert.equal(t.status, 'done', t.error)
  const out = c.engine.tasks.get([...c.engine.tasks.keys()].pop()).finalPath
  assert.match(out, /\.webm$/)
  const tags = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream_tags=alpha_mode:stream=width,height', '-of', 'default=nw=1', out], { encoding: 'utf8' }).stdout
  assert.match(tags, /alpha_mode=1/)
  assert.match(tags, /width=320/, 'an odd size is made even')
  const m = await waitDone(c, await c.startJob('tasks:startBgRemove', { inputPath: v, output: 'color', color: '#ff0000', destination: dir }))
  assert.equal(m.status, 'done', m.error)
  assert.match(c.engine.tasks.get([...c.engine.tasks.keys()].pop()).finalPath, /\.mp4$/)
  const bad = await waitDone(c, await c.startJob('tasks:startBgRemove', { inputPath: path.join(dir, 'nope.mp4'), destination: dir }))
  assert.equal(bad.status, 'error')
  c.shutdown()
})
