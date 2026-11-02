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
 * The plugin host: scans plugin folders, validates manifests, keeps the user's grants, and runs each
 * plugin's backend in its own worker thread behind a permission-checked API (spec: PLUGINS.md).
 * No Electron import, so the desktop app, the TUI and the MCP server all use the same code.
 *
 * Permissions limit what a well-behaved plugin can ask THIS API to do. They are not a sandbox: a
 * backend is Node code with the user's privileges. Everything below exists to make the honest
 * path safe (path checks, schema checks, host allow-lists) and to isolate crashes.
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { Worker } = require('node:worker_threads')
const { buildStartRequest } = require('../mcp_tools.cjs')

const API_VERSION = 1
const CORE_IDS = ['downloader', 'converter', 'image-upscaler', 'video-upscaler', 'frame-interpolation', 'subtitles', 'audio-ai', 'trim', 'compress', 'gif', 'sticker', 'tag', 'tagger', 'music-tagger', 'upscaler', 'interpolation', 'trimmer', 'compressor']
const PERMISSIONS = ['jobs', 'files:read', 'files:write', 'network', 'exec', 'exec:any', 'settings', 'notify', 'hooks', 'tools']
const EVENTS = ['job:finished', 'job:failed', 'watch-folder:file']
const SCOPES = ['universal', 'desktop-exclusive']
const MAX_FILE_BYTES = 64 * 1024 * 1024
const MAX_FETCH_BYTES = 16 * 1024 * 1024
const MAX_EXEC_OUTPUT = 8 * 1024 * 1024
const MAX_ACTIVE_JOBS = 10
const MAX_ASSET_BYTES = 8 * 1024 * 1024
const ASSET_TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' }
const TOOL_TIMEOUT_MS = 10 * 60 * 1000
const ACTIVATE_TIMEOUT_MS = 10 * 1000

class PermissionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PermissionError'
  }
}

/* ---------------------------------------------------------------- manifest */

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const TOOL_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** True for a relative path that stays inside its folder by its text alone (no .., no absolute, no backslash). */
function isSafeRelPath(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 200 || rel.includes('\0') || rel.includes('\\')) return false
  if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) return false
  return rel.split('/').every((seg) => seg !== '..' && seg !== '')
}

const isStr = (v, max = 500) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * Checks a parsed plugin.json and returns { ok, errors, manifest }. `manifest` is the normalized
 * form (a v1 manifest's `entry` becomes `ui.entry`; `permissions` defaults to []). Never throws.
 */
function validateManifest(raw) {
  const errors = []
  const bad = (msg) => errors.push(msg)
  if (!isPlainObject(raw)) return { ok: false, errors: ['plugin.json must be a JSON object'], manifest: null }

  if (!isStr(raw.id, 40) || !ID_RE.test(raw.id)) bad('id must be kebab-case (a-z, 0-9, -), at most 40 characters')
  else if (raw.id in Object.prototype) bad(`id "${raw.id}" is not allowed`)
  else if (CORE_IDS.includes(raw.id)) bad(`id "${raw.id}" is reserved for a built-in tool`)
  if (!isStr(raw.name, 80)) bad('name is required')
  if (!isStr(raw.version, 64) || !SEMVER_RE.test(raw.version)) bad('version must be SemVer (e.g. 1.2.3)')
  if (!isStr(raw.author, 120)) bad('author is required')
  if (!isStr(raw.description, 1000)) bad('description is required')
  if (raw.apiVersion !== undefined && raw.apiVersion !== API_VERSION) bad(`apiVersion ${raw.apiVersion} is not supported (this OPNduck speaks ${API_VERSION})`)
  if (raw.repo !== undefined && !(isStr(raw.repo, 300) && /^https:\/\//.test(raw.repo))) bad('repo must be an https URL')

  let permissions = []
  if (raw.permissions !== undefined) {
    if (!Array.isArray(raw.permissions) || !raw.permissions.every((p) => PERMISSIONS.includes(p))) {
      bad(`permissions must be a list of: ${PERMISSIONS.join(', ')}`)
    } else permissions = [...new Set(raw.permissions)]
  }

  let network = []
  if (raw.network !== undefined) {
    // Exact public hostnames only: no IP literals, no "localhost", no wildcards, so a plugin cannot be pointed at local services.
    if (!Array.isArray(raw.network) || raw.network.length > 20 || !raw.network.every((h) => typeof h === 'string' && HOST_RE.test(h))) {
      bad('network must be a list of exact hostnames such as "api.github.com"')
    } else network = [...new Set(raw.network)]
  }
  if (permissions.includes('network') && network.length === 0) bad('the network permission needs at least one hostname in "network"')
  if (!permissions.includes('network') && network.length > 0) bad('"network" hostnames need the network permission')

  // v1 compatibility: a top-level `entry` is the UI entry.
  const uiRaw = raw.ui ?? (raw.entry !== undefined ? { entry: raw.entry } : undefined)
  let ui
  if (uiRaw !== undefined) {
    if (!isPlainObject(uiRaw) || !isSafeRelPath(uiRaw.entry) || !/\.m?js$/.test(uiRaw.entry)) bad('ui.entry must be a relative .js path inside the plugin folder')
    else ui = { entry: uiRaw.entry }
    // `slot`: "selector" replaces the tile row on Home; "stage" fills the area under the tiles around the open tool. Neither is a tile.
    if (isPlainObject(uiRaw) && uiRaw.slot !== undefined) {
      if (!['selector', 'stage'].includes(uiRaw.slot)) bad('ui.slot must be "selector" or "stage"')
      else if (ui) ui.slot = uiRaw.slot
    }
    if (ui?.slot) {
      if (raw.accent !== undefined && !isStr(raw.accent, 100)) bad('accent must be a CSS color string')
    } else {
      if (!isStr(raw.tagline, 120)) bad('tagline is required for a plugin with a card')
      if (!isStr(raw.icon, 8)) bad('icon is required for a plugin with a card')
      if (!SCOPES.includes(raw.scope)) bad(`scope must be one of: ${SCOPES.join(', ')}`)
      if (raw.accent !== undefined && !isStr(raw.accent, 100)) bad('accent must be a CSS color string')
    }
  }

  let backend
  if (raw.backend !== undefined) {
    if (!isPlainObject(raw.backend) || !isSafeRelPath(raw.backend.entry) || !/\.c?js$/.test(raw.backend.entry)) bad('backend.entry must be a relative .cjs/.js path inside the plugin folder')
    else backend = { entry: raw.backend.entry }
  }
  if (!ui && !backend && errors.length === 0) bad('a plugin needs a ui entry, a backend entry, or both')

  let tools = []
  if (raw.tools !== undefined) {
    if (!Array.isArray(raw.tools) || raw.tools.length > 50) bad('tools must be a list')
    else {
      const seen = new Set()
      for (const t of raw.tools) {
        const ok = isPlainObject(t) && typeof t.name === 'string' && TOOL_NAME_RE.test(t.name) && isStr(t.description, 1000) && isPlainObject(t.inputSchema) && t.inputSchema.type === 'object'
        if (!ok) bad('each tool needs a name (a-z, 0-9, _), a description and an inputSchema of type "object"')
        else if (seen.has(t.name)) bad(`duplicate tool name: ${t.name}`)
        else if (String(raw.id).length + 2 + t.name.length > 64) bad(`tool name "${t.name}" is too long: "<id>__<name>" must fit in 64 characters (MCP clients cap tool names there)`)
        else {
          seen.add(t.name)
          tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema })
        }
      }
    }
    if (tools.length && !permissions.includes('tools')) bad('declaring tools needs the tools permission')
    if (tools.length && !backend) bad('declaring tools needs a backend to handle them')
  }

  let commands = []
  if (raw.commands !== undefined) {
    if (!Array.isArray(raw.commands) || raw.commands.length > 50 || !raw.commands.every((c) => isPlainObject(c) && isStr(c.id, 80) && /^[a-z0-9][a-z0-9._-]*$/.test(c.id) && isStr(c.title, 120))) {
      bad('each command needs an id and a title')
    } else commands = raw.commands.map((c) => ({ id: c.id, title: c.title }))
    if (commands.length && !backend) bad('declaring commands needs a backend to handle them')
  }

  let settings = {}
  if (raw.settings !== undefined) {
    if (!isPlainObject(raw.settings) || Object.keys(raw.settings).length > 50) bad('settings must be an object of settings')
    else {
      for (const [key, spec] of Object.entries(raw.settings)) {
        const ok = KEY_RE.test(key) && isPlainObject(spec) && ['string', 'number', 'boolean'].includes(spec.type) && (spec.enum === undefined || Array.isArray(spec.enum))
        if (!ok) bad(`setting "${key}" is invalid`)
        else settings[key] = { type: spec.type, title: typeof spec.title === 'string' ? spec.title.slice(0, 120) : key, default: spec.default, ...(spec.enum ? { enum: spec.enum } : {}) }
      }
    }
  }
  if (Object.keys(settings).length && !permissions.includes('settings')) bad('declaring settings needs the settings permission')

  if (errors.length) return { ok: false, errors, manifest: null }
  const manifest = {
    id: raw.id,
    name: raw.name,
    version: raw.version,
    apiVersion: raw.apiVersion ?? 0, // 0 = v1 manifest
    author: raw.author,
    description: raw.description,
    ...(raw.tagline !== undefined ? { tagline: raw.tagline } : {}),
    ...(raw.icon !== undefined ? { icon: raw.icon } : {}),
    ...(raw.accent !== undefined ? { accent: raw.accent } : {}),
    ...(raw.scope !== undefined ? { scope: raw.scope } : {}),
    ...(raw.repo !== undefined ? { repo: raw.repo } : {}),
    permissions,
    network,
    ui,
    backend,
    tools,
    commands,
    settings,
  }
  return { ok: true, errors: [], manifest }
}

/* ------------------------------------------------------------------- paths */

/** Resolves symlinks for as much of `p` as exists, then appends the rest, so a not-yet-created file is still judged by its real parent. */
function realResolve(p) {
  let cur = path.resolve(p)
  const rest = []
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...rest.reverse())
    } catch {
      const parent = path.dirname(cur)
      if (parent === cur) return path.resolve(p)
      rest.push(path.basename(cur))
      cur = parent
    }
  }
}

function isInside(root, target) {
  const rel = path.relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

/** Resolves a manifest-relative entry to a real file inside the plugin folder, or throws. Rejects symlinks that leave it. */
function resolveEntry(pluginDir, rel) {
  if (!isSafeRelPath(rel)) throw new Error(`Unsafe path: ${rel}`)
  const root = fs.realpathSync(pluginDir)
  const full = fs.realpathSync(path.join(root, rel)) // throws if missing
  if (!isInside(root, full)) throw new Error(`Path leaves the plugin folder: ${rel}`)
  if (!fs.statSync(full).isFile()) throw new Error(`Not a file: ${rel}`)
  return full
}

/**
 * What a plugin may touch: the download folder (read and write) plus whatever the user picked for it.
 * A picked folder allows everything under it; a picked file allows only that file.
 */
function createFileAccess(downloadsDir) {
  const base = realResolve(downloadsDir)
  const readRoots = new Set([base])
  const writeRoots = new Set([base])
  const allowed = (roots, p) => {
    if (typeof p !== 'string' || !p || p.includes('\0') || !path.isAbsolute(p)) return false
    const real = realResolve(p)
    for (const root of roots) if (isInside(root, real)) return true
    return false
  }
  return {
    canRead: (p) => allowed(readRoots, p),
    canWrite: (p) => allowed(writeRoots, p),
    allowRead: (p) => void readRoots.add(realResolve(p)),
    allowWrite: (p) => void writeRoots.add(realResolve(p)),
  }
}

/* -------------------------------------------------------------- permissions */

/** `granted` is what the user approved; exec:any also implies exec. */
function createGuard(granted) {
  const set = new Set(granted)
  if (set.has('exec:any')) set.add('exec')
  return {
    has: (perm) => set.has(perm),
    require(perm) {
      if (!set.has(perm)) throw new PermissionError(`This plugin does not have the "${perm}" permission`)
    },
  }
}

/** Minimal JSON-schema check for tool arguments: types, enums, required, no extra keys, string length, minimum. */
function validateArgs(schema, args) {
  const a = args == null ? {} : args
  if (!isPlainObject(a)) throw new Error('Arguments must be an object')
  const props = schema.properties ?? {}
  for (const key of Object.keys(a)) if (!Object.hasOwn(props, key)) throw new Error(`Unknown argument: ${key}`)
  for (const key of schema.required ?? []) if (a[key] == null) throw new Error(`Missing argument: ${key}`)
  for (const [key, value] of Object.entries(a)) {
    if (value === undefined) continue
    const spec = isPlainObject(props[key]) ? props[key] : {}
    const types = [].concat(spec.type ?? [])
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value
    if (types.length && !(types.includes(actual) || (actual === 'integer' && types.includes('number')))) throw new Error(`Argument ${key} must be ${types.join(' or ')}`)
    if (spec.enum && !spec.enum.includes(value)) throw new Error(`Argument ${key} must be one of: ${spec.enum.join(', ')}`)
    if (typeof value === 'string' && value.length > 4096) throw new Error(`Argument ${key} is too long`)
    if (typeof value === 'number' && (!Number.isFinite(value) || (spec.minimum != null && value < spec.minimum))) throw new Error(`Argument ${key} is out of range`)
  }
  return a
}

/* ------------------------------------------------------------------- state */

/**
 * plugins.json: per plugin id { enabled, approved: [permissions the user granted], asked: [permissions the
 * user was shown when approving, so a denied one stays denied and only a NEW one needs approval], version, verified,
 * source, settings, lastError }. A missing or corrupt file is an empty state.
 */
function loadState(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const plugins = isPlainObject(raw?.plugins) ? raw.plugins : {}
    const clean = {}
    for (const [id, s] of Object.entries(plugins)) {
      if (!ID_RE.test(id) || !isPlainObject(s)) continue
      clean[id] = {
        enabled: s.enabled === true,
        approved: Array.isArray(s.approved) ? s.approved.filter((p) => PERMISSIONS.includes(p)) : [],
        asked: Array.isArray(s.asked) ? s.asked.filter((p) => PERMISSIONS.includes(p)) : [],
        version: typeof s.version === 'string' ? s.version : '',
        verified: s.verified === true,
        source: typeof s.source === 'string' ? s.source.slice(0, 40) : 'local',
        settings: isPlainObject(s.settings) ? s.settings : {},
        lastError: typeof s.lastError === 'string' ? s.lastError.slice(0, 500) : '',
      }
    }
    return { plugins: clean }
  } catch {
    return { plugins: {} }
  }
}

function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
  fs.renameSync(tmp, file)
}

/** Reads every `<dir>/<id>/plugin.json`. Returns [{ id, dir, manifest, errors }]; broken ones keep their errors and are never loaded. */
function scanPlugins(pluginsDir) {
  let names = []
  try {
    names = fs.readdirSync(pluginsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name)
  } catch {
    return []
  }
  return names.sort().map((name) => {
    const dir = path.join(pluginsDir, name)
    let parsed
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'))
    } catch (err) {
      return { id: name, dir, manifest: null, errors: [`plugin.json: ${err.code === 'ENOENT' ? 'missing' : 'not valid JSON'}`] }
    }
    const result = validateManifest(parsed)
    if (result.ok && result.manifest.id !== name) return { id: name, dir, manifest: null, errors: [`folder name "${name}" must match the plugin id "${result.manifest.id}"`] }
    return { id: name, dir, manifest: result.manifest, errors: result.errors }
  })
}

/* --------------------------------------------------------------- host API */

const NAMED_BINARIES = ['ffmpeg', 'ffprobe', 'yt-dlp', 'soffice']
/** What a plugin's card (renderer) may call; the rest of the API is backend-only. */
const UI_METHODS = ['jobs.start', 'jobs.list', 'jobs.cancel', 'files.pick', 'settings.get', 'settings.set', 'notify', 'rpc.call']

function runExec(command, args, { cwd, timeoutMs = TOOL_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      return reject(err)
    }
    const out = { stdout: [], stderr: [], bytes: 0 }
    const take = (which) => (chunk) => {
      if (out.bytes < MAX_EXEC_OUTPUT) {
        out[which].push(chunk)
        out.bytes += chunk.length
      }
    }
    child.stdout.on('data', take('stdout'))
    child.stderr.on('data', take('stderr'))
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ code: signal ? -1 : code, stdout: Buffer.concat(out.stdout).toString('utf8'), stderr: Buffer.concat(out.stderr).toString('utf8') })
    })
  })
}

async function readCapped(response, cap) {
  const chunks = []
  let total = 0
  for await (const chunk of response.body ?? []) {
    total += chunk.length
    if (total > cap) throw new Error('Response is too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * One plugin's host API as a single `call(method, args)`. The worker proxy and the renderer both go
 * through it, so every permission check lives in this one place.
 *
 * ctx: { manifest, guard, files, core, platform, state (this plugin's state entry), saveState,
 *        pickPath, fetchImpl, ownJobs: Set, subs: Set, registered, invokeRpc, log }
 */
function createApi(ctx) {
  const { manifest, guard, files, core, platform } = ctx
  const fetchImpl = ctx.fetchImpl ?? globalThis.fetch

  const methods = {
    'jobs.start': async (name, args) => {
      guard.require('jobs')
      if (typeof name !== 'string') throw new Error('jobs.start needs a tool name such as "convert"')
      const { channel, req } = buildStartRequest(name, args) // schema-checked; start requests never carry an output folder
      if (name === 'download') {
        let u
        try {
          u = new URL(req.url)
        } catch {
          throw new Error('url must be a full http(s) link')
        }
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error('url must start with http:// or https://')
      }
      for (const [key, value] of Object.entries(req)) {
        if (!/path/i.test(key)) continue
        guard.require('files:read')
        for (const p of [].concat(value)) if (!files.canRead(p)) throw new PermissionError(`This plugin may not read ${String(p).slice(0, 200)}`)
      }
      if (name !== 'download') {
        let st
        try {
          st = fs.statSync(req.inputPath)
        } catch {
          throw new Error('inputPath does not exist')
        }
        if (!st.isFile()) throw new Error('inputPath is not a regular file')
      }
      const active = [...ctx.ownJobs].filter((jobId) => {
        const t = core.engine.tasks.get(jobId)
        return t && !core.engine.TERMINAL.includes(t.state.status)
      })
      if (active.length >= MAX_ACTIVE_JOBS) throw new Error(`Too many jobs from this plugin are waiting or running (limit ${MAX_ACTIVE_JOBS})`)
      const id = await core.startJob(channel, req)
      ctx.ownJobs.add(id)
      return id
    },
    'jobs.list': async () => {
      guard.require('jobs')
      return [...ctx.ownJobs].flatMap((id) => {
        const t = core.engine.tasks.get(id)
        return t ? [{ id, status: t.state.status, progress: t.state.progress, label: t.state.label, error: t.state.error }] : []
      })
    },
    'jobs.cancel': async (id) => {
      guard.require('jobs')
      if (!ctx.ownJobs.has(id)) throw new Error('Unknown job')
      core.engine.cancelTask(id)
    },
    'files.read': async (p) => {
      guard.require('files:read')
      if (!files.canRead(p)) throw new PermissionError(`This plugin may not read ${String(p).slice(0, 200)}`)
      const real = realResolve(p)
      if (fs.statSync(real).size > MAX_FILE_BYTES) throw new Error('File is too large')
      return new Uint8Array(await fs.promises.readFile(real))
    },
    'files.write': async (p, data) => {
      guard.require('files:write')
      if (!files.canWrite(p)) throw new PermissionError(`This plugin may not write ${String(p).slice(0, 200)}`)
      const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data instanceof Uint8Array ? Buffer.from(data) : null
      if (!buf) throw new Error('files.write needs a string or bytes')
      if (buf.length > MAX_FILE_BYTES) throw new Error('Data is too large')
      const real = realResolve(p)
      await fs.promises.mkdir(path.dirname(real), { recursive: true })
      // A link at the target (even a dangling one) would send the write somewhere the check did not look.
      if (fs.lstatSync(real, { throwIfNoEntry: false })?.isSymbolicLink()) throw new PermissionError('Refusing to write through a symlink')
      const fh = await fs.promises.open(real, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW ?? 0), 0o644)
      try {
        await fh.writeFile(buf)
      } finally {
        await fh.close()
      }
    },
    'files.pick': async (opts) => {
      const save = Boolean(opts?.save)
      guard.require(save ? 'files:write' : 'files:read')
      if (!ctx.pickPath) throw new Error('No file picker is available here')
      const picked = await ctx.pickPath({ save, directory: Boolean(opts?.directory), filters: Array.isArray(opts?.filters) ? opts.filters.slice(0, 20) : undefined, plugin: manifest.name })
      if (!picked) return null
      if (save) files.allowWrite(picked)
      else files.allowRead(picked)
      return picked
    },
    'exec.run': async (name, args, opts) => {
      guard.require('exec')
      if (typeof name !== 'string' || !Array.isArray(args) || !args.every((a) => typeof a === 'string' && !a.includes('\0'))) throw new Error('exec.run needs a name and a list of string arguments')
      let command
      if (NAMED_BINARIES.includes(name)) {
        const t = core?.tools
        command = name === 'yt-dlp' ? (t?.ytdlpCommand?.() ?? 'yt-dlp') : name === 'soffice' ? (t?.sofficeCommand?.() ?? 'soffice') : name
      } else {
        guard.require('exec:any')
        command = name
      }
      let cwd
      if (opts?.cwd !== undefined) {
        if (!guard.has('exec:any') && !files.canRead(opts.cwd)) throw new PermissionError('This plugin may not use that working folder')
        cwd = opts.cwd
      }
      return runExec(command, args, { cwd })
    },
    'net.fetch': async (url, init) => {
      guard.require('network')
      let current
      try {
        current = new URL(url)
      } catch {
        throw new Error('Invalid URL')
      }
      const method = String(init?.method ?? 'GET').toUpperCase()
      if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error(`Method not allowed: ${method}`)
      const headers = {}
      for (const [k, v] of Object.entries(init?.headers ?? {})) if (typeof v === 'string') headers[k] = v
      let body = init?.body
      if (body !== undefined && typeof body !== 'string' && !(body instanceof Uint8Array)) throw new Error('Request body must be a string or bytes')
      for (let hop = 0; hop <= 5; hop++) {
        if (!['https:', 'http:'].includes(current.protocol) || !manifest.network.includes(current.hostname)) {
          throw new PermissionError(`This plugin may not contact ${current.hostname}`)
        }
        const res = await fetchImpl(current, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(30000) })
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          await res.body?.cancel().catch(() => {})
          current = new URL(res.headers.get('location'), current) // every hop is checked against the allow-list again
          if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) body = undefined
          continue
        }
        const bytes = method === 'HEAD' ? Buffer.alloc(0) : await readCapped(res, MAX_FETCH_BYTES)
        return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: new Uint8Array(bytes) }
      }
      throw new Error('Too many redirects')
    },
    'settings.get': async (key) => {
      guard.require('settings')
      const spec = manifest.settings[key]
      if (!spec) throw new Error(`Unknown setting: ${key}`)
      return Object.hasOwn(ctx.state.settings, key) ? ctx.state.settings[key] : (spec.default ?? null)
    },
    'settings.set': async (key, value) => {
      guard.require('settings')
      const spec = manifest.settings[key]
      if (!spec) throw new Error(`Unknown setting: ${key}`)
      if (typeof value !== spec.type || (spec.type === 'number' && !Number.isFinite(value))) throw new Error(`Setting ${key} must be a ${spec.type}`)
      if (spec.enum && !spec.enum.includes(value)) throw new Error(`Setting ${key} must be one of: ${spec.enum.join(', ')}`)
      if (typeof value === 'string' && value.length > 4096) throw new Error(`Setting ${key} is too long`)
      ctx.state.settings[key] = value
      ctx.saveState()
    },
    notify: async (opts) => {
      guard.require('notify')
      if (!isPlainObject(opts) || !isStr(opts.body ?? 'x', 500)) throw new Error('notify needs a title and a body')
      if (platform.canNotify?.()) platform.notify({ title: `${manifest.name}: ${String(opts.title ?? '').slice(0, 100)}`, body: String(opts.body ?? '').slice(0, 500) })
    },
    'hooks.subscribe': async (event) => {
      guard.require('hooks')
      if (!EVENTS.includes(event)) throw new Error(`Unknown event: ${event}`)
      ctx.subs.add(event)
    },
    'hooks.unsubscribe': async (event) => void ctx.subs.delete(event),
    'tools.handle': async (name) => {
      guard.require('tools')
      if (!manifest.tools.some((t) => t.name === name)) throw new Error(`Tool "${name}" is not declared in plugin.json`)
      ctx.registered.tool.add(name)
    },
    'commands.handle': async (id) => {
      if (!manifest.commands.some((c) => c.id === id)) throw new Error(`Command "${id}" is not declared in plugin.json`)
      ctx.registered.command.add(id)
    },
    'rpc.handle': async (name) => {
      if (typeof name !== 'string' || !TOOL_NAME_RE.test(name) || ctx.registered.rpc.size >= 100) throw new Error('Invalid rpc name')
      ctx.registered.rpc.add(name)
    },
    'rpc.call': async (name, arg) => ctx.invokeRpc(name, arg),
    log: async (...args) => ctx.log(args.map((a) => String(a)).join(' ').slice(0, 2000)),
  }

  return {
    async call(method, args = [], { fromUi = false } = {}) {
      if (typeof method !== 'string' || !Object.hasOwn(methods, method)) throw new Error(`Unknown method: ${String(method).slice(0, 80)}`)
      if (fromUi && !UI_METHODS.includes(method)) throw new PermissionError(`${method} is not available from a plugin card`)
      return methods[method](...(Array.isArray(args) ? args : []))
    },
  }
}

/* -------------------------------------------------------------------- host */

/**
 * @param {object} deps
 * @param {object} deps.core         createCore() result (needs startJob, engine, tools); may be null in tests that never use jobs
 * @param {object} deps.platform     see core/platform.cjs
 * @param {string} [deps.pluginsDir] default `<userData>/plugins`
 * @param {boolean | (() => boolean)} [deps.safeMode]  skip every plugin (a function is asked on every init)
 * @param {() => void} [deps.onChange]  called after a plugin's status or state changes, so a UI can refresh
 * @param {(opts) => Promise<string|null>} [deps.pickPath]  the shell's file/folder dialog
 * @param {string} [deps.workerFile] override for tests / bundled builds
 * @param {(line: string) => void} [deps.log]
 */
function createPluginHost({ core, platform, pluginsDir, safeMode = false, onChange = () => {}, pickPath, fetchImpl, workerFile, log = () => {} }) {
  const dir = pluginsDir ?? path.join(platform.paths.userData, 'plugins')
  const stateFile = path.join(dir, 'plugins.json')
  let state = loadState(stateFile)
  const runtime = new Map() // id -> { entry, status, worker, ...per-plugin runtime }
  const persist = () => saveState(stateFile, state)
  const inSafeMode = () => (typeof safeMode === 'function' ? safeMode() : safeMode)
  const changed = () => {
    try {
      onChange()
    } catch {
      /* a UI that cannot refresh must not break the host */
    }
  }
  const entryState = (id) => (Object.hasOwn(state.plugins, id) ? state.plugins[id] : (state.plugins[id] = { enabled: false, approved: [], asked: [], version: '', verified: false, source: 'local', settings: {}, lastError: '' }))

  const missingApproval = (manifest, st) => manifest.permissions.filter((p) => !st.asked.includes(p))

  function newRuntime(entry) {
    return { entry, status: 'disabled', worker: null, subs: new Set(), registered: { tool: new Set(), command: new Set(), rpc: new Set() }, calls: new Map(), invokes: new Map(), nextId: 1, ownJobs: new Set(), api: null, stopping: false, gen: 0, abortStart: null }
  }

  function failPending(rec, reason) {
    for (const p of rec.invokes.values()) p.reject(new Error(reason))
    rec.invokes.clear()
  }

  function crash(rec, reason) {
    if (rec.stopping || rec.status === 'crashed') return
    const id = rec.entry.id
    log(`[plugin ${id}] ${reason}`)
    rec.status = 'crashed'
    rec.subs.clear()
    failPending(rec, reason)
    rec.worker?.terminate().catch?.(() => {})
    rec.worker = null
    const st = entryState(id)
    st.enabled = false // a plugin that fails is switched off; the user re-enables it on purpose
    st.lastError = String(reason).slice(0, 500)
    persist()
    changed()
  }

  function invoke(rec, kind, name, args, timeoutMs = TOOL_TIMEOUT_MS) {
    if (rec.status !== 'running' || !rec.worker) return Promise.reject(new Error('Plugin is not running'))
    return new Promise((resolve, reject) => {
      const id = rec.nextId++
      const timer = setTimeout(() => {
        rec.invokes.delete(id)
        reject(new Error(`${name} timed out`))
      }, timeoutMs)
      rec.invokes.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      })
      rec.worker.postMessage({ type: 'invoke', id, kind, name, args })
    })
  }

  function buildApi(rec, st) {
    const { manifest } = rec.entry
    return createApi({
      manifest,
      guard: createGuard(st.approved.filter((p) => manifest.permissions.includes(p))),
      files: createFileAccess(platform.paths.downloads),
      core,
      platform,
      state: st,
      saveState: persist,
      pickPath,
      fetchImpl,
      ownJobs: rec.ownJobs,
      subs: rec.subs,
      registered: rec.registered,
      invokeRpc: (name, arg) => {
        if (!rec.registered.rpc.has(name)) throw new Error(`No rpc handler "${name}"`)
        return invoke(rec, 'rpc', name, arg)
      },
      log: (line) => log(`[plugin ${manifest.id}] ${line}`),
    })
  }

  async function startBackend(rec) {
    const { manifest, dir: pluginDir } = rec.entry
    const st = entryState(manifest.id)
    rec.api = buildApi(rec, st)
    const entryFile = resolveEntry(pluginDir, manifest.backend.entry)
    rec.status = 'starting'
    rec.stopping = false
    const gen = ++rec.gen
    // Resolved here, not at startup: a bundled build (the TUI) has no __dirname and passes workerFile instead.
    const w = new Worker(workerFile ?? path.join(__dirname, 'plugin_worker.cjs'), { workerData: { id: manifest.id, version: manifest.version, entry: entryFile }, env: {}, stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 256 } })
    rec.worker = w
    w.stdout.on('data', (b) => log(`[plugin ${manifest.id}] ${String(b).trimEnd()}`))
    w.stderr.on('data', (b) => log(`[plugin ${manifest.id}] ${String(b).trimEnd()}`))
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('activate() took too long')), ACTIVATE_TIMEOUT_MS)
      const done = (fn, arg) => (clearTimeout(timer), fn(arg))
      rec.abortStart = () => done(reject, new Error('stopped while starting'))
      w.on('message', (msg) => {
        if (rec.worker !== w || !msg || typeof msg !== 'object') return // a worker that was replaced or stopped
        if (msg.type === 'ready') done(resolve)
        else if (msg.type === 'failed') done(reject, Object.assign(new Error(msg.error?.message ?? 'activate failed'), { name: msg.error?.name }))
        else if (msg.type === 'call') {
          rec.api.call(msg.method, msg.args).then(
            (value) => w.postMessage({ type: 'result', id: msg.id, ok: true, value }),
            (err) => w.postMessage({ type: 'result', id: msg.id, ok: false, error: { name: err?.name ?? 'Error', message: String(err?.message ?? err) } }),
          )
        } else if (msg.type === 'invoke-result') {
          const p = rec.invokes.get(msg.id)
          if (!p) return
          rec.invokes.delete(msg.id)
          if (msg.ok) p.resolve(msg.value)
          else p.reject(Object.assign(new Error(msg.error?.message ?? 'Failed'), { name: msg.error?.name }))
        }
      })
      w.on('error', (err) => rec.worker !== w ? undefined : (rec.status === 'starting' ? done(reject, err) : crash(rec, `crashed: ${err.message}`)))
      w.on('exit', (code) => rec.worker !== w ? undefined : (rec.status === 'starting' ? done(reject, new Error(`exited with code ${code} while starting`)) : crash(rec, `exited unexpectedly (code ${code})`)))
    }).catch((err) => {
      if (rec.gen !== gen) throw Object.assign(err, { stale: true }) // stopped or restarted meanwhile: that call owns the status now
      rec.status = 'starting' // let crash() record it
      crash(rec, `failed to start: ${err.message}`)
      throw err
    })
    rec.abortStart = null
    if (rec.gen !== gen) throw Object.assign(new Error('stopped while starting'), { stale: true })
    rec.status = 'running'
  }

  async function stopRuntime(rec) {
    rec.stopping = true
    rec.gen++
    rec.abortStart?.()
    rec.abortStart = null
    for (const jobId of rec.ownJobs) core.engine?.cancelTask?.(jobId) // work the plugin started stops with it
    rec.ownJobs.clear()
    const w = rec.worker
    rec.worker = null
    rec.subs.clear()
    for (const set of Object.values(rec.registered)) set.clear()
    failPending(rec, 'Plugin stopped')
    if (w) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2000)
        w.on('message', (m) => m.type === 'stopped' && (clearTimeout(timer), resolve()))
        w.on('exit', () => (clearTimeout(timer), resolve()))
        try {
          w.postMessage({ type: 'stop' })
        } catch {
          resolve()
        }
      })
      await w.terminate().catch(() => {})
    }
    if (rec.status !== 'crashed') rec.status = 'disabled'
  }

  /** Brings one plugin to the state the user asked for. Never throws: a broken plugin just reports why. */
  async function reconcile(rec) {
    const { manifest } = rec.entry
    if (!manifest) return void (rec.status = 'broken')
    const st = entryState(manifest.id)
    if (inSafeMode()) return void (rec.status = 'safe-mode')
    if (!st.enabled) return void (rec.status = rec.status === 'crashed' ? 'crashed' : 'disabled')
    if (missingApproval(manifest, st).length) return void (rec.status = 'needs-approval')
    if (st.version !== manifest.version) {
      st.version = manifest.version
      persist()
    }
    if (!manifest.backend) {
      rec.api = buildApi(rec, st) // a card with no backend has no worker, but its UI still calls the host API
      return void (rec.status = 'running')
    }
    try {
      await startBackend(rec)
    } catch (err) {
      if (err?.stale) return
      if (rec.status !== 'crashed') {
        rec.status = 'starting' // e.g. the entry path check failed before a worker existed
        crash(rec, `failed to start: ${err.message}`)
      }
    }
  }

  function summary(rec) {
    const { entry } = rec
    const st = state.plugins[entry.id]
    return {
      id: entry.id,
      name: entry.manifest?.name ?? entry.id,
      manifest: entry.manifest,
      errors: entry.errors,
      status: rec.status,
      enabled: Boolean(st?.enabled),
      approved: st?.approved ?? [],
      pendingApproval: entry.manifest && st ? missingApproval(entry.manifest, st) : (entry.manifest?.permissions ?? []),
      verified: Boolean(st?.verified),
      source: st?.source ?? 'local',
      lastError: st?.lastError ?? '',
    }
  }

  const need = (id) => {
    const rec = runtime.get(id)
    if (!rec) throw new Error(`Unknown plugin: ${id}`)
    return rec
  }

  return {
    dir,
    /** Scans the plugins folder and starts every enabled, approved plugin. */
    async init() {
      await Promise.all([...runtime.values()].map((rec) => stopRuntime(rec))) // init() twice must not orphan workers
      runtime.clear()
      state = loadState(stateFile)
      const scanned = scanPlugins(dir)
      for (const entry of scanned) runtime.set(entry.id, newRuntime(entry))
      for (const id of Object.keys(state.plugins)) if (!runtime.has(id)) delete state.plugins[id] // folder is gone
      await Promise.all([...runtime.values()].map(reconcile))
      changed()
      return this.list()
    },
    list: () => [...runtime.values()].map(summary),

    /** Turns a plugin on with the permissions the user approved (a subset of what it asks for). */
    async enable(id, approved) {
      const rec = need(id)
      const { manifest } = rec.entry
      if (!manifest) throw new Error('This plugin is broken and cannot be enabled')
      if (!Array.isArray(approved) || !approved.every((p) => manifest.permissions.includes(p))) throw new Error('Approved permissions must be a subset of what the plugin asks for')
      if (rec.worker) await stopRuntime(rec)
      rec.status = 'disabled'
      const st = entryState(id)
      Object.assign(st, { enabled: true, approved: [...new Set(approved)], asked: [...manifest.permissions], version: manifest.version, lastError: '' })
      persist()
      await reconcile(rec)
      changed()
      return summary(rec)
    },
    async disable(id) {
      const rec = need(id)
      await stopRuntime(rec)
      rec.status = 'disabled'
      if (state.plugins[id]) state.plugins[id].enabled = false
      persist()
      changed()
      return summary(rec)
    },
    /**
     * Picks up a plugin folder the store just put in place (new or replacing an older version): stops
     * the old one, re-reads the folder, records where it came from, and leaves it OFF. It still needs
     * the user's approval, and permissions it was not shown before count as new.
     */
    async adopt(id, { verified, source }) {
      const old = runtime.get(id)
      if (old) await stopRuntime(old)
      const entry = scanPlugins(dir).find((e) => e.id === id)
      if (!entry) throw new Error(`Plugin folder not found: ${id}`)
      const rec = newRuntime(entry)
      runtime.set(id, rec)
      Object.assign(entryState(id), { enabled: false, verified: verified === true, source: String(source).slice(0, 40), lastError: '' })
      persist()
      await reconcile(rec)
      changed()
      return summary(rec)
    },
    /** Stops a plugin and deletes its folder and state. Refuses symlinked folders. */
    async remove(id) {
      const rec = need(id)
      await stopRuntime(rec)
      const target = rec.entry.dir
      if (fs.lstatSync(target).isSymbolicLink()) throw new Error('Refusing to delete a symlinked plugin folder; remove the link yourself')
      if (path.dirname(realResolve(target)) !== realResolve(dir)) throw new Error('Plugin folder is not inside the plugins folder')
      fs.rmSync(target, { recursive: true, force: true })
      runtime.delete(id)
      delete state.plugins[id]
      persist()
      changed()
    },

    /**
     * A file a running plugin's card may load (its UI script, styles, images), for the opnduck-plugin://
     * protocol. Only extensions in ASSET_TYPES, only inside the plugin folder (symlinks followed), never
     * the backend entry, at most 8 MB.
     */
    readAsset(id, rel) {
      const rec = runtime.get(id)
      if (!rec || rec.status !== 'running' || !rec.entry.manifest.ui) throw new Error('No such plugin UI')
      const type = ASSET_TYPES[path.extname(String(rel)).toLowerCase()]
      if (!type) throw new Error('File type not served')
      const full = resolveEntry(rec.entry.dir, rel)
      const { backend } = rec.entry.manifest
      if (backend && full === resolveEntry(rec.entry.dir, backend.entry)) throw new Error('Not served')
      if (fs.statSync(full).size > MAX_ASSET_BYTES) throw new Error('File is too large')
      return { data: fs.readFileSync(full), type }
    },

    /** A plugin card's call from the renderer. Only the UI subset of the API is reachable. */
    callFromUi(id, method, args) {
      const rec = need(id)
      if (rec.status !== 'running' || !rec.api) return Promise.reject(new Error('Plugin is not running'))
      return rec.api.call(method, args, { fromUi: true })
    },

    /** Tools of running plugins that hold the tools permission, named `<id>__<tool>`. Merge into MCP/TUI lists. */
    tools() {
      const out = []
      for (const rec of runtime.values()) {
        if (rec.status !== 'running' || !rec.api) continue
        const { manifest } = rec.entry
        if (!state.plugins[manifest.id]?.approved.includes('tools')) continue
        for (const t of manifest.tools) out.push({ name: `${manifest.id}__${t.name}`, description: `[${manifest.name}] ${t.description}`, inputSchema: t.inputSchema, plugin: manifest.id })
      }
      return out
    },
    async callTool(fullName, args) {
      const sep = typeof fullName === 'string' ? fullName.indexOf('__') : -1
      const rec = sep > 0 ? runtime.get(fullName.slice(0, sep)) : null
      const tool = rec?.entry.manifest?.tools.find((t) => t.name === fullName.slice(sep + 2))
      if (!rec || !tool || rec.status !== 'running') throw new Error(`Unknown tool: ${String(fullName).slice(0, 80)}`)
      if (!rec.registered.tool.has(tool.name)) throw new Error(`Plugin has not registered tool ${tool.name}`)
      return invoke(rec, 'tool', tool.name, validateArgs(tool.inputSchema, args))
    },

    commands() {
      const out = []
      for (const rec of runtime.values()) {
        if (rec.status !== 'running') continue
        for (const c of rec.entry.manifest.commands) if (rec.registered.command.has(c.id)) out.push({ ...c, plugin: rec.entry.id })
      }
      return out
    },
    async runCommand(commandId, args) {
      for (const rec of runtime.values()) {
        if (rec.status === 'running' && rec.registered.command.has(commandId)) return invoke(rec, 'command', commandId, args)
      }
      throw new Error(`Unknown command: ${String(commandId).slice(0, 80)}`)
    },

    /** Tells subscribed plugins about an event; a failing handler is logged, never thrown. */
    emit(event, payload) {
      if (!EVENTS.includes(event)) return
      const safe = JSON.parse(JSON.stringify(payload ?? null))
      for (const rec of runtime.values()) {
        if (rec.status === 'running' && rec.subs.has(event)) invoke(rec, 'event', event, safe, 30000).catch((err) => log(`[plugin ${rec.entry.id}] ${event} handler: ${err.message}`))
      }
    },

    async shutdown() {
      await Promise.all([...runtime.values()].map((rec) => stopRuntime(rec)))
    },
  }
}

module.exports = {
  API_VERSION, ID_RE, SEMVER_RE, CORE_IDS, PERMISSIONS, EVENTS, NAMED_BINARIES, UI_METHODS, PermissionError,
  validateManifest, isSafeRelPath, realResolve, isInside, resolveEntry, createFileAccess, createGuard, validateArgs,
  loadState, saveState, scanPlugins, createApi, createPluginHost,
}
