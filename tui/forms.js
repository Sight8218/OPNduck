import mcp from '../electron/mcp_tools.cjs'

const { TOOLS, DEFAULTS, buildStartRequest } = mcp

/** Which job definition (in electron/mcp_tools.cjs) each tool screen uses. */
const MCP_NAME = {
  downloader: 'download',
  converter: 'convert',
  'image-upscaler': 'upscale_image',
  'video-upscaler': 'upscale_video',
  interpolation: 'interpolate',
  subtitles: 'subtitles',
  'audio-ai': 'audio_ai',
  trim: 'trim',
}

const LABELS = {
  url: 'Link',
  inputPath: 'File',
  container: 'Format',
  format: 'Format',
  videoQuality: 'Video quality',
  audioQuality: 'Audio quality',
  scale: 'Scale',
  model: 'Model',
  multiplier: 'Multiplier',
  language: 'Language',
  translate: 'Translate to English',
  start: 'Start at',
  end: 'End at',
  mode: 'Mode',
  keepVideo: 'Keep the video',
}

const TIME_KEYS = ['start', 'end']

/** The fields of a tool's form, generated from its job definition: kind, choices, default and help text. */
export function buildForm(toolId) {
  const name = MCP_NAME[toolId]
  const def = TOOLS.find((t) => t.name === name)
  const required = def.inputSchema.required ?? []
  const fields = Object.entries(def.inputSchema.properties).map(([key, spec]) => {
    const types = [].concat(spec.type)
    const initial = DEFAULTS[name]?.[key]
    const common = { key, label: LABELS[key] ?? key, required: required.includes(key), help: spec.description ?? '' }
    if (key === 'inputPath') return { ...common, kind: 'path', value: '' }
    if (TIME_KEYS.includes(key)) return { ...common, kind: 'time', value: '', help: (spec.description ?? '') + ' Use seconds or m:ss.' }
    if (spec.enum) return { ...common, kind: 'choice', options: spec.enum, index: Math.max(0, spec.enum.indexOf(initial ?? spec.enum[0])) }
    if (types.includes('boolean')) return { ...common, kind: 'toggle', value: initial ?? false }
    if (types.includes('number') || types.includes('integer')) return { ...common, kind: 'number', value: '' }
    return { ...common, kind: 'text', value: key === 'language' ? 'auto' : '' }
  })
  return { toolId, mcpName: name, channel: def.channel, fields }
}

/** Checks the filled-in form and returns { channel, req } to start, or { error }. */
export function requestFromForm(form, values, { exists, toAbsolute, parseTime }) {
  const args = {}
  for (const f of form.fields) {
    const raw = values[f.key]
    if (f.kind === 'choice') args[f.key] = f.options[raw ?? f.index]
    else if (f.kind === 'toggle') args[f.key] = !!raw
    else {
      const text = String(raw ?? '').trim()
      if (!text) {
        if (f.required) return { error: `${f.label} is required.` }
        continue
      }
      if (f.kind === 'path') {
        args[f.key] = toAbsolute(text)
        if (!exists(args[f.key])) return { error: `No such file: ${args[f.key]}` }
      } else if (f.kind === 'time') {
        const s = parseTime(text)
        if (Number.isNaN(s)) return { error: `${f.label}: use seconds or m:ss.` }
        args[f.key] = s
      } else if (f.kind === 'number') {
        const n = Number(text)
        if (!Number.isFinite(n)) return { error: `${f.label} must be a number.` }
        args[f.key] = n
      } else args[f.key] = text
    }
  }
  try {
    return buildStartRequest(form.mcpName, args)
  } catch (err) {
    return { error: err.message }
  }
}
