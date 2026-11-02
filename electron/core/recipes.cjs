/*
 * OPNduck — local-first media processing suite.
 * Copyright (C) 2026 Aaron Jonsson
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */
/**
 * Recipes: a saved chain of tools. Each step's output file becomes the next step's input, and the steps of a run
 * show up in the Library as one group. This module stores the recipes (userData/recipes.json), checks that a chain
 * can work (each tool declares what it takes and gives, see STEP_TYPES in mcp_tools.cjs), and runs one by starting
 * each step through the same start handlers the UI and MCP use, so there is no second engine.
 * No Electron: everything comes in through `ctx`. The validation helpers are exported for the tests.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { TOOLS, DEFAULTS, STEP_TYPES, producesFor, buildStartRequest } = require('../mcp_tools.cjs')

const INPUT_TYPES = ['url', 'video', 'audio', 'image']
const MAX_STEPS = 12
const MAX_RECIPES = 200
/** The `kind` shown in the Library for each tool (a skipped step is listed under it). */
const TOOL_KIND = { download: 'download', convert: 'convert', upscale_image: 'upscale', upscale_video: 'upscale', interpolate: 'interpolate', subtitles: 'subtitles', trim: 'trim', compress: 'compress', make_gif: 'gif', tag_music: 'tag', audio_ai: 'audio-ai' }
/** Starting values for required settings that have no default of their own, so a new step is valid straight away. */
const START_VALUES = { compress: { targetMB: 20 }, trim: { start: 0 }, convert: { container: 'MP4' }, subtitles: {} }
const RESERVED_ARGS = ['inputPath', 'url', 'destination', 'batch', 'tags', 'hint']

/** Recipes that ship with OPNduck: read-only, but you can duplicate them. */
const BUILT_IN = [
  { id: 'builtin:upscale-and-smooth', name: 'Upscale and smooth', input: 'video', steps: [{ tool: 'upscale_video', args: { scale: 2 } }, { tool: 'interpolate', args: { multiplier: 2 } }] },
  { id: 'builtin:download-mp3-and-tag', name: 'Download as MP3 and tag', input: 'url', steps: [{ tool: 'download', args: { format: 'MP3' } }, { tool: 'tag_music', args: {} }] },
  { id: 'builtin:discord-ready', name: 'Make it Discord-ready', input: 'video', steps: [{ tool: 'compress', args: { targetMB: 20, quality: 'fast' } }] },
  { id: 'builtin:phone-friendly', name: 'Phone-friendly copy', input: 'video', steps: [{ tool: 'convert', args: { container: 'MP4', mode: 'transcode' } }, { tool: 'compress', args: { targetMB: 200, quality: 'fast' } }] },
].map((r) => ({ ...r, builtIn: true }))

const isTool = (name) => Object.hasOwn(STEP_TYPES, name) && TOOLS.some((t) => t.name === name && t.channel)

/** Checks a recipe and returns a clean copy; throws a readable Error. Does not touch the disk. */
function validateRecipe(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('A recipe must be an object')
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name || name.length > 60) throw new Error('Give the recipe a name of 1 to 60 characters')
  if (!INPUT_TYPES.includes(raw.input)) throw new Error(`A recipe starts from one of: ${INPUT_TYPES.join(', ')}`)
  if (!Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > MAX_STEPS) throw new Error(`A recipe needs 1 to ${MAX_STEPS} steps`)
  const steps = []
  let type = raw.input
  raw.steps.forEach((s, i) => {
    const n = i + 1
    if (!s || typeof s !== 'object' || !isTool(s.tool)) throw new Error(`Step ${n}: unknown tool`)
    const args = s.args == null ? {} : s.args
    if (typeof args !== 'object' || Array.isArray(args)) throw new Error(`Step ${n}: settings must be an object`)
    for (const k of RESERVED_ARGS) if (k in args) throw new Error(`Step ${n}: "${k}" is filled in by the recipe, not saved in it`)
    if (!STEP_TYPES[s.tool].accepts.includes(type)) {
      throw new Error(`Step ${n} (${s.tool.replace(/_/g, ' ')}) can't take ${type === 'url' ? 'a link' : type === 'subtitle' ? 'a subtitle file' : type === 'document' ? 'a document' : type}${i === 0 ? '' : ` from step ${i}`}`)
    }
    // Validate the settings against the tool's own schema, with a stand-in for the input the runner fills in.
    const stand = i === 0 && raw.input === 'url' ? { url: 'https://example.com/x' } : { inputPath: '/stand-in' }
    try {
      buildStartRequest(s.tool, { ...args, ...stand })
    } catch (err) {
      throw new Error(`Step ${n}: ${err.message}`)
    }
    steps.push({ tool: s.tool, args: { ...args } })
    type = producesFor(s.tool, args, type)
  })
  return { name, input: raw.input, steps, output: type }
}

const sweepOlderThan = (dir, ms) => {
  try {
    for (const d of fs.readdirSync(dir)) {
      const full = path.join(dir, d)
      if (Date.now() - fs.statSync(full).mtimeMs > ms) fs.rmSync(full, { recursive: true, force: true })
    }
  } catch {
    /* nothing to sweep */
  }
}

function createRecipes(ctx) {
  const { platform, startHandlers, tasks, addTask, broadcastTasks, defaultDownloadDir } = ctx
  const file = path.join(platform.paths.userData, 'recipes.json')
  const tmpRoot = path.join(platform.paths.userData, 'recipes-tmp')
  const runs = new Map()
  sweepOlderThan(tmpRoot, 24 * 3600 * 1000) // leftovers of runs from an earlier session

  function readUser() {
    try {
      const list = JSON.parse(fs.readFileSync(file, 'utf8'))?.recipes
      return (Array.isArray(list) ? list : []).flatMap((r) => {
        try {
          return [{ id: String(r.id), ...validateRecipe(r) }]
        } catch {
          return [] // a hand-edited entry that no longer validates is skipped, not fatal
        }
      })
    } catch {
      return []
    }
  }

  function writeUser(list) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ recipes: list }, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, file)
  }

  const list = () => [...BUILT_IN.map((r) => ({ ...r, ...{ output: validateRecipe(r).output } })), ...readUser()]
  const get = (id) => list().find((r) => r.id === id) ?? null

  function save(raw) {
    const clean = validateRecipe(raw)
    const user = readUser()
    let id = typeof raw.id === 'string' ? raw.id : ''
    if (id.startsWith('builtin:')) throw new Error('Built-in recipes are read-only: duplicate it first')
    const at = user.findIndex((r) => r.id === id)
    if (at < 0) {
      if (user.length >= MAX_RECIPES) throw new Error('Too many recipes')
      id = `r-${crypto.randomUUID().slice(0, 8)}`
      user.push({ id, ...clean })
    } else user[at] = { id, ...clean }
    writeUser(user.map(({ output: _o, ...r }) => r))
    return { id, ...clean }
  }

  function remove(id) {
    const user = readUser()
    if (!user.some((r) => r.id === id)) return false
    writeUser(user.filter((r) => r.id !== id).map(({ output: _o, ...r }) => r))
    return true
  }

  function duplicate(id) {
    const r = get(id)
    if (!r) throw new Error('No such recipe')
    return save({ name: `${r.name.slice(0, 52)} copy`, input: r.input, steps: r.steps })
  }

  /* ----------------------------------------------------------------- the runner */

  const outputFile = (id) => {
    const f = tasks.get(id)?.finalPath
    return f && fs.existsSync(f) ? f : null
  }

  async function startStep(run, i) {
    const step = run.recipe.steps[i]
    const last = i === run.recipe.steps.length - 1
    const feed = i === 0 ? run.input : run.outputs[i - 1]
    const args = { ...step.args, ...(i === 0 && run.recipe.input === 'url' ? { url: feed } : { inputPath: feed }) }
    const { channel, req } = buildStartRequest(step.tool, args)
    if (!last) {
      fs.mkdirSync(run.tmpDir, { recursive: true })
      req.destination = run.tmpDir // only the last step's file is kept; the ones before are working files
    } else if (run.destination) req.destination = run.destination
    if (run.batch) req.batch = run.batch
    const start = startHandlers.get(channel)
    if (!start) throw new Error(`This build cannot run ${step.tool}`)
    const id = await start(null, req)
    run.ids[i] = id
    const entry = tasks.get(id)
    if (!entry) throw new Error('The step did not start')
    entry.recipeRun = { runId: run.id, step: i }
    const after = (state) => stepEnded(run, i, id, state)
    if (['done', 'error', 'canceled'].includes(entry.state.status)) after(entry.state)
    else entry.onDone = after
    return id
  }

  function stepEnded(run, i, id, state) {
    if (state.status === 'done') {
      const out = outputFile(id)
      if (i === run.recipe.steps.length - 1) {
        run.outputs[i] = out
        return finish(run)
      }
      if (!out) return fail(run, i, 'it produced no file')
      run.outputs[i] = out
      startStep(run, i + 1).catch((err) => fail(run, i + 1, err.message))
    } else fail(run, i, state.status === 'canceled' ? 'it was canceled' : state.error || 'it failed')
  }

  /** Marks the steps that will not run as skipped (so the group reads as one story) and keeps the files for a resume. */
  function fail(run, i, why) {
    run.failedAt = i
    for (let j = i + 1; j < run.recipe.steps.length; j++) {
      if (run.ids[j]) continue
      const id = crypto.randomUUID()
      run.ids[j] = id
      addTask(id, {
        state: {
          id,
          kind: TOOL_KIND[run.recipe.steps[j].tool],
          status: 'canceled',
          progress: 0,
          label: run.recipe.steps[j].tool.replace(/_/g, ' '),
          format: '',
          quality: '',
          error: `Skipped: step ${i + 1} ${why === 'it was canceled' ? 'was canceled' : 'failed'}`,
          sizeBytes: null,
          sizeIsEstimate: false,
          thumbnailUrl: null,
          experimentalMatch: null,
          group: run.batch ?? null,
        },
        child: null,
        finalPath: null,
      })
    }
    broadcastTasks()
  }

  function finish(run) {
    run.done = true
    run.failedAt = null
    if (!run.keep) fs.rmSync(run.tmpDir, { recursive: true, force: true })
  }

  /**
   * Starts a recipe on one input (a file path, or a link for a recipe that starts from a link).
   * @param {string|object} recipeOrId  a saved recipe id, or a recipe object (validated)
   * @param {string} input
   * @param {{ destination?: string, keepIntermediate?: boolean }} [opts]
   */
  async function run(recipeOrId, input, opts = {}) {
    const recipe = typeof recipeOrId === 'string' ? get(recipeOrId) : { id: '', ...validateRecipe(recipeOrId) }
    if (!recipe) throw new Error('No such recipe')
    validateRecipe(recipe)
    if (recipe.input === 'url') {
      let u
      try {
        u = new URL(input)
      } catch {
        throw new Error('This recipe starts from a link: give a full http(s) link')
      }
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error('The link must start with http:// or https://')
    } else {
      if (typeof input !== 'string' || !path.isAbsolute(input)) throw new Error('Give the file as an absolute path')
      let st
      try {
        st = fs.statSync(input)
      } catch {
        throw new Error(`This file does not exist: ${input}`)
      }
      if (!st.isFile()) throw new Error('That is not a regular file')
    }
    if (opts.destination != null && (typeof opts.destination !== 'string' || !path.isAbsolute(opts.destination))) throw new Error('destination must be an absolute path')
    const runId = crypto.randomUUID()
    const steps = recipe.steps.length
    const r = {
      id: runId,
      recipe,
      input,
      ids: [],
      outputs: [],
      failedAt: null,
      done: false,
      keep: opts.keepIntermediate === true,
      destination: opts.destination ?? null,
      tmpDir: path.join(tmpRoot, runId),
      batch: steps > 1 ? { id: `recipe-${runId}`, label: `Recipe: ${recipe.name}`, size: steps } : null,
    }
    runs.set(runId, r)
    if (runs.size > 50) runs.delete(runs.keys().next().value)
    try {
      await startStep(r, 0)
    } catch (err) {
      runs.delete(runId)
      throw err
    }
    return { runId, batchId: r.batch?.id ?? null, taskIds: r.ids }
  }

  /** Picks a failed or canceled run up where it stopped, with the files already made. In this session only. */
  async function resume(runId) {
    const r = runs.get(runId)
    if (!r || r.failedAt == null) throw new Error('Nothing to resume')
    const i = r.failedAt
    r.failedAt = null
    r.ids.length = i // the placeholders of skipped steps stay in the Library; the new tasks replace them in the run
    r.outputs.length = i
    try {
      await startStep(r, i)
    } catch (err) {
      fail(r, i, err.message)
      throw err
    }
    return { runId, taskIds: r.ids }
  }

  /** The tools a step can use, for the editor: title, what it takes and gives, and its settings (without the input). */
  function tools() {
    return Object.keys(STEP_TYPES).map((name) => {
      const def = TOOLS.find((t) => t.name === name)
      const properties = Object.fromEntries(Object.entries(def.inputSchema.properties).filter(([k]) => !RESERVED_ARGS.includes(k)))
      return {
        name,
        description: def.description.replace(/ Returns a job id\.$/, ''),
        accepts: STEP_TYPES[name].accepts,
        required: (def.inputSchema.required ?? []).filter((k) => !RESERVED_ARGS.includes(k)),
        properties,
        defaults: Object.fromEntries(Object.entries({ ...(START_VALUES[name] ?? {}), ...(DEFAULTS[name] ?? {}) }).filter(([k]) => k in properties)),
      }
    })
  }

  const EXTS = {
    video: ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'flv', 'wmv', 'ts'],
    audio: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'opus', 'aac', 'wma'],
    image: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'avif'],
  }

  /** The files in a folder (and one level of subfolders) a recipe starting from \`input\` can run on, at most 200. */
  function filesIn(folder, input) {
    const exts = EXTS[input]
    if (!exts || typeof folder !== 'string' || !path.isAbsolute(folder)) return []
    const out = []
    const visit = (dir, depth) => {
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const e of entries) {
        if (out.length >= 200) return
        const full = path.join(dir, e.name)
        if (e.isFile() && exts.includes(path.extname(e.name).slice(1).toLowerCase())) out.push(full)
        else if (e.isDirectory() && depth < 1 && !e.name.startsWith('.')) visit(full, depth + 1)
      }
    }
    visit(folder, 0)
    return out
  }

  const status = (runId) => {
    const r = runs.get(runId)
    return r ? { runId, recipe: r.recipe.name, steps: r.recipe.steps.length, done: r.done, failedAt: r.failedAt, taskIds: [...r.ids] } : null
  }

  return { recipes: { list, get, save, remove, duplicate, run, resume, status, tools, filesIn, validate: validateRecipe } }
}

module.exports = { createRecipes, validateRecipe, BUILT_IN, INPUT_TYPES, TOOL_KIND, MAX_STEPS }
