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
 * Colour grader: automatic fixes measured from the picture (no AI), a few looks as .cube LUTs, your own LUTs, matching
 * one video's colours to a reference image, manual sliders, and a before/after preview. An optional AI look picker only
 * chooses slider values, which are then applied by the same filters. No Electron.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const round = (v, n = 4) => Math.round(v * 10 ** n) / 10 ** n

/* ----------------------------------------------------------------------------------------- looks (LUTs) */

/** The looks that ship with OPNduck: a function from an RGB colour (0..1 each) to a new one. Self-made, no third-party files. */
const LOOKS = {
  warm_film: { label: 'Warm film', fn: ([r, g, b]) => curve(tint([r * 1.04 + 0.01, g * 1.0 + 0.005, b * 0.92], 0), 0.12) },
  teal_orange: {
    label: 'Teal and orange',
    fn: ([r, g, b]) => {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const t = clamp(1 - l * 2, 0, 1) // shadows
      const o = clamp(l * 2 - 1, 0, 1) // highlights
      return curve([r + 0.12 * o - 0.1 * t, g + 0.02 * o + 0.04 * t, b - 0.12 * o + 0.1 * t], 0.1)
    },
  },
  bleach_bypass: {
    label: 'Bleach bypass',
    fn: ([r, g, b]) => {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
      return curve([mix(l, r, 0.45), mix(l, g, 0.45), mix(l, b, 0.45)], 0.35)
    },
  },
  bw_rich: {
    label: 'Rich black and white',
    fn: ([r, g, b]) => {
      const l = curve([0.3 * r + 0.59 * g + 0.11 * b, 0, 0], 0.3)[0]
      return [l, l, l]
    },
  },
  vintage_fade: { label: 'Vintage fade', fn: ([r, g, b]) => [0.06 + r * 0.88 + 0.02, 0.05 + g * 0.88, 0.07 + b * 0.84 + 0.02].map((v) => clamp(v, 0, 1)) },
  cool_night: {
    label: 'Cool night',
    fn: ([r, g, b]) => {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const s = clamp(1 - l * 1.5, 0, 1)
      return curve([r * 0.94 - 0.03 * s, g * 0.98 + 0.01 * s, b * 1.06 + 0.06 * s], 0.15)
    },
  },
}

const mix = (a, b, t) => a * (1 - t) + b * t
/** An S-shaped contrast curve of strength `k` (0 leaves the colour as it is). */
function curve(c, k) {
  return c.map((v) => {
    const x = clamp(v, 0, 1)
    return clamp(x + k * (x * x * (3 - 2 * x) - x), 0, 1)
  })
}
const tint = (c) => c

/** A .cube file's text for a colour function, `size` points per side (the red value changes fastest, as the format wants). */
function cubeText(fn, size = 17, title = 'OPNduck') {
  const lines = [`TITLE "${title}"`, `LUT_3D_SIZE ${size}`]
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const [R, G, B] = fn([r / (size - 1), g / (size - 1), b / (size - 1)]).map((v) => clamp(v, 0, 1))
        lines.push(`${round(R, 6)} ${round(G, 6)} ${round(B, 6)}`)
      }
  return lines.join('\n') + '\n'
}

/** Checks a .cube file somebody imports: a 3D table of a sane size with the right number of numbers. Returns its size. */
function validateCube(text) {
  const size = Number(/^LUT_3D_SIZE\s+(\d+)/m.exec(text)?.[1])
  if (!Number.isInteger(size) || size < 2 || size > 65) throw new Error('This is not a 3D LUT (.cube) file')
  const rows = text.split('\n').filter((l) => /^\s*-?[\d.]+(e-?\d+)?\s+-?[\d.]+(e-?\d+)?\s+-?[\d.]+(e-?\d+)?\s*$/i.test(l))
  if (rows.length !== size ** 3) throw new Error(`The LUT should have ${size ** 3} colour rows, it has ${rows.length}`)
  return size
}

/* ------------------------------------------------------------------------------------ measuring and auto fix */

/** Averages the per-frame numbers `signalstats` printed: { ymin, ymax, yavg, uavg, vavg } (8-bit video range). */
function parseStats(text) {
  const keys = { YMIN: 'ymin', YMAX: 'ymax', YAVG: 'yavg', UAVG: 'uavg', VAVG: 'vavg' }
  const sums = {}
  const counts = {}
  for (const m of String(text).matchAll(/lavfi\.signalstats\.(YMIN|YMAX|YAVG|UAVG|VAVG)=([\d.]+)/g)) {
    const k = keys[m[1]]
    sums[k] = (sums[k] ?? 0) + Number(m[2])
    counts[k] = (counts[k] ?? 0) + 1
  }
  if (!counts.yavg) return null
  return Object.fromEntries(Object.keys(sums).map((k) => [k, sums[k] / counts[k]]))
}

/**
 * The slider values that fix what the measurements show: stretch the levels to the full range, brighten or darken to
 * mid-grey, cancel a colour cast, and lift dull colours a little. Plain rules; returns the values and why.
 */
function autoFix(s) {
  const why = []
  const out = { exposure: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0, blackPoint: 0, whitePoint: 1 }
  const black = clamp((s.ymin - 16) / 219, 0, 0.12)
  const white = clamp((s.ymax - 16) / 219, 0.85, 1)
  // A nearly flat picture (a title card, a black frame) has no range to stretch: leave its levels alone.
  if ((s.ymax - s.ymin) / 219 > 0.35 && (black > 0.02 || white < 0.97)) {
    out.blackPoint = round(black, 3)
    out.whitePoint = round(white, 3)
    why.push({ setting: 'levels', because: `the picture only uses ${Math.round(black * 100)}% to ${Math.round(white * 100)}% of the brightness range, so it looks flat` })
  }
  const mid = (s.yavg - 16) / 219
  if (mid < 0.32 || mid > 0.62) {
    out.exposure = round(clamp(Math.log2(0.45 / Math.max(0.05, mid)) * 0.6, -1, 1), 2)
    why.push({ setting: 'exposure', because: mid < 0.32 ? 'the picture is dark' : 'the picture is very bright' })
  }
  const du = (s.uavg - 128) / 128
  const dv = (s.vavg - 128) / 128
  if (Math.abs(du) > 0.025 || Math.abs(dv) > 0.025) {
    out.temperature = round(clamp(du * 3 - dv * 1.5, -0.6, 0.6), 2) // a blue cast needs warmer, a red cast cooler
    out.tint = round(clamp(-dv * 2, -0.5, 0.5), 2) // a magenta cast needs less magenta (positive tint is more magenta)
    why.push({ setting: 'colour cast', because: 'the average colour leans away from neutral' })
  }
  if (out.blackPoint > 0 || out.whitePoint < 1) out.contrast = 1.05
  return { values: out, why }
}

/* ------------------------------------------------------------------------------------ the filter chain */

const FIELDS = { exposure: [-2, 2, 0], contrast: [0.5, 1.6, 1], saturation: [0, 2, 1], temperature: [-1, 1, 0], tint: [-1, 1, 0], blackPoint: [0, 0.3, 0], whitePoint: [0.7, 1, 1] }

/** Slider values with missing ones at neutral and everything held inside its range. */
function normalizeValues(v = {}) {
  const out = {}
  for (const [k, [lo, hi, def]] of Object.entries(FIELDS)) {
    const n = v[k] == null ? def : Number(v[k])
    if (!Number.isFinite(n)) throw new Error(`${k} must be a number`)
    out[k] = clamp(n, lo, hi)
  }
  return out
}

const num = (n) => String(round(n, 4))

/**
 * The FFmpeg video filters for the slider values and an optional look (a LUT file path and 0..1 strength), applied in a
 * fixed order: levels, exposure, white balance, contrast and saturation, then the look. An empty list means "no change".
 */
function buildFilters(values, { lut = null, intensity = 1, tonemap = false } = {}) {
  const v = normalizeValues(values)
  const f = []
  if (tonemap) f.push('zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv', 'format=yuv420p')
  if (v.blackPoint > 0 || v.whitePoint < 1) f.push(`colorlevels=rimin=${num(v.blackPoint)}:gimin=${num(v.blackPoint)}:bimin=${num(v.blackPoint)}:rimax=${num(v.whitePoint)}:gimax=${num(v.whitePoint)}:bimax=${num(v.whitePoint)}`)
  if (v.exposure !== 0) {
    const gain = 2 ** v.exposure
    f.push(`lutrgb=r='clip(val*${num(gain)},0,maxval)':g='clip(val*${num(gain)},0,maxval)':b='clip(val*${num(gain)},0,maxval)'`)
  }
  if (v.temperature !== 0 || v.tint !== 0) {
    const t = v.temperature * 0.25
    const g = -v.tint * 0.2
    f.push(`colorbalance=rs=${num(t * 0.6)}:gs=${num(g * 0.6)}:bs=${num(-t * 0.6)}:rm=${num(t)}:gm=${num(g)}:bm=${num(-t)}:rh=${num(t * 0.6)}:gh=${num(g * 0.6)}:bh=${num(-t * 0.6)}`)
  }
  if (v.contrast !== 1 || v.saturation !== 1) f.push(`eq=contrast=${num(v.contrast)}:saturation=${num(v.saturation)}`)
  if (lut) {
    const file = `lut3d=file='${lut.replace(/\\/g, '/').replace(/'/g, "'\\''").replace(/:/g, '\\:')}':interp=tetrahedral`
    const k = clamp(intensity, 0, 1)
    if (k >= 0.999) f.push(file)
    else if (k > 0) f.push(`split[o][l];[l]${file}[g];[o][g]blend=all_expr='A*${num(1 - k)}+B*${num(k)}'`)
  }
  return f
}

/** The list as one -vf value. A filter that starts a labelled graph is joined with a comma to the chain before it. */
const joinFilters = (list) => list.join(',')

/* ----------------------------------------------------------------------------------------- colour matching */

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const XYZ_N = [0.95047, 1, 1.08883]
const labF = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
const labInv = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27))

/** sRGB (0..1) to CIE Lab. */
function rgbToLab([r, g, b]) {
  const [R, G, B] = [r, g, b].map(srgbToLinear)
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / XYZ_N[0]
  const y = (0.2126729 * R + 0.7151522 * G + 0.072175 * B) / XYZ_N[1]
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / XYZ_N[2]
  const [fx, fy, fz] = [x, y, z].map(labF)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function labToRgb([L, a, bb]) {
  const fy = (L + 16) / 116
  const [x, y, z] = [labInv(fy + a / 500) * XYZ_N[0], labInv(fy) * XYZ_N[1], labInv(fy - bb / 200) * XYZ_N[2]]
  const R = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z
  const G = -0.969266 * x + 1.8760108 * y + 0.041556 * z
  const B = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z
  return [R, G, B].map((c) => clamp(linearToSrgb(clamp(c, 0, 1)), 0, 1))
}

/** The mean and spread of Lab over RGB pixels (a flat array of r,g,b bytes). */
function labStats(rgb) {
  const n = Math.floor(rgb.length / 3)
  const mean = [0, 0, 0]
  const samples = []
  for (let i = 0; i < n; i++) {
    const lab = rgbToLab([rgb[i * 3] / 255, rgb[i * 3 + 1] / 255, rgb[i * 3 + 2] / 255])
    samples.push(lab)
    for (let k = 0; k < 3; k++) mean[k] += lab[k] / n
  }
  const sd = [0, 0, 0]
  for (const s of samples) for (let k = 0; k < 3; k++) sd[k] += ((s[k] - mean[k]) ** 2) / n
  return { mean, sd: sd.map((v) => Math.sqrt(v)) }
}

/** A colour function that moves the source's Lab mean and spread onto the reference's (Reinhard colour transfer). */
function transferFn(src, ref) {
  return (c) => {
    const lab = rgbToLab(c)
    const out = lab.map((v, k) => ((v - src.mean[k]) * (src.sd[k] > 1e-3 ? clamp(ref.sd[k] / src.sd[k], 0.4, 2.5) : 1)) + ref.mean[k])
    return labToRgb(out)
  }
}

function createGrade(ctx) {
  const { handleStart, assertAbsolutePath, defaultDownloadDir, uniqueOutputPath, addTask, broadcastTasks, runInPool, convertPool, updateTask, tasks, probeMedia, isCanceled, spawnTracked, platform } = ctx
  const lutDir = () => path.join(platform.paths.userData, 'luts')

  const capture = (args, { binary = false } = {}) =>
    new Promise((resolve, reject) => {
      const out = []
      const err = []
      const child = spawn('ffmpeg', ['-hide_banner', '-nostats', '-nostdin', ...args])
      child.stdout.on('data', (c) => out.push(c))
      child.stderr.on('data', (c) => err.push(c))
      child.on('error', reject)
      child.on('close', (code) => (code === 0 ? resolve(binary ? Buffer.concat(out) : Buffer.concat([...out, ...err]).toString()) : reject(new Error(Buffer.concat(err).toString().trim().split('\n').pop() || `ffmpeg exited with code ${code}`))))
    })

  /** The files of the built-in looks, made on first use. */
  function lookFile(id) {
    if (!Object.hasOwn(LOOKS, id)) throw new Error('Unknown look')
    const file = path.join(lutDir(), `${id}.cube`)
    if (!fs.existsSync(file)) {
      fs.mkdirSync(lutDir(), { recursive: true })
      fs.writeFileSync(file, cubeText(LOOKS[id].fn, 17, LOOKS[id].label))
    }
    return file
  }

  /** The looks to offer: the built-in ones, then the person's own imported LUTs. */
  function listLooks() {
    const own = fs.existsSync(lutDir()) ? fs.readdirSync(lutDir()).filter((n) => n.startsWith('user-') && n.endsWith('.cube')) : []
    return [...Object.entries(LOOKS).map(([id, l]) => ({ id, label: l.label })), ...own.map((n) => ({ id: n.replace(/\.cube$/, ''), label: n.slice(5, -5), own: true }))]
  }

  /** Copies a .cube file into the app's own folder after checking it. Returns the look id. */
  function importLut(file) {
    assertAbsolutePath(file, 'file')
    const st = fs.statSync(file)
    if (!st.isFile() || st.size > 8 * 1024 * 1024) throw new Error('A LUT file is a text file of a few MB at most')
    const text = fs.readFileSync(file, 'utf8')
    validateCube(text)
    const name = path.basename(file, path.extname(file)).replace(/[^\w .-]+/g, '_').slice(0, 40) || 'look'
    fs.mkdirSync(lutDir(), { recursive: true })
    fs.writeFileSync(path.join(lutDir(), `user-${name}.cube`), text)
    return `user-${name}`
  }

  function resolveLut(id) {
    if (!id) return null
    if (Object.hasOwn(LOOKS, id)) return lookFile(id)
    if (/^user-[\w .-]+$/.test(id) && fs.existsSync(path.join(lutDir(), `${id}.cube`))) return path.join(lutDir(), `${id}.cube`)
    if (/^match-[0-9a-f]{16}$/.test(id) && fs.existsSync(path.join(lutDir(), `${id}.cube`))) return path.join(lutDir(), `${id}.cube`)
    throw new Error('Unknown look')
  }

  /** Measures a video (or image): brightness and colour numbers from a few seconds of sampled frames. */
  async function measure(inputPath) {
    const text = await capture(['-i', inputPath, '-vf', 'fps=1,signalstats,metadata=print:file=-', '-frames:v', '24', '-an', '-f', 'null', '-'])
    const s = parseStats(text)
    if (!s) throw new Error("Couldn't measure this file")
    return s
  }

  /** The automatic fix for a file: slider values and the reasons. */
  async function autoGrade(inputPath) {
    assertAbsolutePath(inputPath, 'inputPath')
    return autoFix(await measure(inputPath))
  }

  /** Raw 64x64 RGB pixels of up to 8 frames of a video or image, as one buffer. */
  const samplePixels = (input) => capture(['-i', input, '-vf', 'fps=1,scale=64:64:flags=area', '-frames:v', '8', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { binary: true })

  /** A LUT that gives `inputPath` the colours of `referencePath` (a picture or a video). Returns the look id. */
  async function matchLook(inputPath, referencePath) {
    assertAbsolutePath(inputPath, 'inputPath')
    assertAbsolutePath(referencePath, 'referencePath')
    const [a, b] = await Promise.all([samplePixels(inputPath), samplePixels(referencePath)])
    if (a.length < 64 * 64 * 3 || b.length < 64 * 64 * 3) throw new Error("Couldn't read the picture")
    const id = `match-${crypto.createHash('sha256').update(a).update(b).digest('hex').slice(0, 16)}`
    fs.mkdirSync(lutDir(), { recursive: true })
    fs.writeFileSync(path.join(lutDir(), `${id}.cube`), cubeText(transferFn(labStats(a), labStats(b)), 33, 'Match'))
    return id
  }

  /** One frame before and after the grade, for the preview slider. */
  async function previewGrade(req) {
    assertAbsolutePath(req.inputPath, 'inputPath')
    const info = await probeMedia(req.inputPath)
    if (!info?.hasVideo) throw new Error("Couldn't read a picture in this file.")
    const t = clamp(Number(req.time ?? info.duration * 0.3), 0, Math.max(0, info.duration - 0.2))
    const width = clamp(Number(req.width) || 640, 160, 1280)
    const filters = buildFilters(req.values, { lut: resolveLut(req.look), intensity: req.intensity ?? 1 })
    const frame = async (list) => {
      const vf = joinFilters([...list, `scale=${width}:-2`])
      const buf = await capture(['-ss', String(t), '-i', req.inputPath, '-vf', vf, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '5', '-'], { binary: true }).catch(() => null)
      return buf?.length ? `data:image/jpeg;base64,${buf.toString('base64')}` : null
    }
    const [before, after] = await Promise.all([frame([]), frame(filters)])
    return { before, after }
  }

  handleStart('tasks:startGrade', async (_e, req) => {
    assertAbsolutePath(req.inputPath, 'inputPath')
    if (req.destination != null) assertAbsolutePath(req.destination, 'destination')
    // The sliders may come nested (`values`, from the card) or flat (from MCP and the terminal app).
    const flat = Object.fromEntries(Object.keys(FIELDS).filter((k) => req[k] != null).map((k) => [k, req[k]]))
    const given = { ...flat, ...(req.values ?? {}) }
    const values = req.auto === true ? { ...normalizeValues(), ...(await autoGrade(req.inputPath)).values, ...given } : normalizeValues(given)
    const lut = resolveLut(req.look)
    const intensity = clamp(Number(req.intensity ?? 1), 0, 1)
    const filters = buildFilters(values, { lut, intensity })
    if (filters.length === 0 && !req.hdr) throw new Error('Nothing to change: move a slider, pick a look or use Auto')
    const id = crypto.randomUUID()
    const destDir = req.destination || defaultDownloadDir()
    fs.mkdirSync(destDir, { recursive: true })
    const outputPath = uniqueOutputPath(destDir, `${path.basename(req.inputPath, path.extname(req.inputPath))}-graded`, 'mp4')
    addTask(id, {
      state: { id, kind: 'grade', status: 'queued', progress: 0, label: path.basename(req.inputPath), format: 'Colour grade', quality: req.look ? (LOOKS[req.look]?.label ?? 'Custom look') : req.auto ? 'Auto fix' : 'Manual', sizeBytes: null, sizeIsEstimate: false, thumbnailUrl: null, experimentalMatch: null },
      child: null,
      finalPath: outputPath,
    })
    broadcastTasks()
    runInPool(convertPool, id, () => gradeJob(id, req.inputPath, values, lut, intensity, outputPath)).catch((err) => updateTask(id, { status: 'error', error: `Grading failed to start: ${err.message}` }))
    return id
  })

  /** Is the video HDR (PQ or HLG)? Those are tone-mapped to SDR first, so the looks (made for SDR) land right. */
  async function isHdr(inputPath) {
    const text = await new Promise((resolve) => {
      let out = ''
      const child = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_transfer', '-of', 'csv=p=0', inputPath])
      child.stdout.on('data', (c) => (out += c))
      child.on('error', () => resolve(''))
      child.on('close', () => resolve(out))
    })
    return /smpte2084|arib-std-b67/.test(text)
  }

  async function gradeJob(id, inputPath, values, lut, intensity, outputPath) {
    const entry = tasks.get(id)
    updateTask(id, { status: 'running' })
    try {
      const info = await probeMedia(inputPath)
      if (isCanceled(id)) return
      if (!info?.hasVideo) return updateTask(id, { status: 'error', error: "Couldn't read a video in this file." })
      const hdr = await isHdr(inputPath)
      const filters = buildFilters(values, { lut, intensity, tonemap: hdr })
      await spawnTracked('ffmpeg', ['-y', '-i', inputPath, '-vf', joinFilters(filters), '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-map', '0:v:0', '-map', '0:a?', '-sn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', outputPath], entry, {
        onStdout: (text) => {
          const m = [...text.matchAll(/out_time_ms=(\d+)/g)].pop()
          if (m) updateTask(id, { progress: Math.min(0.99, Number(m[1]) / 1e6 / info.duration) })
        },
      })
      updateTask(id, { status: 'done', progress: 1, label: path.basename(outputPath), sizeBytes: fs.statSync(outputPath).size, ...(hdr ? { quality: 'HDR tone-mapped to SDR' } : {}) })
    } catch (err) {
      fs.rmSync(outputPath, { force: true })
      if (!isCanceled(id)) updateTask(id, { status: 'error', error: `Grading failed: ${err.message}` })
    }
  }

  return { measure, autoGrade, matchLook, previewGrade, listLooks, importLut, resolveLut, gradeJob }
}

module.exports = { createGrade, LOOKS, cubeText, validateCube, parseStats, autoFix, buildFilters, normalizeValues, rgbToLab, labToRgb, labStats, transferFn, FIELDS }
