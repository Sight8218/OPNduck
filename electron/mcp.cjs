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
 * The in-app half of OPNduck's MCP support. A localhost-only HTTP server that the stdio bridge
 * (mcp_bridge.cjs) talks to. It only runs while Settings → MCP server is on.
 *
 * Safety: 127.0.0.1 only, a random bearer token (kept in userData/mcp.json, mode 0600), requests
 * with an Origin header are refused (so web pages can't call it), start tools only accept existing
 * regular files and never choose an output folder, and at most MAX_ACTIVE MCP jobs may be waiting
 * or running at once.
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { buildStartRequest, TOOLS } = require('./mcp_tools.cjs')
const { suggest } = require('./core/autosettings.cjs')

const MAX_ACTIVE = 20
const MAX_BODY = 64 * 1024

function tokenMatches(given, expected) {
  const a = Buffer.from(String(given))
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function requireFile(p, what) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error(`${what} must be an absolute path`)
  let st
  try {
    st = fs.statSync(p)
  } catch {
    throw new Error(`${what} does not exist: ${p}`)
  }
  if (!st.isFile()) throw new Error(`${what} is not a regular file`)
}

/**
 * @param {object} deps
 * @param {string} deps.userDataDir
 * @param {Map<string, any>} deps.tasks            main's task map
 * @param {Map<string, Function>} deps.startHandlers
 * @param {(id: string) => boolean} deps.cancelTask
 * @param {(paused: boolean) => void} deps.setQueuePaused
 * @param {(p: string) => Promise<any>} deps.probeMedia
 * @param {(p: string) => Promise<any>} [deps.analyzeMedia]  facts for suggest_settings
 * @param {{ tools(): object[], callTool(name: string, args: unknown): Promise<unknown> }} [deps.plugins]  running plugins' tools (`<id>__<tool>`)
 * @param {(msg: string) => void} [deps.log]
 */
function createMcpServer(deps) {
  const infoFile = path.join(deps.userDataDir, 'mcp.json')
  let server = null
  let token = ''

  const activeMcpJobs = () =>
    [...deps.tasks.values()].filter((t) => t.state.source === 'mcp' && ['queued', 'running'].includes(t.state.status)).length

  const summary = (t) => ({
    id: t.state.id,
    kind: t.state.kind,
    status: t.state.status,
    progress: Math.round((t.state.progress ?? 0) * 1000) / 1000,
    label: t.state.label,
    format: t.state.format,
    error: t.state.error ?? null,
    viaMcp: t.state.source === 'mcp',
  })

  async function call(tool, args) {
    const def = TOOLS.find((t) => t.name === tool)
    // Plugin tools are named `<plugin id>__<tool>`; the plugin host checks the name and the arguments.
    if (!def && deps.plugins && tool.includes('__')) return deps.plugins.callTool(tool, args)
    if (!def) throw new Error(`Unknown tool: ${tool}`)
    if (def.channel) {
      const { channel, req } = buildStartRequest(tool, args)
      if (tool === 'download') {
        let u
        try {
          u = new URL(req.url)
        } catch {
          throw new Error('url must be a full http(s) link')
        }
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error('url must start with http:// or https://')
      } else {
        requireFile(req.inputPath, 'inputPath')
      }
      if (activeMcpJobs() >= MAX_ACTIVE) throw new Error(`Too many MCP jobs waiting or running (limit ${MAX_ACTIVE})`)
      const start = deps.startHandlers.get(channel)
      if (!start) throw new Error(`This build cannot run ${tool}`)
      const id = await start(null, req)
      const entry = deps.tasks.get(id)
      if (entry) entry.state.source = 'mcp'
      return { id }
    }
    const a = args && typeof args === 'object' ? args : {}
    switch (tool) {
      case 'list_jobs': {
        let list = [...deps.tasks.values()]
        if (a.status) list = list.filter((t) => t.state.status === a.status)
        return list.slice(-200).map(summary)
      }
      case 'job_status': {
        const t = deps.tasks.get(String(a.id))
        if (!t) throw new Error('No job with that id')
        const n = Number.isInteger(a.logLines) ? Math.min(Math.max(a.logLines, 0), 200) : 20
        const lines = t.log?.lines ? [...t.log.lines] : []
        return { ...summary(t), outputPath: t.finalPath ?? null, sizeBytes: t.state.sizeBytes, log: n ? lines.slice(-n) : [] }
      }
      case 'cancel_job': {
        const t = deps.tasks.get(String(a.id))
        if (!t) throw new Error('No job with that id')
        return { canceled: deps.cancelTask(String(a.id)) }
      }
      case 'queue_pause':
      case 'queue_resume':
        deps.setQueuePaused(tool === 'queue_pause')
        return { paused: tool === 'queue_pause' }
      case 'suggest_settings': {
        requireFile(a.inputPath, 'inputPath')
        if (!deps.analyzeMedia) throw new Error('This build cannot analyze media')
        const facts = await deps.analyzeMedia(a.inputPath)
        if (!facts) return { error: 'Could not read that file' }
        return { facts, ...suggest(String(a.tool), facts, { container: a.container }) }
      }
      case 'probe_media':
        requireFile(a.path, 'path')
        return (await deps.probeMedia(a.path)) ?? { error: 'Could not read that file' }
    }
    throw new Error(`Unknown tool: ${tool}`)
  }

  function handle(req, res) {
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    // A browser always sends Origin on cross-site requests; the bridge never does.
    if (req.headers.origin) return reply(403, { error: 'Browser requests are not allowed' })
    if (req.method !== 'POST' || (req.url !== '/call' && req.url !== '/tools')) return reply(404, { error: 'Not found' })
    const auth = String(req.headers.authorization ?? '')
    if (!auth.startsWith('Bearer ') || !tokenMatches(auth.slice(7), token)) return reply(401, { error: 'Bad token' })
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reply(413, { error: 'Request too large' })
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', async () => {
      if (res.writableEnded) return
      if (req.url === '/tools') {
        const tools = (deps.plugins?.tools() ?? []).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
        return reply(200, { ok: true, result: tools })
      }
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!body || typeof body.tool !== 'string') throw new Error('Missing tool name')
        const result = await call(body.tool, body.args)
        deps.log?.(`mcp: ${body.tool}`)
        reply(200, { ok: true, result })
      } catch (err) {
        reply(200, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    })
  }

  return {
    infoFile,
    get running() {
      return !!server
    },
    get port() {
      return server?.address()?.port ?? null
    },
    /** Starts listening (no-op if already running). Resolves once the port is known and mcp.json is written. */
    start() {
      if (server) return Promise.resolve()
      token = crypto.randomBytes(32).toString('hex')
      return new Promise((resolve, reject) => {
        const s = http.createServer(handle)
        s.once('error', reject)
        s.listen(0, '127.0.0.1', () => {
          server = s
          fs.mkdirSync(path.dirname(infoFile), { recursive: true })
          fs.writeFileSync(infoFile, JSON.stringify({ port: s.address().port, token, pid: process.pid }), { mode: 0o600 })
          fs.chmodSync(infoFile, 0o600)
          resolve()
        })
      })
    },
    /** Stops listening and removes mcp.json, so the old token is dead. */
    stop() {
      const s = server
      server = null
      token = ''
      try {
        fs.rmSync(infoFile, { force: true })
      } catch {
        /* nothing to clean */
      }
      return new Promise((resolve) => (s ? (s.closeAllConnections?.(), s.close(() => resolve())) : resolve()))
    },
    /** New token, same port (clients re-read mcp.json on every call, so they follow automatically). */
    async resetToken() {
      if (!server) return
      await this.stop()
      await this.start()
    },
    call,
  }
}

module.exports = { createMcpServer }
