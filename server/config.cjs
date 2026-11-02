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
 * OPNduck Server settings: environment variables first; a value in config.json (in the data folder) is used when its
 * environment variable is not set. No Electron.
 */
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const isTailnet = (ip) => {
  const p = String(ip).split('.').map(Number)
  return p.length === 4 && p[0] === 100 && p[1] >= 64 && p[1] <= 127
}

/** The data folder: $OPNDUCK_DATA, else /data when it exists (a container), else a folder under the home directory. */
function dataDir(env = process.env) {
  if (env.OPNDUCK_DATA) return path.resolve(env.OPNDUCK_DATA)
  if (fs.existsSync('/data')) return '/data'
  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'opnduck-server')
}

function number(value, fallback, { min, max }) {
  if (value == null || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${value} is not a number from ${min} to ${max}`)
  return n
}

/** @returns {object} the settings, checked */
function loadConfig(env = process.env) {
  const data = dataDir(env)
  let file = {}
  try {
    file = JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8')) ?? {}
  } catch {
    /* no config file: environment variables and defaults */
  }
  const pick = (envName, key) => (env[envName] != null && env[envName] !== '' ? env[envName] : file[key])
  const bind = String(pick('OPNDUCK_BIND', 'bind') ?? '127.0.0.1')
  if (!net.isIP(bind)) throw new Error(`OPNDUCK_BIND must be an IP address (127.0.0.1, a Tailscale address, or 0.0.0.0), not "${bind}"`)
  const publicUrl = String(pick('OPNDUCK_PUBLIC_URL', 'publicUrl') ?? '').replace(/\/+$/, '')
  if (publicUrl && !/^https?:\/\/[^/\s]+$/.test(publicUrl)) throw new Error('OPNDUCK_PUBLIC_URL must look like https://server.example.com:47821')
  return {
    data,
    output: path.resolve(String(pick('OPNDUCK_OUTPUT', 'output') ?? path.join(data, 'output'))),
    port: number(pick('OPNDUCK_PORT', 'port'), 47821, { min: 1, max: 65535 }),
    bind,
    name: String(pick('OPNDUCK_NAME', 'name') ?? os.hostname()).slice(0, 60),
    maxUploadGB: number(pick('OPNDUCK_MAX_UPLOAD_GB', 'maxUploadGB'), 8, { min: 0.001, max: 1000 }),
    retentionHours: number(pick('OPNDUCK_RETENTION_HOURS', 'retentionHours'), 48, { min: 1, max: 24 * 365 }),
    relay: ['1', 'true', 'yes', true].includes(pick('OPNDUCK_RELAY', 'relay')),
    publicUrl,
  }
}

/**
 * The addresses a device could use to reach this server, best first: the public URL, then Tailscale, then LAN addresses.
 * Used to print a pair link that works; the person can still edit it.
 */
function reachableUrls({ bind, port, publicUrl }, interfaces = os.networkInterfaces()) {
  if (publicUrl) return [publicUrl]
  if (bind !== '0.0.0.0' && bind !== '::') return [`http://${net.isIPv6(bind) ? `[${bind}]` : bind}:${port}`]
  const found = []
  for (const addrs of Object.values(interfaces)) for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) found.push(a.address)
  found.sort((x, y) => Number(isTailnet(y)) - Number(isTailnet(x)))
  return found.length ? found.map((ip) => `http://${ip}:${port}`) : [`http://127.0.0.1:${port}`]
}

module.exports = { loadConfig, reachableUrls, dataDir }
