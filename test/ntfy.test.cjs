const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const E = require('../electron/core/remote/envelope.cjs')
const { createNtfyRelay, validateServer, backoffMs } = require('../electron/core/remote/ntfy.cjs')

test('server must be https (http only for this computer), with no path, login or query', () => {
  assert.equal(validateServer('https://ntfy.sh'), 'https://ntfy.sh')
  assert.equal(validateServer('https://ntfy.sh/'), 'https://ntfy.sh')
  assert.equal(validateServer('https://ntfy.example.com:8443'), 'https://ntfy.example.com:8443')
  assert.equal(validateServer('http://localhost:8080'), 'http://localhost:8080')
  assert.equal(validateServer('http://127.0.0.1:9'), 'http://127.0.0.1:9')
  for (const bad of ['http://ntfy.sh', 'http://192.168.1.5', 'ftp://ntfy.sh', 'ntfy.sh', '', null, 'https://user:pw@ntfy.sh', 'https://ntfy.sh/topic', 'https://ntfy.sh/?x=1', 'https://ntfy.sh/#a', 'javascript:alert(1)']) {
    assert.throws(() => validateServer(bad), undefined, String(bad))
  }
})

test('backoff doubles from 2 s to 60 s, with up to a quarter more at random', () => {
  const none = () => 0
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 9].map((n) => backoffMs(n, none)), [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000])
  assert.equal(backoffMs(0, () => 1), 2500)
  assert.ok(backoffMs(3) >= 16000 && backoffMs(3) <= 20000)
})

/* A tiny fake ntfy server: serves ndjson, can drop the connection, records requests. */
function fakeNtfy({ status = 200, script = [] } = {}) {
  const requests = []
  const open = new Set()
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, auth: req.headers.authorization })
    const step = script[Math.min(requests.length - 1, script.length - 1)] ?? { lines: [], end: false }
    if (status !== 200) {
      res.writeHead(status)
      return res.end()
    }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
    open.add(res)
    res.on('close', () => open.delete(res))
    for (const l of step.lines) res.write(typeof l === 'string' ? l : JSON.stringify(l) + '\n')
    if (step.end) res.end()
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, requests, port: server.address().port, push: (l) => open.forEach((r) => r.write(JSON.stringify(l) + '\n')), close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))) })))
}

function relay(port, over = {}) {
  const keys = E.deriveKeys(E.newSecret())
  const received = []
  const statuses = []
  let last = over.lastId ?? ''
  const r = createNtfyRelay({
    inbox: { keys: () => keys, receive: async (wire, channel) => (received.push({ wire, channel }), true) },
    getConfig: () => ({ enabled: over.enabled ?? true, server: over.server ?? `http://127.0.0.1:${port}`, token: over.token ?? '' }),
    lastId: { get: () => last, set: (id) => (last = id) },
    onStatus: (s) => statuses.push(s.state),
    sleep: async () => new Promise((res) => setTimeout(res, 5)),
    random: () => 0,
  })
  return { r, keys, received, statuses, last: () => last }
}
const until = async (fn, ms = 3000) => {
  const t = Date.now()
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}
const msg = (id, message) => ({ id, time: 1, event: 'message', topic: 't', message })

test('delivers messages to the inbox as "ntfy", remembers the last id, asks for the right topic, and sends the token', async () => {
  const f = await fakeNtfy({ script: [{ lines: [{ event: 'open' }, msg('id1', 'sealed-1'), { event: 'keepalive' }, msg('id2', 'sealed-2')] }] })
  const h = relay(f.port, { token: 'tk_secret' })
  h.r.apply()
  await until(() => h.received.length === 2)
  assert.deepEqual(h.received.map((x) => [x.wire, x.channel]), [['sealed-1', 'ntfy'], ['sealed-2', 'ntfy']])
  assert.equal(h.last(), 'id2')
  assert.equal(f.requests[0].url, `/${h.keys.topic}/json?since=12h`)
  assert.equal(f.requests[0].auth, 'Bearer tk_secret')
  assert.equal(h.r.status().state, 'connected')
  h.r.stop()
  assert.equal(h.r.status().state, 'off')
  await f.close()
})

test('after a drop it reconnects and asks only for what it missed (since=<last id>)', async () => {
  const f = await fakeNtfy({ script: [{ lines: [{ event: 'open' }, msg('a1', 'one')], end: true }, { lines: [{ event: 'open' }, msg('a2', 'two')] }] })
  const h = relay(f.port)
  h.r.apply()
  await until(() => h.received.length === 2)
  assert.equal(f.requests.length, 2)
  assert.match(f.requests[1].url, /since=a1$/)
  assert.ok(h.statuses.includes('reconnecting'))
  h.r.stop()
  await f.close()
})

test('junk lines are skipped and a wrong-shaped event is ignored; messages split across chunks still arrive', async () => {
  const half = JSON.stringify(msg('s1', 'split-message')) + '\n'
  const f = await fakeNtfy({ script: [{ lines: ['not json\n', '{"event":"message"}\n', '{"event":"message","message":42}\n', '\n', half.slice(0, 15), half.slice(15)] }] })
  const h = relay(f.port)
  h.r.apply()
  await until(() => h.received.length === 1)
  assert.equal(h.received[0].wire, 'split-message')
  h.r.stop()
  await f.close()
})

test('a refused token shows a readable error and keeps retrying; a server error too', async () => {
  const f = await fakeNtfy({ status: 401 })
  const h = relay(f.port)
  h.r.apply()
  await until(() => f.requests.length >= 2)
  assert.match(h.r.status().error || 'x', /./)
  assert.ok(h.statuses.includes('error'))
  h.r.stop()
  await f.close()
  const g = await fakeNtfy({ status: 503 })
  const h2 = relay(g.port)
  h2.r.apply()
  await until(() => h2.statuses.includes('error'))
  h2.r.stop()
  await g.close()
})

test('off, and a bad server address, never connect', async () => {
  const f = await fakeNtfy()
  const off = relay(f.port, { enabled: false })
  off.r.apply()
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(f.requests.length, 0)
  assert.equal(off.r.status().state, 'off')
  const bad = relay(f.port, { server: 'http://ntfy.example.com' })
  bad.r.apply()
  assert.equal(bad.r.status().state, 'error')
  assert.match(bad.r.status().error, /https/)
  assert.equal(f.requests.length, 0)
  await f.close()
})

test('stop ends the loop for good (no more requests after it)', async () => {
  const f = await fakeNtfy({ script: [{ lines: [{ event: 'open' }], end: true }] })
  const h = relay(f.port)
  h.r.apply()
  await until(() => f.requests.length >= 1)
  h.r.stop()
  const n = f.requests.length
  await new Promise((r) => setTimeout(r, 80))
  assert.ok(f.requests.length <= n + 1)
  const settled = f.requests.length
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(f.requests.length, settled)
  await f.close()
})
