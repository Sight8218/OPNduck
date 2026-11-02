const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const E = require('../electron/core/remote/envelope.cjs')
const { createEngineApi, bindAddresses, isTailnetIp } = require('../engine-api/server.cjs')
const T = require('../electron/core/remote/tailscale.cjs')

test('bind modes: off listens nowhere, localhost only loopback, lan is the only one that uses 0.0.0.0', () => {
  assert.deepEqual(bindAddresses('off'), [])
  assert.deepEqual(bindAddresses('localhost'), ['127.0.0.1'])
  assert.deepEqual(bindAddresses('lan'), ['0.0.0.0'])
  assert.throws(() => bindAddresses('everywhere'))
})

test('tailscale mode: loopback plus only the tailnet address, never 0.0.0.0, ignoring other interfaces', () => {
  const ifaces = {
    lo: [{ family: 'IPv4', address: '127.0.0.1' }],
    eth0: [{ family: 'IPv4', address: '192.168.1.5' }, { family: 'IPv4', address: '100.100.1.1' }],
    tailscale0: [{ family: 'IPv4', address: '100.109.225.70' }, { family: 'IPv6', address: 'fd7a::1' }],
  }
  assert.deepEqual(bindAddresses('tailscale', ifaces, null), ['127.0.0.1', '100.109.225.70'])
  assert.deepEqual(bindAddresses('tailscale', {}, '100.64.0.9'), ['127.0.0.1', '100.64.0.9'])
  assert.deepEqual(bindAddresses('tailscale', {}, '8.8.8.8'), ['127.0.0.1'], 'an address outside 100.64/10 is not trusted')
  assert.deepEqual(bindAddresses('tailscale', {}, null), ['127.0.0.1'])
  for (const ip of ['100.64.0.0', '100.127.255.255', '100.109.225.70']) assert.equal(isTailnetIp(ip), true, ip)
  for (const ip of ['100.63.0.1', '100.128.0.1', '10.0.0.1', '192.168.1.1', 'x']) assert.equal(isTailnetIp(ip), false, ip)
})

function fakeInbox() {
  const keys = E.deriveKeys(E.newSecret())
  const got = []
  return { got, keys: () => keys, receive: async (wire, channel) => (got.push({ wire, channel }), true) }
}

async function running() {
  const inbox = fakeInbox()
  const api = createEngineApi({ inbox, name: () => 'My PC' })
  const st = await api.start({ mode: 'localhost', port: 47900 })
  assert.equal(st.running, true)
  const call = (method, path, { headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: st.port, path, method, headers, agent: false }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
      })
      req.on('error', reject)
      req.end(body)
    })
  return { api, inbox, call, st }
}

test('health needs no token and says who it is', async () => {
  const { api, call } = await running()
  const r = await call('GET', '/v1/health')
  assert.equal(r.status, 200)
  assert.deepEqual(JSON.parse(r.body), { ok: true, name: 'My PC' })
  await api.stop()
})

test('send: the right token hands the body to the inbox as "direct"; a wrong or missing token does not', async () => {
  const { api, inbox, call } = await running()
  const token = `Bearer ${inbox.keys().authToken}`
  assert.equal((await call('POST', '/v1/send', { headers: { Authorization: token }, body: 'sealed-message' })).status, 202)
  assert.deepEqual(inbox.got, [{ wire: 'sealed-message', channel: 'direct' }])
  assert.equal((await call('POST', '/v1/send', { body: 'x' })).status, 401)
  assert.equal((await call('POST', '/v1/send', { headers: { Authorization: 'Bearer nope' }, body: 'x' })).status, 401)
  assert.equal((await call('POST', '/v1/send', { headers: { Authorization: token.replace('Bearer', 'Basic') }, body: 'x' })).status, 401)
  assert.equal(inbox.got.length, 1)
  await api.stop()
})

test('send: a body over 8 KB is refused, and nothing else is served', async () => {
  const { api, inbox, call } = await running()
  const auth = { Authorization: `Bearer ${inbox.keys().authToken}` }
  const big = await call('POST', '/v1/send', { headers: auth, body: 'a'.repeat(9000) }).catch((e) => ({ status: 'reset', e }))
  assert.ok(big.status === 413 || big.status === 'reset')
  assert.equal(inbox.got.length, 0)
  for (const [m, p] of [['GET', '/'], ['GET', '/v1/send'], ['POST', '/v1/health'], ['GET', '/etc/passwd'], ['GET', '/v1/files'], ['DELETE', '/v1/send'], ['GET', '/../../etc/passwd']]) {
    assert.equal((await call(m, p, { headers: auth })).status, 404, `${m} ${p}`)
  }
  await api.stop()
})

test('CORS: the project page and extensions are answered, any other site is not', async () => {
  const { api, call } = await running()
  const ok = await call('OPTIONS', '/v1/send', { headers: { Origin: 'https://sight8218.github.io' } })
  assert.equal(ok.status, 204)
  assert.equal(ok.headers['access-control-allow-origin'], 'https://sight8218.github.io')
  assert.match(ok.headers['access-control-allow-headers'], /Authorization/)
  assert.equal((await call('OPTIONS', '/v1/send', { headers: { Origin: `chrome-extension://${'a'.repeat(32)}` } })).status, 204)
  assert.equal((await call('OPTIONS', '/v1/send', { headers: { Origin: `moz-extension://${'1'.repeat(8)}-1111-1111-1111-${'1'.repeat(12)}` } })).status, 204)
  for (const origin of ['https://evil.example', 'https://sight8218.github.io.evil.example', 'http://sight8218.github.io', 'chrome-extension://short', 'null']) {
    assert.equal((await call('OPTIONS', '/v1/send', { headers: { Origin: origin } })).status, 403, origin)
    const h = await call('GET', '/v1/health', { headers: { Origin: origin } })
    assert.equal(h.headers['access-control-allow-origin'], undefined, origin)
  }
  await api.stop()
})

test('port fallback: a busy port moves to the next one; off closes the port', async () => {
  const blocker = http.createServer()
  await new Promise((r) => blocker.listen(47910, '127.0.0.1', r))
  const api = createEngineApi({ inbox: fakeInbox(), name: () => 'x' })
  const st = await api.start({ mode: 'localhost', port: 47910 })
  assert.equal(st.port, 47911)
  assert.equal((await api.start({ mode: 'off' })).running, false)
  await assert.rejects(new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: 47911, path: '/v1/health' }, resolve).on('error', reject)), /ECONNREFUSED/)
  await new Promise((r) => blocker.close(r))
})

test('a repeated message through the server is only the inbox\'s business (same answer every time)', async () => {
  const { api, inbox, call } = await running()
  const auth = { Authorization: `Bearer ${inbox.keys().authToken}` }
  const a = await call('POST', '/v1/send', { headers: auth, body: 'same' })
  const b = await call('POST', '/v1/send', { headers: auth, body: 'same' })
  assert.equal(a.body, b.body)
  await api.stop()
})

test('tailscale: status parsing, not installed, serve success, permission failure with the command to run', async () => {
  const json = { BackendState: 'Running', Self: { TailscaleIPs: ['100.109.225.70', 'fd7a::1'], DNSName: 'omarchy.tail1234.ts.net.' }, CertDomains: ['omarchy.tail1234.ts.net'], CurrentTailnet: { Name: 'me@example.com' } }
  assert.deepEqual(T.parseStatus(json), { installed: true, running: true, ip: '100.109.225.70', dnsName: 'omarchy.tail1234.ts.net', httpsAvailable: true, tailnet: 'me@example.com' })
  assert.equal(T.parseStatus({ BackendState: 'Stopped', Self: {} }).running, false)
  assert.equal((await T.status(async () => ({ ok: false, notFound: true, stdout: '', stderr: '' }))).installed, false)
  assert.equal((await T.status(async () => ({ ok: true, stdout: JSON.stringify(json), stderr: '' }))).ip, '100.109.225.70')
  const calls = []
  const ok = await T.serveOn(47821, 'omarchy.tail1234.ts.net', async (args) => (calls.push(args), { ok: true, stdout: '', stderr: '' }))
  assert.deepEqual(ok, { ok: true, url: 'https://omarchy.tail1234.ts.net:47822' })
  assert.deepEqual(calls[0], ['serve', '--bg', '--https=47822', 'http://127.0.0.1:47821'])
  const denied = await T.serveOn(47821, 'x.ts.net', async () => ({ ok: false, stdout: '', stderr: 'Access denied: serve config denied' }))
  assert.equal(denied.ok, false)
  assert.match(denied.error, /operator/)
  assert.equal(denied.command, 'tailscale serve --bg --https=47822 http://127.0.0.1:47821')
  assert.equal((await T.serveOn(47821, null, async () => ({ ok: true }))).ok, false)
  assert.equal((await T.serveOff(async () => ({ ok: true }))).ok, true)
})
