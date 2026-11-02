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
  const v1 = createV1({ engine, platform, devices, name: () => 'My PC', version: '9.9.9', info: () => ({ gpus: ['Test GPU'] }), ...opts })
  const inbox = { keys: () => E.deriveKeys(E.newSecret()), receive: async () => true }
  const api = createEngineApi({ inbox, name: () => 'My PC', v1 })
  const st = await api.start({ mode: 'localhost', port: nextPort++ })
  const call = (method, p, { token, body } = {}) =>
    new Promise((resolve, reject) => {
      const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }
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
          resolve({ status: res.statusCode, json, text })
        })
      })
      req.on('error', reject)
      req.end(body ? JSON.stringify(body) : undefined)
    })
  const pairNew = async (kind = 'phone') => (await call('POST', '/v1/pair', { body: { code: devices.newPairCode(), deviceName: 'Test', deviceKind: kind } })).json.deviceToken
  return { api, engine, devices, platform, call, pairNew, st, dir }
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
    assert.deepEqual([r.name, r.version, r.apiVersion, r.kinds, r.gpus], ['My PC', '9.9.9', 1, ['download'], ['Test GPU']])
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
  assert.throws(() => buildRemoteRequest('convert', { inputPath: '/x' }), /Unknown job kind/)
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
