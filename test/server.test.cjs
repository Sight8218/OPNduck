const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createDevices } = require('../engine-api/devices.cjs')
const { buildEnginePairLink, parseEnginePairLink } = require('../engine-api/pairlink.cjs')
const { loadConfig, reachableUrls } = require('../server/config.cjs')
const { bindAddresses } = require('../engine-api/server.cjs')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'srv-'))

test('a second process can make pairing codes and revoke devices for a running server', () => {
  const dir = tmp()
  const files = { file: path.join(dir, 'devices.json'), codesFile: path.join(dir, 'codes.json') }
  const running = createDevices(files)
  const cli = createDevices(files) // the "opnduck-server pair" command: another process, same folder
  const code = cli.newPairCode()
  assert.ok(!fs.readFileSync(files.codesFile, 'utf8').includes(code), 'only a hash of the code is stored')
  assert.equal(fs.statSync(files.codesFile).mode & 0o777, 0o600)
  const paired = running.pair({ code, deviceName: 'Phone', deviceKind: 'phone' })
  assert.ok(paired)
  assert.equal(running.pair({ code, deviceName: 'Again' }), null, 'single use across processes')
  assert.equal(cli.list().length, 1, 'the command sees the device the server paired')
  assert.ok(running.authenticate(paired.deviceToken))
  assert.equal(cli.revoke(paired.deviceId), true)
  assert.equal(running.authenticate(paired.deviceToken), null, 'the running server notices the revoke')
})

test('engine pair links round trip, and links with a wrong scheme, address or code are refused', () => {
  const link = buildEnginePairLink({ baseUrl: 'http://100.64.0.9:47821', code: 'abcdefghijklmnopqrstuv', name: 'Home server' })
  assert.deepEqual(parseEnginePairLink(link), { baseUrl: 'http://100.64.0.9:47821', code: 'abcdefghijklmnopqrstuv', name: 'Home server' })
  for (const bad of ['https://example.com/?c=abcdefghijklmnopqrstuv', 'opnduck://send?url=https://x.y', 'opnduck://pair?u=javascript:alert(1)&c=abcdefghijklmnopqrstuv', 'opnduck://pair?u=http://a.b&c=short', 'nonsense', '']) {
    assert.equal(parseEnginePairLink(bad), null, bad)
  }
})

test('config: defaults, environment over file, and clear errors', () => {
  const dir = tmp()
  const c = loadConfig({ OPNDUCK_DATA: dir })
  assert.deepEqual([c.port, c.bind, c.retentionHours, c.maxUploadGB, c.relay], [47821, '127.0.0.1', 48, 8, false])
  assert.equal(c.output, path.join(dir, 'output'))
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ port: 5000, name: 'From file', retentionHours: 6 }))
  const d = loadConfig({ OPNDUCK_DATA: dir, OPNDUCK_PORT: '6000' })
  assert.deepEqual([d.port, d.name, d.retentionHours], [6000, 'From file', 6])
  assert.throws(() => loadConfig({ OPNDUCK_DATA: dir, OPNDUCK_BIND: 'everywhere' }), /IP address/)
  assert.throws(() => loadConfig({ OPNDUCK_DATA: dir, OPNDUCK_PORT: '99999' }), /not a number/)
  assert.throws(() => loadConfig({ OPNDUCK_DATA: dir, OPNDUCK_PUBLIC_URL: 'ftp://x' }), /PUBLIC_URL/)
})

test('addresses to put in a pair link: public URL first, then Tailscale, then LAN; loopback otherwise', () => {
  const ifaces = { lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], eth0: [{ family: 'IPv4', address: '192.168.1.5' }], tailscale0: [{ family: 'IPv4', address: '100.100.1.1' }] }
  assert.deepEqual(reachableUrls({ bind: '0.0.0.0', port: 47821, publicUrl: '' }, ifaces), ['http://100.100.1.1:47821', 'http://192.168.1.5:47821'])
  assert.deepEqual(reachableUrls({ bind: '0.0.0.0', port: 47821, publicUrl: 'https://s.example.com' }, ifaces), ['https://s.example.com'])
  assert.deepEqual(reachableUrls({ bind: '100.100.1.1', port: 1, publicUrl: '' }, ifaces), ['http://100.100.1.1:1'])
  assert.deepEqual(reachableUrls({ bind: '127.0.0.1', port: 2, publicUrl: '' }, ifaces), ['http://127.0.0.1:2'])
})

test('a server binds to the address it was told to, and only to a real IP address', () => {
  assert.deepEqual(bindAddresses('address', {}, null, '0.0.0.0'), ['0.0.0.0'])
  assert.deepEqual(bindAddresses('address', {}, null, '100.64.0.9'), ['100.64.0.9'])
  assert.throws(() => bindAddresses('address', {}, null, 'example.com'))
})
