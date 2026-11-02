const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const E = require('../electron/core/remote/envelope.cjs')
const { createRemoteInbox } = require('../electron/core/remote/inbox.cjs')
const vector = require('./vectors/envelope.json')

test('the committed test vector decrypts and re-derives identically (this pins the format for the phone page and extension)', () => {
  const keys = E.deriveKeys(Buffer.from(vector.secretHex, 'hex'))
  assert.equal(keys.topic, vector.topic)
  assert.equal(keys.encKey.toString('hex'), vector.encKeyHex)
  assert.equal(keys.authToken, vector.authToken)
  assert.deepEqual(E.open(vector.wire, keys.encKey), vector.envelope)
  assert.equal(E.seal(vector.envelope, keys.encKey, Buffer.from(vector.ivHex, 'hex')), vector.wire)
})

test('derived values: topic has the right shape, token is 43 base64url characters, secrets differ', () => {
  const a = E.deriveKeys(E.newSecret())
  const b = E.deriveKeys(E.newSecret())
  assert.match(a.topic, /^opnduck_[0-9a-f]{32}$/)
  assert.match(a.authToken, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(a.topic, b.topic)
  assert.throws(() => E.deriveKeys(Buffer.alloc(16)), /32 bytes/)
})

test('open returns null for junk, a wrong key, tampering and truncation, and never throws', () => {
  const keys = E.deriveKeys(Buffer.from(vector.secretHex, 'hex'))
  const other = E.deriveKeys(E.newSecret())
  assert.equal(E.open(vector.wire, other.encKey), null)
  const flipped = Buffer.from(vector.wire, 'base64url')
  flipped[20] ^= 1
  assert.equal(E.open(flipped.toString('base64url'), keys.encKey), null)
  for (const bad of ['', 'abc', '!!!', null, undefined, 42, {}, 'a'.repeat(9000), vector.wire.slice(0, 30)]) assert.equal(E.open(bad, keys.encKey), null)
})

test('a pair link round-trips and the secret stays in the fragment', () => {
  const secret = E.newSecret()
  const link = E.buildPairLink({ secret, relay: 'https://ntfy.sh', direct: 'https://pc.tail.ts.net:47822', name: 'My PC' })
  assert.ok(link.startsWith('https://sight8218.github.io/OPNduck/send/#p='))
  assert.equal(link.split('#')[0].includes(secret.toString('base64url')), false)
  const back = E.parsePairLink(link)
  assert.deepEqual([back.secret.equals(secret), back.relay, back.direct, back.name], [true, 'https://ntfy.sh', 'https://pc.tail.ts.net:47822', 'My PC'])
  assert.ok(E.parsePairLink(link.split('#p=')[1]), 'the part after #p= works too')
  for (const bad of ['', 'nope', 'https://x/#p=e30', null]) assert.equal(E.parsePairLink(bad), null)
})

/* ------------------------------------------------------------------ inbox */

function inbox(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-remote-'))
  const file = path.join(dir, 'remote.json')
  let t = 1_760_000_000_000
  const settings = { remoteEnabled: true, remoteMode: 'ask', remoteFormat: 'MP4', remoteVideoQuality: 'best', remoteAudioQuality: 'best', ...over.settings }
  const log = { started: [], notes: [], changes: 0, recipes: [] }
  const ib = createRemoteInbox({
    file,
    startDownload: async (req, via) => (log.started.push({ req, via }), 'task1'),
    notify: (n) => log.notes.push(n),
    onChange: () => log.changes++,
    getSettings: () => settings,
    getRecipe: (id) => (id === 'good' ? { input: 'url' } : id === 'video-only' ? { input: 'video' } : null),
    runRecipe: async (id, url) => log.recipes.push({ id, url }),
    now: () => t,
  })
  const keys = ib.keys()
  const send = (over2 = {}, channel = 'direct') => ib.receive(E.seal({ v: 1, id: crypto.randomUUID(), ts: t, url: 'https://example.com/watch?v=1', target: 'download', from: 'Phone', ...over2 }, keys.encKey), channel)
  return { ib, log, send, settings, file, advance: (ms) => (t += ms), now: () => t }
}

test('ask mode: a good message waits in the list, notifies once, and starts nothing', async () => {
  const h = inbox()
  assert.equal(await h.send(), true)
  assert.equal(h.log.started.length, 0)
  assert.equal(h.ib.list().length, 1)
  assert.deepEqual([h.ib.list()[0].from, h.ib.list()[0].channel, h.ib.list()[0].url], ['Phone', 'direct', 'https://example.com/watch?v=1'])
  assert.equal(h.log.notes.length, 1)
  assert.match(h.log.notes[0].body, /example\.com/)
})

test('accepting starts a download built only from the link and the local defaults', async () => {
  const h = inbox({ settings: { remoteFormat: 'MP3', remoteAudioQuality: '192k' } })
  await h.send({ url: 'https://example.com/a', destination: '/etc', format: 'FLAC', args: ['--exec', 'rm -rf'], videoQuality: '144', cookies: 'x' })
  await h.ib.accept(h.ib.list()[0].id)
  assert.deepEqual(h.log.started[0].req, { url: 'https://example.com/a', format: 'MP3', audioQuality: '192k', playlist: 'single', embedMeta: true })
  assert.equal(h.log.started[0].via, 'direct')
  assert.equal(h.ib.list().length, 0)
})

test('video defaults use videoQuality, and auto mode starts straight away without waiting', async () => {
  const h = inbox({ settings: { remoteMode: 'auto', remoteVideoQuality: '1080' } })
  assert.equal(await h.send(), true)
  assert.deepEqual(h.log.started[0].req, { url: 'https://example.com/watch?v=1', format: 'MP4', videoQuality: '1080', playlist: 'single', embedMeta: true })
  assert.equal(h.ib.list().length, 0)
})

test('an opnduck:// link always waits for a click, even in auto mode', async () => {
  const h = inbox({ settings: { remoteMode: 'auto' } })
  assert.equal(h.ib.addLink('https://example.com/x', 'opnduck'), true)
  assert.equal(h.log.started.length, 0)
  assert.equal(h.ib.list().length, 1)
  assert.equal(h.ib.addLink('https://example.com/x', 'opnduck'), false, 'the same link twice is one entry')
})

test('everything is refused while Send to OPNduck is off', async () => {
  const h = inbox({ settings: { remoteEnabled: false } })
  assert.equal(await h.send(), false)
  assert.equal(h.ib.addLink('https://example.com/x'), false)
  assert.equal(h.ib.list().length, 0)
})

test('dropped silently: junk, another pairing, wrong version, old, future and replayed messages', async () => {
  const h = inbox()
  assert.equal(await h.ib.receive('not a message', 'ntfy'), false)
  assert.equal(await h.ib.receive(E.seal({ v: 1, id: 'abcdefgh', ts: h.now(), url: 'https://a.com' }, E.deriveKeys(E.newSecret()).encKey), 'ntfy'), false)
  assert.equal(await h.send({ v: 2 }), false)
  assert.equal(await h.send({ ts: h.now() - 25 * 3600 * 1000 }), false)
  assert.equal(await h.send({ ts: h.now() + 6 * 60 * 1000 }), false)
  assert.equal(await h.send({ ts: h.now() - 3600 * 1000 }), true, 'one hour old is fine (relay catch-up)')
  const id = 'replay-me-1234'
  assert.equal(await h.send({ id, url: 'https://example.com/r1' }), true)
  assert.equal(await h.send({ id, url: 'https://example.com/r2' }), false, 'the same id on a second path is ignored')
  assert.equal(await h.send({ id: 'x' }), false, 'a too-short id')
  assert.equal(await h.send({ ts: 'now' }), false)
})

test('only http(s) links of a sane length are accepted', async () => {
  const h = inbox()
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.com/a', 'data:text/html,hi', 'not a url', '', 'https://' + 'a'.repeat(2050) + '.com', 42, null, 'https://']) {
    assert.equal(await h.send({ url }), false, String(url).slice(0, 30))
  }
  assert.equal(h.ib.list().length, 0)
  assert.equal(h.ib.addLink('javascript:alert(1)'), false)
  assert.equal(h.ib.addLink('file:///etc/passwd'), false)
})

test('targets: download, or a recipe that exists and starts from a link; nothing else', async () => {
  const h = inbox()
  assert.equal(await h.send({ target: 'recipe:good', url: 'https://example.com/1' }), true)
  assert.equal(await h.send({ target: 'recipe:missing', url: 'https://example.com/2' }), false)
  assert.equal(await h.send({ target: 'recipe:video-only', url: 'https://example.com/3' }), false, 'a recipe that does not start from a link')
  for (const target of ['shell', 'recipe:', 'recipe:../x', 'delete', 5]) assert.equal(await h.send({ target, url: 'https://example.com/4' }), false)
  await h.ib.accept(h.ib.list()[0].id)
  assert.deepEqual(h.log.recipes, [{ id: 'good', url: 'https://example.com/1' }])
  assert.equal(h.log.started.length, 0)
})

test('rate limit: 30 messages a minute, then room again', async () => {
  const h = inbox({ settings: { remoteMode: 'auto' } })
  let ok = 0
  for (let i = 0; i < 40; i++) if (await h.send({ url: `https://example.com/${i}` })) ok++
  assert.equal(ok, 30)
  h.advance(61000)
  assert.equal(await h.send({ url: 'https://example.com/again' }), true)
})

test('dismiss removes a waiting link; accepting a link that is gone fails; a failed start keeps the link', async () => {
  const h = inbox()
  await h.send()
  const id = h.ib.list()[0].id
  assert.equal(h.ib.dismiss(id), true)
  assert.equal(h.ib.dismiss(id), false)
  await assert.rejects(h.ib.accept(id), /no longer waiting/)
  const failing = inbox()
  failing.log.started.push = () => {}
  const f2 = createRemoteInbox({ file: failing.file, startDownload: async () => { throw new Error('boom') }, notify() {}, onChange() {}, getSettings: () => failing.settings, now: failing.now })
  await f2.receive(E.seal({ v: 1, id: 'abcdefgh1', ts: failing.now(), url: 'https://example.com/z' }, f2.keys().encKey), 'ntfy')
  await assert.rejects(f2.accept(f2.list()[0].id), /boom/)
  assert.equal(f2.list().length, 1)
})

test('the file is private (0600), survives a restart, and reset rotates every key', async () => {
  const h = inbox()
  await h.send()
  assert.equal(fs.statSync(h.file).mode & 0o777, 0o600)
  const before = h.ib.keys()
  const again = createRemoteInbox({ file: h.file, startDownload: async () => 't', notify() {}, onChange() {}, getSettings: () => h.settings })
  assert.equal(again.list().length, 1, 'waiting links survive a restart')
  assert.equal(again.keys().topic, before.topic)
  assert.equal(await again.receive(E.seal({ v: 1, id: 'abcdefgh2', ts: Date.now(), url: 'https://example.com/n' }, before.encKey), 'direct'), true)
  again.resetPairing()
  const after = again.keys()
  assert.notEqual(after.topic, before.topic)
  assert.notEqual(after.authToken, before.authToken)
  assert.equal(await again.receive(E.seal({ v: 1, id: 'abcdefgh3', ts: Date.now(), url: 'https://example.com/o' }, before.encKey), 'direct'), false, 'old pairings stop working')
})

test('a hand-damaged file is ignored, and the pending list is capped', async () => {
  const h = inbox()
  fs.writeFileSync(h.file, '{not json')
  const ib = createRemoteInbox({ file: h.file, startDownload: async () => 't', notify() {}, onChange() {}, getSettings: () => h.settings, now: h.now })
  assert.equal(ib.list().length, 0)
  for (let i = 0; i < 60; i++) {
    ib.addLink(`https://example.com/${i}`)
    h.advance(3000)
  }
  assert.equal(ib.list().length, 50)
})

test('the browser (WebCrypto) implementation matches the same vector and the Node one, both ways', async () => {
  const W = await import('../extension/lib/envelope.mjs')
  const secret = Uint8Array.from(Buffer.from(vector.secretHex, 'hex'))
  const keys = await W.deriveKeys(secret)
  assert.equal(keys.topic, vector.topic)
  assert.equal(keys.authToken, vector.authToken)
  assert.equal(await W.seal(vector.envelope, keys.encKey, Uint8Array.from(Buffer.from(vector.ivHex, 'hex'))), vector.wire)
  assert.deepEqual(await W.open(vector.wire, keys.encKey), vector.envelope)
  // a message sealed in the browser opens in Node, and the other way round
  const nodeKeys = E.deriveKeys(Buffer.from(vector.secretHex, 'hex'))
  const fromBrowser = await W.seal({ v: 1, id: 'abcdefgh', ts: 1, url: 'https://a.com' }, keys.encKey)
  assert.equal(E.open(fromBrowser, nodeKeys.encKey).url, 'https://a.com')
  assert.equal((await W.open(E.seal({ v: 1, id: 'x', url: 'https://b.com' }, nodeKeys.encKey), keys.encKey)).url, 'https://b.com')
  assert.equal(await W.open('junk', keys.encKey), null)
  await assert.rejects(W.deriveKeys(new Uint8Array(5)), /32 bytes/)
})

test('the browser side reads pair links and finds the link in shared text', async () => {
  const W = await import('../extension/lib/envelope.mjs')
  const secret = E.newSecret()
  const link = E.buildPairLink({ secret, relay: 'https://ntfy.example.com', relayToken: 'tk', direct: 'https://pc.ts.net:47822', name: 'PC' })
  const p = W.parsePairLink(link)
  assert.deepEqual([Buffer.from(p.secret).equals(secret), p.relay, p.relayToken, p.direct, p.name], [true, 'https://ntfy.example.com', 'tk', 'https://pc.ts.net:47822', 'PC'])
  assert.equal(W.parsePairLink('nope'), null)
  assert.equal(W.firstUrl('', 'Watch this https://youtu.be/abc123?t=5, it is great!'), 'https://youtu.be/abc123?t=5')
  assert.equal(W.firstUrl('https://a.com/x', 'https://b.com'), 'https://a.com/x')
  assert.equal(W.firstUrl('no link here', null), '')
})

test('sendLink prefers the direct path, falls back to the relay, and says which it used', async () => {
  const W = await import('../extension/lib/envelope.mjs')
  const secret = Uint8Array.from(E.newSecret())
  const keys = E.deriveKeys(Buffer.from(secret))
  const calls = []
  const mk = (direct) => async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', auth: init.headers?.Authorization, body: init.body })
    if (String(url).includes('/v1/health')) return { ok: direct, status: direct ? 200 : 500 }
    if (String(url).includes('/v1/send')) return { ok: true, status: 202 }
    return { ok: true, status: 200 }
  }
  assert.equal(await W.sendLink({ secret, direct: 'https://pc.ts.net:47822', relay: '', relayToken: '' }, 'https://a.com/1', 'Phone', mk(true)), 'direct')
  const send = calls.find((c) => c.url.endsWith('/v1/send'))
  assert.equal(send.auth, `Bearer ${keys.authToken}`)
  assert.equal(E.open(send.body, keys.encKey).url, 'https://a.com/1')
  calls.length = 0
  assert.equal(await W.sendLink({ secret, direct: 'https://pc.ts.net:47822', relay: '', relayToken: 'tok' }, 'https://a.com/2', 'Phone', mk(false)), 'relay')
  const relayCall = calls.find((c) => c.method === 'POST' && !c.url.includes('/v1/'))
  assert.equal(relayCall.url, `https://ntfy.sh/${keys.topic}`)
  assert.equal(relayCall.auth, 'Bearer tok')
  assert.equal(E.open(relayCall.body, keys.encKey).from, 'Phone')
  calls.length = 0
  assert.equal(await W.sendLink({ secret, direct: '', relay: 'https://ntfy.example.com' }, 'https://a.com/3', 'Phone', mk(true)), 'relay')
  assert.ok(calls.every((c) => !c.url.includes('/v1/')), 'no direct address, so no health check')
  await assert.rejects(W.sendLink({ secret }, 'https://a.com/4', 'Phone', async () => { throw new Error('offline') }), /Couldn't reach/)
  await assert.rejects(W.sendLink({ secret }, 'https://a.com/5', 'Phone', async () => ({ ok: false, status: 429 })), /429/)
})
