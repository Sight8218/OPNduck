const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const R = require('../electron/core/recipes.cjs')
const { producesFor, STEP_TYPES, TOOLS } = require('../electron/mcp_tools.cjs')

const rec = (over = {}) => ({ name: 'Test', input: 'video', steps: [{ tool: 'upscale_video', args: { scale: 2 } }, { tool: 'interpolate', args: {} }], ...over })

test('every start tool has a type entry, and every type entry is a start tool', () => {
  for (const t of TOOLS.filter((x) => x.channel)) assert.ok(STEP_TYPES[t.name], t.name)
  for (const name of Object.keys(STEP_TYPES)) assert.ok(TOOLS.some((t) => t.name === name && t.channel), name)
  for (const name of Object.keys(R.TOOL_KIND)) assert.ok(STEP_TYPES[name], name)
})

test('producesFor depends on the settings where it should', () => {
  assert.equal(producesFor('download', { format: 'MP3' }), 'audio')
  assert.equal(producesFor('download', { format: 'FLAC' }), 'audio')
  assert.equal(producesFor('download', { format: 'MP4' }), 'video')
  assert.equal(producesFor('download', {}), 'video')
  assert.equal(producesFor('convert', { container: 'M4A' }), 'audio')
  assert.equal(producesFor('convert', { container: 'PNG' }), 'image')
  assert.equal(producesFor('convert', { container: 'PDF' }), 'document')
  assert.equal(producesFor('convert', { container: 'MKV' }), 'video')
  assert.equal(producesFor('trim', {}, 'audio'), 'audio')
  assert.equal(producesFor('compress', {}, 'video'), 'video')
  assert.equal(producesFor('subtitles', {}, 'video'), 'subtitle')
  assert.equal(producesFor('nope', {}), null)
})

test('validateRecipe accepts a good chain and reports what it leaves behind', () => {
  const r = R.validateRecipe(rec())
  assert.deepEqual([r.name, r.input, r.steps.length, r.output], ['Test', 'video', 2, 'video'])
  assert.equal(R.validateRecipe({ name: 'a', input: 'url', steps: [{ tool: 'download', args: { format: 'MP3' } }, { tool: 'tag_music' }] }).output, 'audio')
})

test('validateRecipe refuses chains that cannot work, with a plain reason', () => {
  assert.throws(() => R.validateRecipe(rec({ steps: [{ tool: 'subtitles', args: {} }, { tool: 'upscale_video', args: {} }] })), /Step 2 .* can't take a subtitle file from step 1/)
  assert.throws(() => R.validateRecipe(rec({ input: 'url', steps: [{ tool: 'upscale_video', args: {} }] })), /Step 1 .* can't take a link/)
  assert.throws(() => R.validateRecipe(rec({ input: 'audio', steps: [{ tool: 'interpolate', args: {} }] })), /can't take audio/)
  assert.throws(() => R.validateRecipe(rec({ steps: [{ tool: 'convert', args: { container: 'PDF' } }, { tool: 'compress', args: { targetMB: 5 } }] })), /document/)
  assert.throws(() => R.validateRecipe(rec({ input: 'url', steps: [{ tool: 'download', args: { format: 'MP3' } }, { tool: 'upscale_video', args: {} }] })), /can't take audio/)
})

test('validateRecipe checks names, step counts, tool names and each tool\'s settings', () => {
  for (const bad of [null, [], {}, rec({ name: '' }), rec({ name: 'x'.repeat(61) }), rec({ input: 'text' }), rec({ steps: [] }), rec({ steps: Array.from({ length: 13 }, () => ({ tool: 'trim', args: { start: 0 } })) }), rec({ steps: [{ tool: 'list_jobs', args: {} }] }), rec({ steps: [{ tool: 'suggest_settings', args: {} }] }), rec({ steps: [{ tool: 'upscale_video', args: { scale: 99 } }] }), rec({ steps: [{ tool: 'upscale_video', args: { nope: 1 } }] }), rec({ steps: [{ tool: 'trim', args: {} }] })]) {
    assert.throws(() => R.validateRecipe(bad), undefined, JSON.stringify(bad)?.slice(0, 80))
  }
})

test('a recipe cannot smuggle in the input, a destination or a batch through a step\'s settings', () => {
  for (const key of ['inputPath', 'url', 'destination', 'batch', 'tags', 'hint']) {
    assert.throws(() => R.validateRecipe(rec({ steps: [{ tool: 'upscale_video', args: { [key]: '/etc/passwd' } }] })), /filled in by the recipe/, key)
  }
})

test('every built-in recipe is valid', () => {
  assert.ok(R.BUILT_IN.length >= 4)
  for (const b of R.BUILT_IN) {
    assert.ok(b.builtIn && b.id.startsWith('builtin:'))
    assert.doesNotThrow(() => R.validateRecipe(b), b.name)
  }
})

/* ------------------------------------------------------------ storage and runner */

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-rec-'))
  const tasks = new Map()
  const started = []
  let n = 0
  const startHandlers = new Map()
  for (const t of TOOLS.filter((x) => x.channel)) {
    startHandlers.set(t.channel, async (_e, req) => {
      const id = `t${++n}`
      const out = path.join(req.destination ?? dir, `out${n}.dat`)
      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.writeFileSync(out, 'x')
      tasks.set(id, { state: { id, status: 'running', group: req.batch ?? null }, finalPath: out, req })
      started.push({ id, channel: t.channel, req })
      return id
    })
  }
  const added = []
  const ctx = {
    platform: { paths: { userData: dir } },
    startHandlers,
    tasks,
    addTask: (id, entry) => (tasks.set(id, entry), added.push({ id, ...entry.state })),
    broadcastTasks() {},
    defaultDownloadDir: () => dir,
  }
  const { recipes } = R.createRecipes(ctx)
  const end = (id, status, extra = {}) => {
    const e = tasks.get(id)
    Object.assign(e.state, { status }, extra)
    const cb = e.onDone
    e.onDone = null
    cb?.(e.state)
  }
  const file = path.join(dir, 'in.mp4')
  fs.writeFileSync(file, 'x')
  return { recipes, tasks, started, added, end, dir, file, tmp: path.join(dir, 'recipes-tmp') }
}
const tick = () => new Promise((r) => setTimeout(r, 5))

test('storage: save, list, update, duplicate and remove; built-ins are read-only', () => {
  const h = harness()
  assert.equal(h.recipes.list().filter((r) => !r.builtIn).length, 0)
  const saved = h.recipes.save(rec())
  assert.match(saved.id, /^r-[0-9a-f]{8}$/)
  assert.equal(h.recipes.list().filter((r) => !r.builtIn).length, 1)
  const updated = h.recipes.save({ ...rec({ name: 'Renamed' }), id: saved.id })
  assert.equal(updated.id, saved.id)
  assert.equal(h.recipes.get(saved.id).name, 'Renamed')
  const copy = h.recipes.duplicate('builtin:upscale-and-smooth')
  assert.ok(!copy.builtIn && copy.name.endsWith('copy') && copy.steps.length === 2)
  assert.throws(() => h.recipes.save({ ...rec(), id: 'builtin:discord-ready' }), /read-only/)
  assert.equal(h.recipes.remove(saved.id), true)
  assert.equal(h.recipes.remove(saved.id), false)
  assert.equal(h.recipes.remove('builtin:discord-ready'), false)
  assert.throws(() => h.recipes.save(rec({ steps: [] })))
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.dir, 'recipes.json'), 'utf8')).recipes.every((r) => !('output' in r) && !('builtIn' in r)), true)
})

test('storage: a hand-edited bad entry is skipped, a corrupt file is an empty list', () => {
  const h = harness()
  fs.writeFileSync(path.join(h.dir, 'recipes.json'), JSON.stringify({ recipes: [{ id: 'r-1', name: 'ok', input: 'video', steps: [{ tool: 'trim', args: { start: 1 } }] }, { id: 'r-2', name: 'bad', input: 'video', steps: [{ tool: 'rm', args: {} }] }] }))
  assert.deepEqual(h.recipes.list().filter((r) => !r.builtIn).map((r) => r.id), ['r-1'])
  fs.writeFileSync(path.join(h.dir, 'recipes.json'), '{not json')
  assert.equal(h.recipes.list().filter((r) => !r.builtIn).length, 0)
})

test('runner: each step feeds the next, middle steps write to a temp folder, only the last goes to the destination', async () => {
  const h = harness()
  const dest = path.join(h.dir, 'final')
  const { runId, batchId } = await h.recipes.run(rec(), h.file, { destination: dest })
  assert.match(batchId, /^recipe-/)
  assert.equal(h.started.length, 1)
  assert.equal(h.started[0].req.inputPath, h.file)
  assert.ok(h.started[0].req.destination.startsWith(h.tmp), 'step 1 writes to the working folder')
  assert.deepEqual([h.started[0].req.batch.size, h.started[0].req.batch.label], [2, 'Recipe: Test'])
  h.end(h.started[0].id, 'done')
  await tick()
  assert.equal(h.started.length, 2)
  assert.equal(h.started[1].req.inputPath, h.tasks.get(h.started[0].id).finalPath, 'step 2 takes step 1\'s output')
  assert.equal(h.started[1].req.destination, dest)
  assert.equal(h.started[1].req.batch.id, batchId)
  assert.ok(fs.existsSync(path.join(h.tmp, runId)))
  h.end(h.started[1].id, 'done')
  await tick()
  assert.equal(h.recipes.status(runId).done, true)
  assert.equal(fs.existsSync(path.join(h.tmp, runId)), false, 'working files are deleted at the end')
})

test('runner: keepIntermediate keeps the working files; a one-step recipe has no group', async () => {
  const h = harness()
  const { runId } = await h.recipes.run(rec(), h.file, { keepIntermediate: true })
  h.end(h.started[0].id, 'done')
  await tick()
  h.end(h.started[1].id, 'done')
  await tick()
  assert.ok(fs.existsSync(path.join(h.tmp, runId)))
  const one = await h.recipes.run({ name: 'One', input: 'video', steps: [{ tool: 'compress', args: { targetMB: 5 } }] }, h.file)
  assert.equal(one.batchId, null)
  assert.equal(h.started[2].req.batch, undefined)
})

test('runner: a recipe from a link starts its first step with url, not a path', async () => {
  const h = harness()
  await h.recipes.run('builtin:download-mp3-and-tag', 'https://example.com/watch?v=1')
  assert.equal(h.started[0].channel, 'tasks:start')
  assert.equal(h.started[0].req.url, 'https://example.com/watch?v=1')
  assert.equal(h.started[0].req.format, 'MP3')
  assert.equal(h.started[0].req.inputPath, undefined)
  h.end(h.started[0].id, 'done')
  await tick()
  assert.equal(h.started[1].channel, 'tasks:startTag')
  assert.equal(h.started[1].req.inputPath, h.tasks.get(h.started[0].id).finalPath)
})

test('runner: when a step fails the rest are listed as skipped, and resume continues from the failed step', async () => {
  const h = harness()
  const three = { name: 'Three', input: 'video', steps: [{ tool: 'trim', args: { start: 0 } }, { tool: 'compress', args: { targetMB: 5 } }, { tool: 'convert', args: { container: 'MKV' } }] }
  const { runId } = await h.recipes.run(three, h.file)
  h.end(h.started[0].id, 'done')
  await tick()
  h.end(h.started[1].id, 'error', { error: 'ffmpeg broke' })
  await tick()
  assert.equal(h.recipes.status(runId).failedAt, 1)
  assert.equal(h.started.length, 2, 'step 3 did not start')
  assert.equal(h.added.length, 1)
  assert.deepEqual([h.added[0].status, h.added[0].kind, h.added[0].error], ['canceled', 'convert', 'Skipped: step 2 failed'])
  assert.equal(h.added[0].group.size, 3)
  assert.ok(fs.existsSync(path.join(h.tmp, runId)), 'files are kept so it can resume')

  await h.recipes.resume(runId)
  assert.equal(h.started.length, 3)
  assert.equal(h.started[2].channel, 'tasks:startCompress')
  assert.equal(h.started[2].req.inputPath, h.tasks.get(h.started[0].id).finalPath, 'the resumed step takes the earlier output')
  h.end(h.started[2].id, 'done')
  await tick()
  assert.equal(h.started.length, 4)
  h.end(h.started[3].id, 'done')
  await tick()
  assert.equal(h.recipes.status(runId).done, true)
  await assert.rejects(h.recipes.resume(runId), /Nothing to resume/)
})

test('runner: a canceled step skips the rest with a "was canceled" note', async () => {
  const h = harness()
  const { runId } = await h.recipes.run(rec(), h.file)
  h.end(h.started[0].id, 'canceled')
  await tick()
  assert.equal(h.recipes.status(runId).failedAt, 0)
  assert.equal(h.added[0].error, 'Skipped: step 1 was canceled')
})

test('runner: refuses a missing file, a relative path, a bad link and an unknown recipe, and starts nothing', async () => {
  const h = harness()
  await assert.rejects(h.recipes.run(rec(), path.join(h.dir, 'nope.mp4')), /does not exist/)
  await assert.rejects(h.recipes.run(rec(), 'in.mp4'), /absolute path/)
  await assert.rejects(h.recipes.run(rec(), h.dir), /regular file/)
  await assert.rejects(h.recipes.run('builtin:download-mp3-and-tag', 'ftp://x/y'), /http/)
  await assert.rejects(h.recipes.run('builtin:download-mp3-and-tag', 'not a link'), /full http/)
  await assert.rejects(h.recipes.run('nope', h.file), /No such recipe/)
  await assert.rejects(h.recipes.run(rec(), h.file, { destination: 'relative' }), /absolute/)
  assert.equal(h.started.length, 0)
})

test('runner: a step whose output file is gone fails the run instead of feeding nothing', async () => {
  const h = harness()
  await h.recipes.run(rec(), h.file)
  fs.rmSync(h.tasks.get(h.started[0].id).finalPath)
  h.end(h.started[0].id, 'done')
  await tick()
  assert.equal(h.started.length, 1)
  assert.equal(h.added.length, 1)
})
