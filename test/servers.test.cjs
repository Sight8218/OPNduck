const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { createServers, transportOf } = require('../electron/core/remote/servers.cjs')
const { createDevices } = require('../engine-api/devices.cjs')
const { createEngineApi } = require('../engine-api/server.cjs')
const { createV1 } = require('../engine-api/v1.cjs')
const { buildEnginePairLink } = require('../engine-api/pairlink.cjs')
const E = require('../electron/core/remote/envelope.cjs')

const seal = (t) => `sealed:${Buffer.from(t).toString('base64')}`
const unseal = (s) => Buffer.from(s.slice(7), 'base64').toString()

async function engine(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srvs-'))
  const devices = createDevices({ file: path.join(dir, 'd.json') })
  const platform = { on: () => () => {} }
  const v1 = createV1({ engine: { tasks: new Map(), startHandlers: new Map() }, platform, devices, name: () => 'Box', version: '1.2.3', info: () => ({ gpus: ['GPU'] }) })
  const api = createEngineApi({ inbox: { keys: () => E.deriveKeys(E.newSecret()), receive: async () => true }, name: () => 'Box', v1 })
  await api.start({ mode: 'localhost', port })
  return { api, devices, base: `http://127.0.0.1:${port}` }
}

test('transport: https and loopback are fine, a tailnet address is already encrypted, a LAN http address is flagged', () => {
  assert.equal(transportOf('https://s.example.com'), 'https')
  assert.equal(transportOf('http://127.0.0.1:1'), 'loopback')
  assert.equal(transportOf('http://100.100.1.1:1'), 'tailnet')
  assert.equal(transportOf('http://box.tail1234.ts.net:1'), 'tailnet')
  assert.equal(transportOf('http://192.168.1.5:47821'), 'lan-http')
})

test('adding a server pairs with it, seals the token, and shows what it can do; removing forgets it', async () => {
  const e = await engine(47960)
  try {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'srvs-')), 'servers.json')
    const s = createServers({ file, seal, unseal, deviceName: () => 'My PC' })
    await assert.rejects(s.add('nonsense'), /pair link/)
    await assert.rejects(s.add(buildEnginePairLink({ baseUrl: e.base, code: 'wrongwrongwrongwrong', name: 'Box' })), /wrong, used or older/)
    const added = await s.add(buildEnginePairLink({ baseUrl: e.base, code: e.devices.newPairCode(), name: 'Box' }))
    assert.deepEqual([added.name, added.transport], ['Box', 'loopback'])
    assert.equal(e.devices.list()[0].name, 'My PC')
    const raw = fs.readFileSync(file, 'utf8')
    assert.ok(raw.includes('sealed:') && !raw.includes(s.token(added.id)), 'the token is stored sealed')
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    await assert.rejects(s.add(buildEnginePairLink({ baseUrl: e.base, code: e.devices.newPairCode(), name: 'Box' })), /already added/)
    const st = await s.check(added.id)
    assert.deepEqual([st.online, st.mismatch, st.version, st.gpus], [true, false, '1.2.3', ['GPU']])
    s.setDefault('upscale_video', added.id)
    assert.equal(s.defaults().upscale_video, added.id)
    assert.throws(() => s.setDefault('bogus', 'local'))
    assert.throws(() => s.setDefault('convert', 'nope'))
    assert.equal(createServers({ file, seal, unseal }).list().length, 1, 'it persists')
    assert.equal(s.remove(added.id), true)
    assert.deepEqual(s.defaults(), {}, 'a default that pointed at it is dropped')
    assert.equal(s.remove(added.id), false)
  } finally {
    await e.api.stop()
  }
})

test('a server that is down, or revoked this computer, reads as offline with a reason', async () => {
  const e = await engine(47961)
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'srvs-')), 'servers.json')
  const s = createServers({ file, seal, unseal })
  const added = await s.add(buildEnginePairLink({ baseUrl: e.base, code: e.devices.newPairCode(), name: 'Box' }))
  e.devices.revoke(e.devices.list()[0].id)
  const revoked = await s.check(added.id)
  assert.equal(revoked.online, false)
  assert.match(revoked.error, /no longer accepts/)
  await e.api.stop()
  assert.match((await s.check(added.id)).error, /cannot be reached/)
  await assert.rejects(createServers({ file: path.join(os.tmpdir(), 'x-' + Date.now()), seal, unseal }).add(buildEnginePairLink({ baseUrl: 'http://127.0.0.1:1', code: 'abcdefghijklmnopqrst', name: 'x' })), /Cannot reach/)
})

test('a server speaking another API version is marked as a mismatch', async () => {
  const srv = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(req.url === '/v1/pair' ? JSON.stringify({ deviceToken: 't'.repeat(43), deviceId: 'x' }) : JSON.stringify({ apiVersion: 2, version: '9' }))
  })
  await new Promise((r) => srv.listen(47962, '127.0.0.1', r))
  try {
    const s = createServers({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'srvs-')), 's.json'), seal, unseal })
    const a = await s.add(buildEnginePairLink({ baseUrl: 'http://127.0.0.1:47962', code: 'abcdefghijklmnopqrst', name: 'New' }))
    const st = await s.check(a.id)
    assert.deepEqual([st.online, st.mismatch], [true, true])
  } finally {
    srv.closeAllConnections()
    srv.close()
  }
})
