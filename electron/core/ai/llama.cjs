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
 * OPNduck's own local model: downloads the llama.cpp server (a prebuilt release for this system) and a small open model
 * (at most 4 GB in total, with its picture add-on), runs the server on this computer only (127.0.0.1, a random port),
 * and loads and ejects it on demand. Downloads are resumable and checked against the published SHA-256. No Electron.
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { spawn, execFile } = require('node:child_process')

/** The models on offer. The default is one small model that also sees pictures; sizes are what the download is, in MB. */
const MODELS = {
  'ministral-3-3b': {
    label: 'Ministral 3 (3B): the default, sees pictures',
    repo: 'mistralai/Ministral-3-3B-Instruct-2512-GGUF',
    file: 'Ministral-3-3B-Instruct-2512-Q4_K_M.gguf',
    mmproj: 'Ministral-3-3B-Instruct-2512-BF16-mmproj.gguf',
    vision: true,
    sizeMB: 2990,
  },
  'qwen3-1.7b': {
    label: 'Qwen3 (1.7B): small and fast, text only',
    repo: 'unsloth/Qwen3-1.7B-GGUF',
    file: 'Qwen3-1.7B-Q4_K_M.gguf',
    mmproj: null,
    vision: false,
    sizeMB: 1110,
    // Its "thinking" can be switched off per request through the chat template.
    noThink: { chat_template_kwargs: { enable_thinking: false } },
  },
}
const DEFAULT_MODEL = 'ministral-3-3b'
const MAX_TOTAL_MB = 4000

/** The release file for this system: Vulkan builds on Linux and Windows (any GPU, NVIDIA included), Metal on a Mac. */
function assetSuffix(platform = process.platform, arch = process.arch) {
  const a = arch === 'arm64' ? 'arm64' : 'x64'
  if (platform === 'linux') return `bin-ubuntu-vulkan-${a}.tar.gz`
  if (platform === 'win32') return `bin-win-vulkan-${a}.zip`
  if (platform === 'darwin') return `bin-macos-${a}.tar.gz`
  throw new Error(`There is no llama.cpp build for ${platform}`)
}

/**
 * The newest release that has a build for this system: { tag, name, url, sha256 }. `releases` is GitHub's list, newest
 * first. A release without the file (they are published one build at a time) is skipped.
 */
function pickAsset(releases, platform, arch) {
  const suffix = assetSuffix(platform, arch)
  for (const r of releases) {
    const a = (r.assets ?? []).find((x) => x.name.startsWith('llama-') && x.name.endsWith(suffix))
    if (a) return { tag: r.tag_name, name: a.name, url: a.browser_download_url, sha256: /^sha256:([0-9a-f]{64})$/.exec(a.digest ?? '')?.[1] ?? null, size: a.size }
  }
  throw new Error('No llama.cpp build for this system was found in the latest releases')
}

const sha256File = (file) =>
  new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })

/**
 * Downloads `url` to `dest`, resuming a partial `.part` file, and checks the SHA-256 when one is known. Reports
 * `onProgress(bytesDone, bytesTotal)`. Throws on a wrong checksum (and deletes the file).
 */
async function download(url, dest, { sha256 = null, onProgress = () => {}, signal, fetchFn = fetch } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const part = `${dest}.part`
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0
  let res = await fetchFn(url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal, redirect: 'follow' })
  if (res.status === 416) {
    // The partial file is already complete (or wrong): start over once.
    fs.rmSync(part, { force: true })
    have = 0
    res = await fetchFn(url, { signal, redirect: 'follow' })
  }
  if (!res.ok && res.status !== 206) throw new Error(`The download failed (${res.status})`)
  if (res.status === 200 && have) have = 0 // the server ignored the Range: begin again
  const total = have + Number(res.headers.get('content-length') ?? 0)
  const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' })
  let done = have
  try {
    for await (const chunk of res.body) {
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
      done += chunk.length
      onProgress(done, total)
    }
  } finally {
    await new Promise((r) => out.end(r))
  }
  if (total && fs.statSync(part).size !== total) throw new Error('The download stopped early. Try again: it continues where it stopped.')
  if (sha256) {
    const got = await sha256File(part)
    if (got !== sha256) {
      fs.rmSync(part, { force: true })
      throw new Error('The downloaded file does not match its published checksum. It was deleted; try again.')
    }
  }
  fs.renameSync(part, dest)
  return dest
}

/** A free TCP port on this computer. */
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

const findFile = (dir, name) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      const f = findFile(p, name)
      if (f) return f
    } else if (e.name === name) return p
  }
  return null
}

/**
 * @param {object} deps
 * @param {() => string} deps.dir  where the runtime and models live (the person can move it to another disk)
 * @param {() => object} deps.getSettings
 * @param {typeof fetch} [deps.fetchFn]
 * @param {{ github?: string, hf?: string, hfApi?: string }} [deps.sources]  addresses (tests point them at a local server)
 * @param {(line: string) => void} [deps.log]
 */
function createLlama({ dir, getSettings, fetchFn = fetch, sources = {}, log = () => {} }) {
  const github = sources.github ?? 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=8'
  const hf = sources.hf ?? 'https://huggingface.co'
  const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  const listeners = new Set()
  let state = 'unloaded' // unloaded | loading | ready | error
  let error = ''
  let child = null
  let port = null
  let loadedModel = null
  let installing = null // { what, done, total } while a download runs
  let installAbort = null
  let loadPromise = null
  let idleTimer = null

  const cfg = () => getSettings().ai
  const runtimeDir = () => path.join(dir(), 'runtime')
  const modelDir = (id) => path.join(dir(), 'models', id)
  const serverPath = () => {
    try {
      return fs.existsSync(runtimeDir()) ? findFile(runtimeDir(), exe) : null
    } catch {
      return null
    }
  }
  const emit = () => listeners.forEach((l) => l(status()))

  function modelFiles(id) {
    const m = MODELS[id]
    if (!m) throw new Error('Unknown model')
    return { model: path.join(modelDir(id), m.file), mmproj: m.mmproj ? path.join(modelDir(id), m.mmproj) : null }
  }

  /** What is installed and what the server is doing now. */
  function status() {
    const out = { state, error, port, model: loadedModel, installing, runtime: !!serverPath(), models: {}, dir: dir(), catalog: MODELS }
    for (const id of Object.keys(MODELS)) {
      const f = modelFiles(id)
      out.models[id] = fs.existsSync(f.model) && (!f.mmproj || fs.existsSync(f.mmproj))
    }
    return out
  }

  /** Downloads the llama.cpp server for this system (about 20 to 40 MB). */
  async function installRuntime() {
    if (installing) throw new Error('A download is already running. Wait for it or stop it first.')
    installAbort = new AbortController()
    try {
      installing = { what: 'The AI engine (llama.cpp)', done: 0, total: 0 }
      emit()
      const res = await fetchFn(github, { headers: { Accept: 'application/vnd.github+json' }, signal: installAbort.signal })
      if (!res.ok) throw new Error(`GitHub answered ${res.status} when looking for the AI engine`)
      const asset = pickAsset(await res.json(), process.platform, process.arch)
      if (!asset.sha256) throw new Error('GitHub gave no checksum for the AI engine download, so OPNduck will not run it. Try again later, or install llama.cpp yourself and point OPNduck at it.')
      const archive = path.join(dir(), 'downloads', asset.name)
      await download(asset.url, archive, { sha256: asset.sha256, signal: installAbort.signal, fetchFn, onProgress: (d, t) => ((installing = { what: installing.what, done: d, total: t || asset.size }), emit()) })
      fs.rmSync(runtimeDir(), { recursive: true, force: true })
      fs.mkdirSync(runtimeDir(), { recursive: true })
      await new Promise((resolve, reject) => execFile('tar', ['-xf', archive, '-C', runtimeDir()], (err) => (err ? reject(new Error(`Could not unpack the AI engine: ${err.message}`)) : resolve())))
      fs.rmSync(archive, { force: true })
      const bin = serverPath()
      if (!bin) throw new Error('The AI engine download did not contain llama-server')
      if (process.platform !== 'win32') fs.chmodSync(bin, 0o755)
      fs.writeFileSync(path.join(runtimeDir(), 'version.json'), JSON.stringify({ tag: asset.tag, name: asset.name }))
      log(`ai: installed llama.cpp ${asset.tag}`)
    } finally {
      installing = null
      installAbort = null
      emit()
    }
  }

  /** The published size and SHA-256 of a model repository's files. */
  async function modelInfo(repo, signal) {
    const res = await fetchFn(`${sources.hfApi ?? hf}/api/models/${repo}?blobs=true`, { signal })
    if (!res.ok) throw new Error(`The model list answered ${res.status}`)
    const j = await res.json()
    return Object.fromEntries((j.siblings ?? []).map((s) => [s.rfilename, { size: s.size ?? s.lfs?.size ?? 0, sha256: s.lfs?.sha256 ?? null }]))
  }

  /** Downloads a model (and its picture add-on). Refuses anything over the 4 GB limit. */
  async function installModel(id) {
    const m = MODELS[id]
    if (!m) throw new Error('Unknown model')
    if (installing) throw new Error('A download is already running. Wait for it or stop it first.')
    installAbort = new AbortController()
    try {
      installing = { what: m.label, done: 0, total: 0 }
      emit()
      const info = await modelInfo(m.repo, installAbort.signal)
      const files = [m.file, m.mmproj].filter(Boolean)
      for (const f of files) if (!info[f]) throw new Error(`${f} is not in the model repository any more`)
      const total = files.reduce((n, f) => n + info[f].size, 0)
      if (total > MAX_TOTAL_MB * 1e6) throw new Error('This model is larger than the 4 GB limit')
      let before = 0
      for (const f of files) {
        await download(`${hf}/${m.repo}/resolve/main/${f}`, path.join(modelDir(id), f), {
          sha256: info[f].sha256,
          signal: installAbort.signal,
          fetchFn,
          onProgress: (d) => ((installing = { what: m.label, done: before + d, total }), emit()),
        })
        before += info[f].size
      }
      log(`ai: installed ${id}`)
    } finally {
      installing = null
      installAbort = null
      emit()
    }
  }

  const cancelInstall = () => installAbort?.abort()

  function remove(id) {
    if (loadedModel === id) eject()
    fs.rmSync(modelDir(id), { recursive: true, force: true })
    emit()
  }

  const pidFile = () => path.join(dir(), 'server.pid')
  /** Stops a model server that an earlier OPNduck started and never stopped. Only a process still called llama-server is touched. */
  function reapStale() {
    let pid
    try {
      pid = Number(fs.readFileSync(pidFile(), 'utf8'))
    } catch {
      return
    }
    fs.rmSync(pidFile(), { force: true })
    if (!Number.isInteger(pid) || pid <= 1 || (child && child.pid === pid)) return
    try {
      const name = process.platform === 'linux' ? fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim() : 'llama-server'
      if (!/^llama-server/.test(name)) return
      process.kill(pid, 'SIGKILL')
    } catch {
      /* not running any more */
    }
  }

  /** Starts the server with the chosen model; resolves when it answers. Calling it again while loading waits for the same load. */
  function load() {
    if (state === 'ready') return Promise.resolve(status())
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      const s = cfg()
      const bin = serverPath()
      if (!bin) throw new Error('The AI engine is not installed yet. Install it in Settings > AI.')
      const id = s.localModel
      const files = modelFiles(id)
      if (!fs.existsSync(files.model)) throw new Error('The model is not downloaded yet. Install it in Settings > AI.')
      state = 'loading'
      error = ''
      emit()
      reapStale() // a server left over from an earlier run (a crash, a restart) still holds the graphics memory
      port = await freePort()
      const args = ['-m', files.model, '--host', '127.0.0.1', '--port', String(port), '-c', String(s.context), '-ngl', s.gpu === 'cpu' ? '0' : '99', '--jinja']
      if (files.mmproj && s.vision && fs.existsSync(files.mmproj)) args.push('--mmproj', files.mmproj)
      child = spawn(bin, args, { cwd: path.dirname(bin), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LD_LIBRARY_PATH: [path.dirname(bin), process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter) } })
      try {
        fs.mkdirSync(dir(), { recursive: true })
        fs.writeFileSync(pidFile(), String(child.pid))
      } catch {
        /* the file is only a safety net */
      }
      let tail = ''
      const keep = (c) => (tail = (tail + c).slice(-1500))
      child.stdout.on('data', keep)
      child.stderr.on('data', keep)
      const mine = child
      // A server that cannot even start (missing, not executable) reports through 'error'; without a listener that would crash the app.
      child.on('error', (err) => {
        if (child !== mine) return
        state = 'error'
        error = `The AI engine could not be started: ${err.message}`
        child = null
        port = null
        loadedModel = null
        emit()
      })
      child.on('close', () => {
        try {
          if (fs.readFileSync(pidFile(), 'utf8') === String(mine.pid)) fs.rmSync(pidFile(), { force: true })
        } catch {
          /* already gone */
        }
        if (child !== mine) return
        if (state !== 'unloaded') {
          state = state === 'loading' ? 'error' : 'unloaded'
          if (state === 'error') error = `The AI engine stopped while loading:\n${tail.trim().split('\n').slice(-4).join('\n')}`
        }
        child = null
        port = null
        loadedModel = null
        emit()
      })
      for (let i = 0; i < 600; i++) {
        if (!child) break
        try {
          const r = await fetchFn(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) })
          if (r.ok) {
            state = 'ready'
            loadedModel = id
            emit()
            touch()
            return status()
          }
        } catch {
          /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      const failure = state === 'error' ? error : '' // the server stopped by itself: keep that reason on show
      if (state !== 'error') eject()
      throw new Error(failure || error || 'The AI engine did not start in time. Try a smaller context or the CPU option.')
    })().finally(() => {
      loadPromise = null
    })
    loadPromise.catch(() => {})
    return loadPromise
  }

  /** Stops the server and frees the memory it used. */
  function eject() {
    clearTimeout(idleTimer)
    const c = child
    state = 'unloaded'
    if (c) {
      try {
        c.kill()
        // A server busy with a long answer can ignore the polite stop and keep holding the graphics memory.
        setTimeout(() => {
          if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL')
        }, 3000).unref()
      } catch {
        /* already gone */
      }
    }
    child = null
    port = null
    loadedModel = null
    emit()
  }

  /** Every question calls this: the idle timer starts over. */
  function touch() {
    clearTimeout(idleTimer)
    const minutes = cfg().idleEject
    if (state === 'ready' && minutes > 0) {
      idleTimer = setTimeout(eject, minutes * 60000)
      idleTimer.unref?.()
    }
  }

  /** The address to talk to, loading the model first when it is not running ("the next message loads it again"). */
  async function ensureLoaded() {
    if (state !== 'ready') await load()
    touch()
    return `http://127.0.0.1:${port}/v1`
  }

  /** Called once the app is up: loads the model in the background when the person asked for that. */
  function startIfWanted() {
    const s = cfg()
    if (s.provider === 'local' && s.startOnLaunch && serverPath() && fs.existsSync(modelFiles(s.localModel).model)) void load().catch(() => {})
  }

  return {
    status,
    installRuntime,
    installModel,
    cancelInstall,
    remove,
    load,
    eject,
    touch,
    ensureLoaded,
    startIfWanted,
    onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    modelMeta: (id) => MODELS[id] ?? null,
  }
}

module.exports = { createLlama, pickAsset, assetSuffix, download, MODELS, DEFAULT_MODEL, MAX_TOTAL_MB }
