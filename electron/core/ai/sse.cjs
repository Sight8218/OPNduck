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
 * Server-sent events from a fetch Response: yields { event, data } for every event, with `data` as the raw text.
 * Handles chunks that split a line anywhere, and CRLF or LF line ends. Used by every streaming provider.
 */
async function* readSse(response) {
  const decoder = new TextDecoder()
  let buffer = ''
  let event = ''
  let data = []
  const flush = function* () {
    if (data.length) yield { event: event || 'message', data: data.join('\n') }
    event = ''
    data = []
  }
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true })
    let nl
    while ((nl = buffer.search(/\r?\n/)) !== -1) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + (buffer[nl] === '\r' ? 2 : 1))
      if (line === '') yield* flush()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      else if (line.startsWith('event:')) event = line.slice(6).trim()
      // ids, retry and comment lines (": keep-alive") are ignored
    }
  }
  if (buffer.startsWith('data:')) data.push(buffer.slice(5).replace(/^ /, ''))
  yield* flush()
}

/** A readable one-line reason for a failed API response (the body is usually JSON with an error message). */
async function describeError(response) {
  let text = ''
  try {
    text = await response.text()
  } catch {
    /* no body */
  }
  let msg = ''
  try {
    const j = JSON.parse(text)
    msg = j?.error?.message ?? j?.error ?? j?.message ?? ''
    if (typeof msg !== 'string') msg = JSON.stringify(msg)
  } catch {
    msg = text.slice(0, 200)
  }
  const hint = response.status === 401 || response.status === 403 ? ' (check the API key)' : response.status === 429 ? ' (rate limit or out of credit)' : ''
  return `${response.status}${hint}${msg ? `: ${msg.slice(0, 300)}` : ''}`
}

module.exports = { readSse, describeError }
