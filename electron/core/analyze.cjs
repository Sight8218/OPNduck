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
 * Looks at a media file and reports facts the auto-settings rules need: size, frame rate (and whether it varies),
 * codec, bitrate, HDR, interlacing, black bars, loudness and whether it looks like animation. It is quick (a few
 * one-second samples, not a full decode) and cached per file. No Electron; the parsers are pure and exported for tests.
 */
const fs = require('node:fs')
const { spawn } = require('node:child_process')

const SAMPLES = 5
const FRAME_W = 160
const FRAME_H = 90

/** Runs a program and returns { code, stdout, stderr }; stdout is a Buffer. Never rejects. */
function run(cmd, args, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args)
    } catch {
      return resolve({ code: -1, stdout: Buffer.alloc(0), stderr: '' })
    }
    const out = []
    let err = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (c) => out.push(c))
    child.stderr.on('data', (c) => (err += c))
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ code: -1, stdout: Buffer.alloc(0), stderr: err })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout: Buffer.concat(out), stderr: err })
    })
  })
}

/** The share of frames idet called interlaced (0 to 1) from ffmpeg's idet summary lines. */
function parseIdet(stderr) {
  // ffmpeg can print the summary more than once (an empty one first); the last one with frames counts.
  for (const m of [...stderr.matchAll(/Multi frame detection: TFF:\s*(\d+)\s+BFF:\s*(\d+)\s+Progressive:\s*(\d+)/g)].reverse()) {
    const [tff, bff, prog] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const total = tff + bff + prog
    if (total) return (tff + bff) / total
  }
  return null
}

/** The last crop=w:h:x:y cropdetect printed, or null. */
function parseCropdetect(stderr) {
  const all = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)]
  const m = all[all.length - 1]
  return m ? { w: Number(m[1]), h: Number(m[2]), x: Number(m[3]), y: Number(m[4]) } : null
}

/** Integrated loudness in LUFS from the ebur128 summary, or null (also null for silence, -70 or lower). */
function parseEbur128(stderr) {
  const m = /Integrated loudness:\s*I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/.exec(stderr)
  if (!m) return null
  const v = Number(m[1])
  return v > -69 ? v : null
}

/** "30000/1001" -> 29.97 */
function parseRate(s) {
  const [a, b] = String(s ?? '').split('/').map(Number)
  return a > 0 && b > 0 ? a / b : null
}

/** Whether the colours of some small RGB frames look drawn (few distinct colours, big flat areas) rather than filmed. */
function classifyAnimation(frames, w = FRAME_W, h = FRAME_H) {
  if (!frames.length) return null
  let distinct = 0
  let flat = 0
  for (const f of frames) {
    const colors = new Set()
    let same = 0
    for (let i = 0; i < w * h; i++) {
      const o = i * 3
      colors.add(((f[o] >> 3) << 10) | ((f[o + 1] >> 3) << 5) | (f[o + 2] >> 3))
      if (i % w !== w - 1 && Math.abs(f[o] - f[o + 3]) + Math.abs(f[o + 1] - f[o + 4]) + Math.abs(f[o + 2] - f[o + 5]) < 12) same++
    }
    distinct += colors.size
    flat += same / (w * h)
  }
  const d = distinct / frames.length
  const fl = flat / frames.length
  return d < 700 && fl > 0.72
}

const cache = new Map()

/**
 * @param {string} file
 * @returns {Promise<null | { width, height, fps, vfr, codec, bitrate, duration, hdr, interlaced, crop, loudness, hasAudio, animation, isImage }>}
 */
async function analyzeMedia(file) {
  let st
  try {
    st = fs.statSync(file)
  } catch {
    return null
  }
  const key = `${file}|${st.size}|${st.mtimeMs}`
  if (cache.has(key)) return cache.get(key)
  const probe = await run('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file], { timeoutMs: 15000 })
  let info
  try {
    info = JSON.parse(probe.stdout.toString('utf8'))
  } catch {
    return null
  }
  const v = info.streams?.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
  const a = info.streams?.find((s) => s.codec_type === 'audio')
  const duration = Number.parseFloat(info.format?.duration) || 0
  const avg = parseRate(v?.avg_frame_rate)
  const r = parseRate(v?.r_frame_rate)
  const isImage = !!v && (!duration || ['image2', 'png_pipe', 'jpeg_pipe', 'webp_pipe', 'bmp_pipe', 'tiff_pipe'].some((f) => String(info.format?.format_name ?? '').includes(f))) && !v.nb_frames?.startsWith?.('0')
  const facts = {
    width: v?.width ?? null,
    height: v?.height ?? null,
    fps: avg ?? r,
    // Variable frame rate: the stream's average rate differs from its nominal one by more than 2%.
    vfr: !!(avg && r && Math.abs(avg - r) / r > 0.02),
    codec: v?.codec_name ?? null,
    bitrate: Number.parseInt(info.format?.bit_rate, 10) || null,
    duration,
    hdr: ['smpte2084', 'arib-std-b67'].includes(v?.color_transfer),
    interlaced: null,
    crop: null,
    loudness: null,
    hasAudio: !!a,
    animation: null,
    isImage,
  }

  if (v && !isImage && duration > 0) {
    const windows = Array.from({ length: SAMPLES }, (_, i) => (duration * (i + 1)) / (SAMPLES + 1))
    const idets = []
    const lufs = []
    let crop = null
    for (const t of windows) {
      const args = ['-hide_banner', '-nostdin', '-ss', t.toFixed(2), '-t', '1', '-i', file, '-vf', 'idet,cropdetect=limit=24:round=2:reset=0']
      if (a) args.push('-af', 'ebur128')
      else args.push('-an')
      args.push('-f', 'null', '-')
      const res = await run('ffmpeg', args, { timeoutMs: 15000 })
      const i = parseIdet(res.stderr)
      if (i != null) idets.push(i)
      const c = parseCropdetect(res.stderr)
      if (c) crop = !crop ? c : { w: Math.max(crop.w, c.w), h: Math.max(crop.h, c.h), x: Math.min(crop.x, c.x), y: Math.min(crop.y, c.y) }
      const l = parseEbur128(res.stderr)
      if (l != null) lufs.push(l)
    }
    facts.interlaced = idets.length ? idets.reduce((x, y) => x + y, 0) / idets.length > 0.5 : null
    if (crop && facts.width && facts.height && (crop.w < facts.width - 8 || crop.h < facts.height - 8)) facts.crop = crop
    facts.loudness = lufs.length ? Math.round((lufs.reduce((x, y) => x + y, 0) / lufs.length) * 10) / 10 : null
  }
  if (v) {
    const at = duration > 0 && !isImage ? ['-ss', (duration / 2).toFixed(2)] : []
    const res = await run('ffmpeg', ['-hide_banner', '-nostdin', ...at, '-i', file, '-frames:v', '3', '-vf', `scale=${FRAME_W}:${FRAME_H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { timeoutMs: 15000 })
    const size = FRAME_W * FRAME_H * 3
    const frames = []
    for (let o = 0; o + size <= res.stdout.length; o += size) frames.push(res.stdout.subarray(o, o + size))
    facts.animation = classifyAnimation(frames)
  }
  cache.set(key, facts)
  if (cache.size > 100) cache.delete(cache.keys().next().value)
  return facts
}

function createAnalyze() {
  return { analyzeMedia }
}

module.exports = { createAnalyze, analyzeMedia, parseIdet, parseCropdetect, parseEbur128, parseRate, classifyAnimation }
