const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const E = require('../electron/core/remote/envelope.cjs')
const { createEngineApi } = require('../engine-api/server.cjs')
const { createDevices } = require('../engine-api/devices.cjs')
const { createV1 } = require('../engine-api/v1.cjs')
const { createUploads, safeName } = require('../engine-api/uploads.cjs')
const crypto = require('node:crypto')
const { buildRemoteRequest } = require('../engine-api/remote_request.cjs')

let nextPort = 47930

function fakeEngine() {
  const tasks = new Map()
  const started = []
  const engine = {
    tasks,
    started,
    broadcastTasks: () => {},
    startHandlers: new Map([
      [
        'tasks:start',
        async (_e, req) => {
          const id = `t${tasks.size + 1}`
          tasks.set(id, { state: { id, kind: 'download', status: 'queued', progress: 0, label: req.url } })
          started.push(req)
          return id
        },
      ],
    ]),
    taskFile: (id) => tasks.get(id)?.finalPath ?? null,
    cancelTask: (id) => tasks.has(id),
    rerunTask: (id) => tasks.has(id),
    removeTasks: (ids) => ids.filter((i) => tasks.delete(i)).length,
  }
  return engine
}

async function running(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v1-'))
  const bus = new EventEmitter()
  const platform = { on: (ch, fn) => (bus.on(ch, fn), () => bus.off(ch, fn)), emit: (ch, p) => bus.emit(ch, p) }
  const engine = fakeEngine()
  const devices = createDevices({ file: path.join(dir, 'devices.json') })
  const uploads = opts.noUploads ? null : createUploads({ dir: path.join(dir, 'uploads'), maxBytes: opts.maxBytes ?? 1024 * 1024, freeBytes: () => opts.free ?? 1e12 })
  const v1 = createV1({ engine, platform, devices, uploads, name: () => 'My PC', version: '9.9.9', info: () => ({ gpus: ['Test GPU'] }), ...opts })
  const inbox = { keys: () => E.deriveKeys(E.newSecret()), receive: async () => true }
  const api = createEngineApi({ inbox, name: () => 'My PC', v1 })
  const st = await api.start({ mode: 'localhost', port: nextPort++ })
  const call = (method, p, { token, body, raw, extra = {} } = {}) =>
    new Promise((resolve, reject) => {
      const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra }
      const req = http.request({ host: '127.0.0.1', port: st.port, path: p, method, headers, agent: false }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try {
            json = JSON.parse(text)
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode, json, text, headers: res.headers, buf: Buffer.concat(chunks) })
        })
      })
      req.on('error', reject)
      req.end(raw ?? (body ? JSON.stringify(body) : undefined))
    })
  const pairNew = async (kind = 'phone') => (await call('POST', '/v1/pair', { body: { code: devices.newPairCode(), deviceName: 'Test', deviceKind: kind } })).json.deviceToken
  return { api, engine, devices, platform, call, pairNew, st, dir, uploads }
}

test('pairing: a code works once, a wrong or reused code does not, and only the token hash is stored', async () => {
  const h = await running()
  try {
    const code = h.devices.newPairCode()
    const ok = await h.call('POST', '/v1/pair', { body: { code, deviceName: 'Phone', deviceKind: 'phone' } })
    assert.equal(ok.status, 200)
    assert.ok(ok.json.deviceToken.length >= 40 && ok.json.deviceId)
    assert.equal((await h.call('POST', '/v1/pair', { body: { code, deviceName: 'again' } })).status, 403)
    assert.equal((await h.call('POST', '/v1/pair', { body: { code: 'nope' } })).status, 403)
    const stored = fs.readFileSync(path.join(h.dir, 'devices.json'), 'utf8')
    assert.ok(!stored.includes(ok.json.deviceToken), 'the token itself is never written to disk')
    assert.equal(fs.statSync(path.join(h.dir, 'devices.json')).mode & 0o777, 0o600)
  } finally {
    await h.api.stop()
  }
})

test('pairing codes expire after five minutes', () => {
  let t = 1000
  const d = createDevices({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'v1-')), 'd.json'), now: () => t })
  const code = d.newPairCode()
  t += 5 * 60 * 1000 + 1
  assert.equal(d.pair({ code, deviceName: 'x', deviceKind: 'phone' }), null)
})

test('every route but health and pair needs a device token; a revoked device stops working', async () => {
  const h = await running()
  try {
    for (const [m, p] of [['GET', '/v1/info'], ['GET', '/v1/tasks'], ['GET', '/v1/events'], ['POST', '/v1/tasks'], ['GET', '/v1/devices']]) {
      assert.equal((await h.call(m, p)).status, 401, `${m} ${p}`)
      assert.equal((await h.call(m, p, { token: 'x'.repeat(43) })).status, 401, `${m} ${p} wrong token`)
    }
    const token = await h.pairNew('desktop')
    assert.equal((await h.call('GET', '/v1/info', { token })).status, 200)
    const id = h.devices.list()[0].id
    h.devices.revoke(id)
    assert.equal((await h.call('GET', '/v1/info', { token })).status, 401)
  } finally {
    await h.api.stop()
  }
})

test('info says what the engine can do', async () => {
  const h = await running()
  try {
    const token = await h.pairNew()
    const r = (await h.call('GET', '/v1/info', { token })).json
    assert.deepEqual([r.name, r.version, r.apiVersion, r.gpus, r.uploads], ['My PC', '9.9.9', 1, ['Test GPU'], true])
    assert.ok(r.kinds.includes('download') && r.kinds.includes('convert'))
    assert.equal((await h.call('GET', '/v1/health')).json.apiVersion, 1)
  } finally {
    await h.api.stop()
  }
})

test('starting a job: only a cleaned download request reaches the engine, and it is marked remote', async () => {
  const h = await running()
  try {
    const token = await h.pairNew()
    const r = await h.call('POST', '/v1/tasks', { token, body: { kind: 'download', req: { url: 'https://example.com/v?1', format: 'MP4', videoQuality: '720', playlist: 'all', bogus: 1 } } })
    assert.equal(r.status, 202)
    assert.deepEqual(h.engine.started[0], { url: 'https://example.com/v?1', format: 'MP4', videoQuality: '720', playlist: 'single' })
    assert.equal(h.engine.tasks.get(r.json.id).state.source, 'remote')
    const list = (await h.call('GET', '/v1/tasks', { token })).json.tasks
    assert.deepEqual([list.length, list[0].host], [1, 'My PC'])
    assert.equal((await h.call('POST', `/v1/tasks/${r.json.id}/cancel`, { token })).json.ok, true)
    assert.equal((await h.call('POST', `/v1/tasks/${r.json.id}/rerun`, { token })).json.ok, true)
    assert.equal((await h.call('DELETE', `/v1/tasks/${r.json.id}`, { token })).json.removed, 1)
  } finally {
    await h.api.stop()
  }
})

test('remote requests never carry paths, destinations or cookie settings', () => {
  const bad = [
    { url: 'file:///etc/passwd' },
    { url: 'ftp://x/y' },
    { url: 'https://x/y', destination: '/tmp' },
    { url: 'https://x/y', cookies: 'chrome' },
    { url: 'https://x/y', cookieMode: 'file' },
    { url: 'https://x/y', format: '/etc/passwd' },
    { url: 'https://x/y', format: '../../x' },
    { url: 'https://x/y', format: 'C:\\Windows' },
    { url: 'x'.repeat(2100) },
    {},
  ]
  for (const req of bad) assert.throws(() => buildRemoteRequest('download', req), undefined, JSON.stringify(req).slice(0, 60))
  assert.throws(() => buildRemoteRequest('convert', { inputPath: '/x', container: 'MP4' }), /uploadId is required|inputPath cannot|file paths/)
  assert.throws(() => buildRemoteRequest('convert', { uploadId: 'a'.repeat(32), container: 'MP4' }), /not finished or does not exist/)
  assert.throws(() => buildRemoteRequest('convert', { uploadId: 'a'.repeat(32), container: 'MP4', destination: '/tmp' }, () => '/up/x.mp4'), /destination/)
  assert.throws(() => buildRemoteRequest('rm_rf', {}), /Unknown job kind/)
  assert.deepEqual(buildRemoteRequest('convert', { uploadId: 'a'.repeat(32), container: 'MP4' }, () => '/up/x.mp4').req.inputPath, '/up/x.mp4')
  assert.throws(() => buildRemoteRequest('download', null))
})

test('device management is for desktop devices only', async () => {
  const h = await running()
  try {
    const phone = await h.pairNew('phone')
    const desktop = await h.pairNew('desktop')
    assert.equal((await h.call('GET', '/v1/devices', { token: phone })).status, 403)
    const list = (await h.call('GET', '/v1/devices', { token: desktop })).json.devices
    assert.equal(list.length, 2)
    assert.ok(!JSON.stringify(list).includes('tokenHash'))
    const phoneId = list.find((d) => d.kind === 'phone').id
    assert.equal((await h.call('DELETE', `/v1/devices/${phoneId}`, { token: desktop })).json.removed, true)
    assert.equal((await h.call('GET', '/v1/info', { token: phone })).status, 401)
  } finally {
    await h.api.stop()
  }
})

test('rate limits: repeated pairing attempts and repeated bad tokens get a 429', async () => {
  const h = await running()
  try {
    let last = 0
    for (let i = 0; i < 12; i++) last = (await h.call('POST', '/v1/pair', { body: { code: `wrong${i}` } })).status
    assert.equal(last, 429)
  } finally {
    await h.api.stop()
  }
  const h2 = await running()
  try {
    let status = 0
    for (let i = 0; i < 25; i++) status = (await h2.call('GET', '/v1/tasks', { token: 'y'.repeat(43) })).status
    assert.equal(status, 429)
  } finally {
    await h2.api.stop()
  }
})

test('an oversized or non-JSON body is refused', async () => {
  const h = await running()
  try {
    const token = await h.pairNew()
    const big = await h.call('POST', '/v1/tasks', { token, body: { kind: 'download', req: { url: 'https://x.y/' + 'a'.repeat(20000) } } })
    assert.equal(big.status, 413)
  } finally {
    await h.api.stop()
  }
})

test('events: a snapshot first, then updates at most four times a second, and the listener goes away with the last client', async () => {
  const h = await running()
  try {
    const token = await h.pairNew()
    const got = []
    const req = http.get({ host: '127.0.0.1', port: h.st.port, path: '/v1/events', headers: { Authorization: `Bearer ${token}` }, agent: false }, (res) => {
      assert.equal(res.headers['content-type'], 'text/event-stream')
      res.on('data', (c) => got.push(c.toString()))
    })
    await new Promise((r) => setTimeout(r, 150))
    assert.match(got.join(''), /^event: tasks\ndata: \[\]/)
    for (let i = 1; i <= 20; i++) h.platform.emit('tasks:update', { full: false, tasks: [{ id: 'a', status: 'running', progress: i / 20 }] })
    await new Promise((r) => setTimeout(r, 500))
    const updates = got.join('').split('\n\n').filter((b) => b.startsWith('event: task\n'))
    assert.equal(updates.length, 1, 'twenty progress ticks in a burst become one message')
    assert.match(updates[0], /"progress":1/)
    assert.match(updates[0], /"host":"My PC"/)
    req.destroy()
    await new Promise((r) => setTimeout(r, 100))
  } finally {
    await h.api.stop()
  }
})

const put = (h, token, id, buf, start, total) => h.call('PUT', `/v1/uploads/${id}`, { token, raw: buf, extra: { 'Content-Range': `bytes ${start}-${start + buf.length - 1}/${total}` } })

test('uploads: chunks append in order, a wrong offset is told where to resume, and the finished file starts a job', async () => {
  const h = await running()
  try {
    const token = await h.pairNew()
    const data = crypto.randomBytes(1000)
    const sha = crypto.createHash('sha256').update(data).digest('hex')
    const made = await h.call('POST', '/v1/uploads', { token, body: { name: '../../etc/My Clip.mp4', size: 1000, sha256: sha } })
    assert.equal(made.status, 201)
    const id = made.json.uploadId
    assert.equal((await put(h, token, id, data.subarray(0, 400), 0, 1000)).json.offset, 400)
    const head = await h.call('HEAD', `/v1/uploads/${id}`, { token })
    assert.equal(head.headers['upload-offset'], '400')
    const gap = await put(h, token, id, data.subarray(600), 600, 1000)
    assert.deepEqual([gap.status, gap.json.offset], [409, 400])
    const done = await put(h, token, id, data.subarray(400), 400, 1000)
    assert.deepEqual([done.status, done.json.complete], [200, true])
    const file = h.uploads.resolve(id, h.devices.list()[0].id)
    assert.equal(path.basename(file), 'My Clip.mp4', 'the name is cleaned: no folders')
    assert.ok(file.startsWith(path.join(h.dir, 'uploads')))
    assert.deepEqual(fs.readFileSync(file), data)
    const job = await h.call('POST', '/v1/tasks', { token, body: { kind: 'convert', req: { uploadId: id, container: 'MP4' } } })
    assert.equal(job.status, 501, 'the fake engine has no convert handler, so the request got past validation')
  } finally {
    await h.api.stop()
  }
})

test('uploads: a damaged file, a too-big file, a full disk, another device and a no-uploads engine are all refused', async () => {
  const h = await running({ maxBytes: 2000 })
  try {
    const token = await h.pairNew()
    const other = await h.pairNew()
    const bad = await h.call('POST', '/v1/uploads', { token, body: { name: 'a.bin', size: 10, sha256: 'a'.repeat(64) } })
    const r = await put(h, token, bad.json.uploadId, Buffer.alloc(10), 0, 10)
    assert.equal(r.status, 422)
    assert.equal((await h.call('POST', '/v1/uploads', { token, body: { name: 'big.bin', size: 5000 } })).status, 413)
    assert.equal((await h.call('POST', '/v1/uploads', { token, body: { name: 'x', size: 0 } })).status, 400)
    const mine = await h.call('POST', '/v1/uploads', { token, body: { name: 'm.bin', size: 10 } })
    assert.equal((await put(h, other, mine.json.uploadId, Buffer.alloc(10), 0, 10)).status, 404, 'someone else cannot write to it')
    assert.equal((await put(h, token, mine.json.uploadId, Buffer.alloc(10), 0, 99)).status, 400, 'a range that does not match the size')
  } finally {
    await h.api.stop()
  }
  const full = await running({ free: 1000 })
  try {
    const token = await full.pairNew()
    assert.equal((await full.call('POST', '/v1/uploads', { token, body: { name: 'x.bin', size: 500 } })).status, 507)
  } finally {
    await full.api.stop()
  }
  const none = await running({ noUploads: true })
  try {
    const token = await none.pairNew()
    assert.equal((await none.call('POST', '/v1/uploads', { token, body: { name: 'x.bin', size: 5 } })).status, 501)
    assert.ok(!(await none.call('GET', '/v1/info', { token })).json.kinds.includes('convert'))
  } finally {
    await none.api.stop()
  }
})

test('upload names are made safe and old uploads are swept', () => {
  assert.equal(safeName('../../a/b\\c.txt'), 'c.txt')
  assert.equal(safeName('.bashrc'), 'bashrc')
  assert.equal(safeName(''), 'upload')
  assert.ok(safeName('x'.repeat(500) + '.mp4').length <= 120 && safeName('x'.repeat(500) + '.mp4').endsWith('.mp4'))
  let t = 0
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'up-'))
  const u = createUploads({ dir, retentionMs: 1000, freeBytes: () => 1e12, now: () => t })
  const { uploadId } = u.create({ name: 'a.bin', size: 5 }, 'dev')
  t = 2000
  u.sweep()
  assert.deepEqual(fs.readdirSync(dir), [])
  assert.throws(() => u.status(uploadId, 'dev'), /No such upload/)
})

test('files: the finished result streams, resumes with Range, and a signed link works without a header until it expires', async () => {
  let t = 1_000_000
  const h = await running({ now: () => t })
  try {
    const token = await h.pairNew()
    const file = path.join(h.dir, 'résumé "x".mp4')
    const data = crypto.randomBytes(500)
    fs.writeFileSync(file, data)
    h.engine.tasks.set('j1', { state: { id: 'j1', status: 'done' }, finalPath: file })
    h.engine.tasks.set('j2', { state: { id: 'j2', status: 'running' }, finalPath: file })
    assert.equal((await h.call('GET', '/v1/files/j1')).status, 401)
    const all = await h.call('GET', '/v1/files/j1', { token })
    assert.deepEqual([all.status, all.headers['content-length']], [200, '500'])
    assert.match(all.headers['content-disposition'], /^attachment; filename="r_sum_ _x_\.mp4"; filename\*=UTF-8''r%C3%A9sum%C3%A9%20%22x%22\.mp4$/)
    assert.deepEqual(all.buf, data)
    const part = await h.call('GET', '/v1/files/j1', { token, extra: { Range: 'bytes=100-199' } })
    assert.deepEqual([part.status, part.headers['content-range']], [206, 'bytes 100-199/500'])
    assert.deepEqual(part.buf, data.subarray(100, 200))
    assert.deepEqual((await h.call('GET', '/v1/files/j1', { token, extra: { Range: 'bytes=-50' } })).buf, data.subarray(450))
    assert.deepEqual((await h.call('GET', '/v1/files/j1', { token, extra: { Range: 'bytes=400-' } })).buf, data.subarray(400))
    assert.equal((await h.call('GET', '/v1/files/j1', { token, extra: { Range: 'bytes=900-' } })).status, 416)
    assert.equal((await h.call('GET', '/v1/files/j2', { token })).status, 404, 'a job that is not done has no file')
    assert.equal((await h.call('GET', '/v1/files/nope', { token })).status, 404)
    const link = (await h.call('POST', '/v1/files/j1/link', { token })).json
    assert.deepEqual((await h.call('GET', link.url)).buf, data)
    assert.equal((await h.call('GET', link.url.replace('j1', 'j2'))).status, 403, 'a link is only good for its own file')
    assert.equal((await h.call('GET', link.url.slice(0, -3) + 'abc')).status, 403)
    t += 11 * 60 * 1000
    assert.equal((await h.call('GET', link.url)).status, 403, 'expired')
  } finally {
    await h.api.stop()
  }
})
