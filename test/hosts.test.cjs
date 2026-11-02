const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const E = require('../electron/core/remote/envelope.cjs')
const { createEngineApi } = require('../engine-api/server.cjs')
const { createDevices } = require('../engine-api/devices.cjs')
const { createUploads } = require('../engine-api/uploads.cjs')
const { createV1 } = require('../engine-api/v1.cjs')
const { buildEnginePairLink } = require('../engine-api/pairlink.cjs')
const { createServers } = require('../electron/core/remote/servers.cjs')
const { createHosts, remoteArgs } = require('../electron/core/remote/hosts.cjs')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hosts-'))
const seal = (t) => `s:${t}`
const unseal = (t) => t.slice(2)
const wait = async (fn, ms = 8000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

/** A fake engine on the server side: "convert" copies the upload to a result (slowly, so progress is seen). */
function remoteEngine(dir, { fail = false } = {}) {
  const tasks = new Map()
  const seen = []
  return {
    tasks,
    seen,
    broadcastTasks: () => {},
    taskFile: (id) => tasks.get(id)?.finalPath ?? null,
    cancelTask: (id) => {
      const t = tasks.get(id)
      if (t) t.state.status = 'canceled'
      return !!t
    },
    rerunTask: () => null,
    removeTasks: (ids) => ids.filter((i) => tasks.delete(i)).length,
    startHandlers: new Map([
      [
        'tasks:startConvert',
        async (_e, req) => {
          seen.push(req)
          const id = `r${tasks.size + 1}`
          const out = path.join(dir, `${path.basename(req.inputPath, path.extname(req.inputPath))}.${req.container.toLowerCase()}`)
          const entry = { state: { id, kind: 'convert', status: 'running', progress: 0.1 }, finalPath: out }
          tasks.set(id, entry)
          setTimeout(() => {
            if (entry.state.status === 'canceled') return
            if (fail) return Object.assign(entry.state, { status: 'error', error: 'ffmpeg exploded' })
            fs.copyFileSync(req.inputPath, out)
            Object.assign(entry.state, { status: 'done', progress: 1 })
          }, 400)
          return id
        },
      ],
    ]),
  }
}

async function setup(port, opts) {
  const dir = tmp()
  const devices = createDevices({ file: path.join(dir, 'd.json') })
  const engine = remoteEngine(dir, opts)
  const bus = new EventEmitter()
  const v1 = createV1({ engine, platform: { on: (c, f) => (bus.on(c, f), () => bus.off(c, f)) }, devices, uploads: createUploads({ dir: path.join(dir, 'up'), freeBytes: () => 1e12 }), name: () => 'Box', version: '1', info: () => ({}) })
  const api = createEngineApi({ inbox: { keys: () => E.deriveKeys(E.newSecret()), receive: async () => true }, name: () => 'Box', v1 })
  await api.start({ mode: 'localhost', port })
  const servers = createServers({ file: path.join(tmp(), 's.json'), seal, unseal })
  const added = await servers.add(buildEnginePairLink({ baseUrl: `http://127.0.0.1:${port}`, code: devices.newPairCode(), name: 'Box' }))
  // The local side: the few engine parts the mirror uses.
  const local = new Map()
  const outDir = tmp()
  const localEngine = {
    tasks: local,
    sanitizeBatch: () => null,
    broadcastTasks: () => {},
    addTask: (id, entry) => local.set(id, entry),
    updateTask: (id, patch) => {
      const e = local.get(id)
      if (e && !['done', 'error', 'canceled'].includes(e.state.status)) Object.assign(e.state, patch)
    },
  }
  const hosts = createHosts({ engine: localEngine, servers, defaultDownloadDir: () => outDir, uniqueOutputPath: (d, b, ext) => path.join(d, `${b}.${ext}`) })
  return { api, engine, servers, serverId: added.id, local, hosts, outDir, localEngine, dir }
}

test('a job on a server: upload, run, download, and the mirror task ends done with the result in the chosen folder', async () => {
  const h = await setup(47970)
  try {
    const input = path.join(tmp(), 'clip.mp4')
    const data = crypto.randomBytes(3000)
    fs.writeFileSync(input, data)
    const start = h.hosts.route('tasks:startConvert', async () => 'LOCAL')
    const id = await start(null, { inputPath: input, container: 'MKV', mode: 'transcode', destination: h.outDir, runOn: h.serverId, secret: 'x' })
    const entry = h.local.get(id)
    assert.deepEqual([entry.state.host, entry.state.label, entry.state.kind], ['Box', 'clip.mp4', 'convert'])
    assert.ok(await wait(() => entry.state.status === 'done'), `finished (${entry.state.status} ${entry.state.error})`)
    assert.equal(entry.state.progress, 1)
    assert.deepEqual(fs.readFileSync(path.join(h.outDir, 'clip.mkv')), data)
    assert.equal(entry.finalPath, path.join(h.outDir, 'clip.mkv'))
    assert.deepEqual(h.engine.seen[0].container, 'MKV')
    assert.ok(!('destination' in h.engine.seen[0]) && !('secret' in h.engine.seen[0]), 'the folder and extra fields never reach the server')
    assert.ok(await wait(() => h.engine.tasks.size === 0), 'the server forgets the job once the result is saved')
  } finally {
    await h.api.stop()
  }
})

test('routing: local by default, per-kind default sends it to a server, runOn overrides, and other channels are untouched', async () => {
  const h = await setup(47971)
  try {
    const calls = []
    const local = async (_e, req) => (calls.push(req), 'LOCAL')
    const start = h.hosts.route('tasks:startConvert', local)
    assert.equal(await start(null, { inputPath: '/x', container: 'MP4', runOn: 'local' }), 'LOCAL')
    assert.equal(await start(null, { inputPath: '/x', container: 'MP4' }), 'LOCAL')
    assert.deepEqual(calls[0], { inputPath: '/x', container: 'MP4' }, 'runOn is removed before the local job sees it')
    assert.equal(await start(null, { inputPath: '/x', container: 'MP4', runOn: 'ask' }), 'LOCAL')
    h.servers.setDefault('convert', h.serverId)
    await assert.rejects(start(null, { inputPath: '/does/not/exist.mp4', container: 'MP4' }), /file that exists/)
    assert.equal(await start(null, { inputPath: '/x', container: 'MP4', runOn: 'local' }), 'LOCAL', 'the card can still choose this PC')
    const other = async () => 'OTHER'
    assert.equal(h.hosts.route('tasks:startTag', other), other)
  } finally {
    await h.api.stop()
  }
})

test('a server that fails the job, or is gone, fails the mirror with a readable reason', async () => {
  const h = await setup(47972, { fail: true })
  try {
    const input = path.join(tmp(), 'a.mp4')
    fs.writeFileSync(input, 'abc')
    const start = h.hosts.route('tasks:startConvert', async () => 'LOCAL')
    const id = await start(null, { inputPath: input, container: 'MKV', runOn: h.serverId })
    const entry = h.local.get(id)
    assert.ok(await wait(() => entry.state.status === 'error'))
    assert.equal(entry.state.error, 'ffmpeg exploded')
  } finally {
    await h.api.stop()
  }
  await assert.rejects(h.hosts.route('tasks:startConvert', async () => 'L')(null, { inputPath: __filename, container: 'MKV', runOn: h.serverId }), /not available/)
})

test('cancel stops the mirror and tells the server; nothing is saved', async () => {
  const h = await setup(47973)
  try {
    const input = path.join(tmp(), 'b.mp4')
    fs.writeFileSync(input, crypto.randomBytes(500))
    const id = await h.hosts.route('tasks:startConvert', async () => 'L')(null, { inputPath: input, container: 'MKV', runOn: h.serverId, destination: h.outDir })
    const entry = h.local.get(id)
    assert.ok(await wait(() => entry.remoteId))
    entry.child.kill()
    h.localEngine.updateTask(id, { status: 'canceled' })
    assert.ok(await wait(() => h.engine.tasks.get(entry.remoteId)?.state.status === 'canceled'))
    await new Promise((r) => setTimeout(r, 2200))
    assert.deepEqual(fs.readdirSync(h.outDir), [])
    assert.equal(entry.state.status, 'canceled')
  } finally {
    await h.api.stop()
  }
})

test('only the settings the Engine API knows leave this PC', () => {
  assert.deepEqual(remoteArgs('download', { url: 'https://x/y', format: 'MP4', videoQuality: '720', destination: '/home/me', cookies: 'chrome', embedMeta: true, playlist: 'all' }), { url: 'https://x/y', format: 'MP4', videoQuality: '720', embedMeta: true })
  assert.deepEqual(remoteArgs('convert', { inputPath: '/a', container: 'MKV', mode: 'remux', destination: '/b', extra: 1 }), { container: 'MKV', mode: 'remux' })
})
