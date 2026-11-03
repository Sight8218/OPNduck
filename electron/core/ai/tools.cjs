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
 * The AI tool bridge: the same job definitions the MCP server and the terminal app use (electron/mcp_tools.cjs),
 * turned into what a model can call. A model can only *propose* jobs (the person confirms them); reading things (job
 * status, file facts, recommended settings) runs at once. Arguments are checked by the same schemas, paths must be
 * files the person picked or that are in the Library, and there are no shell or delete tools.
 */
const path = require('node:path')
const { TOOLS, buildStartRequest } = require('../../mcp_tools.cjs')

const MAX_CALLS = 10

/** Tools whose call starts something: the model gets a plan card, not a result. */
const PROPOSAL_EXTRA = ['run_recipe', 'change_theme', 'change_setting']
/** Tools a model may call to look: they change nothing. */
const READ_ONLY = ['probe_media', 'list_jobs', 'job_status', 'list_recipes', 'suggest_settings', 'list_settings']

const isProposal = (name) => name === 'change_theme' || name === 'change_setting' || !!TOOLS.find((t) => t.name === name)?.channel || PROPOSAL_EXTRA.includes(name)
const isRead = (name) => READ_ONLY.includes(name)

/** Changes how the app looks, not what it does: the person confirms it, and the window applies it. */
/** Colour words and every theme there is. Kept as an enum so a small model cannot invent a theme; a test checks it against the palettes. */
const THEME_NAMES = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'blarange', 'monochrome', 'catppuccin', 'catppuccin-latte', 'ethereal', 'everforest', 'flexoki-light', 'gruvbox', 'hackerman', 'jade-horse', 'kanagawa', 'last-horizon', 'lumon', 'lupine', 'matte-black', 'miasma', 'nord', 'osaka-jade', 'retro-82', 'ristretto', 'rose-pine', 'solitude', 'starship', 'tokyo-night', 'vantablack', 'white']
const THEME_TOOL = {
  name: 'change_theme',
  description: "Change the app's colour theme. Pass a colour like green, blue or orange, or a theme name like osaka-jade or monochrome; the app picks the closest theme. The person confirms first.",
  parameters: { type: 'object', properties: { theme: { type: 'string', enum: THEME_NAMES, description: 'A colour or a theme name' } }, required: ['theme'], additionalProperties: false },
}

const SETTING_TOOLS = [
  {
    name: 'change_setting',
    description: 'Change one app setting (call list_settings first to see the keys and values). The person confirms first. Sharing, keys, folders and power settings are not available: tell them to use Settings.',
    parameters: { type: 'object', properties: { setting: { type: 'string', description: 'A key from list_settings' }, value: { description: 'The new value: true or false, a number, or text' } }, required: ['setting', 'value'], additionalProperties: false },
  },
  { name: 'list_settings', description: 'The app settings you can change, with what each does, its allowed values and its current value.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
]

/** The tools in a provider-neutral shape: { name, description, parameters }. */
function definitions() {
  return [...definitionsOfJobs(), THEME_TOOL, ...SETTING_TOOLS]
}

function definitionsOfJobs() {
  return TOOLS.filter((t) => t.channel || PROPOSAL_EXTRA.includes(t.name) || READ_ONLY.includes(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  }))
}

const fail = (message) => Object.assign(new Error(message), { toolError: true })

/**
 * Turns a model's call into a checked proposal: { tool, args, channel?, req? }. Throws a readable message when the call
 * is wrong, which is sent back to the model so it can fix itself.
 * @param {object} deps
 * @param {(p: string) => boolean} deps.isKnownFile  a file the person picked or a Library file
 * @param {(id: string) => object|null} [deps.getRecipe]
 */
function propose(name, args, deps) {
  if (!isProposal(name)) throw fail(`${name} is not a tool that starts a job`)
  if (name === 'change_theme') {
    const theme = String(args?.theme ?? '').trim().toLowerCase().slice(0, 40)
    if (!THEME_NAMES.includes(theme)) throw fail(`There is no theme called "${theme}". Use one of: ${THEME_NAMES.join(', ')}`)
    return { tool: name, args: { theme } }
  }
  if (name === 'change_setting') {
    let change
    try {
      change = require('./app_settings.cjs').check(args?.setting, args?.value, deps.getSettings?.() ?? {})
    } catch (err) {
      throw fail(err.message)
    }
    return { tool: name, args: { setting: change.key, value: change.value }, change }
  }
  if (name === 'run_recipe') {
    const recipe = deps.getRecipe?.(String(args?.recipe))
    if (!recipe) throw fail('No recipe with that id. Use list_recipes first.')
    const input = String(args?.input ?? '')
    if (recipe.input === 'url') {
      try {
        if (!['http:', 'https:'].includes(new URL(input).protocol)) throw new Error()
      } catch {
        throw fail('This recipe needs a full http(s) link as input')
      }
    } else if (!path.isAbsolute(input) || !deps.isKnownFile(input)) throw fail('The input must be a file the person picked or one in the Library')
    return { tool: name, args: { recipe: recipe.id, input } }
  }
  let built
  try {
    built = buildStartRequest(name, args)
  } catch (err) {
    throw fail(err.message)
  }
  const { channel, req } = built
  if (name === 'download') {
    try {
      if (!['http:', 'https:'].includes(new URL(req.url).protocol)) throw new Error()
    } catch {
      throw fail('url must be a full http(s) link')
    }
  } else {
    for (const p of [req.inputPath, req.backgroundImage, ...(Array.isArray(req.clips) ? req.clips : [])].filter(Boolean)) {
      if (!path.isAbsolute(p)) throw fail('Paths must be absolute')
      if (!deps.isKnownFile(p)) throw fail(`${path.basename(p)} is not a file the person picked or one in the Library. Ask them to add it.`)
    }
  }
  return { tool: name, args: args ?? {}, channel, req }
}

/**
 * Runs a read-only tool. `deps`: tasks (Map), probeMedia, analyzeMedia, recipes, isKnownFile, suggest.
 */
async function readTool(name, args, deps) {
  const a = args && typeof args === 'object' ? args : {}
  switch (name) {
    case 'list_jobs': {
      let list = [...deps.tasks.values()]
      if (a.status) list = list.filter((t) => t.state.status === a.status)
      return list.slice(-30).map((t) => ({ id: t.state.id, kind: t.state.kind, status: t.state.status, progress: Math.round((t.state.progress ?? 0) * 100) / 100, label: t.state.label, error: t.state.error ?? null }))
    }
    case 'job_status': {
      const t = deps.tasks.get(String(a.id))
      if (!t) throw fail('No job with that id')
      const n = Number.isInteger(a.logLines) ? Math.min(Math.max(a.logLines, 0), 40) : 15
      const lines = t.log?.lines ? [...t.log.lines] : []
      return { id: t.state.id, kind: t.state.kind, status: t.state.status, progress: t.state.progress, label: t.state.label, error: t.state.error ?? null, outputPath: t.finalPath ?? null, log: n ? lines.slice(-n) : [] }
    }
    case 'list_settings':
      return require('./app_settings.cjs').describe(deps.getSettings?.() ?? {})
    case 'list_recipes':
      return (deps.recipes?.list() ?? []).map((r) => ({ id: r.id, name: r.name, input: r.input, steps: r.steps.map((s) => s.tool) }))
    case 'probe_media':
      if (!path.isAbsolute(String(a.path)) || !deps.isKnownFile(a.path)) throw fail('That is not a file the person picked or one in the Library')
      return (await deps.probeMedia(a.path)) ?? { error: 'Could not read that file' }
    case 'suggest_settings': {
      if (!path.isAbsolute(String(a.inputPath)) || !deps.isKnownFile(a.inputPath)) throw fail('That is not a file the person picked or one in the Library')
      const facts = await deps.analyzeMedia?.(a.inputPath)
      if (!facts) return { error: 'Could not read that file' }
      return { facts, ...deps.suggest(String(a.tool), facts, { container: a.container }) }
    }
  }
  throw fail(`Unknown tool: ${name}`)
}

module.exports = { THEME_NAMES, definitions, propose, readTool, isProposal, isRead, MAX_CALLS }
