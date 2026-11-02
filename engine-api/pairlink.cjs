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
 * The link another OPNduck (or the phone app) uses to pair with an engine: `opnduck://pair?u=<address>&c=<code>&n=<name>`.
 * The code is one-time and expires after five minutes. No Electron.
 */

/** @param {{ baseUrl: string, code: string, name: string }} p */
function buildEnginePairLink({ baseUrl, code, name }) {
  const q = new URLSearchParams({ u: baseUrl, c: code, n: name })
  return `opnduck://pair?${q}`
}

/** Reads an engine pair link. Returns { baseUrl, code, name } or null. Only http(s) addresses are accepted. */
function parseEnginePairLink(text) {
  try {
    const u = new URL(String(text).trim())
    if (u.protocol !== 'opnduck:' || u.hostname !== 'pair') return null
    const baseUrl = u.searchParams.get('u') ?? ''
    const code = u.searchParams.get('c') ?? ''
    const base = new URL(baseUrl)
    if (!['http:', 'https:'].includes(base.protocol) || !/^[A-Za-z0-9_-]{16,64}$/.test(code)) return null
    return { baseUrl: base.origin, code, name: (u.searchParams.get('n') ?? '').slice(0, 60) }
  } catch {
    return null
  }
}

module.exports = { buildEnginePairLink, parseEnginePairLink }
