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
/**
 * The settings the assistant may change (after the person confirms). One table says what each is, what values it takes
 * and where it lives: 'engine' settings are in settings.json and are checked again by the settings validator; 'window'
 * ones (theme, motion, background, density) belong to the window and are applied there. Left out on purpose, because
 * they open the computer to the network, hold a key or a login, or can power it off: sharing and link servers, the MCP
 * server, cloud providers and their keys, other computers' addresses, cookies and sign-in, folders, and sleep or
 * shut down. Those stay in Settings, by hand. No Electron.
 */
const bool = { type: 'boolean' }
const num = (min, max) => ({ type: 'number', min, max })
const one = (...options) => ({ type: 'enum', options })

/** key -> { label, scope, ...type }. Dotted keys reach inside a group (ai.effort is settings.ai.effort). */
const SETTINGS = {
  'app.theme': { label: 'App theme', scope: 'window', type: 'theme', hint: 'a colour word or a theme name' },
  'app.reduceMotion': { label: 'Reduce motion (no animations or page transitions)', scope: 'window', ...bool },
  'app.devMode': { label: 'Developer mode (extra tools for debugging)', scope: 'window', ...bool },
  'app.compact': { label: 'Compact density', scope: 'window', ...bool },
  'app.background': { label: 'Background style', scope: 'window', ...one('flat', 'gradient') },
  notifyOnFinish: { label: 'Notify when jobs finish', scope: 'engine', ...bool },
  runInTray: { label: 'Keep running in the tray when the window closes', scope: 'engine', ...bool },
  maxDownloads: { label: 'Parallel downloads', scope: 'engine', ...num(1, 6) },
  maxConversions: { label: 'Parallel conversions', scope: 'engine', ...num(1, 4) },
  videoEncoder: { label: 'Video encoder for AI jobs', scope: 'engine', ...one('auto', 'cpu') },
  gpuThreads: { label: 'GPU performance mode', scope: 'engine', ...one('auto', 'low') },
  upscaleEngine: { label: 'Video upscaling engine', scope: 'engine', ...one('auto', 'ncnn') },
  proxy: { label: 'Proxy for downloads (empty for none)', scope: 'engine', type: 'string', max: 200 },
  autoTagAudio: { label: 'Tag new audio downloads automatically', scope: 'engine', ...bool },
  pluginsSafeMode: { label: 'Start with every plugin skipped', scope: 'engine', ...bool },
  tuiTheme: { label: 'Terminal app theme', scope: 'engine', type: 'string', max: 40 },
  'watchFolder.enabled': { label: 'Watch folder on or off (needs a folder chosen first)', scope: 'engine', ...bool },
  'watchFolder.container': { label: 'Watch folder output format, like MP4', scope: 'engine', type: 'string', max: 5 },
  'schedule.window': { label: 'Only start heavy jobs inside a time window', scope: 'engine', ...bool },
  'schedule.from': { label: 'Window start, like 23:00', scope: 'engine', type: 'string', max: 5 },
  'schedule.to': { label: 'Window end, like 07:00', scope: 'engine', type: 'string', max: 5 },
  'schedule.battery': { label: 'Hold heavy jobs on battery', scope: 'engine', ...bool },
  'schedule.heat': { label: 'Pause GPU jobs when too hot', scope: 'engine', ...bool },
  'schedule.maxC': { label: 'Temperature limit in degrees C', scope: 'engine', ...num(60, 100) },
  'schedule.idle': { label: 'Only start heavy jobs after being away', scope: 'engine', ...bool },
  'schedule.idleMinutes': { label: 'Minutes away', scope: 'engine', ...num(1, 240) },
  'schedule.downloads': { label: 'The scheduling rules also hold downloads', scope: 'engine', ...bool },
  'ai.provider': { label: 'Where the assistant runs', scope: 'engine', ...one('off', 'local', 'ollama', 'lmstudio') },
  'ai.model': { label: 'Model name for Ollama or LM Studio', scope: 'engine', type: 'string', max: 200 },
  'ai.localModel': { label: "OPNduck's own model", scope: 'engine', ...one('ministral-3-3b', 'qwen3-1.7b') },
  'ai.effort': { label: 'Effort', scope: 'engine', ...one('low', 'medium', 'high') },
  'ai.reasoning': { label: 'Thinking', scope: 'engine', ...one('auto', 'on', 'off') },
  'ai.vision': { label: 'Let the model see pictures', scope: 'engine', ...bool },
  'ai.temperature': { label: 'Temperature (how adventurous answers are)', scope: 'engine', ...num(0, 1.5) },
  'ai.keepChats': { label: 'Keep my conversations on this computer', scope: 'engine', ...bool },
  'ai.context': { label: 'Memory for the conversation', scope: 'engine', ...one(4096, 8192, 16384, 32768) },
  'ai.gpu': { label: 'Run the own model on', scope: 'engine', ...one('auto', 'cpu') },
  'ai.startOnLaunch': { label: 'Load the own model when OPNduck starts', scope: 'engine', ...bool },
  'ai.idleEject': { label: 'Eject the model after this many idle minutes (0 never)', scope: 'engine', ...one(0, 5, 15, 30, 60) },
  'ai.monthlyTokenLimit': { label: 'Monthly token limit for cloud providers (0 none)', scope: 'engine', ...num(0, 1e9) },
}

const get = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)

/** Every changeable setting: what it is, the values it takes, and (for engine ones) what it is now. */
function describe(settings) {
  return Object.entries(SETTINGS).map(([key, s]) => ({
    key,
    label: s.label,
    values: s.type === 'enum' ? s.options : s.type === 'number' ? `${s.min} to ${s.max}` : s.type === 'boolean' ? 'true or false' : (s.hint ?? 'text'),
    ...(s.scope === 'engine' ? { now: get(settings, key) } : {}),
  }))
}

/** Reads true/false/number/text the way a model says them ("on", "3", "false"). */
function coerce(def, raw) {
  if (def.type === 'boolean') {
    if (typeof raw === 'boolean') return raw
    const t = String(raw).trim().toLowerCase()
    if (['true', 'on', 'yes', '1'].includes(t)) return true
    if (['false', 'off', 'no', '0'].includes(t)) return false
    throw new Error('That setting is on or off (true or false)')
  }
  if (def.type === 'number' || (def.type === 'enum' && typeof def.options[0] === 'number')) {
    const n = Number(raw)
    if (!Number.isFinite(n)) throw new Error('That setting takes a number')
    return n
  }
  return String(raw)
}

/**
 * A model's call turned into a checked change: { key, label, scope, value, before? }. Throws a readable message that
 * goes back to the model so it can fix itself. The settings validator checks engine values once more when applied.
 */
function check(key, raw, settings) {
  const def = SETTINGS[String(key)]
  if (!def) throw new Error(`"${key}" is not a setting the assistant can change. Use list_settings to see which are. Others (sharing, keys, folders, power) are changed by hand in Settings.`)
  const value = coerce(def, raw)
  if (def.type === 'enum' && !def.options.includes(value)) throw new Error(`${def.label} takes one of: ${def.options.join(', ')}`)
  if (def.type === 'number' && (value < def.min || value > def.max)) throw new Error(`${def.label} takes ${def.min} to ${def.max}`)
  if (def.type === 'string' && value.length > (def.max ?? 200)) throw new Error('That is too long')
  return { key: String(key), label: def.label, scope: def.scope, value, ...(def.scope === 'engine' ? { before: get(settings, String(key)) } : {}) }
}

/** The settings.json patch for a checked engine change: ai.effort becomes { ai: { effort } }. */
function toPatch(change) {
  const [group, leaf] = change.key.split('.')
  return leaf === undefined ? { [group]: change.value } : { [group]: { [leaf]: change.value } }
}

module.exports = { SETTINGS, describe, check, toPatch }
