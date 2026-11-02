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
 * Talks to the Tailscale command line (if it is installed) to find this computer's tailnet address and name, and to
 * put an HTTPS front on the local server (browsers refuse to call a plain http:// address from an https:// page).
 * No Electron. `run` is injectable so the tests need no Tailscale.
 */
const { execFile } = require('node:child_process')

const SERVE_PORT = 47822
const DOWNLOAD_URL = 'https://tailscale.com/download'

function defaultRun(args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    execFile('tailscale', args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, notFound: err?.code === 'ENOENT', stdout: String(stdout), stderr: String(stderr || err?.message || '') })
    })
  })
}

/** Reads the JSON of `tailscale status --json` into what the Settings card shows. */
function parseStatus(json) {
  const self = json?.Self ?? {}
  const ips = (self.TailscaleIPs ?? []).filter((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x))
  const dns = String(self.DNSName ?? '').replace(/\.$/, '')
  return {
    installed: true,
    running: json?.BackendState === 'Running',
    ip: ips[0] ?? null,
    dnsName: dns || null,
    // certificates (and so HTTPS) need to be switched on for the tailnet
    httpsAvailable: Array.isArray(json?.CertDomains) && json.CertDomains.length > 0,
    tailnet: json?.CurrentTailnet?.Name ?? null,
  }
}

async function status(run = defaultRun) {
  const r = await run(['status', '--json'])
  if (r.notFound) return { installed: false, running: false, ip: null, dnsName: null, httpsAvailable: false, tailnet: null, downloadUrl: DOWNLOAD_URL }
  try {
    return { ...parseStatus(JSON.parse(r.stdout)), downloadUrl: DOWNLOAD_URL }
  } catch {
    return { installed: true, running: false, ip: null, dnsName: null, httpsAvailable: false, tailnet: null, downloadUrl: DOWNLOAD_URL, error: r.stderr.trim().slice(0, 300) }
  }
}

/** The command a user can run by hand when OPNduck is not allowed to (Linux needs `tailscale set --operator`). */
const serveCommand = (port) => `tailscale serve --bg --https=${SERVE_PORT} http://127.0.0.1:${port}`

/** Puts an HTTPS address on the local server. Returns { ok, url } or { ok: false, error, command }. */
async function serveOn(port, dnsName, run = defaultRun) {
  if (!dnsName) return { ok: false, error: 'This computer has no Tailscale name yet.', command: serveCommand(port) }
  const r = await run(['serve', '--bg', `--https=${SERVE_PORT}`, `http://127.0.0.1:${port}`], 20000)
  if (!r.ok) {
    const needsOperator = /access denied|operator|permission/i.test(r.stderr)
    return {
      ok: false,
      error: needsOperator ? 'Tailscale needs to let your user control it. Run this once, then try again: sudo tailscale set --operator=$USER' : r.stderr.trim().slice(0, 300) || 'tailscale serve failed',
      command: serveCommand(port),
    }
  }
  return { ok: true, url: `https://${dnsName}:${SERVE_PORT}` }
}

async function serveOff(run = defaultRun) {
  const r = await run(['serve', `--https=${SERVE_PORT}`, 'off'], 10000)
  return r.ok ? { ok: true } : { ok: false, error: r.stderr.trim().slice(0, 300) || 'tailscale serve off failed', command: `tailscale serve --https=${SERVE_PORT} off` }
}

module.exports = { status, parseStatus, serveOn, serveOff, serveCommand, SERVE_PORT, DOWNLOAD_URL }
