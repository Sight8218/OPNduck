const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const P = require('../electron/core/plugins.cjs')
const S = require('../electron/core/plugin_store.cjs')

/* ------------------------------------------------------------- tar builder */

function header({ name, size = 0, type = '0', prefix = '' }) {
  const b = Buffer.alloc(512)
  b.write(name, 0, 100)
  b.write('0000644\0', 100)
  b.write('0000000\0', 108)
  b.write('0000000\0', 116)
  b.write(size.toString(8).padStart(11, '0') + '\0', 124)
  b.write('00000000000\0', 136)
  b.write('        ', 148)
  b.write(type, 156)
  b.write('ustar\0', 257)
  b.write('00', 263)
  b.write(prefix, 345, 155)
  let sum = 0
  for (const x of b) sum += x
  b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  return b
}
const pad = (buf) => Buffer.concat([buf, Buffer.alloc((512 - (buf.length % 512)) % 512)])
function tar(entries) {
  const parts = []
  for (const e of entries) {
    const data = Buffer.from(e.data ?? '')
    parts.push(header({ name: e.name, size: e.type === '5' || e.type === '2' ? 0 : data.length, type: e.type ?? '0', prefix: e.prefix }), pad(e.type === '5' || e.type === '2' ? Buffer.alloc(0) : data))
  }
  parts.push(Buffer.alloc(1024))
  return Buffer.concat(parts)
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-store-'))
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

const manifest = (over = {}) => ({ id: 'demo', name: 'Demo', version: '1.0.0', apiVersion: 1, author: 'A', description: 'D', permissions: ['tools'], backend: { entry: 'backend.cjs' }, tools: [{ name: 'x', description: 'x', inputSchema: { type: 'object', properties: {} } }], ...over })
const pluginTar = (over = {}, extra = []) =>
  tar([{ name: 'repo-abc/', type: '5' }, { name: 'repo-abc/plugin.json', data: JSON.stringify(manifest(over)) }, { name: 'repo-abc/backend.cjs', data: 'exports.activate = async (o) => { await o.tools.handle("x", () => 1) }' }, ...extra])

/* ------------------------------------------------------------------ index */

const entry = (over = {}) => ({ id: 'demo', name: 'Demo', version: '1.0.0', author: 'A', description: 'D', repo: 'https://github.com/o/r', commit: 'a'.repeat(40), sha256: 'b'.repeat(64), permissions: ['tools'], verified: false, ...over })

test('parseIndex keeps good entries and drops bad ones', () => {
  const bad = [
    entry({ id: 'downloader' }), entry({ id: 'Bad_ID' }), entry({ repo: 'http://github.com/o/r' }), entry({ repo: 'https://evil.com/o/r' }),
    entry({ commit: 'abc' }), entry({ sha256: 'zz' }), entry({ permissions: ['root'] }), entry({ version: 'one' }), entry({ subdir: '../x' }), null, 'x',
  ]
  const out = S.parseIndex({ plugins: [entry(), entry({ id: 'second', verified: true }), entry(), ...bad] })
  assert.deepEqual(out.map((e) => e.id), ['demo', 'second'])
  assert.equal(out[1].verified, true)
  assert.deepEqual(S.parseIndex({}), [])
  assert.deepEqual(S.parseIndex(null), [])
})

/* ---------------------------------------------------------------- extract */

test('extractTar drops the top folder and writes plain files', () => {
  const dest = path.join(tmp(), 'out')
  const r = S.extractTar(pluginTar(), dest)
  assert.equal(r.files, 2)
  assert.ok(fs.existsSync(path.join(dest, 'plugin.json')))
  assert.equal(fs.statSync(path.join(dest, 'backend.cjs')).mode & 0o111, 0)
})

test('extractTar honours subdir and long (prefix) paths', () => {
  const dest = path.join(tmp(), 'out')
  S.extractTar(tar([{ name: 'repo-abc/', type: '5' }, { name: 'repo-abc/other/skip.txt', data: 'no' }, { name: 'repo-abc/plugins/mine/plugin.json', data: '{}' }, { name: 'long.txt', prefix: 'repo-abc/plugins/mine/deep/er', data: 'hi' }]), dest, { subdir: 'plugins/mine' })
  assert.deepEqual(fs.readdirSync(dest).sort(), ['deep', 'plugin.json'])
  assert.equal(fs.readFileSync(path.join(dest, 'deep/er/long.txt'), 'utf8'), 'hi')
})

test('extractTar refuses links, traversal, absolute paths, duplicates and empty archives', () => {
  const run = (entries) => S.extractTar(tar(entries), path.join(tmp(), 'out'))
  assert.throws(() => run([{ name: 'r/a', type: '2', data: '' }]), /link or special/)
  assert.throws(() => run([{ name: 'r/a', type: '1' }]), /link or special/)
  assert.throws(() => run([{ name: 'r/../../evil', data: 'x' }]), /Unsafe path/)
  assert.throws(() => run([{ name: '/etc/evil', data: 'x' }]), /Unsafe path/)
  assert.throws(() => run([{ name: 'r\\evil', data: 'x' }]), /Unsafe path/)
  assert.throws(() => run([{ name: 'r/a', data: '1' }, { name: 'r/a', data: '2' }]), /EEXIST/)
  assert.throws(() => run([{ name: 'r/', type: '5' }]), /no files/)
})

test('extractTar refuses a truncated archive and too many files', () => {
  const t = pluginTar()
  assert.throws(() => S.extractTar(t.subarray(0, 700), path.join(tmp(), 'out')), /truncated/)
  const many = tar(Array.from({ length: 2001 }, (_, i) => ({ name: `r/f${i}`, data: 'x' })))
  assert.throws(() => S.extractTar(many, path.join(tmp(), 'out')), /too many files/)
})

/* --------------------------------------------------------------- the store */

function fakeFetch(routes, seen = []) {
  return async (url) => {
    seen.push(String(url))
    const hit = routes[url]
    if (hit === undefined) return { ok: false, status: 404, url, headers: new Headers(), body: [] }
    const body = Buffer.isBuffer(hit.body) ? hit.body : Buffer.from(hit.body)
    return { ok: true, status: 200, url: hit.finalUrl ?? url, headers: new Headers(), body: [body] }
  }
}

const INDEX_URL = 'https://index.test/index.json'
const BASE = 'https://codeload.test'
const archiveFor = (e) => `${BASE}/o/r/tar.gz/${e.commit}`

function setup({ over = {}, tarBuf = pluginTar(), local = false, gzBody } = {}) {
  const root = tmp()
  const pluginsDir = path.join(root, 'plugins')
  fs.mkdirSync(pluginsDir, { recursive: true })
  if (local) {
    fs.mkdirSync(path.join(pluginsDir, 'demo'))
    fs.writeFileSync(path.join(pluginsDir, 'demo', 'plugin.json'), JSON.stringify(manifest()))
    fs.writeFileSync(path.join(pluginsDir, 'demo', 'backend.cjs'), '')
  }
  const platform = { paths: { userData: root, downloads: path.join(root, 'dl') }, canNotify: () => false }
  const core = { startJob: async () => 'j', engine: { tasks: new Map(), cancelTask() {} }, tools: {} }
  const host = P.createPluginHost({ core, platform, pluginsDir })
  const e = entry({ sha256: sha(tarBuf), ...over })
  const routes = { [INDEX_URL]: { body: JSON.stringify({ plugins: [e] }) }, [archiveFor(e)]: { body: gzBody ?? zlib.gzipSync(tarBuf) } }
  const seen = []
  const store = S.createPluginStore({ host, fetchImpl: fakeFetch(routes, seen), indexUrl: INDEX_URL, archiveBase: BASE })
  return { host, store, pluginsDir, routes, seen, entry: e }
}

test('store: install lands the plugin OFF with source "store" and the index verified flag', async () => {
  const { host, store, pluginsDir } = setup({ over: { verified: true } })
  await host.init()
  const s = await store.install('demo')
  assert.equal(s.status, 'disabled')
  assert.equal(s.enabled, false)
  assert.equal(s.source, 'store')
  assert.equal(s.verified, true)
  assert.deepEqual(s.pendingApproval, ['tools'])
  assert.ok(fs.existsSync(path.join(pluginsDir, 'demo', 'plugin.json')))
  assert.deepEqual(fs.readdirSync(pluginsDir).filter((n) => n.startsWith('.install') || n.startsWith('.old')), [])
  const listed = await store.list()
  assert.equal(listed.entries[0].installed, '1.0.0')
  await host.shutdown()
})

test('store: a tampered archive is refused and nothing is installed', async () => {
  const good = pluginTar()
  const evil = pluginTar({}, [{ name: 'repo-abc/extra.js', data: 'steal()' }])
  const { host, store, pluginsDir } = setup({ tarBuf: good, gzBody: zlib.gzipSync(evil) })
  await host.init()
  await assert.rejects(store.install('demo'), /checksum/)
  assert.deepEqual(fs.readdirSync(pluginsDir).filter((n) => n !== 'plugins.json' && n !== '.store-index.json'), [])
  assert.deepEqual(host.list(), [])
})

test('store: manifest must match its entry (version, id, permissions)', async () => {
  for (const over of [{ version: '2.0.0' }, { id: 'other' }, { permissions: ['tools', 'exec'] }]) {
    const { host, store, pluginsDir } = setup({ tarBuf: pluginTar(over) })
    await host.init()
    await assert.rejects(store.install('demo'), /does not match|different permissions|not valid/, JSON.stringify(over))
    assert.equal(fs.existsSync(path.join(pluginsDir, 'demo')), false)
  }
})

test('store: an unknown id, a non-gzip body and a foreign redirect are refused', async () => {
  const a = setup()
  await a.host.init()
  await assert.rejects(a.store.install('nope'), /not in the store/)
  const b = setup({ gzBody: Buffer.from('not gzip') })
  await b.host.init()
  await assert.rejects(b.store.install('demo'), /not a valid archive/)
  const c = setup()
  c.routes[archiveFor(c.entry)].finalUrl = 'https://evil.test/x'
  await c.host.init()
  await assert.rejects(c.store.install('demo'), /Unexpected download location/)
})

test('store: refuses to replace a plugin dropped in by hand', async () => {
  const { host, store, pluginsDir } = setup({ local: true })
  await host.init()
  await assert.rejects(store.install('demo'), /already installed from a folder/)
  assert.ok(fs.existsSync(path.join(pluginsDir, 'demo', 'backend.cjs')))
})

test('store: an update replaces the folder, turns the plugin off and re-asks only for new permissions', async () => {
  const v1 = setup({ over: { verified: true } })
  await v1.host.init()
  await v1.store.install('demo')
  await v1.host.enable('demo', ['tools'])
  assert.equal(v1.host.list()[0].status, 'running')

  const t2 = pluginTar({ version: '1.1.0', permissions: ['tools', 'exec'] })
  const e2 = entry({ version: '1.1.0', permissions: ['tools', 'exec'], sha256: sha(t2), commit: 'c'.repeat(40) })
  const routes = { [INDEX_URL]: { body: JSON.stringify({ plugins: [e2] }) }, [archiveFor(e2)]: { body: zlib.gzipSync(t2) } }
  const store2 = S.createPluginStore({ host: v1.host, fetchImpl: fakeFetch(routes), indexUrl: INDEX_URL, archiveBase: BASE, now: () => Date.now() + 2 * 3600 * 1000 })
  const s = await store2.install('demo')
  assert.equal(s.manifest.version, '1.1.0')
  assert.equal(s.enabled, false)
  assert.deepEqual(s.pendingApproval, ['exec'])
  assert.equal(fs.readdirSync(v1.pluginsDir).some((n) => n.startsWith('.old')), false)
  await v1.host.shutdown()
})

test('store: the index is cached, and a stale cache serves when offline', async () => {
  const { store, seen, host } = setup()
  await host.init()
  await store.index()
  await store.index()
  assert.equal(seen.filter((u) => u === INDEX_URL).length, 1)
  const offline = S.createPluginStore({ host, fetchImpl: async () => { throw new Error('offline') }, indexUrl: INDEX_URL, archiveBase: BASE, now: () => Date.now() + 5 * 3600 * 1000 })
  const r = await offline.index()
  assert.equal(r.offline, true)
  assert.equal(r.entries.length, 1)
  const fresh = setup()
  const none = S.createPluginStore({ host: fresh.host, fetchImpl: async () => { throw new Error('offline') }, indexUrl: INDEX_URL, archiveBase: BASE })
  const empty = await none.index()
  assert.deepEqual([empty.entries.length, empty.offline], [0, true])
})

test('store: only one install at a time', async () => {
  const { host, store } = setup()
  await host.init()
  const first = store.install('demo')
  await assert.rejects(store.install('demo'), /Another plugin install/)
  await first
})
