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
 * The first slice of OPNduck's network API (/v1), used by the phone page and the browser extension to send links.
 * It can be switched off (the default), bound to this computer only, to this computer plus the Tailscale address, or
 * to the whole LAN. It only ever answers health checks and one authenticated POST that hands a sealed message to the
 * inbox; it never serves files. No Electron.
 */
const http = require('node:http')
const os = require('node:os')
const crypto = require('node:crypto')

const MAX_BODY = 8 * 1024
const DEFAULT_PORT = 47821
const ALLOWED_ORIGIN = [/^https:\/\/sight8218\.github\.io$/, /^chrome-extension:\/\/[a-p]{32}$/, /^moz-extension:\/\/[0-9a-f-]{36}$/]

/** 100.64.0.0/10, the range Tailscale hands out. */
const isTailnetIp = (ip) => {
  const p = String(ip).split('.').map(Number)
  return p.length === 4 && p[0] === 100 && p[1] >= 64 && p[1] <= 127
}

/**
 * Which addresses to listen on for a bind mode. `interfaces` is os.networkInterfaces(), `tailscaleIp` the address
 * `tailscale ip -4` reported (or null). Never 0.0.0.0 unless the mode is 'lan'.
 */
function bindAddresses(mode, interfaces = os.networkInterfaces(), tailscaleIp = null) {
  if (mode === 'off') return []
  if (mode === 'localhost') return ['127.0.0.1']
  if (mode === 'lan') return ['0.0.0.0']
  if (mode === 'tailscale') {
    const found = new Set()
    for (const [name, addrs] of Object.entries(interfaces)) {
      if (!/^(tailscale|utun)/i.test(name)) continue
      for (const a of addrs ?? []) if (a.family === 'IPv4' && isTailnetIp(a.address)) found.add(a.address)
    }
    if (tailscaleIp && isTailnetIp(tailscaleIp)) found.add(tailscaleIp)
    return ['127.0.0.1', ...found]
  }
  throw new Error(`Unknown bind mode: ${mode}`)
}

const sameToken = (given, expected) => {
  const a = Buffer.from(String(given))
  const b = Buffer.from(String(expected))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * @param {object} deps
 * @param {{ receive(wire: string, channel: string): Promise<boolean>, keys(): { authToken: string } }} deps.inbox
 * @param {() => string} deps.name  this computer's name, shown by /v1/health
 * @param {{ handle: Function, closeAll: Function }} [deps.v1]  the rest of the API (see v1.cjs); without it only /health and /send exist
 * @param {(line: string) => void} [deps.log]
 */
function createEngineApi({ inbox, name, v1 = null, log = () => {} }) {
  let servers = []
  let status = { running: false, port: null, addresses: [], error: '' }

  function handle(req, res) {
    const origin = req.headers.origin
    const reply = (code, body) => {
      const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(code === 413 ? { Connection: 'close' } : {}) }
      if (origin && ALLOWED_ORIGIN.some((re) => re.test(origin))) {
        headers['Access-Control-Allow-Origin'] = origin
        headers['Access-Control-Expose-Headers'] = 'Upload-Offset, Upload-Length, Content-Range, Content-Disposition'
        headers.Vary = 'Origin'
      }
      res.writeHead(code, headers)
      res.end(JSON.stringify(body))
    }
    const url = (req.url ?? '').split('?')[0]
    if (req.method === 'OPTIONS') {
      if (!origin || !ALLOWED_ORIGIN.some((re) => re.test(origin))) return reply(403, { error: 'Origin not allowed' })
      res.writeHead(204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Content-Range, Range',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      })
      return res.end()
    }
    if (req.method === 'GET' && url === '/v1/health') return reply(200, { ok: true, name: name(), apiVersion: 1 })
    if (v1 && url.startsWith('/v1/') && url !== '/v1/send') {
      const cors = origin && ALLOWED_ORIGIN.some((re) => re.test(origin)) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}
      return void v1.handle(req, res, { reply, url, cors, ip: req.socket.remoteAddress ?? '' })
    }
    if (req.method !== 'POST' || url !== '/v1/send') return reply(404, { error: 'Not found' })
    const auth = String(req.headers.authorization ?? '')
    if (!auth.startsWith('Bearer ') || !sameToken(auth.slice(7), inbox.keys().authToken)) return reply(401, { error: 'Bad token' })
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reply(413, { error: 'Too large' })
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      if (res.writableEnded) return
      void inbox.receive(Buffer.concat(chunks).toString('utf8').trim(), 'direct').catch(() => {})
      reply(202, { ok: true }) // the same answer for a new, a repeated and a refused message, so it tells a sender nothing
    })
  }

  /** (Re)starts listening for `mode`. Tries `port`, then the next nine, and uses one port on every address. */
  async function start({ mode, port = DEFAULT_PORT, interfaces, tailscaleIp }) {
    await stop()
    const addresses = bindAddresses(mode, interfaces, tailscaleIp)
    if (addresses.length === 0) return status
    for (let p = port; p < port + 10; p++) {
      const opened = []
      try {
        for (const host of addresses) {
          const s = http.createServer(handle)
          s.requestTimeout = v1 ? 5 * 60 * 1000 : 10000 // an 8 MB upload chunk over a slow link needs more than ten seconds
          s.headersTimeout = 10000
          await new Promise((resolve, reject) => {
            s.once('error', reject)
            s.listen(p, host, resolve)
          })
          opened.push(s)
        }
        servers = opened
        status = { running: true, port: p, addresses, error: '' }
        log(`remote: listening on ${addresses.join(', ')}:${p}`)
        return status
      } catch (err) {
        await Promise.all(opened.map((s) => new Promise((r) => s.close(r))))
        if (err.code !== 'EADDRINUSE') {
          status = { running: false, port: null, addresses: [], error: err.message }
          return status
        }
      }
    }
    status = { running: false, port: null, addresses: [], error: `Ports ${port} to ${port + 9} are all in use` }
    return status
  }

  async function stop() {
    v1?.closeAll()
    const open = servers
    servers = []
    status = { running: false, port: null, addresses: [], error: '' }
    await Promise.all(open.map((s) => new Promise((r) => (s.closeAllConnections?.(), s.close(r)))))
  }

  return { start, stop, status: () => ({ ...status }) }
}

module.exports = { createEngineApi, bindAddresses, isTailnetIp, DEFAULT_PORT, MAX_BODY }
