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
 * Thumbnail picker: finds a good still for a video. Frames are sampled across the video, the dull ones (too dark, too
 * bright, blurry) are dropped by simple measurements, and when the AI model can see pictures it chooses the most
 * inviting of the rest; otherwise the sharpest, best lit frame wins. The model only chooses a number: it never writes
 * a path. The still is saved beside the video. Pure helpers plus a function that runs FFmpeg. No Electron.
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args)
    const out = []
    let err = ''
    child.stdout.on('data', (c) => out.push(c))
    child.stderr.on('data', (c) => (err += c))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.trim().split('\n').pop() || `${cmd} exited with code ${code}`))))
  })

/** Higher is a better still. `bytes` is the JPEG size (more detail is more bytes), `luma` the average brightness 0..255. */
function score({ bytes, luma }) {
  const lit = 1 - Math.min(1, Math.abs(luma - 120) / 120) // best around the middle, zero at black or white
  return Math.sqrt(bytes) * (0.25 + lit)
}

/** The model's answer made safe: an integer index into the candidates, else null. */
function parsePick(text, count) {
  try {
    const j = JSON.parse(String(text).trim().replace(/^```(?:json)?|```$/g, ''))
    const n = Math.trunc(Number(j.pick))
    if (Number.isFinite(n) && n >= 1 && n <= count) return { index: n - 1, why: String(j.why ?? '').slice(0, 200) }
  } catch {
    /* fall through */
  }
  return null
}

const pickSchema = { type: 'object', properties: { pick: { type: 'integer' }, why: { type: 'string' } }, required: ['pick', 'why'], additionalProperties: false }

/** Grabs one frame as JPEG bytes at `time` seconds. */
const grab = (file, time, width) => run('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '3', '-f', 'image2pipe', '-c:v', 'mjpeg', '-']).catch(() => null)

async function averageLuma(file, time) {
  const raw = await run('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'scale=16:16,format=gray', '-f', 'rawvideo', '-']).catch(() => null)
  return raw && raw.length ? raw.reduce((a, b) => a + b, 0) / raw.length : null
}

async function duration(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
  const d = Number(String(out).trim())
  if (!(d > 0)) throw new Error('Could not read how long this video is')
  return d
}

/**
 * @param {{ chat: Function } | null} ai  the AI runtime, or null to use only the measurements
 * @returns {{ path: string, time: number, why: string, byAi: boolean }}
 */
async function pickThumbnail(ai, file, { destDir, uniqueOutputPath, count = 12, canSee = false }) {
  const dur = await duration(file)
  const times = Array.from({ length: count }, (_, i) => +(dur * (0.05 + (0.9 * i) / (count - 1))).toFixed(2))
  const cands = []
  for (const time of times) {
    const jpg = await grab(file, time, 480)
    const luma = jpg && (await averageLuma(file, time))
    if (jpg && jpg.length && luma != null) cands.push({ time, jpg, score: score({ bytes: jpg.length, luma }) })
  }
  if (!cands.length) throw new Error('Could not read any frames from this video')
  cands.sort((a, b) => b.score - a.score)
  const top = cands.slice(0, 6)
  let chosen = top[0]
  let why = 'The sharpest, best lit frame.'
  let byAi = false
  if (ai && canSee) {
    try {
      let text = ''
      const system = 'You choose the thumbnail for a video. You see numbered frames in order. Choose the one that is the most inviting and clear: a sharp frame, a clear subject, good light, not mid-blink or mid-motion, no black or fade. Answer only with the JSON asked for: pick is the number of the frame.'
      for await (const ev of ai.chat({ messages: [{ role: 'system', content: system }, { role: 'user', content: `There are ${top.length} frames.`, images: top.map((c) => `data:image/jpeg;base64,${c.jpg.toString('base64')}`) }], jsonSchema: pickSchema, temperature: 0.1, reasoning: 'off', maxTokens: 200 })) if (ev.type === 'text') text += ev.delta
      const p = parsePick(text, top.length)
      if (p) {
        chosen = top[p.index]
        why = p.why || 'Chosen by the AI model.'
        byAi = true
      }
    } catch {
      /* the measurements are the answer when the model cannot help */
    }
  }
  const full = await grab(file, chosen.time, 1920)
  if (!full || !full.length) throw new Error('Could not save the chosen frame')
  fs.mkdirSync(destDir, { recursive: true })
  const out = uniqueOutputPath(destDir, `${path.basename(file, path.extname(file))}-thumbnail`, 'jpg')
  fs.writeFileSync(out, full)
  return { path: out, time: chosen.time, why, byAi }
}

module.exports = { pickThumbnail, parsePick, score, pickSchema }
