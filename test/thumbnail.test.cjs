const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const T = require('../electron/core/ai/thumbnail.cjs')

test('scoring prefers detail and a middle brightness; the model answer is held to the frame numbers', () => {
  assert.ok(T.score({ bytes: 40000, luma: 120 }) > T.score({ bytes: 40000, luma: 5 }))
  assert.ok(T.score({ bytes: 40000, luma: 120 }) > T.score({ bytes: 4000, luma: 120 }))
  assert.deepEqual(T.parsePick('{"pick":2,"why":"clear"}', 6), { index: 1, why: 'clear' })
  assert.equal(T.parsePick('{"pick":9,"why":"x"}', 6), null)
  assert.equal(T.parsePick('/etc/passwd', 6), null)
})

const ok = spawnSync('ffmpeg', ['-version']).status === 0
test('a real video: black and fade frames are skipped, the file is saved beside it, the model picks by number', { skip: !ok }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-'))
  const v = path.join(dir, 'v.mp4')
  // 5 s black, then 5 s of a busy test picture.
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=10:d=5', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10:duration=5', '-filter_complex', '[0][1]concat=n=2:v=1[o]', '-map', '[o]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', v])
  const uniq = (d, n, e) => path.join(d, `${n}.${e}`)
  const plain = await T.pickThumbnail(null, v, { destDir: dir, uniqueOutputPath: uniq })
  assert.ok(plain.time > 5, `chose a lit frame, not black: ${plain.time}`)
  assert.ok(fs.statSync(plain.path).size > 1000)
  let seen = 0
  const ai = { chat: async function* (o) { seen = o.messages[1].images.length; yield { type: 'text', delta: '{"pick":2,"why":"nice"}' } } }
  const viaAi = await T.pickThumbnail(ai, v, { destDir: dir, uniqueOutputPath: (d, n, e) => path.join(d, `${n}-ai.${e}`), canSee: true })
  assert.equal(viaAi.byAi, true)
  assert.ok(seen >= 2 && seen <= 6)
  const broken = { chat: async function* () { throw new Error('offline') } }
  assert.equal((await T.pickThumbnail(broken, v, { destDir: dir, uniqueOutputPath: (d, n, e) => path.join(d, `${n}-b.${e}`), canSee: true })).byAi, false)
})
