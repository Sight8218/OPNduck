// Regression tests for the fixes of the November 2026 code audit.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { PassThrough } = require('node:stream')
const { buildRemoteRequest } = require('../engine-api/remote_request.cjs')
const { createUploads, safeName } = require('../engine-api/uploads.cjs')
const { remoteArgs } = require('../electron/core/remote/hosts.cjs')
const { transportOf } = require('../electron/core/remote/servers.cjs')
const { buildStartRequest } = require('../electron/mcp_tools.cjs')
const { addressOk } = require('../electron/core/ai/index.cjs')
const aiTools = require('../electron/core/ai/tools.cjs')
const T = require('../electron/core/ai/transcripts.cjs')
const { createLlama } = require('../electron/core/ai/llama.cjs')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'))

test('remote requests: the background remover\'s own "output" setting is accepted, real output paths are still refused', () => {
  const r = buildRemoteRequest('remove_background', { uploadId: 'u', output: 'blur', quality: 'best' }, () => '/up/a.png')
  assert.equal(r.channel, 'tasks:startBgRemove')
  assert.deepEqual([r.req.output, r.req.quality, r.req.inputPath], ['blur', 'best', '/up/a.png'])
  assert.throws(() => buildRemoteRequest('remove_background', { uploadId: 'u', outputPath: 'x' }, () => '/up/a.png'), /cannot be set/)
  assert.throws(() => buildRemoteRequest('remove_background', { uploadId: 'u', output: 'image', backgroundImage: '/etc/x.png' }, () => '/up/a.png'), /file paths/)
})

test('a server job for the colour grader keeps the sliders the card nests under "values"', () => {
  const args = remoteArgs('grade', { inputPath: '/a.mp4', look: 'warm_film', intensity: 0.5, values: { exposure: 0.4, contrast: 1.2, blackPoint: 0.05 } })
  assert.deepEqual(args, { look: 'warm_film', intensity: 0.5, exposure: 0.4, contrast: 1.2 })
})

test('start requests enforce a schema maximum as well as a minimum', () => {
  assert.throws(() => buildStartRequest('make_gif', { inputPath: '/a.mp4', width: 99999 }), /out of range/)
  assert.throws(() => buildStartRequest('tag_music', { inputPath: '/a.mp3', minConfidence: 5 }), /out of range/)
  assert.equal(buildStartRequest('make_gif', { inputPath: '/a.mp4', width: 1920 }).req.width, 1920)
})

test('plain http is only for real tailnet addresses, not for hostnames that start with one', () => {
  assert.equal(addressOk('http://100.64.0.1:8080'), true)
  assert.equal(addressOk('http://100.100.evil.example.com/v1'), false)
  assert.equal(addressOk('http://100.64.0.1.example.com/v1'), false)
  assert.equal(addressOk('http://100.200.1.1/v1'), false, 'outside 100.64.0.0/10')
})

test('a server address is only "loopback" when it is a loopback address', () => {
  assert.equal(transportOf('http://127.0.0.1:47821'), 'loopback')
  assert.equal(transportOf('http://127.evil.example.com:47821'), 'lan-http')
  assert.equal(transportOf('http://100.64.1.1:1'), 'tailnet')
})

test('the assistant may only use a background picture the person picked', () => {
  const deps = { isKnownFile: (p) => p === '/media/a.png' || p === '/media/bg.jpg' }
  const ok = aiTools.propose('remove_background', { inputPath: '/media/a.png', output: 'image', backgroundImage: '/media/bg.jpg' }, deps)
  assert.equal(ok.req.backgroundImage, '/media/bg.jpg')
  assert.throws(() => aiTools.propose('remove_background', { inputPath: '/media/a.png', output: 'image', backgroundImage: '/home/me/.secret.png' }, deps), /not a file the person picked/)
})

test('uploads: reserved names cannot overwrite the bookkeeping, finished uploads do not fill the waiting list, an over-long chunk is cut back', async () => {
  assert.equal(safeName('meta.json'), '_meta.json')
  assert.equal(safeName('data.part'), '_data.part')
  const dir = tmp()
  const up = createUploads({ dir, freeBytes: () => 1e12 })
  // 21 finished uploads in a row: only unfinished ones count against the limit of 20.
  for (let i = 0; i < 21; i++) {
    const { uploadId } = up.create({ name: i === 0 ? 'meta.json' : `f${i}.bin`, size: 3 }, 'dev')
    const body = new PassThrough()
    const p = up.append(uploadId, 'dev', 'bytes 0-2/3', body)
    body.end(Buffer.from('abc'))
    assert.deepEqual((await p).complete, true)
    if (i === 0) assert.equal(fs.readFileSync(up.resolve(uploadId, 'dev'), 'utf8'), 'abc', 'the upload named meta.json kept its content')
  }
  // A chunk that runs past its Content-Range leaves the file exactly as it was.
  const { uploadId } = up.create({ name: 'big.bin', size: 20 }, 'dev')
  const first = new PassThrough()
  const p1 = up.append(uploadId, 'dev', 'bytes 0-9/20', first)
  first.end(Buffer.alloc(10, 1))
  await p1
  const bad = new PassThrough()
  const p2 = up.append(uploadId, 'dev', 'bytes 10-14/20', bad)
  bad.write(Buffer.alloc(12, 2))
  await assert.rejects(p2, /longer than its Content-Range/)
  assert.equal(up.status(uploadId, 'dev').offset, 10)
})

test('searching inside one video is not crowded out by better matches in other videos', () => {
  const dir = tmp()
  const t = T.createTranscripts({ dir: path.join(dir, 't') })
  const seg = (text) => ({ start: 1, end: 2, text })
  for (let i = 0; i < 600; i++) {
    const v = path.join(dir, `other${i}.mp4`)
    fs.writeFileSync(v, 'x')
    t.add(v, [seg('pineapple pineapple pineapple')])
  }
  const mine = path.join(dir, 'mine.mp4')
  fs.writeFileSync(mine, 'x')
  t.add(mine, [seg('a long talk that mentions pineapple once among many other words')])
  const hits = t.search('pineapple', { videoPath: mine, any: true, limit: 12 })
  assert.deepEqual(hits.map((h) => h.path), [mine])
  t.close()
})

test('the local AI engine: a program that cannot start is a readable error, not a crash; two downloads cannot overlap', async () => {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, 'runtime'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'runtime', 'llama-server'), 'not a program', { mode: 0o644 })
  fs.mkdirSync(path.join(dir, 'models', 'qwen3-1.7b'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'models', 'qwen3-1.7b', 'Qwen3-1.7B-Q4_K_M.gguf'), 'x')
  const settings = { ai: { provider: 'local', localModel: 'qwen3-1.7b', context: 8192, gpu: 'auto', vision: false, idleEject: 0 } }
  const stuck = (_url, { signal }) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('stopped'))))
  const llama = createLlama({ dir: () => dir, getSettings: () => settings, fetchFn: stuck })
  if (process.platform !== 'win32') {
    await assert.rejects(llama.load(), /could not be started/)
    assert.equal(llama.status().state, 'error')
  }
  const first = llama.installRuntime()
  await assert.rejects(llama.installRuntime(), /already running/)
  await assert.rejects(llama.installModel('qwen3-1.7b'), /already running/)
  llama.cancelInstall()
  await assert.rejects(first, /stopped/)
  assert.equal(llama.status().installing, null)
})
