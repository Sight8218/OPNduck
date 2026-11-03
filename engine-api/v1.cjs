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
 * Engine API v1: the routes that let another device (the companion app, a server's desktop, the browser extension) use
 * this engine: pair, ask what it can do, list and start jobs, and follow them live. Every route but /health and /pair
 * needs a device token. Requests never contain file paths (see remote_request.cjs). No Electron.
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { buildRemoteRequest, KINDS } = require('./remote_request.cjs')

const MAX_JSON = 16 * 1024
const MAX_AI_JSON = 512 * 1024 // a conversation (and a few pictures as data: addresses)
const PAIR_PER_MIN = 10
const BAD_AUTH_PER_MIN = 20
const EVENT_INTERVAL_MS = 250 // progress goes out at most 4 times a second
const HEARTBEAT_MS = 25000
const LINK_TTL_MS = 10 * 60 * 1000

/** A sliding one-minute counter per key, for the rate limits. */
function limiter(max, now) {
  const hits = new Map()
  return {
    /** Counts one hit; false when `key` is over the limit. */
    hit(key) {
      const t = now()
      const list = (hits.get(key) ?? []).filter((x) => t - x < 60000)
      list.push(t)
      hits.set(key, list)
      if (hits.size > 2000) for (const [k, v] of hits) if (t - v[v.length - 1] > 60000) hits.delete(k)
      return list.length <= max
    },
    over(key) {
      const t = now()
      return (hits.get(key) ?? []).filter((x) => t - x < 60000).length > max
    },
  }
}

/**
 * @param {object} deps
 * @param {object} deps.engine    the task engine (tasks, startHandlers, cancelTask, rerunTask, removeTasks, TERMINAL)
 * @param {object} deps.platform  for the 'tasks:update' event
 * @param {ReturnType<import('./devices.cjs').createDevices>} deps.devices
 * @param {ReturnType<import('./uploads.cjs').createUploads>} [deps.uploads]  without it, file jobs and uploads are off
 * @param {{ get(id: string): object|null, run(id: string, input: string): Promise<{ taskIds: string[] }> }} [deps.recipes]  without it, link recipes are off
 * @param {{ chat(o: object): AsyncGenerator, models(): Promise<object[]>, status(): object, load(): Promise<unknown>, eject(): void }} [deps.ai]  this computer's model, offered to paired devices; without it the AI routes are off
 * @param {() => string} deps.name
 * @param {string} deps.version
 * @param {() => object} [deps.info]  extra capabilities for /info (gpus, free disk, tool checks)
 * @param {(line: string) => void} [deps.log]
 */
function createV1({ engine, platform, devices, uploads = null, recipes = null, ai = null, name, version, info = () => ({}), log = () => {}, now = Date.now }) {
  const pairLimit = limiter(PAIR_PER_MIN, now)
  const authLimit = limiter(BAD_AUTH_PER_MIN, now)
  const streams = new Set()
  let unsubscribe = null

  // `downloadable` is false once the file is gone (a recipe's working files, or a result someone deleted): nothing to fetch.
  const stateOf = (entry) => ({ ...entry.state, host: name(), downloadable: entry.state.status === 'done' ? !!engine.taskFile?.(entry.state.id) : false })
  const allTasks = () => [...engine.tasks.values()].map(stateOf)

  /* --- live events: one 'tasks:update' listener feeds every connected client, coalesced per client --- */
  function ensureListener() {
    if (unsubscribe || !platform?.on) return
    unsubscribe = platform.on('tasks:update', (payload) => {
      for (const s of streams) s.push(payload)
    })
  }
  function maybeStopListener() {
    if (streams.size === 0 && unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  }

  function openStream(req, res, cors) {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    let pending = null // { full, byId }
    let timer = null
    const stream = {
      push(payload) {
        if (!pending) pending = { full: false, byId: new Map() }
        if (payload.full) {
          pending.full = true
          pending.byId.clear()
        }
        for (const s of payload.tasks) pending.byId.set(s.id, { ...s, host: name() })
        timer ??= setTimeout(flush, EVENT_INTERVAL_MS)
      },
    }
    function flush() {
      timer = null
      if (!pending || res.writableEnded) return
      const { full, byId } = pending
      pending = null
      send(full ? 'tasks' : 'task', [...byId.values()])
    }
    streams.add(stream)
    ensureListener()
    send('tasks', allTasks())
    const beat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS)
    req.on('close', () => {
      clearInterval(beat)
      clearTimeout(timer)
      streams.delete(stream)
      maybeStopListener()
    })
  }

  function readJson(req, max = MAX_JSON) {
    return new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > max) {
          if (size - c.length <= max) reject(Object.assign(new Error('Too large'), { code: 413 }))
          chunks.length = 0 // the rest is dropped; the connection closes after the answer
        } else chunks.push(c)
      })
      req.on('end', () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
        } catch {
          reject(Object.assign(new Error('Body must be JSON'), { code: 400 }))
        }
      })
      req.on('error', reject)
    })
  }

  /* --- result files: streamed with Range support; a signed link lets a browser download without headers --- */
  const signKey = crypto.randomBytes(32)
  const sign = (id, exp) => crypto.createHmac('sha256', signKey).update(`${id}.${exp}`).digest('base64url')
  function validSig(id, query) {
    const exp = Number(query.get('exp'))
    const sig = String(query.get('sig') ?? '')
    if (!Number.isFinite(exp) || exp < now()) return false
    const want = Buffer.from(sign(id, exp))
    const got = Buffer.from(sig)
    return got.length === want.length && crypto.timingSafeEqual(got, want)
  }

  /** "bytes=S-E", "bytes=S-" or "bytes=-N" against a file of `size` bytes: [start, end] or null when unsatisfiable. */
  function parseRange(header, size) {
    const r = /^bytes=(\d*)-(\d*)$/.exec(String(header))
    if (!r || (r[1] === '' && r[2] === '')) return null
    let start
    let end
    if (r[1] === '') {
      start = Math.max(0, size - Number(r[2]))
      end = size - 1
    } else {
      start = Number(r[1])
      end = r[2] === '' ? size - 1 : Math.min(Number(r[2]), size - 1)
    }
    return start <= end && start < size ? [start, end] : null
  }

  function sendFile(req, res, taskId, cors, reply) {
    const entry = engine.tasks.get(taskId)
    const file = entry?.state.status === 'done' ? engine.taskFile(taskId) : null
    if (!file) return reply(404, { error: 'That job has no finished file' })
    const size = fs.statSync(file).size
    const base = path.basename(file)
    const headers = {
      ...cors,
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${base.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(base)}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    }
    let range = null
    if (req.headers.range) {
      range = parseRange(req.headers.range, size)
      if (!range) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` })
        return res.end()
      }
    }
    const [start, end] = range ?? [0, size - 1]
    res.writeHead(range ? 206 : 200, { ...headers, 'Content-Length': size === 0 ? 0 : end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) })
    if (req.method === 'HEAD' || size === 0) return res.end()
    const stream = fs.createReadStream(file, { start, end })
    stream.on('error', () => res.destroy())
    res.on('close', () => stream.destroy())
    stream.pipe(res)
  }

  /**
   * The OpenAI chat-completions shape on top of this computer's model, so another OPNduck (or any OpenAI-compatible
   * client) can use it with a device token as the key. Tools are only descriptions here: nothing runs on this computer.
   */
  async function aiCompletions(req, res, cors, reply, device) {
    const body = await readJson(req, MAX_AI_JSON)
    const messages = Array.isArray(body.messages) ? body.messages.slice(-60) : []
    if (messages.length === 0) return reply(400, { error: 'messages is required' })
    const wire = messages.map((m) => ({
      role: ['system', 'user', 'assistant', 'tool'].includes(m.role) ? m.role : 'user',
      content: typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.filter((p) => p?.type === 'text').map((p) => p.text).join('\n') : '',
      ...(Array.isArray(m.content) ? { images: m.content.filter((p) => p?.type === 'image_url' && typeof p.image_url?.url === 'string' && p.image_url.url.startsWith('data:image/')).map((p) => p.image_url.url).slice(0, 4) } : {}),
      ...(m.tool_call_id ? { tool_call_id: String(m.tool_call_id) } : {}),
      ...(Array.isArray(m.tool_calls) ? { tool_calls: m.tool_calls.map((c) => ({ id: String(c.id), name: String(c.function?.name ?? ''), args: (() => { try { return JSON.parse(c.function?.arguments || '{}') } catch { return {} } })() })) } : {}),
    }))
    const tools = Array.isArray(body.tools) ? body.tools.slice(0, 64).map((t) => ({ name: String(t.function?.name ?? ''), description: String(t.function?.description ?? '').slice(0, 2000), parameters: t.function?.parameters ?? { type: 'object', properties: {} } })).filter((t) => t.name) : undefined
    const jsonSchema = body.response_format?.type === 'json_schema' ? body.response_format.json_schema?.schema : undefined
    const stream = body.stream !== false
    const id = `chatcmpl-${crypto.randomUUID()}`
    const created = Math.floor(now() / 1000)
    const chunk = (delta, extra = {}) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: String(body.model ?? ''), choices: [{ index: 0, delta, finish_reason: null, ...extra }] })}\n\n`
    const controller = new AbortController()
    res.on('close', () => controller.abort()) // the device went away: stop the model
    let text = ''
    const calls = []
    let usage = null
    try {
      if (stream) res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
      for await (const ev of ai.chat({ messages: wire, tools, jsonSchema, temperature: typeof body.temperature === 'number' ? body.temperature : undefined, maxTokens: Number.isInteger(body.max_tokens) ? Math.min(body.max_tokens, 8000) : undefined, signal: controller.signal })) {
        if (ev.type === 'text') {
          text += ev.delta
          if (stream) res.write(chunk({ content: ev.delta }))
        } else if (ev.type === 'thinking') {
          if (stream) res.write(chunk({ reasoning_content: ev.delta }))
        } else if (ev.type === 'tool_call') {
          calls.push(ev)
          if (stream) res.write(chunk({ tool_calls: [{ index: calls.length - 1, id: ev.id, type: 'function', function: { name: ev.name, arguments: JSON.stringify(ev.args) } }] }))
        } else if (ev.type === 'done') usage = ev.usage
      }
      log(`engine-api: ${device.name} used the AI model`)
      const u = usage ? { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.input + usage.output } : undefined
      if (stream) {
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: String(body.model ?? ''), choices: [{ index: 0, delta: {}, finish_reason: calls.length ? 'tool_calls' : 'stop' }], ...(u ? { usage: u } : {}) })}\n\n`)
        res.end('data: [DONE]\n\n')
      } else {
        reply(200, { id, object: 'chat.completion', created, model: String(body.model ?? ''), choices: [{ index: 0, finish_reason: calls.length ? 'tool_calls' : 'stop', message: { role: 'assistant', content: text, ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) } }], ...(u ? { usage: u } : {}) })
      }
    } catch (err) {
      if (controller.signal.aborted) return
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`)
        res.end('data: [DONE]\n\n')
      } else reply(502, { error: err.message })
    }
  }

  /**
   * Handles a /v1 request the server did not answer itself. Returns false for a path this does not know.
   * @param {{ reply: (code: number, body: object) => void, url: string, cors: object, ip: string }} ctx
   */
  async function handle(req, res, { reply, url, cors, ip }) {
    const parts = url.split('/').filter(Boolean) // ['v1', 'tasks', id, 'cancel']
    const [, a, b, c] = parts
    const m = req.method
    try {
      if (m === 'POST' && a === 'pair' && parts.length === 2) {
        if (!pairLimit.hit(ip)) return reply(429, { error: 'Too many attempts, wait a minute' })
        const body = await readJson(req)
        const done = devices.pair({ code: body.code, deviceName: body.deviceName, deviceKind: body.deviceKind })
        if (!done) return reply(403, { error: 'That pairing code is wrong or has expired' })
        log('engine-api: a device paired')
        return reply(200, done)
      }
      const known =
        (a === 'info' && parts.length === 2) ||
        (a === 'tasks' && parts.length <= 4) ||
        (a === 'events' && parts.length === 2) ||
        (a === 'devices' && parts.length <= 3) ||
        (a === 'uploads' && parts.length <= 3) ||
        (a === 'files' && parts.length >= 3 && parts.length <= 4) ||
        (a === 'ai' && parts.length >= 3 && parts.length <= 4)
      if (!known) return reply(404, { error: 'Not found' })

      // A signed download link carries its own proof (made by POST /files/:id/link, good for 10 minutes).
      if ((m === 'GET' || m === 'HEAD') && a === 'files' && b && !c) {
        const query = new URL(req.url, 'http://x').searchParams
        if (query.has('sig')) return validSig(b, query) ? sendFile(req, res, b, cors, reply) : reply(403, { error: 'This link has expired' })
      }

      if (authLimit.over(ip)) return reply(429, { error: 'Too many failed attempts, wait a minute' })
      const auth = String(req.headers.authorization ?? '')
      const device = auth.startsWith('Bearer ') ? devices.authenticate(auth.slice(7)) : null
      if (!device) {
        authLimit.hit(ip)
        return reply(401, { error: 'Bad token' })
      }

      if (m === 'GET' && a === 'info') {
        const kinds = [...Object.entries(KINDS).filter(([k]) => k === 'download' || uploads).map(([k]) => k), ...(recipes ? ['recipe'] : [])]
        return reply(200, { name: name(), version, apiVersion: 1, kinds, uploads: !!uploads, ...info() })
      }
      if (m === 'GET' && a === 'tasks' && !b) return reply(200, { tasks: allTasks() })
      if (m === 'GET' && a === 'events') return openStream(req, res, cors)
      if (m === 'POST' && a === 'tasks' && !b) {
        const body = await readJson(req)
        if (body.kind === 'recipe') {
          // A saved recipe that starts from a link, run on a link. The recipe's own steps decide everything else.
          if (!recipes) return reply(501, { error: 'This engine has no recipes' })
          const r = body.req ?? {}
          const recipe = typeof r.recipeId === 'string' ? recipes.get(r.recipeId) : null
          if (!recipe || recipe.input !== 'url') return reply(400, { error: 'That recipe does not start from a link' })
          buildRemoteRequest('download', { url: r.url }) // the same link checks as a plain download
          const run = await recipes.run(recipe.id, r.url)
          log(`engine-api: ${device.name} started the recipe ${recipe.name}`)
          return reply(202, { id: run.taskIds[0], taskIds: run.taskIds })
        }
        const { channel, req: clean } = buildRemoteRequest(body.kind, body.req, (uid) => uploads?.resolve(uid, device.id) ?? null)
        const start = engine.startHandlers.get(channel)
        if (!start) return reply(501, { error: 'This engine cannot run that job' })
        const id = await start(null, clean)
        const entry = engine.tasks.get(id)
        if (entry) {
          entry.state.source = 'remote'
          engine.broadcastTasks()
        }
        log(`engine-api: ${device.name} started a ${body.kind} job`)
        return reply(202, { id })
      }
      if (m === 'POST' && a === 'tasks' && b && c === 'cancel') return reply(200, { ok: engine.cancelTask(b) })
      if (m === 'POST' && a === 'tasks' && b && c === 'rerun') return reply(200, { ok: engine.rerunTask(b) })
      if (m === 'DELETE' && a === 'tasks' && b && !c) return reply(200, { removed: engine.removeTasks([b]) })
      if (a === 'ai') {
        if (!ai) return reply(501, { error: 'This engine has no AI model to share' })
        const route = parts.slice(2).join('/')
        if (m === 'GET' && route === 'status') return reply(200, ai.status())
        if (m === 'GET' && route === 'models') return reply(200, { object: 'list', data: (await ai.models()).map((x) => ({ id: x.id, object: 'model', name: x.name ?? x.id })) })
        if (m === 'POST' && (route === 'load' || route === 'eject')) {
          if (route === 'load') await ai.load()
          else ai.eject()
          return reply(200, ai.status())
        }
        if (m === 'POST' && route === 'chat/completions') return aiCompletions(req, res, cors, reply, device)
        return reply(404, { error: 'Not found' })
      }
      if (a === 'uploads') {
        if (!uploads) return reply(501, { error: 'This engine does not take uploads' })
        if (m === 'POST' && !b) {
          const body = await readJson(req)
          return reply(201, uploads.create({ name: body.name, size: body.size, sha256: body.sha256 }, device.id))
        }
        if (m === 'PUT' && b) {
          const r = await uploads.append(b, device.id, req.headers['content-range'], req)
          return reply(r.short ? 400 : 200, r.short ? { error: 'The chunk was cut short', ...r } : r)
        }
        if ((m === 'HEAD' || m === 'GET') && b) {
          const st = uploads.status(b, device.id)
          if (m === 'GET') return reply(200, st)
          res.writeHead(200, { ...cors, 'Upload-Offset': st.offset, 'Upload-Length': st.size, 'Cache-Control': 'no-store' })
          return res.end()
        }
      }
      if (a === 'files' && b) {
        if ((m === 'GET' || m === 'HEAD') && !c) return sendFile(req, res, b, cors, reply)
        if (m === 'POST' && c === 'link') {
          if (!engine.taskFile(b)) return reply(404, { error: 'That job has no finished file' })
          const exp = now() + LINK_TTL_MS
          return reply(200, { url: `/v1/files/${encodeURIComponent(b)}?exp=${exp}&sig=${sign(b, exp)}`, expires: exp })
        }
      }
      if (a === 'devices') {
        if (device.kind !== 'desktop') return reply(403, { error: 'Only a desktop device can manage devices' })
        if (m === 'GET' && !b) return reply(200, { devices: devices.list() })
        if (m === 'DELETE' && b) return reply(200, { removed: devices.revoke(b) })
      }
      return reply(404, { error: 'Not found' })
    } catch (err) {
      const code = [400, 404, 409, 413, 422, 429, 507].includes(err.code) ? err.code : 400
      if (code === 413) res.once('finish', () => req.destroy())
      return reply(code, { error: err.message, ...(err.offset !== undefined ? { offset: err.offset } : {}) })
    }
  }

  function closeAll() {
    for (const s of streams) s.push = () => {}
    streams.clear()
    maybeStopListener()
  }

  return { handle, closeAll }
}

module.exports = { createV1, limiter }
