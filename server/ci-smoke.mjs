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

// Smoke test for a running OPNduck Server: pair with a one-time code, upload a video in two chunks (checking the resume
// offset), convert it to MKV, follow the job, download the result and check it. Used by CI against the container.
//   node server/ci-smoke.mjs <video file> <pairing code> [base url]
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const [file, code, base = 'http://127.0.0.1:47821'] = process.argv.slice(2)
if (!file || !code) {
  console.error('Usage: node server/ci-smoke.mjs <video file> <pairing code> [base url]')
  process.exit(2)
}
const check = (ok, what) => {
  if (!ok) {
    console.error(`FAILED: ${what}`)
    process.exit(1)
  }
  console.log(`ok: ${what}`)
}
const call = async (method, path, { body, token, headers = {} } = {}) => {
  const raw = body instanceof Uint8Array
  const r = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  })
  return { status: r.status, headers: r.headers, buf: Buffer.from(await r.arrayBuffer()), get json() { try { return JSON.parse(this.buf.toString()) } catch { return null } } }
}

const paired = await call('POST', '/v1/pair', { body: { code, deviceName: 'ci', deviceKind: 'desktop' } })
check(paired.status === 200 && paired.json?.deviceToken, 'paired with the one-time code')
const token = paired.json.deviceToken
check((await call('POST', '/v1/pair', { body: { code, deviceName: 'again' } })).status === 403, 'the code only works once')
const info = (await call('GET', '/v1/info', { token })).json
check(info?.apiVersion === 1 && info.kinds.includes('convert') && info.tools.ffmpeg, 'the engine reports convert and ffmpeg')

const data = readFileSync(file)
const up = (await call('POST', '/v1/uploads', { token, body: { name: 'in.mp4', size: data.length, sha256: createHash('sha256').update(data).digest('hex') } })).json
const half = Math.floor(data.length / 2)
await call('PUT', `/v1/uploads/${up.uploadId}`, { token, body: data.subarray(0, half), headers: { 'Content-Range': `bytes 0-${half - 1}/${data.length}` } })
const head = await call('HEAD', `/v1/uploads/${up.uploadId}`, { token })
check(head.headers.get('upload-offset') === String(half), 'the server remembers how much arrived')
const done = await call('PUT', `/v1/uploads/${up.uploadId}`, { token, body: data.subarray(half), headers: { 'Content-Range': `bytes ${half}-${data.length - 1}/${data.length}` } })
check(done.json?.complete === true, 'the upload finished and its checksum matched')

check((await call('POST', '/v1/tasks', { token, body: { kind: 'convert', req: { inputPath: '/etc/passwd', container: 'MKV' } } })).status === 400, 'a file path from a device is refused')
const job = await call('POST', '/v1/tasks', { token, body: { kind: 'convert', req: { uploadId: up.uploadId, container: 'MKV' } } })
check(job.status === 202, 'the convert job started')
let task
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 500))
  task = (await call('GET', '/v1/tasks', { token })).json.tasks.find((t) => t.id === job.json.id)
  if (['done', 'error', 'canceled'].includes(task?.status)) break
}
check(task?.status === 'done', `the job finished (${task?.status} ${task?.error ?? ''})`)
const out = await call('GET', `/v1/files/${job.json.id}`, { token })
check(out.status === 200 && out.buf.length > 1000 && out.buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), 'the result downloads and is a Matroska file')
const part = await call('GET', `/v1/files/${job.json.id}`, { token, headers: { Range: 'bytes=0-99' } })
check(part.status === 206 && part.buf.length === 100, 'a Range request returns just that part')
console.log('All checks passed.')
