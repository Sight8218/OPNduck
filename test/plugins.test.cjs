// Tests for the plugin host core (electron/core/plugins.cjs). Run: npm test
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const P = require('../electron/core/plugins.cjs')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-plugins-'))
const valid = (over = {}) => ({ id: 'demo', name: 'Demo', version: '1.0.0', apiVersion: 1, author: 'A', description: 'D', backend: { entry: 'backend.cjs' }, ...over })

/* ---------------------------------------------------------------- manifest */

test('a minimal backend-only manifest is valid and normalized', () => {
  const r = P.validateManifest(valid())
  assert.equal(r.ok, true)
  assert.deepEqual(r.manifest.permissions, [])
  assert.deepEqual(r.manifest.tools, [])
})

test('a v1 manifest (top-level entry) becomes a UI-only plugin with no permissions', () => {
  const r = P.validateManifest({ id: 'old', name: 'Old', version: '0.1.0', author: 'A', description: 'D', tagline: 't', icon: '★', scope: 'universal', entry: 'index.js' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.manifest.ui, { entry: 'index.js' })
  assert.deepEqual(r.manifest.permissions, [])
  assert.equal(r.manifest.apiVersion, 0)
})

test('manifest rejects bad ids, core ids, bad versions and unknown api versions', () => {
  for (const over of [{ id: 'Bad_ID' }, { id: '../x' }, { id: '' }, { id: 'downloader' }, { version: 'one' }, { apiVersion: 2 }, { author: '' }]) {
    assert.equal(P.validateManifest(valid(over)).ok, false, JSON.stringify(over))
  }
})

test('manifest rejects entries that escape the plugin folder', () => {
  for (const entry of ['../evil.cjs', '/etc/passwd.js', 'C:/x.js', 'a\\b.js', 'a//b.js', './x.js'.replace('./', '../'), 'x.sh']) {
    assert.equal(P.validateManifest(valid({ backend: { entry } })).ok, false, entry)
  }
  assert.equal(P.validateManifest(valid({ backend: { entry: 'lib/main.cjs' } })).ok, true)
})

test('permissions must be known; network needs hostnames and vice versa; no IPs or localhost', () => {
  assert.equal(P.validateManifest(valid({ permissions: ['root'] })).ok, false)
  assert.equal(P.validateManifest(valid({ permissions: ['network'] })).ok, false)
  assert.equal(P.validateManifest(valid({ network: ['api.github.com'] })).ok, false)
  assert.equal(P.validateManifest(valid({ permissions: ['network'], network: ['api.github.com'] })).ok, true)
  for (const host of ['localhost', '127.0.0.1', '10.0.0.1', '*.github.com', 'https://api.github.com', 'api.github.com:8080']) {
    assert.equal(P.validateManifest(valid({ permissions: ['network'], network: [host] })).ok, false, host)
  }
})

test('tools and settings require their permission, tools also a backend', () => {
  const tool = { name: 'do_it', description: 'x', inputSchema: { type: 'object', properties: {} } }
  assert.equal(P.validateManifest(valid({ tools: [tool] })).ok, false)
  assert.equal(P.validateManifest(valid({ permissions: ['tools'], tools: [tool] })).ok, true)
  assert.equal(P.validateManifest(valid({ permissions: ['tools'], tools: [tool, tool] })).ok, false)
  assert.equal(P.validateManifest(valid({ settings: { a: { type: 'string' } } })).ok, false)
  assert.equal(P.validateManifest(valid({ permissions: ['settings'], settings: { a: { type: 'string' } } })).ok, true)
})

test('tool names must keep "<id>__<name>" within 64 characters', () => {
  const tool = (name) => ({ name, description: 'x', inputSchema: { type: 'object', properties: {} } })
  const m = (id, name) => valid({ id, permissions: ['tools'], tools: [tool(name)] })
  assert.equal(P.validateManifest(m('a'.repeat(40), 'b'.repeat(22))).ok, true) // 40 + 2 + 22 = 64
  assert.equal(P.validateManifest(m('a'.repeat(40), 'b'.repeat(23))).ok, false)
})

test('a card needs tagline, icon and scope; a plugin needs at least one entry', () => {
  assert.equal(P.validateManifest(valid({ backend: undefined })).ok, false)
  assert.equal(P.validateManifest(valid({ ui: { entry: 'ui.js' } })).ok, false)
  assert.equal(P.validateManifest(valid({ ui: { entry: 'ui.js' }, tagline: 't', icon: '★', scope: 'universal' })).ok, true)
})

test('the shipped examples are valid manifests', () => {
  const root = path.join(__dirname, '..', 'plugin-examples')
  for (const name of fs.readdirSync(root)) {
    const r = P.validateManifest(JSON.parse(fs.readFileSync(path.join(root, name, 'plugin.json'), 'utf8')))
    assert.equal(r.ok, true, `${name}: ${r.errors.join('; ')}`)
  }
})

/* --------------------------------------------------------------- path safety */

test('isSafeRelPath', () => {
  for (const ok of ['a.js', 'lib/a.js', 'a/b/c.cjs']) assert.equal(P.isSafeRelPath(ok), true, ok)
  for (const bad of ['', '..', '../a', 'a/../b', '/a', 'C:\\a', 'a\\b', 'a\0b', 'a//b', 5, null]) assert.equal(P.isSafeRelPath(bad), false, String(bad))
})

test('resolveEntry follows symlinks and refuses ones that leave the folder', () => {
  const root = tmp()
  const plugin = path.join(root, 'p')
  fs.mkdirSync(plugin)
  fs.writeFileSync(path.join(plugin, 'ok.cjs'), '')
  fs.writeFileSync(path.join(root, 'outside.cjs'), '')
  fs.symlinkSync(path.join(root, 'outside.cjs'), path.join(plugin, 'link.cjs'))
  assert.equal(P.resolveEntry(plugin, 'ok.cjs'), path.join(fs.realpathSync(plugin), 'ok.cjs'))
  assert.throws(() => P.resolveEntry(plugin, 'link.cjs'), /leaves the plugin folder/)
  assert.throws(() => P.resolveEntry(plugin, '../outside.cjs'), /Unsafe/)
  assert.throws(() => P.resolveEntry(plugin, 'missing.cjs'))
})

test('file access: downloads only, plus what the user picked', () => {
  const root = tmp()
  const downloads = path.join(root, 'dl')
  const other = path.join(root, 'other')
  fs.mkdirSync(downloads)
  fs.mkdirSync(other)
  fs.writeFileSync(path.join(other, 'secret.txt'), 's')
  fs.writeFileSync(path.join(other, 'picked.txt'), 'p')
  fs.symlinkSync(other, path.join(downloads, 'escape'))
  const f = P.createFileAccess(downloads)
  assert.equal(f.canRead(path.join(downloads, 'a.mp4')), true) // not created yet is fine
  assert.equal(f.canWrite(path.join(downloads, 'sub', 'a.mp4')), true)
  assert.equal(f.canRead(path.join(other, 'secret.txt')), false)
  assert.equal(f.canRead(path.join(downloads, '..', 'other', 'secret.txt')), false)
  assert.equal(f.canRead(path.join(downloads, 'escape', 'secret.txt')), false) // symlink out of downloads
  assert.equal(f.canRead('relative.txt'), false)
  assert.equal(f.canRead(''), false)
  assert.equal(f.canRead(undefined), false)
  f.allowRead(path.join(other, 'picked.txt'))
  assert.equal(f.canRead(path.join(other, 'picked.txt')), true)
  assert.equal(f.canRead(path.join(other, 'secret.txt')), false) // a picked file is only that file
  assert.equal(f.canWrite(path.join(other, 'picked.txt')), false) // picked for reading, not writing
})

/* ------------------------------------------------------ permissions and args */

test('guard: require throws PermissionError; exec:any implies exec', () => {
  const g = P.createGuard(['jobs'])
  assert.doesNotThrow(() => g.require('jobs'))
  assert.throws(() => g.require('files:read'), P.PermissionError)
  assert.equal(P.createGuard(['exec:any']).has('exec'), true)
  assert.equal(P.createGuard(['exec']).has('exec:any'), false)
})

test('validateArgs checks types, enums, required and extra keys', () => {
  const schema = { type: 'object', properties: { p: { type: 'string' }, n: { type: 'integer', minimum: 1 }, m: { type: 'string', enum: ['a', 'b'] } }, required: ['p'] }
  assert.deepEqual(P.validateArgs(schema, { p: 'x', n: 2 }), { p: 'x', n: 2 })
  for (const bad of [{}, { p: 1 }, { p: 'x', extra: 1 }, { p: 'x', m: 'c' }, { p: 'x', n: 0 }, 'str', [1]]) assert.throws(() => P.validateArgs(schema, bad), undefined, JSON.stringify(bad))
})

/* -------------------------------------------------------------------- state */

test('state: round trip, missing file, corrupt file, junk entries dropped', () => {
  const dir = tmp()
  const file = path.join(dir, 'sub', 'plugins.json')
  assert.deepEqual(P.loadState(file), { plugins: {} })
  P.saveState(file, { plugins: { demo: { enabled: true, approved: ['jobs', 'bogus'], asked: ['jobs'], version: '1.0.0', verified: true, source: 'store', settings: { a: 1 }, lastError: '' }, '../evil': { enabled: true } } })
  const s = P.loadState(file)
  assert.deepEqual(Object.keys(s.plugins), ['demo'])
  assert.deepEqual(s.plugins.demo.approved, ['jobs'])
  assert.equal(s.plugins.demo.enabled, true)
  fs.writeFileSync(file, '{not json')
  assert.deepEqual(P.loadState(file), { plugins: {} })
})

test('scanPlugins lists good, broken and mismatched folders', () => {
  const dir = tmp()
  const mk = (name, manifest) => {
    fs.mkdirSync(path.join(dir, name))
    if (manifest !== undefined) fs.writeFileSync(path.join(dir, name, 'plugin.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest))
  }
  mk('demo', valid())
  mk('nomanifest')
  mk('garbage', '{nope')
  mk('wrong-name', valid({ id: 'other' }))
  const byId = Object.fromEntries(P.scanPlugins(dir).map((e) => [e.id, e]))
  assert.ok(byId.demo.manifest)
  assert.match(byId.nomanifest.errors[0], /missing/)
  assert.match(byId.garbage.errors[0], /not valid JSON/)
  assert.match(byId['wrong-name'].errors[0], /must match/)
})

/* ------------------------------------------------------------------ host API */

function apiFor(manifestOver, granted, extra = {}) {
  const { manifest } = P.validateManifest(valid({ permissions: granted, ...manifestOver }))
  const downloads = tmp()
  const state = { settings: {} }
  const jobs = []
  const core = { startJob: async (channel, req) => (jobs.push({ channel, req }), `job${jobs.length}`), engine: { tasks: new Map(), cancelTask() {} }, tools: {} }
  const api = P.createApi({
    manifest, guard: P.createGuard(granted), files: P.createFileAccess(downloads), core, platform: { canNotify: () => false }, state, saveState() {},
    ownJobs: new Set(), subs: new Set(), registered: { tool: new Set(), command: new Set(), rpc: new Set() }, invokeRpc: async () => 'rpc', log() {}, ...extra,
  })
  return { api, downloads, jobs, state }
}

test('every namespace refuses without its permission', async () => {
  const { api } = apiFor({}, [])
  for (const [method, args] of [['jobs.start', ['convert', { inputPath: '/x' }]], ['jobs.list', []], ['files.read', ['/x']], ['files.write', ['/x', 'a']], ['files.pick', [{}]], ['exec.run', ['ffmpeg', []]], ['net.fetch', ['https://a.com']], ['settings.get', ['k']], ['notify', [{ body: 'x' }]], ['hooks.subscribe', ['job:finished']], ['tools.handle', ['t']]]) {
    await assert.rejects(api.call(method, args), P.PermissionError, method)
  }
})

test('jobs.start validates against the tool schema and only reads allowed paths', async () => {
  const { api, downloads, jobs } = apiFor({}, ['jobs', 'files:read'])
  const inside = path.join(downloads, 'a.mp4')
  fs.writeFileSync(inside, '')
  assert.equal(await api.call('jobs.start', ['convert', { inputPath: inside, container: 'MP4' }]), 'job1')
  assert.equal(jobs[0].channel, 'tasks:startConvert')
  await assert.rejects(api.call('jobs.start', ['convert', { inputPath: '/etc/passwd', container: 'MP4' }]), P.PermissionError)
  await assert.rejects(api.call('jobs.start', ['convert', { inputPath: inside, outputDir: '/tmp' }]), /Unknown argument/)
  await assert.rejects(api.call('jobs.start', ['nope', {}]), /Unknown start tool/)
  assert.equal(jobs.length, 1)
})

test('jobs.start re-checks what the app checks: http(s) URLs, files that exist, a job limit', async () => {
  const { api, downloads, jobs } = apiFor({}, ['jobs', 'files:read'])
  await assert.rejects(api.call('jobs.start', ['download', { url: 'file:///etc/passwd' }]), /http/)
  await assert.rejects(api.call('jobs.start', ['download', { url: 'not a url' }]), /full http/)
  assert.equal(await api.call('jobs.start', ['download', { url: 'https://example.com/v' }]), 'job1')
  await assert.rejects(api.call('jobs.start', ['convert', { inputPath: path.join(downloads, 'missing.mp4'), container: 'MP4' }]), /does not exist/)
  fs.mkdirSync(path.join(downloads, 'dir'))
  await assert.rejects(api.call('jobs.start', ['convert', { inputPath: path.join(downloads, 'dir'), container: 'MP4' }]), /regular file/)
  assert.equal(jobs.length, 1)
  // the limit counts this plugin's own unfinished jobs
  const tasks = new Map()
  const core = { startJob: async () => { const id = `j${tasks.size}`; tasks.set(id, { state: { status: 'running' } }); return id }, engine: { tasks, TERMINAL: ['done', 'error', 'canceled'], cancelTask() {} }, tools: {} }
  const limited = apiFor({}, ['jobs'], { core }).api
  for (let i = 0; i < 10; i++) await limited.call('jobs.start', ['download', { url: 'https://example.com/v' }])
  await assert.rejects(limited.call('jobs.start', ['download', { url: 'https://example.com/v' }]), /Too many jobs/)
})

test('jobs.start with a path needs files:read even when jobs is granted', async () => {
  const { api, downloads } = apiFor({}, ['jobs'])
  await assert.rejects(api.call('jobs.start', ['convert', { inputPath: path.join(downloads, 'a.mp4'), container: 'MP4' }]), P.PermissionError)
})

test('files.read / files.write stay inside allowed folders', async () => {
  const { api, downloads } = apiFor({}, ['files:read', 'files:write'])
  const f = path.join(downloads, 'sub', 'a.txt')
  await api.call('files.write', [f, 'hello'])
  assert.equal(Buffer.from(await api.call('files.read', [f])).toString(), 'hello')
  await assert.rejects(api.call('files.read', ['/etc/passwd']), P.PermissionError)
  await assert.rejects(api.call('files.write', [path.join(downloads, '..', 'x.txt'), 'x']), P.PermissionError)
})

test('files.pick grants access to exactly what was picked', async () => {
  const dir = tmp()
  const picked = path.join(dir, 'p.txt')
  fs.writeFileSync(picked, 'p')
  fs.writeFileSync(path.join(dir, 'q.txt'), 'q')
  const { api } = apiFor({}, ['files:read'], { pickPath: async () => picked })
  await assert.rejects(api.call('files.read', [picked]), P.PermissionError)
  assert.equal(await api.call('files.pick', [{}]), picked)
  assert.equal(Buffer.from(await api.call('files.read', [picked])).toString(), 'p')
  await assert.rejects(api.call('files.read', [path.join(dir, 'q.txt')]), P.PermissionError)
  await assert.rejects(api.call('files.pick', [{ save: true }]), P.PermissionError) // needs files:write
})

test('exec: named binaries need exec, anything else needs exec:any', async () => {
  const { api } = apiFor({}, ['exec'])
  await assert.rejects(api.call('exec.run', ['sh', ['-c', 'echo hi']]), P.PermissionError)
  const any = apiFor({}, ['exec', 'exec:any']).api
  const r = await any.call('exec.run', [process.execPath, ['-e', 'process.stdout.write("hi")']])
  assert.equal(r.stdout, 'hi')
  assert.equal(r.code, 0)
  await assert.rejects(any.call('exec.run', ['x', 'not-an-array']), /list of string/)
})

test('net.fetch: only listed hosts, and every redirect hop is rechecked', async () => {
  const seen = []
  const fetchImpl = async (url) => {
    seen.push(String(url))
    if (url.hostname === 'api.good.com' && url.pathname === '/redir') return new Response(null, { status: 302, headers: { location: 'https://evil.com/steal' } })
    if (url.hostname === 'api.good.com' && url.pathname === '/hop') return new Response(null, { status: 302, headers: { location: '/ok' } })
    return new Response('hello', { status: 200 })
  }
  const { api } = apiFor({ network: ['api.good.com'] }, ['network'], { fetchImpl })
  const ok = await api.call('net.fetch', ['https://api.good.com/x'])
  assert.equal(ok.status, 200)
  assert.equal(Buffer.from(ok.body).toString(), 'hello')
  assert.equal((await api.call('net.fetch', ['https://api.good.com/hop'])).status, 200)
  await assert.rejects(api.call('net.fetch', ['https://evil.com/']), P.PermissionError)
  await assert.rejects(api.call('net.fetch', ['https://api.good.com/redir']), P.PermissionError)
  await assert.rejects(api.call('net.fetch', ['https://api.good.com.evil.com/']), P.PermissionError)
  await assert.rejects(api.call('net.fetch', ['file:///etc/passwd']), P.PermissionError)
  assert.ok(!seen.includes('https://evil.com/steal'))
})

test('settings are schema-checked and namespaced to the plugin', async () => {
  const { api, state } = apiFor({ settings: { mode: { type: 'string', enum: ['a', 'b'], default: 'a' } } }, ['settings'])
  assert.equal(await api.call('settings.get', ['mode']), 'a')
  await api.call('settings.set', ['mode', 'b'])
  assert.equal(state.settings.mode, 'b')
  await assert.rejects(api.call('settings.set', ['mode', 'c']), /one of/)
  await assert.rejects(api.call('settings.set', ['mode', 5]), /must be a string/)
  await assert.rejects(api.call('settings.get', ['other']), /Unknown setting/)
})

test('the card (fromUi) only reaches the UI subset of the API', async () => {
  const { api } = apiFor({}, ['files:read', 'files:write', 'exec', 'network', 'hooks'])
  for (const m of ['files.read', 'files.write', 'exec.run', 'net.fetch', 'hooks.subscribe', 'tools.handle']) {
    await assert.rejects(api.call(m, [], { fromUi: true }), /not available from a plugin card/, m)
  }
  assert.equal(await api.call('rpc.call', ['x'], { fromUi: true }), 'rpc')
  await assert.rejects(api.call('constructor', []), /Unknown method/)
  await assert.rejects(api.call('__proto__', []), /Unknown method/)
})

/* ------------------------------------------------- host with real workers */

function makeHost(plugins, opts = {}) {
  const root = tmp()
  const pluginsDir = path.join(root, 'plugins')
  const downloads = path.join(root, 'downloads')
  fs.mkdirSync(downloads)
  for (const [id, { manifest, files }] of Object.entries(plugins)) {
    const dir = path.join(pluginsDir, id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(manifest))
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body)
  }
  const logs = []
  const platform = { paths: { userData: root, downloads }, canNotify: () => false }
  const core = { startJob: async () => 'job1', engine: { tasks: new Map(), cancelTask() {} }, tools: {} }
  const host = P.createPluginHost({ core, platform, pluginsDir, log: (l) => logs.push(l), ...opts })
  return { host, pluginsDir, downloads, logs, root, platform, core }
}

const toolPlugin = (extra = {}) => ({
  manifest: valid({ permissions: ['tools', 'files:read', 'hooks'], tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }, { name: 'read_etc', description: 'x', inputSchema: { type: 'object', properties: {} } }], ...extra }),
  files: {
    'backend.cjs': `
      exports.activate = async (o) => {
        await o.tools.handle('echo', ({ text }) => ({ echoed: text }))
        await o.tools.handle('read_etc', async () => { try { await o.files.read('/etc/hostname'); return 'READ' } catch (e) { return e.name } })
        const events = []
        o.on('job:finished', (p) => events.push(p))
        await o.rpc.handle('events', () => events)
      }`,
  },
})

test('host: a dropped-in plugin is NOT started until the user enables it', async () => {
  const { host, logs } = makeHost({ demo: toolPlugin() })
  const list = await host.init()
  assert.equal(list[0].status, 'disabled')
  assert.deepEqual(host.tools(), [])
  assert.deepEqual(logs, [])
})

test('host: enable with approved permissions runs the backend; tools are namespaced and callable', async () => {
  const { host } = makeHost({ demo: toolPlugin() })
  await host.init()
  const s = await host.enable('demo', ['tools', 'files:read', 'hooks'])
  assert.equal(s.status, 'running')
  assert.deepEqual(host.tools().map((t) => t.name), ['demo__echo', 'demo__read_etc'])
  assert.deepEqual(await host.callTool('demo__echo', { text: 'hi' }), { echoed: 'hi' })
  await assert.rejects(host.callTool('demo__echo', { text: 1 }), /must be string/)
  await assert.rejects(host.callTool('demo__echo', { text: 'x', extra: 1 }), /Unknown argument/)
  await assert.rejects(host.callTool('demo__missing', {}), /Unknown tool/)
  await assert.rejects(host.callTool('echo', {}), /Unknown tool/)
  await host.shutdown()
})

test('host: a permission that was not approved is refused inside the worker', async () => {
  const { host } = makeHost({ demo: toolPlugin() })
  await host.init()
  await host.enable('demo', ['tools', 'hooks']) // files:read NOT approved
  assert.equal(host.list()[0].status, 'running') // denying a permission does not stop the plugin
  assert.deepEqual(host.list()[0].pendingApproval, [])
  assert.equal(await host.callTool('demo__read_etc', {}), 'PermissionError')
  await host.shutdown()
})

test('host: even an approved files:read cannot read outside the allowed folders', async () => {
  const { host } = makeHost({ demo: toolPlugin() })
  await host.init()
  await host.enable('demo', ['tools', 'files:read', 'hooks'])
  assert.equal(await host.callTool('demo__read_etc', {}), 'PermissionError')
  await host.shutdown()
})

test('host: tools need the tools permission to be approved', async () => {
  const { host } = makeHost({ demo: toolPlugin() })
  await host.init()
  await host.enable('demo', ['files:read'])
  assert.deepEqual(host.tools(), [])
  await host.shutdown()
})

test('host: approvals must be a subset of what the manifest asks for', async () => {
  const { host } = makeHost({ demo: toolPlugin() })
  await host.init()
  await assert.rejects(host.enable('demo', ['exec:any']), /subset/)
  await host.shutdown()
})

test('host: events reach subscribed plugins', async () => {
  const { host } = makeHost({ demo: toolPlugin() })
  await host.init()
  await host.enable('demo', ['tools', 'files:read', 'hooks'])
  await new Promise((r) => setTimeout(r, 100)) // subscription is a message to the host
  host.emit('job:finished', { id: 'j1', status: 'done' })
  host.emit('not-an-event', {})
  await new Promise((r) => setTimeout(r, 100))
  assert.deepEqual(await host.callFromUi('demo', 'rpc.call', ['events']), [{ id: 'j1', status: 'done' }])
  await host.shutdown()
})

test('host: a card-only plugin (no backend) can still use the UI API', async () => {
  const card = { manifest: { id: 'card', name: 'Card', version: '1.0.0', apiVersion: 1, author: 'A', description: 'D', tagline: 't', icon: '★', scope: 'universal', permissions: ['settings'], settings: { mode: { type: 'string', default: 'a' } }, ui: { entry: 'ui.js' } }, files: { 'ui.js': 'export default () => null' } }
  const { host } = makeHost({ card })
  await host.init()
  assert.equal((await host.enable('card', ['settings'])).status, 'running')
  assert.equal(await host.callFromUi('card', 'settings.get', ['mode']), 'a')
  await host.callFromUi('card', 'settings.set', ['mode', 'b'])
  assert.equal(await host.callFromUi('card', 'settings.get', ['mode']), 'b')
  await assert.rejects(host.callFromUi('card', 'files.read', ['/x']), /not available from a plugin card/)
})

test('host: re-enabling right after a crash starts a clean worker; init() twice orphans nothing', async () => {
  const flaky = { manifest: valid({ id: 'flaky', permissions: ['tools'], tools: [{ name: 'ping', description: 'x', inputSchema: { type: 'object', properties: {} } }] }), files: { 'backend.cjs': 'exports.activate = async (o) => { await o.tools.handle("ping", () => "pong") }' } }
  const { host } = makeHost({ flaky })
  await host.init()
  await host.enable('flaky', ['tools'])
  await host.enable('flaky', ['tools']) // restart while the first worker is still shutting down
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(host.list()[0].status, 'running')
  assert.equal(await host.callTool('flaky__ping', {}), 'pong')
  await host.init() // a rescan: the old worker is stopped, state is reloaded, enabled plugins start again
  assert.equal(host.list()[0].status, 'running')
  assert.equal(await host.callTool('flaky__ping', {}), 'pong')
  await host.shutdown()
})

test('host: a card cannot call backend-only methods', async () => {
  const { host } = makeHost({ demo: toolPlugin() })
  await host.init()
  await host.enable('demo', ['tools', 'files:read', 'hooks'])
  await assert.rejects(host.callFromUi('demo', 'files.read', ['/etc/hostname']), /not available from a plugin card/)
  await host.shutdown()
})

test('host: a plugin that throws in activate is disabled; others keep running', async () => {
  const bad = { manifest: valid({ id: 'bad' }), files: { 'backend.cjs': 'exports.activate = async () => { throw new Error("boom") }' } }
  const { host, pluginsDir } = makeHost({ demo: toolPlugin(), bad })
  await host.init()
  await host.enable('demo', ['tools', 'files:read', 'hooks'])
  const s = await host.enable('bad', [])
  assert.equal(s.status, 'crashed')
  assert.match(s.lastError, /boom/)
  assert.equal(s.enabled, false)
  assert.equal(host.list().find((p) => p.id === 'demo').status, 'running')
  assert.deepEqual(await host.callTool('demo__echo', { text: 'still here' }), { echoed: 'still here' })
  assert.equal(JSON.parse(fs.readFileSync(path.join(pluginsDir, 'plugins.json'), 'utf8')).plugins.bad.enabled, false)
  await host.shutdown()
})

test('host: a plugin that crashes later is switched off without touching others', async () => {
  const bomb = { manifest: valid({ id: 'bomb' }), files: { 'backend.cjs': 'exports.activate = async () => { setTimeout(() => { throw new Error("late") }, 50) }' } }
  const { host } = makeHost({ demo: toolPlugin(), bomb })
  await host.init()
  await host.enable('demo', ['tools', 'files:read', 'hooks'])
  await host.enable('bomb', [])
  await new Promise((r) => setTimeout(r, 300))
  const list = host.list()
  assert.equal(list.find((p) => p.id === 'bomb').status, 'crashed')
  assert.equal(list.find((p) => p.id === 'demo').status, 'running')
  await host.shutdown()
})

test('host: a plugin that hangs in activate times out', { timeout: 20000 }, async () => {
  const hang = { manifest: valid({ id: 'hang' }), files: { 'backend.cjs': 'exports.activate = () => new Promise(() => {})' } }
  const { host } = makeHost({ hang })
  await host.init()
  const s = await host.enable('hang', [])
  assert.equal(s.status, 'crashed')
  assert.match(s.lastError, /too long/)
})

test('host: enabled state survives a restart; a grown permission list needs re-approval', async () => {
  const { host, pluginsDir, platform, core } = makeHost({ demo: toolPlugin() })
  await host.init()
  await host.enable('demo', ['tools', 'files:read', 'hooks'])
  await host.shutdown()

  const again = P.createPluginHost({ core, platform, pluginsDir })
  assert.equal((await again.init())[0].status, 'running')
  await again.shutdown()

  const manifestFile = path.join(pluginsDir, 'demo', 'plugin.json')
  const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  m.permissions.push('exec')
  fs.writeFileSync(manifestFile, JSON.stringify(m))
  const updated = P.createPluginHost({ core, platform, pluginsDir })
  const [entry] = await updated.init()
  assert.equal(entry.status, 'needs-approval')
  assert.deepEqual(entry.pendingApproval, ['exec'])
  assert.deepEqual(updated.tools(), [])
})

test('host: safe mode starts nothing', async () => {
  const { host, pluginsDir, platform, core } = makeHost({ demo: toolPlugin() })
  await host.init()
  await host.enable('demo', ['tools', 'files:read', 'hooks'])
  await host.shutdown()
  const safe = P.createPluginHost({ core, platform, pluginsDir, safeMode: true })
  assert.equal((await safe.init())[0].status, 'safe-mode')
  assert.deepEqual(safe.tools(), [])
})

test('host: remove deletes the folder; symlinked plugin folders are ignored', async () => {
  const { host, pluginsDir, root } = makeHost({ demo: toolPlugin() })
  const real = path.join(root, 'elsewhere')
  fs.mkdirSync(real)
  fs.writeFileSync(path.join(real, 'plugin.json'), JSON.stringify(valid({ id: 'linked' })))
  fs.writeFileSync(path.join(real, 'backend.cjs'), 'exports.activate = async () => {}')
  fs.symlinkSync(real, path.join(pluginsDir, 'linked'))
  await host.init()
  assert.deepEqual((await host.init()).map((p) => p.id), ['demo']) // a symlinked plugin folder is never scanned
  await host.remove('demo')
  assert.equal(fs.existsSync(path.join(pluginsDir, 'demo')), false)
  await assert.rejects(host.remove('linked'), /Unknown plugin/)
  assert.equal(fs.existsSync(path.join(real, 'plugin.json')), true) // the target is untouched
})

test('host: a manifest whose backend entry is a symlink out of the folder never loads', async () => {
  const { host, pluginsDir, root } = makeHost({ demo: toolPlugin() })
  fs.writeFileSync(path.join(root, 'evil.cjs'), 'exports.activate = async () => {}')
  fs.rmSync(path.join(pluginsDir, 'demo', 'backend.cjs'))
  fs.symlinkSync(path.join(root, 'evil.cjs'), path.join(pluginsDir, 'demo', 'backend.cjs'))
  await host.init()
  const s = await host.enable('demo', ['tools', 'files:read', 'hooks'])
  assert.equal(s.status, 'crashed')
  assert.match(s.lastError, /leaves the plugin folder/)
})

/* ------------------------------------------------- assets for opnduck-plugin:// */

test('readAsset serves a running plugin\'s UI files and nothing else', async () => {
  const card = { manifest: { id: 'card', name: 'Card', version: '1.0.0', apiVersion: 1, author: 'A', description: 'D', tagline: 't', icon: '★', scope: 'universal', ui: { entry: 'ui.js' }, backend: { entry: 'backend.cjs' } }, files: { 'ui.js': 'export default () => null', 'backend.cjs': 'exports.activate = async () => {}', 'style.css': 'a{}', 'run.sh': 'echo' } }
  const { host, pluginsDir, root } = makeHost({ card })
  fs.mkdirSync(path.join(pluginsDir, 'card', 'lib'))
  fs.writeFileSync(path.join(pluginsDir, 'card', 'lib', 'a.js'), 'x')
  fs.writeFileSync(path.join(root, 'secret.js'), 'secret')
  fs.symlinkSync(path.join(root, 'secret.js'), path.join(pluginsDir, 'card', 'leak.js'))
  await host.init()
  assert.throws(() => host.readAsset('card', 'ui.js'), /No such plugin UI/) // not enabled yet
  await host.enable('card', [])
  assert.deepEqual([host.readAsset('card', 'ui.js').type, host.readAsset('card', 'ui.js').data.toString()], ['text/javascript', 'export default () => null'])
  assert.equal(host.readAsset('card', 'style.css').type, 'text/css')
  assert.equal(host.readAsset('card', 'lib/a.js').data.toString(), 'x')
  for (const bad of ['backend.cjs', 'run.sh', '../secret.js', 'leak.js', 'nope.js', '', '/etc/passwd', 'lib/../ui.js', 'plugin.json/..']) assert.throws(() => host.readAsset('card', bad), undefined, bad)
  assert.throws(() => host.readAsset('missing', 'ui.js'), /No such plugin UI/)
  await host.disable('card')
  assert.throws(() => host.readAsset('card', 'ui.js'), /No such plugin UI/)
  await host.shutdown()
})

test('host: onChange fires on enable, disable, crash and init', async () => {
  const bad = { manifest: valid({ id: 'bad' }), files: { 'backend.cjs': 'exports.activate = async () => { throw new Error("x") }' } }
  let n = 0
  const { host } = makeHost({ bad }, { onChange: () => void n++ })
  await host.init()
  const afterInit = n
  assert.ok(afterInit >= 1)
  await host.enable('bad', [])
  assert.ok(n > afterInit)
  const afterEnable = n
  await host.disable('bad')
  assert.ok(n > afterEnable)
})

test('host: safe mode can be a function that is asked on every init', async () => {
  let safe = false
  const { host } = makeHost({ demo: toolPlugin() }, { safeMode: () => safe })
  await host.init()
  await host.enable('demo', ['tools', 'files:read', 'hooks'])
  assert.equal(host.list()[0].status, 'running')
  safe = true
  assert.equal((await host.init())[0].status, 'safe-mode')
  safe = false
  assert.equal((await host.init())[0].status, 'running')
  await host.shutdown()
})

/* ------------------------------------------------------- audit regressions */

test('ids that name Object.prototype members are refused', () => {
  for (const id of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) assert.equal(P.validateManifest(valid({ id })).ok, false, id)
})

test('isInside accepts names that merely start with two dots', () => {
  const root = tmp()
  assert.equal(P.isInside(root, path.join(root, '..foo')), true)
  assert.equal(P.isInside(root, path.join(root, '..', 'x')), false)
  assert.equal(P.isInside(root, root), true)
})

test('validateArgs survives a schema with a null property', () => {
  assert.doesNotThrow(() => P.validateArgs({ properties: { a: null } }, { a: 'x' }))
})

test('files.write refuses to write through a dangling symlink', async () => {
  const { api, downloads } = apiFor({}, ['files:write'])
  const outside = path.join(tmp(), 'target.txt')
  const link = path.join(downloads, 'link.txt')
  fs.symlinkSync(outside, link)
  await assert.rejects(api.call('files.write', [link, 'x']), /symlink/)
  assert.equal(fs.existsSync(outside), false)
  await api.call('files.write', [path.join(downloads, 'ok.txt'), 'fine'])
  assert.equal(fs.readFileSync(path.join(downloads, 'ok.txt'), 'utf8'), 'fine')
})

test('host: disabling during a slow activation stops cleanly; a double enable starts one worker', async () => {
  const slow = { manifest: valid({ id: 'slow', permissions: [] }), files: { 'backend.cjs': 'exports.activate = () => new Promise(() => {})' } }
  const ok = { manifest: valid({ id: 'fine', permissions: [] }), files: { 'backend.cjs': 'exports.activate = async () => {}' } }
  const { host } = makeHost({ slow, fine: ok })
  await host.init()
  const started = Date.now()
  const pending = host.enable('slow', [])
  await new Promise((r) => setTimeout(r, 300))
  const off = await host.disable('slow')
  await pending
  assert.equal(off.status, 'disabled')
  assert.equal(host.list().find((p) => p.id === 'slow').status, 'disabled')
  assert.ok(Date.now() - started < 5000, 'did not wait for the 10 s activation timeout')

  await Promise.all([host.enable('fine', []), host.enable('fine', [])])
  assert.equal(host.list().find((p) => p.id === 'fine').status, 'running')
  await host.shutdown()
})
