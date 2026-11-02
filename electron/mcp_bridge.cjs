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
 * MCP stdio bridge: `node mcp_bridge.cjs <path to userData/mcp.json>`.
 * An MCP client (Claude Code, ...) starts this; it forwards tool calls to the running OPNduck app
 * over localhost. Plain Node, no dependencies. stdout carries only protocol messages.
 */
const fs = require('node:fs')
const http = require('node:http')
const readline = require('node:readline')
const { publicTools } = require('./mcp_tools.cjs')

const infoFile = process.argv[2]
const PROTOCOL = '2025-06-18'

function send(msg) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`)
}

/** Posts one tool call to the app; mcp.json is re-read every time so an app restart or token reset is followed. */
function callApp(tool, args, route = '/call') {
  return new Promise((resolve, reject) => {
    let info
    try {
      info = JSON.parse(fs.readFileSync(infoFile, 'utf8'))
    } catch {
      return reject(new Error('OPNduck is not running with the MCP server turned on (Settings → MCP server).'))
    }
    const body = JSON.stringify({ tool, args })
    const req = http.request(
      {
        host: '127.0.0.1',
        port: info.port,
        path: route,
        method: 'POST',
        headers: { Authorization: `Bearer ${info.token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 120000,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (res.statusCode !== 200) reject(new Error(parsed.error || `HTTP ${res.statusCode}`))
            else if (!parsed.ok) reject(new Error(parsed.error || 'Tool failed'))
            else resolve(parsed.result)
          } catch {
            reject(new Error('Unreadable reply from OPNduck'))
          }
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('OPNduck did not answer in time')))
    req.on('error', () => reject(new Error('Could not reach OPNduck. Is it running with the MCP server turned on?')))
    req.end(body)
  })
}

async function handle(msg) {
  const { id, method, params } = msg
  if (id === undefined) return // notifications (initialized, cancelled, ...) need no answer
  try {
    switch (method) {
      case 'initialize':
        return send({
          id,
          result: { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'opnduck', version: '1.0.0' } },
        })
      case 'ping':
        return send({ id, result: {} })
      case 'tools/list': {
        // Plugin tools come from the running app; if it is not reachable, the built-in tools still list.
        const extra = await callApp(null, null, '/tools').catch(() => [])
        return send({ id, result: { tools: [...publicTools(), ...(Array.isArray(extra) ? extra : [])] } })
      }
      case 'tools/call': {
        const name = params?.name
        // `<plugin>__<tool>` names are checked by the app, which knows which plugins are running.
        if (typeof name !== 'string' || (!name.includes('__') && !publicTools().some((t) => t.name === name))) return send({ id, error: { code: -32602, message: `Unknown tool: ${name}` } })
        try {
          const result = await callApp(name, params.arguments)
          return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } })
        } catch (err) {
          return send({ id, result: { isError: true, content: [{ type: 'text', text: err.message }] } })
        }
      }
      default:
        return send({ id, error: { code: -32601, message: `Method not found: ${method}` } })
    }
  } catch (err) {
    send({ id, error: { code: -32603, message: err.message } })
  }
}

if (!infoFile) {
  process.stderr.write('Usage: mcp_bridge.cjs <path to OPNduck userData/mcp.json>\n')
  process.exit(2)
}
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return send({ id: null, error: { code: -32700, message: 'Parse error' } })
  }
  void handle(msg)
})
