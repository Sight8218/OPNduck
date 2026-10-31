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
    const actual = value === null ? 'null' : Number.isInteger(value) ? 'integer' : typeof value
    const ok = types.includes(actual) || (actual === 'integer' && types.includes('number'))
    if (!ok) throw new Error(`Argument ${key} must be ${types.join(' or ')}`)
    if (spec.enum && !spec.enum.includes(value)) throw new Error(`Argument ${key} must be one of: ${spec.enum.join(', ')}`)
    if (typeof value === 'string' && value.length > 4096) throw new Error(`Argument ${key} is too long`)
    if (typeof value === 'number' && (!Number.isFinite(value) || (spec.minimum != null && value < spec.minimum))) throw new Error(`Argument ${key} is out of range`)
    req[key] = value
  }
  return { channel: tool.channel, req }
}

module.exports = { TOOLS, DEFAULTS, publicTools, buildStartRequest }
