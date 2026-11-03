const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const L = require('../electron/core/ai/llama.cjs')
const { createAi } = require('../electron/core/ai/index.cjs')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'llama-'))
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

test('the right llama.cpp build for each system, from the newest release that has one, with its checksum', () => {
  assert.equal(L.assetSuffix('linux', 'x64'), 'bin-ubuntu-vulkan-x64.tar.gz')
  assert.equal(L.assetSuffix('linux', 'arm64'), 'bin-ubuntu-vulkan-arm64.tar.gz')
  assert.equal(L.assetSuffix('win32', 'x64'), 'bin-win-vulkan-x64.zip')
  assert.equal(L.assetSuffix('darwin', 'arm64'), 'bin-macos-arm64.tar.gz')
  assert.equal(L.assetSuffix('darwin', 'x64'), 'bin-macos-x64.tar.gz')
  assert.throws(() => L.assetSuffix('freebsd', 'x64'), /no llama\.cpp build/)
  const releases = [
    { tag_name: 'b3', assets: [{ name: 'llama-b3-bin-win-cpu-x64.zip', browser_download_url: 'u0' }] },
    { tag_name: 'b2', assets: [{ name: 'cudart-llama-bin-ubuntu-vulkan-x64.tar.gz' }, { name: 'llama-b2-bin-ubuntu-vulkan-x64.tar.gz', browser_download_url: 'u2', digest: `sha256:${'a'.repeat(64)}`, size: 5 }] },
    { tag_name: 'b1', assets: [{ name: 'llama-b1-bin-ubuntu-vulkan-x64.tar.gz', browser_download_url: 'u1' }] },
  ]
  const a = L.pickAsset(releases, 'linux', 'x64')
  assert.deepEqual([a.tag, a.url, a.sha256], ['b2', 'u2', 'a'.repeat(64)])
  assert.equal(L.pickAsset([{ tag_name: 'x', assets: [{ name: 'llama-x-bin-ubuntu-vulkan-x64.tar.gz', browser_download_url: 'u' }] }], 'linux', 'x64').sha256, null)
  assert.throws(() => L.pickAsset(releases, 'darwin', 'arm64'), /No llama\.cpp build/)
})

test('the default download is at most 4 GB, picture add-on included, and the small option is smaller', () => {
  for (const m of Object.values(L.MODELS)) assert.ok(m.sizeMB <= 4000, m.label)
  assert.ok(L.MODELS[L.DEFAULT_MODEL].vision && L.MODELS[L.DEFAULT_MODEL].mmproj)
  assert.ok(L.MODELS['qwen3-1.7b'].sizeMB < 1500)
})

/** A file server with Range support and a request log. */
async function files(map, { rangeBug = false } = {}) {
  const log = []
  const srv = http.createServer((req, res) => {
    const body = map[req.url.split('?')[0]]
    log.push([req.url, req.headers.range ?? ''])
    if (req.url.startsWith('/api/') || req.url === '/releases') {
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify(typeof body === 'function' ? body(srv.address().port) : body))
    }
    if (!body) return res.writeHead(404).end()
    const m = /bytes=(\d+)-/.exec(req.headers.range ?? '')
    if (m && !rangeBug) {
      const from = Number(m[1])
      if (from >= body.length) return res.writeHead(416).end()
      res.writeHead(206, { 'Content-Length': body.length - from })
      return res.end(body.subarray(from))
    }
    res.writeHead(200, { 'Content-Length': body.length })
    res.end(body)
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${srv.address().port}`, log, close: () => (srv.closeAllConnections(), new Promise((r) => srv.close(r))) }
}

test('downloads resume where they stopped, report progress, and a wrong checksum deletes the file', async () => {
  const data = crypto.randomBytes(200000)
  const s = await files({ '/f.bin': data })
  try {
    const dest = path.join(tmp(), 'f.bin')
    fs.writeFileSync(`${dest}.part`, data.subarray(0, 50000))
    const seen = []
    await L.download(`${s.url}/f.bin`, dest, { sha256: sha(data), onProgress: (d, t) => seen.push([d, t]) })
    assert.deepEqual(fs.readFileSync(dest), data)
    assert.equal(s.log[0][1], 'bytes=50000-', 'asked only for the rest')
    assert.deepEqual(seen[seen.length - 1], [200000, 200000])
    assert.ok(!fs.existsSync(`${dest}.part`))
    const bad = path.join(tmp(), 'g.bin')
    await assert.rejects(L.download(`${s.url}/f.bin`, bad, { sha256: 'b'.repeat(64) }), /does not match its published checksum/)
    assert.ok(!fs.existsSync(bad) && !fs.existsSync(`${bad}.part`))
    const done = path.join(tmp(), 'h.bin')
    fs.writeFileSync(`${done}.part`, data) // a complete part file: the server answers 416
    await L.download(`${s.url}/f.bin`, done, { sha256: sha(data) })
    assert.deepEqual(fs.readFileSync(done), data)
    await assert.rejects(L.download(`${s.url}/missing`, path.join(tmp(), 'x')), /download failed \(404\)/)
  } finally {
    await s.close()
  }
  const s2 = await files({ '/f.bin': crypto.randomBytes(1000) }, { rangeBug: true })
  try {
    const dest = path.join(tmp(), 'f.bin')
    fs.writeFileSync(`${dest}.part`, Buffer.alloc(300, 7))
    await L.download(`${s2.url}/f.bin`, dest, {})
    assert.equal(fs.statSync(dest).size, 1000, 'a server that ignores Range gives the whole file again, not a joined one')
  } finally {
    await s2.close()
  }
})

/** A stand-in for llama-server: a script that answers /health and /v1/chat/completions on the port it is given. */
const FAKE_SERVER = `#!/usr/bin/env node
const http = require('http')
const a = process.argv.slice(2)
const port = Number(a[a.indexOf('--port') + 1])
require('fs').writeFileSync(process.env.FAKE_ARGS_FILE || '/dev/null', JSON.stringify(a))
const delay = Number(process.env.FAKE_DELAY || 0)
setTimeout(() => http.createServer((req, res) => {
  if (req.url === '/health') return res.end('{"status":"ok"}')
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const j = JSON.parse(body || '{}')
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'local says hi' } }] }) + '\\n\\n')
    res.write('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4 }, _seen: j.chat_template_kwargs ?? null }) + '\\n\\n')
    res.end('data: [DONE]\\n\\n')
  })
}).listen(port, '127.0.0.1'), delay)
`

async function installed({ vision = false, model = 'ministral-3-3b', extra = {} } = {}) {
  const work = tmp()
  const archive = path.join(work, 'a.tar.gz')
  fs.mkdirSync(path.join(work, 'pkg', 'llama-b9'), { recursive: true })
  fs.writeFileSync(path.join(work, 'pkg', 'llama-b9', 'llama-server'), FAKE_SERVER, { mode: 0o755 })
  execFileSync('tar', ['-czf', archive, '-C', path.join(work, 'pkg'), 'llama-b9'])
  const tarball = fs.readFileSync(archive)
  const m = L.MODELS[model]
  const gguf = crypto.randomBytes(5000)
  const mm = crypto.randomBytes(3000)
  const map = {
    '/releases': (port) => [{ tag_name: 'b9', assets: [{ name: 'llama-b9-bin-ubuntu-vulkan-x64.tar.gz', browser_download_url: `http://127.0.0.1:${port}/dl/llama.tar.gz`, digest: `sha256:${sha(tarball)}`, size: tarball.length }, { name: 'llama-b9-bin-win-vulkan-x64.zip', browser_download_url: `http://127.0.0.1:${port}/dl/llama.zip` }, { name: 'llama-b9-bin-macos-arm64.tar.gz', browser_download_url: `http://127.0.0.1:${port}/dl/llama.tar.gz` }, { name: 'llama-b9-bin-macos-x64.tar.gz', browser_download_url: `http://127.0.0.1:${port}/dl/llama.tar.gz` }] }],
    '/dl/llama.tar.gz': tarball,
    [`/api/models/${m.repo}`]: { siblings: [{ rfilename: m.file, size: gguf.length, lfs: { sha256: sha(gguf) } }, ...(m.mmproj ? [{ rfilename: m.mmproj, size: mm.length, lfs: { sha256: sha(mm) } }] : [])] },
    [`/${m.repo}/resolve/main/${m.file}`]: gguf,
    ...(m.mmproj ? { [`/${m.repo}/resolve/main/${m.mmproj}`]: mm } : {}),
    ...extra,
  }
  const srv = await files(map)
  const settings = { ai: { provider: 'local', localModel: model, context: 8192, gpu: 'auto', vision, startOnLaunch: false, idleEject: 0, dir: '', reasoning: 'auto', effort: 'medium', temperature: 0.7, model: '' } }
  const dir = tmp()
  const llama = L.createLlama({ dir: () => dir, getSettings: () => settings, sources: { github: `${srv.url}/releases`, hf: srv.url, hfApi: srv.url } })
  return { llama, srv, settings, dir }
}

test('installing: the engine is downloaded, checked and unpacked; the model files are checked; progress and removal work', { skip: process.platform === 'win32' }, async () => {
  const t = await installed({ vision: true })
  try {
    assert.deepEqual([t.llama.status().runtime, t.llama.status().models['ministral-3-3b']], [false, false])
    const events = []
    t.llama.onChange((s) => s.installing && events.push(s.installing.what))
    await t.llama.installRuntime()
    assert.equal(t.llama.status().runtime, true)
    assert.ok(fs.statSync(path.join(t.dir, 'runtime', 'llama-b9', 'llama-server')).mode & 0o100, 'executable')
    assert.ok(!fs.existsSync(path.join(t.dir, 'downloads', 'llama-b9-bin-ubuntu-vulkan-x64.tar.gz')), 'the archive is removed')
    await t.llama.installModel('ministral-3-3b')
    assert.equal(t.llama.status().models['ministral-3-3b'], true)
    assert.ok(events.some((e) => /llama\.cpp/.test(e)) && events.some((e) => /Ministral/.test(e)))
    assert.equal(t.llama.status().installing, null)
    t.llama.remove('ministral-3-3b')
    assert.equal(t.llama.status().models['ministral-3-3b'], false)
  } finally {
    await t.srv.close()
  }
})

test('a model over the 4 GB limit, or one that vanished from its repository, is refused before downloading', async () => {
  const m = L.MODELS['qwen3-1.7b']
  const t = await installed({ model: 'qwen3-1.7b', extra: { [`/api/models/${m.repo}`]: { siblings: [{ rfilename: m.file, size: 5e9, lfs: { sha256: 'a'.repeat(64) } }] } } })
  try {
    await assert.rejects(t.llama.installModel('qwen3-1.7b'), /larger than the 4 GB limit/)
    await assert.rejects(t.llama.installModel('nope'), /Unknown model/)
    assert.equal(t.llama.status().installing, null)
  } finally {
    await t.srv.close()
  }
  const t2 = await installed({ vision: true, extra: { [`/api/models/${L.MODELS['ministral-3-3b'].repo}`]: { siblings: [] } } })
  try {
    await assert.rejects(t2.llama.installModel('ministral-3-3b'), /not in the model repository/)
  } finally {
    await t2.srv.close()
  }
})

test('load and eject: the server starts on 127.0.0.1 with the right options, answers, and stops; the picture add-on only with vision on', { skip: process.platform === 'win32' }, async () => {
  const t = await installed({ vision: true })
  try {
    await assert.rejects(t.llama.load(), /engine is not installed/)
    await t.llama.installRuntime()
    await assert.rejects(t.llama.load(), /model is not downloaded/)
    await t.llama.installModel('ministral-3-3b')
    const argsFile = path.join(tmp(), 'args.json')
    process.env.FAKE_ARGS_FILE = argsFile
    const states = []
    t.llama.onChange((s) => states.push(s.state))
    const [a, b] = await Promise.all([t.llama.load(), t.llama.load()])
    assert.equal(a.state, 'ready')
    assert.equal(b.state, 'ready', 'two callers share one load')
    assert.deepEqual(states.filter((s, i) => s !== states[i - 1]), ['loading', 'ready'])
    const args = JSON.parse(fs.readFileSync(argsFile, 'utf8'))
    assert.equal(args[args.indexOf('--host') + 1], '127.0.0.1')
    assert.deepEqual([args[args.indexOf('-c') + 1], args[args.indexOf('-ngl') + 1], args.includes('--jinja'), args.includes('--mmproj')], ['8192', '99', true, true])
    const r = await fetch(`http://127.0.0.1:${t.llama.status().port}/health`)
    assert.equal(r.ok, true)
    t.llama.eject()
    assert.equal(t.llama.status().state, 'unloaded')
    await new Promise((r2) => setTimeout(r2, 200))
    await assert.rejects(fetch(`http://127.0.0.1:${a.port}/health`, { signal: AbortSignal.timeout(500) }), 'the process is gone')
    t.settings.ai.vision = false
    t.settings.ai.gpu = 'cpu'
    t.settings.ai.context = 4096
    await t.llama.load()
    const args2 = JSON.parse(fs.readFileSync(argsFile, 'utf8'))
    assert.deepEqual([args2[args2.indexOf('-c') + 1], args2[args2.indexOf('-ngl') + 1], args2.includes('--mmproj')], ['4096', '0', false])
    t.llama.eject()
  } finally {
    delete process.env.FAKE_ARGS_FILE
    await t.srv.close()
  }
})

test('the AI runtime uses the local model: it starts it on the first question, streams the answer, and the idle timer ejects it', { skip: process.platform === 'win32' }, async (tctx) => {
  const t = await installed({ model: 'qwen3-1.7b' })
  try {
    await t.llama.installRuntime()
    await t.llama.installModel('qwen3-1.7b')
    const ai = createAi({ getSettings: () => t.settings, keys: { get: () => null }, local: t.llama })
    assert.equal(t.llama.status().state, 'unloaded')
    let text = ''
    for await (const ev of ai.chat({ messages: [{ role: 'user', content: 'hi' }], reasoning: 'off' })) if (ev.type === 'text') text += ev.delta
    assert.equal(text, 'local says hi')
    assert.equal(t.llama.status().state, 'ready', 'loaded by the question')
    assert.deepEqual((await ai.models()).map((m) => m.id), ['ministral-3-3b', 'qwen3-1.7b'])
    assert.equal((await ai.test()).ok, true)
    t.settings.ai.idleEject = 5
    tctx.mock.timers.enable({ apis: ['setTimeout'] })
    t.llama.touch()
    tctx.mock.timers.tick(5 * 60000 - 1)
    assert.equal(t.llama.status().state, 'ready')
    tctx.mock.timers.tick(2)
    assert.equal(t.llama.status().state, 'unloaded', 'ejected after 5 idle minutes')
    tctx.mock.timers.reset()
    const bare = createAi({ getSettings: () => t.settings, keys: { get: () => null } })
    await assert.rejects(bare.chat({ messages: [] }).next(), /not available in this app/)
  } finally {
    t.llama.eject()
    await t.srv.close()
  }
})
