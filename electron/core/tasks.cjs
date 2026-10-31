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
 * The task engine: the task map, live logs, history on disk, the concurrency pools, the queue
 * (pause, run next) and killing a job's processes. No Electron: events go out through
 * platform.emit, so the desktop app and the terminal app share one engine.
 *
 * @param {{ platform: object, getSettings: () => object, onFinished: (state: object, req: object) => void }} deps
 */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

function createTaskEngine({ platform, getSettings, onFinished }) {
  /* --- Task orchestration (yt-dlp downloads) --- */
  // @category: downloader/task-orchestration-main-process
  const tasks = new Map() // taskId -> { state: TaskState, child: ChildProcess|null }

  /** Registers a new task, stamping when it was created (the Library sorts on it). */
  function addTask(id, entry) {
    entry.state.createdAt = Date.now()
    tasks.set(id, entry)
    historyChanged = true
  }

  /* --- Live logs: a short in-memory tail of what each job's tools print, shown on demand in the UI ---
   * Not persisted (history keeps only the outcome). The renderer asks for the buffer and, while a log
   * panel is open for a task, receives new lines as they arrive. */
  const LOG_MAX_LINES = 400
  const LOG_NOISE = /^ffmpeg version |^\s+(built with|configuration:|lib\w+\s+\d)|^(frame|fps|stream_\d+_\d+_q|bitrate|total_size|out_time_us|out_time_ms|out_time|dup_frames|drop_frames|speed|progress)=|^\s*\d+(\.\d+)?%\s*$/
  const logWatched = new Set() // task ids with an open log panel
  const logPending = new Map() // id -> { lines, replaceLast }
  let logTimer = null

  /** Appends tool output (partial lines are held until complete) to a task's log. */
  function appendLog(id, chunk, stream = 'o') {
    const entry = tasks.get(id)
    if (!entry) return
    entry.log ??= { lines: [], partial: { o: '', e: '' } }
    const log = entry.log
    const parts = (log.partial[stream] + String(chunk)).split(/\r?\n|\r/)
    log.partial[stream] = parts.pop() ?? ''
    for (const raw of parts) {
      const line = raw.replace(/\s+$/, '').slice(0, 300)
      if (!line || LOG_NOISE.test(line)) continue
      // yt-dlp's percent line updates in place: keep only the latest instead of hundreds of near-copies.
      const isPct = /^\[download\]\s+\d/.test(line)
      const replace = isPct && /^\[download\]\s+\d/.test(log.lines[log.lines.length - 1] ?? '')
      if (replace) log.lines[log.lines.length - 1] = line
      else log.lines.push(line)
      if (log.lines.length > LOG_MAX_LINES) log.lines.splice(0, log.lines.length - LOG_MAX_LINES)
      if (logWatched.has(id)) {
        const pend = logPending.get(id) ?? { lines: [], replaceLast: false }
        if (replace && !pend.lines.length) pend.replaceLast = true
        else if (replace) pend.lines[pend.lines.length - 1] = line
        if (!replace) pend.lines.push(line)
        logPending.set(id, pend)
      }
    }
    if (logWatched.has(id) && logPending.size && !logTimer) {
      logTimer = setTimeout(() => {
        logTimer = null
        for (const [tid, pend] of logPending) {
          platform.emit('tasks:log', { id: tid, ...pend })
        }
        logPending.clear()
      }, 120)
    }
  }
  /** A human-readable step marker the job itself wants in the log ("Chunk 2 of 5: upscaling"). */
  const jobLog = (id, text) => appendLog(id, text + '\n')
  /** Mirrors a child process's stdout/stderr into the task log. */
  function attachLog(child, id) {
    child.stdout?.on('data', (c) => appendLog(id, c, 'o'))
    child.stderr?.on('data', (c) => appendLog(id, c, 'e'))
  }

  function defaultDownloadDir() {
    return path.join(platform.paths.downloads, 'OPNduck')
  }

  // Progress callbacks can fire many times a second (ffmpeg, upscalers); every broadcast makes
  // the renderer re-render each subscribed card, so coalesce them to at most one per 120ms
  // (trailing edge — the latest snapshot always goes out).
  let broadcastTimer = null
  /** Overall progress of running jobs on the taskbar/dock icon (Windows, macOS, and Linux launchers since Electron 45). */
  function updateTaskbarProgress(active) {
    const value = active.length ? active.reduce((sum, s) => sum + (s.progress || 0), 0) / active.length : -1
    platform.setProgress?.(value < 0 ? -1 : Math.min(1, Math.max(0, value)))
  }
  // The history (up to 500 finished rows) rarely changes while a job's progress ticks; sending it
  // all every 120ms made every tick cost a 500-row IPC clone. Ticks carry only the active tasks
  // ({ full: false }, merged by id in the renderer); anything that adds, removes or edits a finished
  // row sends the complete list ({ full: true }).
  let historyChanged = true
  function broadcastTasks() {
    if (broadcastTimer) return
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null
      const all = [...tasks.values()].map((t) => t.state)
      const active = all.filter((s) => !TERMINAL.includes(s.status))
      updateTaskbarProgress(active)
      const full = historyChanged || all.length !== lastSentCount
      historyChanged = false
      lastSentCount = all.length
      const payload = { full, tasks: full ? all : active }
      platform.emit('tasks:update', payload)
    }, 120)
  }
  let lastSentCount = -1

  /* --- History: finished tasks persist across restarts, with the request needed to re-run them --- */
  const TERMINAL = ['done', 'error', 'canceled']
  const MAX_HISTORY = 500
  const startHandlers = new Map() // IPC channel -> start function, so a stored request can be re-run

  function historyFile() {
    return path.join(platform.paths.userData, 'history.json')
  }

  let saveTimer = null
  function scheduleHistorySave() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(saveHistory, 400)
  }
  function saveHistory() {
    clearTimeout(saveTimer) // also called directly on quit, so a pending debounce must not fire later
    try {
      const finished = [...tasks.values()]
        .filter((t) => TERMINAL.includes(t.state.status) && t.channel)
        .slice(-MAX_HISTORY)
        .map((t) => ({ state: t.state, channel: t.channel, req: t.req, finalPath: t.finalPath ?? null }))
      fs.mkdirSync(path.dirname(historyFile()), { recursive: true })
      // Write-then-rename so a crash mid-write can't leave a truncated history.json.
      const tmp = `${historyFile()}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(finished))
      fs.renameSync(tmp, historyFile())
    } catch {
      /* history is a convenience — never let a disk error break a job */
    }
  }
  function loadHistory() {
    try {
      const rows = JSON.parse(fs.readFileSync(historyFile(), 'utf8'))
      if (!Array.isArray(rows)) return
      for (const r of rows.slice(-MAX_HISTORY)) {
        if (typeof r?.state?.id !== 'string' || !TERMINAL.includes(r.state.status)) continue
        tasks.set(r.state.id, { state: r.state, child: null, finalPath: r.finalPath, channel: r.channel, req: r.req })
      }
    } catch {
      /* no history yet */
    }
  }

  /** A batch tag from a request: `{ id, label, size }` or null if it isn't a sane one. */
  function sanitizeBatch(b) {
    if (!b || typeof b !== 'object') return null
    const { id, label, size } = b
    if (typeof id !== 'string' || id.length < 1 || id.length > 80) return null
    if (typeof label !== 'string' || label.length > 120) return null
    if (!Number.isInteger(size) || size < 2 || size > 1000) return null
    return { id, label, size }
  }

  /** Wraps a job-start function: remembers (channel, request) on the task it creates, which is
   *  what lets the Library "Run again" button replay it. The caller exposes the result (IPC, CLI). */
  function wrapStart(channel, fn) {
    const wrapped = async (e, req) => {
      const id = await fn(e, req)
      const entry = tasks.get(id)
      if (entry) {
        entry.channel = channel
        entry.req = req
        // Jobs started together (a batch of files, or a download plus its audio tracks) share a
        // group, which the Library shows as one collapsible block.
        entry.state.group = sanitizeBatch(req?.batch)
        broadcastTasks() // a task waiting in a queue wouldn't otherwise show its group until it starts
      }
      return id
    }
    startHandlers.set(channel, wrapped)
    return wrapped
  }

  function updateTask(id, patch) {
    const entry = tasks.get(id)
    if (!entry) return
    // A finished task never changes outcome: a cancel that races a normal exit (or a late
    // 'error'/'close' event after a kill) must not flip 'canceled' to 'done' or vice versa.
    if (patch.status && TERMINAL.includes(entry.state.status)) return
    // Progress only ever moves forward while a job runs: multi-stage tools (yt-dlp's separate video and
    // audio streams, extract/process/encode phases) restart their own percentages, which made bars jump back.
    if (typeof patch.progress === 'number' && !patch.status && entry.state.status === 'running') {
      patch = { ...patch, progress: Math.max(entry.state.progress, patch.progress) }
    }
    Object.assign(entry.state, patch)
    if (patch.status && patch.status !== 'canceled' && TERMINAL.includes(patch.status)) onFinished(entry.state, entry.req)
    if (TERMINAL.includes(entry.state.status)) {
      historyChanged = true // a row just finished (or a finished one was edited): the renderer needs the full list
      scheduleHistorySave()
    }
    // A finished conversion frees its concurrency slot for the next queued one.
    if (entry.releaseSlot && TERMINAL.includes(entry.state.status)) entry.releaseSlot()
    // A job that never produced output leaves behind the empty placeholder uniqueOutputPath() made.
    if (entry.state.status !== 'done' && entry.finalPath && TERMINAL.includes(entry.state.status)) {
      try {
        if (fs.statSync(entry.finalPath).size === 0) fs.rmSync(entry.finalPath, { force: true })
      } catch {
        /* nothing there */
      }
    }
    if (entry.onDone && TERMINAL.includes(entry.state.status)) {
      const cb = entry.onDone
      entry.onDone = null
      cb(entry.state)
    }
    broadcastTasks()
  }

  /** A counting semaphore: queued jobs wait here for a slot instead of all starting at once. */
  const allPools = []
  let queuePaused = false
  function makePool(limit) {
    let active = 0
    const waiters = [] // { id, resolve }
    const pool = {
      acquire(id) {
        if (!queuePaused && active < limit) {
          active++
          return Promise.resolve()
        }
        return new Promise((resolve) => waiters.push({ id, resolve }))
      },
      release() {
        active--
        pool.drain()
      },
      /** Hands free slots to waiting jobs, unless the queue is paused. */
      drain() {
        while (!queuePaused && active < limit && waiters.length) {
          active++
          waiters.shift().resolve()
        }
      },
      setLimit(n) {
        limit = n
        pool.drain()
      },
      /** Moves a waiting job to the front of this pool's line. */
      prioritize(id) {
        const i = waiters.findIndex((w) => w.id === id)
        if (i <= 0) return i === 0
        waiters.unshift(...waiters.splice(i, 1))
        return true
      },
    }
    allPools.push(pool)
    return pool
  }
  const broadcastQueueState = () => platform.emit('queue:state', { paused: queuePaused })
  // Batches would otherwise spawn one process per file at once: ffmpeg/soffice conversions are
  // light (2 at a time); upscalers/interpolation fight over one GPU and Whisper loads a whole
  // model per process (1 at a time each).
  const convertPool = makePool(2)
  const gpuPool = makePool(1)
  const whisperPool = makePool(1)
  // yt-dlp downloads: a big batch, "Retry failed" or several subscriptions must not start 1000 at once.
  const downloadPool = makePool(3)

  /** Applies the user's parallel-job limits (Settings → Job queue). */
  function applyQueueLimits() {
    const s = getSettings()
    downloadPool.setLimit(s.maxDownloads)
    convertPool.setLimit(s.maxConversions)
  }

  function setQueuePaused(paused) {
    queuePaused = !!paused
    if (!queuePaused) allPools.forEach((p) => p.drain())
    broadcastQueueState()
  }

  /** Runs `work` once the pool has a free slot. The slot is released by updateTask() when the
   *  task reaches a terminal state, or immediately if the task was canceled while waiting. */
  async function runInPool(pool, id, work) {
    await pool.acquire(id)
    const entry = tasks.get(id)
    if (!entry || isCanceled(id)) return pool.release()
    let released = false
    entry.releaseSlot = () => {
      if (!released) {
        released = true
        pool.release()
      }
    }
    try {
      await work()
    } catch (err) {
      updateTask(id, { status: 'error', error: `Failed to start: ${err.message}` })
    }
  }

  /** Kill a job's process, including children: soffice is a launcher whose real worker
   *  (soffice.bin) would otherwise be orphaned. Detached jobs lead their own group. */
  function killTask(entry) {
    const child = entry.child
    if (!child) return
    try {
      if (entry.killGroup && process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM')
      else if (entry.killGroup && process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']).on('error', () => child.kill())
      else child.kill()
    } catch {
      child.kill()
    }
  }

  function isCanceled(id) {
    return tasks.get(id)?.state.status === 'canceled'
  }

  /** The next broadcast sends the complete task list, not just the active tasks. */
  function markHistoryChanged() {
    historyChanged = true
  }

  return {
    tasks, startHandlers, allPools, pools: { convertPool, gpuPool, whisperPool, downloadPool },
    logWatched, logPending, TERMINAL, MAX_HISTORY,
    addTask, appendLog, jobLog, attachLog, defaultDownloadDir, broadcastTasks,
    historyFile, scheduleHistorySave, saveHistory, loadHistory, markHistoryChanged, sanitizeBatch,
    wrapStart, updateTask, makePool, setQueuePaused, applyQueueLimits, runInPool, killTask, isCanceled,
    get queuePaused() {
      return queuePaused
    },
  }
}

module.exports = { createTaskEngine }
