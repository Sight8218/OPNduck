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
 * Running a job on a server. The job still appears in the local queue and Library as one task: a "mirror" that uploads
 * the input, follows the server's job, downloads the result into the folder the person picked, and cleans up after
 * itself. Cancel, run again and the progress bar work like any local task. No Electron.
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { TOOLS } = require('../../mcp_tools.cjs')
const { TOOL_KIND } = require('../recipes.cjs')

/** The start channel of each tool a server can run, and the tool's name in the Engine API. */
const CHANNEL_KIND = {
  'tasks:start': 'download',
  'tasks:startConvert': 'convert',
  'tasks:startUpscale': 'upscale_image',
  'tasks:startVideoUpscale': 'upscale_video',
  'tasks:startInterpolate': 'interpolate',
  'tasks:startSubtitles': 'subtitles',
  'tasks:startTrim': 'trim',
  'tasks:startCompress': 'compress',
  'tasks:startGif': 'make_gif',
  'tasks:startJumpCut': 'jump_cut',
  'tasks:startRestore': 'restore',
  'tasks:startBeatAnalyze': 'beat_analyze',
  'tasks:startGrade': 'grade',
  'tasks:startBgRemove': 'remove_background',
  'tasks:startDub': 'dub_video',
  'tasks:startAudioAi': 'audio_ai',
}
const DOWNLOAD_ARGS = ['url', 'format', 'videoQuality', 'audioQuality', 'embedMeta']
const POLL_MS = 1500
const GIVE_UP_MS = 2 * 60 * 1000 // a server that stays unreachable this long fails the task (it keeps running over there)

/** Only the settings the Engine API knows for a tool; the rest of a card's request (folders, paths) never leaves this PC. */
function remoteArgs(kind, req) {
  if (kind === 'download') return Object.fromEntries(DOWNLOAD_ARGS.filter((k) => req[k] != null).map((k) => [k, req[k]]))
  const props = TOOLS.find((t) => t.name === kind)?.inputSchema.properties ?? {}
  return Object.fromEntries(Object.entries(req).filter(([k, v]) => k !== 'inputPath' && k !== 'destination' && Object.hasOwn(props, k) && v != null))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param {object} deps
 * @param {object} deps.engine  the local task engine
 * @param {ReturnType<import('./servers.cjs').createServers>} deps.servers
 * @param {() => string} deps.defaultDownloadDir
 * @param {(dir: string, base: string, ext: string) => string} deps.uniqueOutputPath
 * @param {() => boolean} [deps.keepOnServer]
 */
function createHosts({ engine, servers, defaultDownloadDir, uniqueOutputPath, keepOnServer = () => false }) {
  const { tasks, updateTask, addTask, broadcastTasks } = engine

  async function sha256Of(file) {
    const h = crypto.createHash('sha256')
    for await (const chunk of fs.createReadStream(file)) h.update(chunk)
    return h.digest('hex')
  }

  /** Sends a file in chunks. A failed chunk asks the server how much it has and carries on from there. */
  async function upload(serverId, file, run) {
    const size = fs.statSync(file).size
    if (size === 0) throw new Error('That file is empty')
    const made = await servers.request(serverId, 'POST', '/v1/uploads', { name: path.basename(file), size, sha256: await sha256Of(file) })
    const handle = await fs.promises.open(file, 'r')
    try {
      let offset = 0
      let failures = 0
      while (offset < size) {
        if (run.aborted) throw new Error('canceled')
        const len = Math.min(made.chunkSize, size - offset)
        const buf = Buffer.alloc(len)
        await handle.read(buf, 0, len, offset)
        try {
          const res = await servers.raw(serverId, 'PUT', `/v1/uploads/${made.uploadId}`, { headers: { 'Content-Range': `bytes ${offset}-${offset + len - 1}/${size}` }, body: buf, signal: run.signal })
          const json = await res.json().catch(() => ({}))
          if (res.status === 409 && Number.isInteger(json.offset)) offset = json.offset
          else if (!res.ok) throw new Error(json.error || `The server answered ${res.status}`)
          else offset = json.offset
          failures = 0
          run.progress(offset / size)
        } catch (err) {
          if (run.aborted) throw err
          if (++failures > 5) throw new Error(`Upload failed: ${err.message}`)
          run.stage('Reconnecting')
          await sleep(Math.min(8000, 1000 * failures))
          const head = await servers.raw(serverId, 'HEAD', `/v1/uploads/${made.uploadId}`, { signal: run.signal }).catch(() => null)
          const next = Number(head?.headers.get('upload-offset'))
          if (Number.isInteger(next)) offset = next
          run.stage('Uploading')
        }
      }
    } finally {
      await handle.close()
    }
    return made.uploadId
  }

  /** Downloads the result, resuming with Range after a drop. Returns the local path. */
  async function download(serverId, remoteId, destDir, run) {
    fs.mkdirSync(destDir, { recursive: true })
    let out = null
    let offset = 0
    let total = 0
    let failures = 0
    let fd = null
    try {
      while (!total || offset < total) {
        if (run.aborted) throw new Error('canceled')
        try {
          const res = await servers.raw(serverId, 'GET', `/v1/files/${encodeURIComponent(remoteId)}`, { headers: offset ? { Range: `bytes=${offset}-` } : {}, signal: run.signal })
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `The server answered ${res.status}`)
          if (!out) {
            const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'result')
            const ext = path.extname(name).slice(1) || 'bin'
            out = uniqueOutputPath(destDir, path.basename(name, path.extname(name)).replace(/[\\/\0]/g, '_') || 'result', ext)
            fd = fs.openSync(out, 'w')
          }
          total = offset + Number(res.headers.get('content-length') ?? 0)
          for await (const chunk of res.body) {
            fs.writeSync(fd, chunk, 0, chunk.length, offset)
            offset += chunk.length
            run.progress(total ? offset / total : 0)
          }
          failures = 0
        } catch (err) {
          if (run.aborted) throw err
          if (++failures > 5) throw new Error(`Download failed: ${err.message}`)
          run.stage('Reconnecting')
          await sleep(Math.min(8000, 1000 * failures))
          run.stage('Downloading result')
        }
      }
    } catch (err) {
      if (fd !== null) fs.closeSync(fd)
      fd = null
      if (out) fs.rmSync(out, { force: true })
      throw err
    }
    if (fd !== null) fs.closeSync(fd)
    return out
  }

  /** Starts `req` on a server and returns the id of the local mirror task. */
  async function startMirror(channel, kind, req, serverId) {
    const server = servers.get(serverId)
    const status = await servers.check(serverId)
    if (!status.online || status.mismatch) throw new Error(`${server.name} is not available: ${status.error}`)
    if (!status.kinds?.includes(kind)) throw new Error(`${server.name} cannot run this kind of job`)
    const local = kind !== 'download' ? req.inputPath : null
    if (local && !(typeof local === 'string' && path.isAbsolute(local) && fs.existsSync(local) && fs.statSync(local).isFile())) throw new Error('Choose a file that exists')
    const id = crypto.randomUUID()
    const controller = new AbortController()
    const run = { aborted: false, signal: controller.signal, progress: () => {}, stage: () => {} }
    const label = kind === 'download' ? String(req.url) : path.basename(local)
    const entry = {
      state: { id, kind: TOOL_KIND[kind], status: 'queued', progress: 0, label, host: server.name, stage: 'Uploading', format: req.container ?? req.format, quality: null, sizeBytes: null, sizeIsEstimate: false, thumbnailUrl: null, group: engine.sanitizeBatch(req.batch) },
      child: {
        kill: () => {
          run.aborted = true
          controller.abort()
          if (entry.remoteId) servers.request(serverId, 'POST', `/v1/tasks/${entry.remoteId}/cancel`).catch(() => {})
        },
      },
      finalPath: null,
      channel,
      req,
    }
    addTask(id, entry)
    broadcastTasks()
    // progress: upload 0-20%, the server's work 20-80%, the download 80-100% (a download job has no upload, so the work is 0-80%).
    const [a, b, c] = kind === 'download' ? [0, 0.8, 0.8] : [0.2, 0.8, 0.8]
    const setStage = (s) => updateTask(id, { stage: s })
    const finish = async () => {
      updateTask(id, { status: 'running', stage: local ? 'Uploading' : 'Running on server' })
      let args = remoteArgs(kind, req)
      if (local) {
        run.progress = (f) => updateTask(id, { progress: a * f })
        run.stage = setStage
        args = { ...args, uploadId: await upload(serverId, local, run) }
      }
      const started = await servers.request(serverId, 'POST', '/v1/tasks', { kind, req: args })
      entry.remoteId = started.id
      updateTask(id, { stage: `Running on ${server.name}`, progress: a })
      let lastOk = Date.now()
      let remote
      for (;;) {
        if (run.aborted) throw new Error('canceled')
        await sleep(POLL_MS)
        try {
          remote = (await servers.request(serverId, 'GET', '/v1/tasks')).tasks.find((t) => t.id === started.id)
          lastOk = Date.now()
        } catch (err) {
          if (/no longer accepts/.test(err.message) || Date.now() - lastOk > GIVE_UP_MS) throw err
          updateTask(id, { stage: 'Reconnecting' })
          continue
        }
        if (!remote) throw new Error('The server lost track of the job')
        if (remote.status === 'error') throw new Error(remote.error || 'The job failed on the server')
        if (remote.status === 'canceled') throw new Error('The job was canceled on the server')
        updateTask(id, { stage: `Running on ${server.name}`, progress: a + (b - a) * (remote.progress ?? 0) })
        if (remote.status === 'done') break
      }
      updateTask(id, { stage: 'Downloading result', progress: c })
      run.stage = setStage
      run.progress = (f) => updateTask(id, { progress: c + (1 - c) * f })
      const file = await download(serverId, started.id, req.destination || defaultDownloadDir(), run)
      entry.finalPath = file
      if (!keepOnServer()) servers.request(serverId, 'DELETE', `/v1/tasks/${started.id}`).catch(() => {})
      updateTask(id, { status: 'done', progress: 1, stage: null, sizeBytes: fs.statSync(file).size })
    }
    finish().catch((err) => {
      if (run.aborted || tasks.get(id)?.state.status === 'canceled') return
      updateTask(id, { status: 'error', error: err.message, stage: null })
    })
    return id
  }

  /**
   * Wraps a start function: when the request (or the person's default for that kind of job) says "run on a server", the
   * job runs there; otherwise the original function runs, with the `runOn` field removed.
   */
  function route(channel, local) {
    const kind = CHANNEL_KIND[channel]
    if (!kind) return local
    return async (e, req) => {
      const { runOn, ...rest } = req ?? {}
      const where = runOn ?? servers.defaults()[kind] ?? 'local'
      if (where === 'local' || where === 'ask') return local(e, rest)
      return startMirror(channel, kind, rest, where)
    }
  }

  return { route, CHANNEL_KIND, remoteArgs }
}

module.exports = { createHosts, CHANNEL_KIND, remoteArgs }
