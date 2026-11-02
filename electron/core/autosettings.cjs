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
 * Picks sensible settings for a tool from the facts analyze.cjs measured. Plain rules, no model: each decision
 * comes with the reason it was made, so the card can show "Why these settings?". Pure and unit-tested.
 */

/** Containers (convert targets) that can hold the codec as it is, so the file can be remuxed without re-encoding. */
const REMUX_OK = {
  MP4: ['h264', 'hevc', 'av1', 'mpeg4'],
  MKV: ['h264', 'hevc', 'av1', 'vp9', 'vp8', 'mpeg4'],
  MOV: ['h264', 'hevc', 'mpeg4'],
  WEBM: ['vp9', 'vp8', 'av1'],
}

const TOOLS = ['upscale_image', 'upscale_video', 'interpolate', 'convert', 'compress', 'subtitles']

/**
 * @param {string} tool one of TOOLS
 * @param {object} f facts from analyzeMedia
 * @param {{ container?: string }} [opts]
 * @returns {{ settings: object, reasons: { setting: string, value: unknown, because: string }[], notes: { level: 'info'|'warn', text: string }[] }}
 */
function suggest(tool, f, opts = {}) {
  const settings = {}
  const reasons = []
  const notes = []
  const set = (setting, value, because) => {
    settings[setting] = value
    reasons.push({ setting, value, because })
  }
  const note = (level, text) => notes.push({ level, text })
  const h = f.height ?? 0
  const size = f.width && f.height ? `${f.width}×${f.height}` : 'this size'

  if (f.hdr) note('warn', 'This is HDR. Results can look washed out unless you convert it to SDR first.')
  if (f.interlaced) note('warn', 'The picture is interlaced (combed lines on motion). Deinterlace it first for a cleaner result.')
  if (f.crop) note('info', `It has black bars: the picture is really ${f.crop.w}×${f.crop.h}.`)

  if (tool === 'upscale_image') {
    if (f.animation) set('model', 'realesrgan-x4plus-anime', 'It looks like drawn art, and this model is made for that.')
    else set('model', 'realesrgan-x4plus', 'It looks like a photo, and this model is the best general one.')
    if (h >= 2000 || (f.width ?? 0) >= 2000) {
      set('model', 'realesr-animevideov3', `${size} is already large, and only this model can do a gentle 2×.`)
      set('scale', 2, `A 4× result of ${size} would be huge, so 2× is enough.`)
    } else set('scale', 4, `${size} is small, so the full 4× helps most.`)
  } else if (tool === 'upscale_video') {
    if (h >= 1080) {
      set('scale', 2, `${size} is already full HD, so 2× (to about ${f.width * 2}×${h * 2}) is plenty and 4× would take very long.`)
    } else if (h >= 720) {
      set('scale', 2, `${size} doubles to about ${(f.width ?? 0) * 2}×${h * 2}.`)
    } else {
      set('scale', 4, `${size} is small, so 4× brings it to about ${(f.width ?? 0) * 4}×${h * 4}.`)
    }
    // Only this model can do 2×; the other two are 4× only.
    if (settings.scale === 2) set('model', 'realesr-animevideov3', 'Only this model can upscale video by 2×.')
    else if (f.animation) set('model', 'realesrgan-x4plus-anime', 'It looks like animation, and this 4× model is made for that.')
    else set('model', 'realesr-animevideov3', 'It is fast and safe for filmed video too.')
    if (f.duration > 1800) note('info', `This is ${Math.round(f.duration / 60)} minutes long; upscaling will take a long time.`)
  } else if (tool === 'interpolate') {
    if (f.fps && f.fps >= 50) {
      set('multiplier', 2, `It is already ${Math.round(f.fps)} fps. Interpolating is rarely worth it.`)
      note('warn', 'This video is already smooth (50 fps or more).')
    } else if (f.fps && f.fps <= 16) {
      set('multiplier', 4, `${Math.round(f.fps)} fps is choppy, so 4× (to about ${Math.round(f.fps * 4)} fps) makes it smooth.`)
    } else {
      set('multiplier', 2, `${f.fps ? Math.round(f.fps) : 'The'} fps doubles to about ${f.fps ? Math.round(f.fps * 2) : 60}, which is the usual smooth result.`)
    }
    if (f.vfr) note('warn', 'The frame rate varies (typical for screen recordings). The result can stutter.')
    if (f.animation) note('warn', 'It looks like animation. Interpolation can smear line art.')
  } else if (tool === 'convert') {
    const container = String(opts.container ?? '').toUpperCase()
    if (REMUX_OK[container]) {
      if (f.codec && REMUX_OK[container].includes(f.codec) && !f.hdr && !f.interlaced) {
        set('mode', 'remux', `The video (${f.codec}) already fits in ${container}, so it can be copied in seconds without losing quality.`)
      } else {
        set('mode', 'transcode', f.codec && !REMUX_OK[container].includes(f.codec) ? `${f.codec} does not fit in ${container}, so it has to be re-encoded.` : 'It has to be re-encoded to fix the picture.')
      }
    } else if (!container) note('info', 'Pick the format first and Auto can tell whether a quick copy is enough.')
    if (f.hdr && container) note('warn', 'HDR to a normal player needs tone-mapping; the converter does not do that yet.')
  } else if (tool === 'compress') {
    if (f.animation) set('quality', 'best', 'Flat colours compress much better in two passes.')
    else set('quality', 'fast', 'The graphics-card encoder is fine for filmed video and much quicker.')
    if (f.crop) note('info', 'Cropping the black bars first would save bits.')
  } else if (tool === 'subtitles') {
    if (f.duration > 3600) set('model', 'base', `It is ${Math.round(f.duration / 60)} minutes long, so a lighter model keeps it fast.`)
    else if (f.loudness != null && f.loudness < -32) set('model', 'small', 'The sound is very quiet, so a stronger model hears it better.')
    else set('model', 'small', 'A good balance of speed and accuracy.')
    set('language', 'auto', 'It detects the language by itself.')
    if (!f.hasAudio) note('warn', 'This file has no audio, so there is nothing to transcribe.')
  } else {
    throw new Error(`No automatic settings for ${tool}`)
  }
  if (f.loudness != null && f.loudness > -10) note('info', `The sound is very loud (${f.loudness} LUFS).`)
  return { settings, reasons, notes }
}

module.exports = { suggest, TOOLS, REMUX_OK }
