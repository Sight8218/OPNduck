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

const path = require('node:path')

/**
 * Builds the whole job core (tools, task engine, every job module) around a platform object.
 * The desktop app and the terminal app both call this, so there is one wiring and one code path.
 *
 * @param {object} deps
 * @param {object} deps.platform  see core/platform.cjs
 * @param {(state: object, req: object) => void} [deps.onFinished]  called when a task reaches a final state
 * @param {(channel: string, wrapped: Function) => void} [deps.registerStart]  expose a start function (e.g. over IPC)
 * @param {(opts: object) => Promise<string|null>} [deps.pickPath]  the shell's file dialog, for plugins
 * @param {boolean} [deps.safeMode]  force every plugin off (default: the pluginsSafeMode setting)
 * @param {{ seal(text: string): string, unseal(sealed: string): string }} [deps.secrets]  how API keys are sealed on disk (the desktop passes its keyring; without it the file is only readable by this user)
 * @param {string} [deps.pluginWorkerFile]  full path of plugin_worker.cjs when it cannot be found next to this file (bundled builds)
 */
function createCore({ platform, onFinished = () => {}, registerStart, pickPath, safeMode, pluginWorkerFile, secrets }) {
  const settings = require('./settings.cjs')
  settings.configure(platform)
  const { getSettings, ytdlpBaseArgs, hasCookies } = settings

  const tools = require('./tools.cjs').createTools(platform)
  let plugins = null // set below; the engine needs a callback before the host exists
  const engine = require('./tasks.cjs').createTaskEngine({
    platform,
    getSettings,
    onFinished: (state, req) => {
      onFinished(state, req)
      plugins?.emit(state.status === 'error' ? 'job:failed' : 'job:finished', { id: state.id, kind: state.kind, status: state.status, label: state.label })
      autoTag(state)
    },
  })

  /**
   * After an audio download finishes, tag it by itself, but only when the user turned that on in Settings (it sends the
   * song's fingerprint and title to AcoustID, MusicBrainz and the Cover Art Archive). Never for the tagger's own jobs.
   */
  function autoTag(state) {
    if (state.status !== 'done' || state.kind !== 'download' || !getSettings().autoTagAudio) return
    const entry = engine.tasks.get(state.id)
    const file = entry?.finalPath
    if (!file || !['mp3', 'flac', 'm4a', 'ogg', 'opus'].includes(path.extname(file).slice(1).toLowerCase())) return
    Promise.resolve(core.startJob('tasks:startTag', { inputPath: file, minConfidence: 0.9, ...(entry.spotify ? { hint: entry.spotify } : {}) })).catch(() => {})
  }

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
  add('tagger', require('./tagger.cjs').createTagger)
  add('analyze', require('./analyze.cjs').createAnalyze)
  add('gif', require('./gif.cjs').createGif)
  add('jumpcut', require('./jumpcut.cjs').createJumpCut)
  add('beats', require('./beats.cjs').createBeats)
  add('restore', require('./restore.cjs').createRestore) // chains into the recipe runner, which is added last
  add('compress', require('./compress.cjs').createCompress) // after gpu: it uses the NVENC check from there
  add('download', require('./download.cjs').createDownload)
  add('recipes', require('./recipes.cjs').createRecipes) // last: it starts steps through the handlers above
  // Not started here (it runs a timer): the shells call `core.schedule.start()` once they are ready.
  const schedule = require('./schedule.cjs').createSchedule({ engine, platform, getSettings })

  /** Starts a job by its channel name (the same names the desktop IPC uses), without a UI. */
  function startJob(channel, req) {
    const start = engine.startHandlers.get(channel)
    if (!start) throw new Error(`Unknown job: ${channel}`)
    return start(null, req)
  }

  /** Stops everything cleanly: kills queued/running jobs' processes, saves history, stops the model workers and plugins. */
  function shutdown() {
    schedule.stop()
    void plugins.shutdown()
    modules.subtitles.whisperWorker.stop()
    modules.audioAi.demucsWorker.stop()
    for (const entry of engine.tasks.values()) {
      if (entry.state.status === 'queued' || entry.state.status === 'running') engine.killTask(entry)
    }
    engine.saveHistory()
  }

  const aiKeys = require('./ai/keys.cjs').createKeys({ file: path.join(platform.paths.userData, 'ai-keys.json'), ...(secrets ?? {}) })
  const ai = require('./ai/index.cjs').createAi({ getSettings, keys: aiKeys })
  const core = { platform, settings, tools, engine, modules, ctx, startJob, shutdown, recipes: modules.recipes.recipes, schedule, ai, aiKeys }
  // Not started here: the shell calls `core.plugins.init()` once it is ready (after its windows and dialogs exist).
  plugins = core.plugins = require('./plugins.cjs').createPluginHost({
    core,
    platform,
    pickPath,
    safeMode: safeMode ?? (() => getSettings().pluginsSafeMode === true),
    onChange: () => platform.emit('plugins:changed', null),
    workerFile: pluginWorkerFile,
    log: (line) => process.stderr.write(`${line}\n`),
  })
  // The store client. The two env vars point it at a local test server (see test/plugin_store.test.cjs).
  core.pluginStore = require('./plugin_store.cjs').createPluginStore({
    host: plugins,
    indexUrl: process.env.OPNDUCK_PLUGIN_INDEX || undefined,
    archiveBase: process.env.OPNDUCK_PLUGIN_ARCHIVES || undefined,
    log: (line) => process.stderr.write(`${line}\n`),
  })
  return core
}

module.exports = { createCore }
