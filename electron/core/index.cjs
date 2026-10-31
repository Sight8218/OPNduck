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
 * Builds the whole job core (tools, task engine, every job module) around a platform object.
 * The desktop app and the terminal app both call this, so there is one wiring and one code path.
 *
 * @param {object} deps
 * @param {object} deps.platform  see core/platform.cjs
 * @param {(state: object, req: object) => void} [deps.onFinished]  called when a task reaches a final state
 * @param {(channel: string, wrapped: Function) => void} [deps.registerStart]  expose a start function (e.g. over IPC)
 */
function createCore({ platform, onFinished = () => {}, registerStart }) {
  const settings = require('./settings.cjs')
  settings.configure(platform)
  const { getSettings, ytdlpBaseArgs, hasCookies } = settings

  const tools = require('./tools.cjs').createTools(platform)
  const engine = require('./tasks.cjs').createTaskEngine({ platform, getSettings, onFinished })

  /** Registers a job-start function through the engine's wrapper (see wrapStart). */
  function handleStart(channel, fn) {
    const wrapped = engine.wrapStart(channel, fn) // registers it in engine.startHandlers
    registerStart?.(channel, wrapped)
  }

  // Job modules share one context: the platform, tools, engine and each other's helpers.
  const ctx = { platform, tools, getSettings, ytdlpBaseArgs, hasCookies, ...tools, ...engine, ...engine.pools, handleStart }
  const modules = {}
  // Static requires (not built from a string) so a bundler can follow them.
  const add = (name, create) => {
    const mod = create(ctx)
    modules[name] = mod
    Object.assign(ctx, mod)
    return mod
  }
  add('common', require('./common.cjs').createCommon)
  add('convert', require('./convert.cjs').createConvert)
  add('trim', require('./trim.cjs').createTrim)
  add('audioAi', require('./audio_ai.cjs').createAudioAi)
  add('subtitles', require('./subtitles.cjs').createSubtitles)
  add('gpu', require('./gpu_jobs.cjs').createGpuJobs)
  add('download', require('./download.cjs').createDownload)

  /** Starts a job by its channel name (the same names the desktop IPC uses), without a UI. */
  function startJob(channel, req) {
    const start = engine.startHandlers.get(channel)
    if (!start) throw new Error(`Unknown job: ${channel}`)
    return start(null, req)
  }

  /** Stops everything cleanly: kills queued/running jobs' processes, saves history, stops the model workers. */
  function shutdown() {
    modules.subtitles.whisperWorker.stop()
    modules.audioAi.demucsWorker.stop()
    for (const entry of engine.tasks.values()) {
      if (entry.state.status === 'queued' || entry.state.status === 'running') engine.killTask(entry)
    }
    engine.saveHistory()
  }

  return { platform, settings, tools, engine, modules, ctx, startJob, shutdown }
}

module.exports = { createCore }
