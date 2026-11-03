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
 * What a request from another device may ask the engine to do. Remote requests never carry paths: this keeps only the
 * fields of a known job kind, and refuses anything that looks like a file path, a destination or a cookie setting.
 * No Electron.
 */

const { TOOLS, DEFAULTS, buildStartRequest } = require('../electron/mcp_tools.cjs')

/** Tools that work on one uploaded file. The file is named by an upload id, never by a path. */
const FILE_KINDS = ['convert', 'upscale_image', 'upscale_video', 'interpolate', 'subtitles', 'trim', 'compress', 'make_gif', 'jump_cut', 'restore', 'grade', 'beat_analyze', 'audio_ai']

/** Job kinds a remote device can start, and the start channel each one uses. */
const KINDS = { download: 'tasks:start', ...Object.fromEntries(FILE_KINDS.map((k) => [k, TOOLS.find((t) => t.name === k).channel])) }

/** Request fields each kind keeps. Everything else is dropped. */
const FIELDS = { download: ['url', 'format', 'videoQuality', 'audioQuality', 'embedMeta'] }

const PATHLIKE = /^(?:\/|~|\\\\|[A-Za-z]:[\\/]|file:)/i

/** The first thing wrong with a request, or '' when it is fine. */
function whyRefused(value, depth = 0) {
  if (depth > 4) return 'too deeply nested'
  if (typeof value === 'string') return PATHLIKE.test(value) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value) ? 'file paths are not accepted from other devices' : ''
  if (Array.isArray(value)) return value.length > 100 ? 'too long' : value.map((v) => whyRefused(v, depth + 1)).find(Boolean) ?? ''
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (/^(destination|inputPath|path|cookies?|cookieMode|cookieFile|output)/i.test(k)) return `${k} cannot be set from another device`
      const why = whyRefused(v, depth + 1)
      if (why) return why
    }
  }
  return ''
}

/**
 * @param {string} kind
 * @param {object} req  for a file kind: the tool's arguments plus `uploadId` (no `inputPath`)
 * @param {(uploadId: string) => string|null} [resolveUpload]  turns a finished upload's id into its path
 * @returns {{ channel: string, req: object }}  the start channel and the cleaned request
 * @throws {Error} with a readable reason
 */
function buildRemoteRequest(kind, req, resolveUpload = () => null) {
  if (typeof kind !== 'string' || !Object.hasOwn(KINDS, kind)) throw new Error(`Unknown job kind. Available: ${Object.keys(KINDS).join(', ')}`)
  if (!req || typeof req !== 'object' || Array.isArray(req)) throw new Error('req must be an object')
  if (FILE_KINDS.includes(kind)) {
    const { uploadId, ...args } = req
    const bad = whyRefused(args)
    if (bad) throw new Error(bad)
    if (typeof uploadId !== 'string') throw new Error('uploadId is required: upload the file first')
    const inputPath = resolveUpload(uploadId)
    if (!inputPath) throw new Error('That upload is not finished or does not exist')
    if (Object.hasOwn(args, 'inputPath')) throw new Error('inputPath cannot be set from another device')
    return buildStartRequest(kind, { ...args, inputPath })
  }
  const url = typeof req.url === 'string' ? req.url : ''
  const why = whyRefused({ ...req, url: undefined })
  if (why) throw new Error(why)
  const clean = { ...(DEFAULTS[kind] ?? {}) }
  for (const k of FIELDS[kind]) if (req[k] !== undefined && req[k] !== null) clean[k] = req[k]
  if (kind === 'download') {
    let u
    try {
      u = new URL(url)
    } catch {
      throw new Error('url must be a full http(s) link')
    }
    if (!['http:', 'https:'].includes(u.protocol) || url.length > 2048) throw new Error('url must be a full http(s) link')
    clean.playlist = 'single'
  }
  return { channel: KINDS[kind], req: clean }
}

module.exports = { buildRemoteRequest, whyRefused, KINDS, FILE_KINDS }
