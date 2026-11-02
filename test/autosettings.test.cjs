const test = require('node:test')
const assert = require('node:assert/strict')
const A = require('../electron/core/analyze.cjs')
const { suggest } = require('../electron/core/autosettings.cjs')
const { buildStartRequest, TOOLS } = require('../electron/mcp_tools.cjs')

const facts = (o = {}) => ({ width: 1280, height: 720, fps: 30, vfr: false, codec: 'h264', bitrate: 4e6, duration: 300, hdr: false, interlaced: false, crop: null, loudness: -20, hasAudio: true, animation: false, isImage: false, ...o })
const by = (r, s) => r.reasons.find((x) => x.setting === s)

test('parseIdet reads the last summary that has frames and returns the interlaced share', () => {
  const empty = '[Parsed_idet_0 @ 0x1] Multi frame detection: TFF:     0 BFF:     0 Progressive:     0 Undetermined:     0'
  const real = '[Parsed_idet_0 @ 0x2] Multi frame detection: TFF:    20 BFF:     0 Progressive:    10 Undetermined:     0'
  assert.equal(A.parseIdet(`${empty}\n${real}`), 20 / 30)
  assert.equal(A.parseIdet(empty), null)
  assert.equal(A.parseIdet('nothing'), null)
})

test('parseCropdetect, parseEbur128 and parseRate', () => {
  assert.deepEqual(A.parseCropdetect('x crop=1920:800:0:140\n y crop=1920:816:0:132'), { w: 1920, h: 816, x: 0, y: 132 })
  assert.equal(A.parseCropdetect('no crop here'), null)
  assert.equal(A.parseEbur128('Integrated loudness:\n    I:         -14.2 LUFS\n'), -14.2)
  assert.equal(A.parseEbur128('Integrated loudness:\n    I:         -70.0 LUFS'), null, 'silence')
  assert.equal(A.parseRate('30000/1001').toFixed(2), '29.97')
  assert.equal(A.parseRate('0/0'), null)
})

test('classifyAnimation: a flat few-colour frame is animation, noise is not', () => {
  const w = 160
  const h = 90
  const flat = Buffer.alloc(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    const c = i % w < 80 ? [200, 40, 40] : [30, 30, 180]
    flat.set(c, i * 3)
  }
  const noisy = Buffer.alloc(w * h * 3)
  let seed = 1
  for (let i = 0; i < noisy.length; i++) noisy[i] = ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 8) & 255
  assert.equal(A.classifyAnimation([flat]), true)
  assert.equal(A.classifyAnimation([noisy]), false)
  assert.equal(A.classifyAnimation([]), null)
})

test('video upscaler: HD source gets 2x with the 2x model; small source gets 4x; animation gets the anime model at 4x', () => {
  const hd = suggest('upscale_video', facts({ width: 1920, height: 1080 }))
  assert.deepEqual([hd.settings.scale, hd.settings.model], [2, 'realesr-animevideov3'])
  assert.match(by(hd, 'scale').because, /1920×1080/)
  const sd = suggest('upscale_video', facts({ width: 640, height: 360 }))
  assert.deepEqual([sd.settings.scale, sd.settings.model], [4, 'realesr-animevideov3'])
  const anime = suggest('upscale_video', facts({ width: 640, height: 360, animation: true }))
  assert.deepEqual([anime.settings.scale, anime.settings.model], [4, 'realesrgan-x4plus-anime'])
})

test('every upscaler suggestion is a valid model and scale pair', () => {
  const x4only = ['realesrgan-x4plus', 'realesrgan-x4plus-anime']
  for (const tool of ['upscale_image', 'upscale_video']) {
    for (const height of [240, 480, 720, 1080, 2160, 4000]) {
      for (const animation of [true, false]) {
        const { settings } = suggest(tool, facts({ width: Math.round(height * 1.78), height, animation }))
        assert.ok([2, 3, 4].includes(settings.scale), `${tool} ${height}`)
        if (x4only.includes(settings.model)) assert.equal(settings.scale, 4, `${tool} ${height} ${animation}`)
      }
    }
  }
})

test('image upscaler: photos and art get their model; big images get a gentle 2x', () => {
  assert.equal(suggest('upscale_image', facts({ width: 800, height: 600 })).settings.model, 'realesrgan-x4plus')
  assert.equal(suggest('upscale_image', facts({ width: 800, height: 600, animation: true })).settings.model, 'realesrgan-x4plus-anime')
  const big = suggest('upscale_image', facts({ width: 3000, height: 2000 }))
  assert.deepEqual([big.settings.scale, big.settings.model], [2, 'realesr-animevideov3'])
})

test('interpolation: 24/30 fps doubles, choppy gets 4x, 60 fps warns, VFR and animation add warnings', () => {
  assert.equal(suggest('interpolate', facts({ fps: 24 })).settings.multiplier, 2)
  assert.equal(suggest('interpolate', facts({ fps: 12 })).settings.multiplier, 4)
  const smooth = suggest('interpolate', facts({ fps: 60 }))
  assert.ok(smooth.notes.some((n) => n.level === 'warn' && /smooth/.test(n.text)))
  assert.ok(suggest('interpolate', facts({ vfr: true })).notes.some((n) => /varies/.test(n.text)))
  assert.ok(suggest('interpolate', facts({ animation: true })).notes.some((n) => /smear/.test(n.text)))
})

test('convert: remux when the codec fits the container and the picture needs no fixing', () => {
  assert.equal(suggest('convert', facts({ codec: 'h264' }), { container: 'MKV' }).settings.mode, 'remux')
  assert.equal(suggest('convert', facts({ codec: 'h264' }), { container: 'WEBM' }).settings.mode, 'transcode')
  assert.equal(suggest('convert', facts({ codec: 'h264', interlaced: true }), { container: 'MP4' }).settings.mode, 'transcode')
  assert.equal(suggest('convert', facts({ codec: 'hevc', hdr: true }), { container: 'MP4' }).settings.mode, 'transcode')
  assert.deepEqual(suggest('convert', facts(), {}).settings, {})
})

test('compress and subtitles rules', () => {
  assert.equal(suggest('compress', facts({ animation: true })).settings.quality, 'best')
  assert.equal(suggest('compress', facts()).settings.quality, 'fast')
  assert.equal(suggest('subtitles', facts({ duration: 7200 })).settings.model, 'base')
  assert.equal(suggest('subtitles', facts({ loudness: -40 })).settings.model, 'small')
  assert.equal(suggest('subtitles', facts()).settings.language, 'auto')
  assert.ok(suggest('subtitles', facts({ hasAudio: false })).notes.some((n) => /no audio/.test(n.text)))
})

test('shared notes: HDR, interlacing and black bars are reported for any tool; unknown tools throw', () => {
  const r = suggest('upscale_video', facts({ hdr: true, interlaced: true, crop: { w: 1920, h: 800, x: 0, y: 140 } }))
  assert.equal(r.notes.length, 3)
  assert.throws(() => suggest('nope', facts()), /No automatic settings/)
})

test('every reason is data with a setting, a value and a sentence', () => {
  for (const tool of ['upscale_image', 'upscale_video', 'interpolate', 'compress', 'subtitles']) {
    for (const r of suggest(tool, facts({ animation: true })).reasons) {
      assert.ok(typeof r.setting === 'string' && r.value !== undefined && r.because.length > 10, tool)
    }
  }
})

test('the MCP tool suggest_settings is read-only (no channel) and validates its arguments', () => {
  const def = TOOLS.find((t) => t.name === 'suggest_settings')
  assert.ok(def && !def.channel)
  assert.ok(def.inputSchema.properties.tool.enum.includes('upscale_video'))
  assert.throws(() => buildStartRequest('suggest_settings', { tool: 'convert', inputPath: '/x/a.mp4' }))
})
