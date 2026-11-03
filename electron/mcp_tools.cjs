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
 * The MCP tool list, shared by the stdio bridge (which advertises it) and the in-app server
 * (which validates and runs it). Plain Node, no Electron, so the bridge can load it.
 *
 * `start` tools never take an output folder: MCP jobs always write to the normal download folder.
 */

const FILE = { type: 'string', description: 'Absolute path to an existing file on this computer.' }
const JOB_ID = { type: 'string', description: 'A job id from list_jobs or from a start tool.' }

/** @type {{ name: string, description: string, inputSchema: object, channel?: string, kind?: string }[]} */
const TOOLS = [
  {
    name: 'download',
    description: 'Download a video or audio from a URL with yt-dlp (YouTube, SoundCloud, Spotify links and similar). Returns a job id.',
    channel: 'tasks:start',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http(s) link to the media.' },
        format: { type: 'string', enum: ['MP4', 'MP3', 'MKV', 'MOV', 'FLAC', 'WAV'], description: 'Default MP4.' },
        videoQuality: { type: 'string', enum: ['best', '2160', '1440', '1080', '720', '480', '360'], description: 'Default best.' },
        audioQuality: { type: 'string', enum: ['best', '320k', '192k', '128k'], description: 'Default best.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'convert',
    description: 'Convert a media, image or document file to another format. Returns a job id.',
    channel: 'tasks:startConvert',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: FILE,
        container: {
          type: 'string',
          enum: ['MP4', 'MKV', 'WEBM', 'MOV', 'AVI', 'GIF', 'MP3', 'FLAC', 'WAV', 'OGG', 'M4A', 'OPUS', 'PDF', 'DOCX', 'ODT', 'RTF', 'TXT', 'HTML', 'PNG', 'JPG', 'WEBP', 'AVIF', 'BMP', 'TIFF', 'ICO'],
        },
        mode: { type: 'string', enum: ['remux', 'transcode'], description: 'remux copies streams (fast); transcode re-encodes. Default transcode.' },
      },
      required: ['inputPath', 'container'],
      additionalProperties: false,
    },
  },
  {
    name: 'upscale_image',
    description: 'Upscale an image with Real-ESRGAN. Returns a job id.',
    channel: 'tasks:startUpscale',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: FILE,
        scale: { type: 'integer', enum: [2, 3, 4], description: 'Default 4.' },
        model: { type: 'string', enum: ['realesr-animevideov3', 'realesrgan-x4plus', 'realesrgan-x4plus-anime'], description: 'Default realesr-animevideov3.' },
      },
      required: ['inputPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'upscale_video',
    description: 'Upscale a video with Real-ESRGAN (GPU). Slow for long videos. Returns a job id.',
    channel: 'tasks:startVideoUpscale',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: FILE,
        scale: { type: 'integer', enum: [2, 3, 4], description: 'Default 2.' },
        model: { type: 'string', enum: ['realesr-animevideov3', 'realesrgan-x4plus', 'realesrgan-x4plus-anime'], description: 'Default realesr-animevideov3.' },
      },
      required: ['inputPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'interpolate',
    description: 'Raise a video\'s frame rate with RIFE (2x or 4x). Returns a job id.',
    channel: 'tasks:startInterpolate',
    inputSchema: {
      type: 'object',
      properties: { inputPath: FILE, multiplier: { type: 'integer', enum: [2, 4], description: 'Default 2.' } },
      required: ['inputPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'subtitles',
    description: 'Generate subtitles for a video or audio file with Whisper. Returns a job id.',
    channel: 'tasks:startSubtitles',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: FILE,
        model: { type: 'string', enum: ['tiny', 'base', 'small', 'medium'], description: 'Default tiny.' },
        language: { type: 'string', description: "'auto' or an ISO 639-1 code like 'en'. Default auto." },
        translate: { type: 'boolean', description: 'Translate to English. Default false.' },
        format: { type: 'string', enum: ['srt', 'vtt'], description: 'Default srt.' },
      },
      required: ['inputPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'trim',
    description: 'Cut a section out of a video or audio file. Returns a job id.',
    channel: 'tasks:startTrim',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: FILE,
        start: { type: 'number', minimum: 0, description: 'Seconds from the start.' },
        end: { type: ['number', 'null'], description: 'Seconds; omit or null for the end of the file.' },
        mode: { type: 'string', enum: ['fast', 'precise'], description: 'fast copies streams (keyframe cuts); precise re-encodes. Default fast.' },
      },
      required: ['inputPath', 'start'],
      additionalProperties: false,
    },
  },
  {
    name: 'compress',
    description: 'Make a video or audio file land just under a size (for example 10 MB for Discord). Returns a job id.',
    channel: 'tasks:startCompress',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: FILE,
        targetMB: { type: 'number', minimum: 0.5, description: 'The size to stay under, in megabytes.' },
        quality: { type: 'string', enum: ['fast', 'best'], description: 'fast uses the GPU encoder when there is one; best is a slower two-pass x264 encode. Default fast.' },
      },
      required: ['inputPath', 'targetMB'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_recipes',
    description: 'List the saved recipes (chains of tools), with what each starts from and its steps. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'run_recipe',
    description: 'Run a saved recipe on a file (or a link, for a recipe that starts from a link). Each step feeds the next, and the steps show up as one group in the Library. Returns the run and job ids.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe: { type: 'string', description: 'The recipe id from list_recipes.' },
        input: { type: 'string', description: 'An absolute file path, or a full http(s) link for a recipe that starts from a link.' },
        keepIntermediate: { type: 'boolean', description: 'Keep the files the middle steps make. Default false.' },
      },
      required: ['recipe', 'input'],
      additionalProperties: false,
    },
  },
  {
    name: 'suggest_settings',
    description: 'Look at a media file and suggest the best settings for a tool (model, scale, frame rate multiplier, remux or re-encode, subtitle model), with the reason for each. Read-only; does not start a job.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', enum: ['upscale_image', 'upscale_video', 'interpolate', 'convert', 'compress', 'subtitles'], description: 'The tool to suggest settings for.' },
        inputPath: FILE,
        container: { type: 'string', description: 'For convert: the target format, such as MP4 or MKV.' },
      },
      required: ['tool', 'inputPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'make_gif',
    description: 'Turn a section of a video into a GIF, an animated WebP, or a Telegram or Discord sticker (sizes and lengths are fitted to the sticker limits). Returns a job id.',
    channel: 'tasks:startGif',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: FILE,
        preset: { type: 'string', enum: ['gif', 'webp', 'telegram', 'discord'], description: 'gif, webp, telegram (WebM, 512 px, up to 3 s, 256 KB) or discord (APNG, 320 px, 512 KB). Default gif.' },
        start: { type: 'number', minimum: 0, description: 'Seconds from the start. Default 0.' },
        end: { type: ['number', 'null'], description: 'Seconds; omit or null for the preset limit after the start.' },
        width: { type: 'integer', minimum: 64, maximum: 1920, description: 'Width in pixels for gif and webp. Default 480. Stickers use their own size.' },
        fps: { type: 'integer', minimum: 5, maximum: 30, description: 'Frames per second. Default depends on the preset.' },
        loop: { type: 'boolean', description: 'Loop forever (gif and webp). Default true.' },
      },
      required: ['inputPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'beat_analyze',
    description: 'Find the tempo (BPM), beat times and musical key of a song. Optionally writes the BPM and key into a tagged copy (MP3, FLAC, Ogg, Opus). Needs the Beat Finder install (librosa). Returns a job id; the BPM and key show in the job status.',
    channel: 'tasks:startBeatAnalyze',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: FILE,
        writeTags: { type: 'boolean', description: 'Write BPM and key tags into a copy of the file. Default false.' },
      },
      required: ['inputPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'beat_cut',
    description: 'Make a montage that switches clips on the beat of a song: cuts a list of video clips (or folders of them) every 1, 2, 4 or 8 beats, with the song as the sound. Returns a job id.',
    channel: 'tasks:startBeatCut',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string', description: 'Absolute path to the song.' },
        clips: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of video files or folders of videos, used in this order.' },
        everyBeats: { type: 'integer', enum: [1, 2, 4, 8], description: 'Switch clip every this many beats. Default 4.' },
        shuffle: { type: 'boolean', description: 'Use the clips in random order. Default false.' },
        skipSeconds: { type: 'number', minimum: 0, maximum: 30, description: 'Seconds to skip at the start of every clip. Default 0.' },
        beats: { type: 'array', items: { type: 'number' }, description: 'Beat times in seconds (from an earlier analysis). Omit to analyse the song first.' },
      },
      required: ['inputPath', 'clips'],
      additionalProperties: false,
    },
  },
  {
    name: 'restore',
    description: 'Clean up old or bad footage in one pass: deinterlace, denoise, stabilize and fix the colors. With upscale or interpolate the result then goes through the AI upscaler and the frame interpolator as follow-up jobs in the same group. Returns a job id.',
    channel: 'tasks:startRestore',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: FILE,
        deinterlace: { type: 'string', enum: ['auto', 'on', 'off'], description: 'auto looks at the video and deinterlaces only when it is interlaced. Default auto.' },
        denoise: { type: 'string', enum: ['off', 'light', 'medium', 'strong'], description: 'Remove grain and noise. strong is slow. Default off.' },
        stabilize: { type: 'boolean', description: 'Steady shaky footage (needs an FFmpeg with libvidstab). Default false.' },
        fixColors: { type: 'boolean', description: 'Even out faded or dark footage with automatic levels. Default false.' },
        upscale: { type: 'boolean', description: 'Then upscale 2x with the AI upscaler. Default false.' },
        interpolate: { type: 'boolean', description: 'Then double the frame rate with RIFE. Default false.' },
      },
      required: ['inputPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'jump_cut',
    description: 'Remove the silences from a talking video or a podcast (one re-encode), and/or even out the loudness. Returns a job id.',
    channel: 'tasks:startJumpCut',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: FILE,
        cut: { type: 'boolean', description: 'Cut the silences. Default true.' },
        thresholdDb: { type: 'number', minimum: -80, maximum: -10, description: 'Anything quieter than this is silence. Default -30.' },
        minSilence: { type: 'number', minimum: 0.1, maximum: 10, description: 'Only silences at least this many seconds long are cut. Default 0.5.' },
        padding: { type: 'number', minimum: 0, maximum: 2, description: 'Seconds of silence kept around each part. Default 0.15.' },
        normalize: { type: 'string', enum: ['off', 'podcast', 'broadcast'], description: 'Even out the loudness: podcast (-14 LUFS, YouTube and Spotify) or broadcast (-23 LUFS). Default off.' },
        audioOnly: { type: 'boolean', description: 'Write an MP3 without the video. Default false.' },
      },
      required: ['inputPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'tag_music',
    description: 'Look up a song by its audio fingerprint (AcoustID, MusicBrainz, Cover Art Archive) and write artist, title, album, year, track and cover into the file. It changes the file only when it is sure enough. Returns a job id.',
    channel: 'tasks:startTag',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: FILE,
        organize: { type: 'boolean', description: 'Also move the file to Artist/Album/ next to where it is. Default false.' },
        minConfidence: { type: 'number', minimum: 0.5, maximum: 1, description: 'How sure the match must be before the file is changed, 0.5 to 1. Default 0.9.' },
      },
      required: ['inputPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'audio_ai',
    description: 'Remove vocals / isolate the voice / clean up audio (Demucs, or ffmpeg for echo). Returns a job id.',
    channel: 'tasks:startAudioAi',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: FILE,
        mode: { type: 'string', enum: ['no-vocals', 'vocals', 'voice', 'echo'] },
        format: { type: 'string', enum: ['MP3', 'FLAC', 'WAV'], description: 'Default MP3.' },
        keepVideo: { type: 'boolean', description: 'For videos: put the processed audio back on the picture.' },
      },
      required: ['inputPath', 'mode'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_jobs',
    description: 'List OPNduck jobs (newest last): id, kind, status, progress 0-1, label, error.',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['queued', 'running', 'done', 'error', 'canceled'], description: 'Only jobs with this status.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'job_status',
    description: 'One job in detail, with its output file path (when done) and the last log lines.',
    inputSchema: {
      type: 'object',
      properties: { id: JOB_ID, logLines: { type: 'integer', minimum: 0, maximum: 200, description: 'How many log lines. Default 20.' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_job',
    description: 'Cancel a queued or running job.',
    inputSchema: { type: 'object', properties: { id: JOB_ID }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'queue_pause',
    description: 'Pause the job queue: running jobs finish, waiting jobs do not start.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'queue_resume',
    description: 'Resume the job queue.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'probe_media',
    description: 'Read a media file\'s duration, resolution and whether it has video. Read-only.',
    inputSchema: { type: 'object', properties: { path: FILE }, required: ['path'], additionalProperties: false },
  },
]

/**
 * What each start tool takes and gives, for chaining tools into a recipe. Types: url, video, audio, image, subtitle
 * (a subtitle file is a dead end: no tool takes one). `produces` is a type, or a function of (args, inputType) for tools
 * whose output depends on their settings. Kept next to TOOLS, and out of publicTools().
 */
const AUDIO_CONTAINERS = ['MP3', 'FLAC', 'WAV', 'OGG', 'M4A', 'OPUS']
const IMAGE_CONTAINERS = ['PNG', 'JPG', 'WEBP', 'AVIF', 'BMP', 'TIFF', 'ICO']
const same = (_args, inputType) => inputType
const STEP_TYPES = {
  download: { accepts: ['url'], produces: (a) => (AUDIO_CONTAINERS.includes(String(a.format ?? DEFAULTS.download.format).toUpperCase()) ? 'audio' : 'video') },
  convert: { accepts: ['video', 'audio', 'image'], produces: (a) => (AUDIO_CONTAINERS.includes(a.container) ? 'audio' : IMAGE_CONTAINERS.includes(a.container) ? 'image' : ['PDF', 'DOCX', 'ODT', 'RTF', 'TXT', 'HTML'].includes(a.container) ? 'document' : 'video') },
  upscale_image: { accepts: ['image'], produces: 'image' },
  upscale_video: { accepts: ['video'], produces: 'video' },
  interpolate: { accepts: ['video'], produces: 'video' },
  subtitles: { accepts: ['video', 'audio'], produces: 'subtitle' },
  trim: { accepts: ['video', 'audio'], produces: same },
  compress: { accepts: ['video', 'audio'], produces: same },
  make_gif: { accepts: ['video'], produces: 'image' },
  beat_analyze: { accepts: ['audio'], produces: 'audio' },
  beat_cut: { accepts: [], produces: 'video' }, // takes a song and a list of clips: a job of its own, never a recipe step
  restore: { accepts: ['video'], produces: 'video' },
  jump_cut: { accepts: ['video', 'audio'], produces: (a, inputType) => (a.audioOnly ? 'audio' : inputType) },
  tag_music: { accepts: ['audio'], produces: 'audio' },
  audio_ai: { accepts: ['audio', 'video'], produces: 'audio' },
}

/** The type a step leaves behind, given its arguments and what it was fed. */
function producesFor(tool, args, inputType) {
  const t = STEP_TYPES[tool]
  if (!t) return null
  return typeof t.produces === 'function' ? t.produces(args ?? {}, inputType) : t.produces
}

/** What the bridge advertises to MCP clients. */
function publicTools() {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
}

/** Default values and unknown-key stripping, so a start request is exactly what the UI would have sent. */
const DEFAULTS = {
  download: { format: 'MP4', videoQuality: 'best', audioQuality: 'best', playlist: 'single' },
  convert: { mode: 'transcode' },
  upscale_image: { scale: 4, model: 'realesr-animevideov3' },
  upscale_video: { scale: 2, model: 'realesr-animevideov3' },
  interpolate: { multiplier: 2 },
  subtitles: { model: 'tiny', language: 'auto', translate: false, format: 'srt' },
  trim: { end: null, mode: 'fast' },
  compress: { quality: 'fast' },
  make_gif: { preset: 'gif', start: 0, end: null, loop: true },
  beat_analyze: { writeTags: false },
  beat_cut: { everyBeats: 4, shuffle: false, skipSeconds: 0 },
  restore: { deinterlace: 'auto', denoise: 'off', stabilize: false, fixColors: false },
  jump_cut: { cut: true, normalize: 'off', audioOnly: false },
  tag_music: { organize: false, minConfidence: 0.9 },
  audio_ai: { format: 'MP3', keepVideo: false },
}

/**
 * Checks `args` against the tool's schema (types, enums, required, no extra keys) and returns the
 * request object for the matching start handler. Throws a readable Error for anything else.
 * Path and URL checks happen in the app (they need the file system), see mcp.cjs.
 */
function buildStartRequest(name, args) {
  const tool = TOOLS.find((t) => t.name === name && t.channel)
  if (!tool) throw new Error(`Unknown start tool: ${name}`)
  const a = args == null ? {} : args
  if (typeof a !== 'object' || Array.isArray(a)) throw new Error('Arguments must be an object')
  const props = tool.inputSchema.properties
  for (const key of Object.keys(a)) if (!Object.hasOwn(props, key)) throw new Error(`Unknown argument: ${key}`)
  for (const key of tool.inputSchema.required ?? []) if (a[key] == null) throw new Error(`Missing argument: ${key}`)
  const req = { ...(DEFAULTS[name] ?? {}) }
  for (const [key, value] of Object.entries(a)) {
    if (value === undefined) continue
    const spec = props[key]
    const types = [].concat(spec.type)
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value
    const ok = types.includes(actual) || (actual === 'integer' && types.includes('number'))
    if (!ok) throw new Error(`Argument ${key} must be ${types.join(' or ')}`)
    if (spec.enum && !spec.enum.includes(value)) throw new Error(`Argument ${key} must be one of: ${spec.enum.join(', ')}`)
    if (Array.isArray(value) && (value.length > 5000 || value.some((v) => (spec.items?.type ?? 'string') !== typeof v && !(spec.items?.type === 'integer' && Number.isInteger(v))))) throw new Error(`Argument ${key} must be a list of ${spec.items?.type ?? 'string'}s (at most 5000)`)
    if (typeof value === 'string' && value.length > 4096) throw new Error(`Argument ${key} is too long`)
    if (typeof value === 'number' && (!Number.isFinite(value) || (spec.minimum != null && value < spec.minimum))) throw new Error(`Argument ${key} is out of range`)
    req[key] = value
  }
  return { channel: tool.channel, req }
}

module.exports = { TOOLS, DEFAULTS, STEP_TYPES, producesFor, publicTools, buildStartRequest }
