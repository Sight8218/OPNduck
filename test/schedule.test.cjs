const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { EventEmitter } = require('node:events')
const S = require('../electron/core/schedule.cjs')
const { systemActionCommand } = require('../electron/core/platform.cjs')

const at = (h, m = 0) => new Date(2026, 10, 3, h, m)
const SC = { window: false, from: '23:00', to: '07:00', battery: false, heat: false, maxC: 85, idle: false, idleMinutes: 10, downloads: false, whenDone: 'nothing', powerConfirmed: false }

test('time window: normal, over midnight, and equal times mean always', () => {
  assert.equal(S.inWindow(at(23, 0), '23:00', '07:00'), true)
  assert.equal(S.inWindow(at(3), '23:00', '07:00'), true)
  assert.equal(S.inWindow(at(7, 0), '23:00', '07:00'), false)
  assert.equal(S.inWindow(at(12), '23:00', '07:00'), false)
  assert.equal(S.inWindow(at(10), '09:00', '17:00'), true)
  assert.equal(S.inWindow(at(18), '09:00', '17:00'), false)
  assert.equal(S.inWindow(at(18), '08:00', '08:00'), true)
})

test('block reasons come in a fixed order and unknown state never blocks', () => {
  const env = { now: at(12), onBattery: true, idleSec: 30, hot: true, temp: 88 }
  assert.equal(S.blockReason(SC, env), '', 'everything off: never blocked')
  assert.equal(S.blockReason({ ...SC, window: true, battery: true }, env), 'Waiting for 23:00')
  assert.equal(S.blockReason({ ...SC, battery: true, heat: true }, env), 'Waiting for power (on battery)')
  assert.equal(S.blockReason({ ...SC, heat: true, idle: true }, env), 'Cooling down (88 °C)')
  assert.equal(S.blockReason({ ...SC, idle: true }, env), 'Waiting until you are away')
  assert.equal(S.blockReason({ ...SC, idle: true }, { ...env, idleSec: 11 * 60 }), '')
  assert.equal(S.blockReason({ ...SC, battery: true, idle: true }, { ...env, onBattery: null, idleSec: null }), '', 'a rule that cannot be checked is not applied')
})

test('heat guard pauses at the limit and resumes 8 degrees below it, not before', () => {
  assert.equal(S.nextHot(false, 84, 85), false)
  assert.equal(S.nextHot(false, 85, 85), true)
  assert.equal(S.nextHot(true, 80, 85), true)
  assert.equal(S.nextHot(true, 77, 85), false)
  assert.equal(S.nextHot(true, null, 85), true, 'no reading keeps the state')
})

test('the commands that sleep and shut down, per system', () => {
  assert.deepEqual(systemActionCommand('sleep', 'linux'), ['systemctl', ['suspend']])
  assert.deepEqual(systemActionCommand('shutdown', 'linux'), ['systemctl', ['poweroff']])
  assert.equal(systemActionCommand('shutdown', 'win32')[0], 'shutdown')
  assert.equal(systemActionCommand('sleep', 'darwin')[0], 'pmset')
})

function fake(overrides = {}) {
  const bus = new EventEmitter()
  const tasks = new Map()
  const pools = { downloadPool: { heavy: false, drain() {} }, gpuPool: { heavy: true, drain() {} }, convertPool: { heavy: true, drain() {} }, whisperPool: { heavy: true, drain() {} } }
  let gate = () => ''
  const engine = { tasks, allPools: Object.values(pools), pools, updateTask: (id, p) => Object.assign(tasks.get(id).state, p), setGate: (g) => (gate = g) }
  const platform = { emit: (c, d) => bus.emit(c, d), isOnBattery: () => false, idleSeconds: () => null, canCountdown: () => true, notify: (n) => bus.emit('notify', n), systemAction: (k) => bus.emit('system', k), ...overrides.platform }
  let settings = { ...SC, ...overrides.sc }
  const sched = S.createSchedule({ engine, platform, getSettings: () => ({ schedule: settings }), readTemp: overrides.readTemp ?? (async () => 60), now: () => overrides.now ?? at(12) })
  return { sched, engine, bus, pools, set: (p) => (settings = { ...settings, ...p }), gate: () => gate }
}

test('the gate holds heavy pools, leaves downloads alone unless asked, and marks waiting jobs', async () => {
  const f = fake({ sc: { window: true } })
  f.sched.start()
  assert.equal(f.sched.gate(f.pools.convertPool), 'Waiting for 23:00')
  assert.equal(f.sched.gate(f.pools.downloadPool), '')
  f.set({ downloads: true })
  assert.equal(f.sched.gate(f.pools.downloadPool), 'Waiting for 23:00')
  f.engine.tasks.set('a', { state: { id: 'a', status: 'queued' }, pool: f.pools.convertPool })
  f.engine.tasks.set('b', { state: { id: 'b', status: 'queued' }, pool: f.pools.downloadPool })
  f.set({ downloads: false })
  await f.sched.tick()
  assert.equal(f.engine.tasks.get('a').state.waiting, 'Waiting for 23:00')
  assert.ok(!f.engine.tasks.get('b').state.waiting)
  f.set({ window: false })
  await f.sched.tick()
  assert.equal(f.engine.tasks.get('a').state.waiting, null, 'released when the rule no longer applies')
  f.sched.stop()
})

test('heat: a running GPU job is stopped when hot and continued when cool, and stop() never leaves it frozen', { skip: process.platform === 'win32' }, async () => {
  let temp = 90
  const f = fake({ sc: { heat: true }, readTemp: async () => temp })
  const child = spawn('sleep', ['30'])
  const state = () => fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8').split(') ')[1][0]
  f.engine.tasks.set('g', { state: { id: 'g', status: 'running' }, pool: f.pools.gpuPool, child })
  try {
    await f.sched.tick()
    assert.equal(f.sched.status().hot, true)
    assert.match(f.engine.tasks.get('g').state.waiting, /Cooling down \(90/)
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(state(), 'T', 'stopped')
    temp = 79
    await f.sched.tick()
    assert.equal(f.sched.status().hot, true, 'still above limit minus 8')
    temp = 76
    await f.sched.tick()
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(f.sched.status().hot, false)
    assert.notEqual(state(), 'T')
    assert.equal(f.engine.tasks.get('g').state.waiting, null)
    temp = 95
    await f.sched.tick()
    f.sched.stop()
    await new Promise((r) => setTimeout(r, 100))
    assert.notEqual(state(), 'T', 'stop() continues a frozen job')
  } finally {
    child.kill('SIGKILL')
  }
})

test('when the queue finishes: notify, or a 60 second cancelable countdown for sleep and shutdown, only once confirmed', async () => {
  const f = fake({ sc: { whenDone: 'notify' } })
  f.engine.tasks.set('a', { state: { id: 'a', status: 'running' }, pool: f.pools.convertPool })
  const events = []
  f.bus.on('notify', (n) => events.push(['notify', n.title]))
  f.bus.on('queue:countdown', (c) => events.push(['countdown', c && c.action]))
  f.bus.on('system', (k) => events.push(['system', k]))
  await f.sched.tick()
  assert.deepEqual(events, [], 'still busy')
  f.engine.tasks.get('a').state.status = 'done'
  await f.sched.tick()
  assert.deepEqual(events, [['notify', 'OPNduck: the queue is empty']])
  await f.sched.tick()
  assert.equal(events.length, 1, 'only once per emptied queue')

  f.set({ whenDone: 'sleep', powerConfirmed: false })
  f.engine.tasks.set('b', { state: { id: 'b', status: 'running' }, pool: f.pools.convertPool })
  await f.sched.tick()
  f.engine.tasks.get('b').state.status = 'done'
  await f.sched.tick()
  assert.deepEqual(events.slice(1), [['notify', 'OPNduck: the queue is empty']], 'not confirmed: only a notification')

  f.set({ powerConfirmed: true })
  f.engine.tasks.set('c', { state: { id: 'c', status: 'running' }, pool: f.pools.convertPool })
  await f.sched.tick()
  f.engine.tasks.get('c').state.status = 'done'
  await f.sched.tick()
  assert.deepEqual(events.slice(2), [['countdown', 'sleep']])
  assert.equal(f.sched.status().countdown.action, 'sleep')
  assert.equal(f.sched.cancelCountdown(), true)
  assert.deepEqual(events.slice(3), [['countdown', null]])
  assert.ok(!events.some((e) => e[0] === 'system'), 'canceled: nothing happened')
  f.sched.stop()

  const tui = fake({ sc: { whenDone: 'shutdown', powerConfirmed: true }, platform: { canCountdown: () => false } })
  tui.engine.tasks.set('t', { state: { id: 't', status: 'running' }, pool: tui.pools.convertPool })
  const out = []
  tui.bus.on('notify', () => out.push('notify'))
  tui.bus.on('system', () => out.push('system'))
  await tui.sched.tick()
  tui.engine.tasks.get('t').state.status = 'done'
  await tui.sched.tick()
  assert.deepEqual(out, ['notify'], 'a terminal app never shuts the computer down on its own')
})

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
test('with the real engine: a job waits while the window is closed and runs when the rule goes away', { skip: !hasFfmpeg }, async () => {
  const { createCore } = require('../electron/core/index.cjs')
  const { createNodePlatform } = require('../electron/core/platform.cjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sch-'))
  const platform = createNodePlatform({ version: 'test' })
  platform.paths = { userData: path.join(dir, 'app'), downloads: path.join(dir, 'dl'), documents: dir }
  const core = createCore({ platform, safeMode: true })
  const input = path.join(dir, 'a.wav')
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=duration=1', input])
  const h = new Date().getHours()
  const closed = `${String((h + 2) % 24).padStart(2, '0')}:00`
  const end = `${String((h + 3) % 24).padStart(2, '0')}:00`
  core.settings.setSettings({ schedule: { window: true, from: closed, to: end } })
  core.schedule.start()
  try {
    const id = await core.startJob('tasks:startConvert', { inputPath: input, container: 'MP3', destination: dir })
    await core.schedule.tick()
    await new Promise((r) => setTimeout(r, 500))
    const state = core.engine.tasks.get(id).state
    assert.equal(state.status, 'queued')
    assert.equal(state.waiting, `Waiting for ${closed}`)
    core.settings.setSettings({ schedule: { window: false } })
    await core.schedule.tick()
    for (let i = 0; i < 100 && core.engine.tasks.get(id).state.status !== 'done'; i++) await new Promise((r) => setTimeout(r, 100))
    assert.equal(core.engine.tasks.get(id).state.status, 'done', core.engine.tasks.get(id).state.error)
  } finally {
    core.shutdown()
  }
})
