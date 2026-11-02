const test = require('node:test')
const assert = require('node:assert/strict')
const C = require('../electron/core/compress.cjs')
const { buildStartRequest } = require('../electron/mcp_tools.cjs')

const MB = 1024 * 1024

test('planBitrates fills the target with a 3% margin and 96 kb/s audio', () => {
  const p = C.planBitrates({ durationSec: 60, targetBytes: 10 * MB, hasAudio: true })
  assert.equal(p.audioKbps, 96)
  const bits = (p.videoKbps + p.audioKbps) * 1000 * 60
  assert.ok(bits / 8 < 10 * MB && bits / 8 > 10 * MB * 0.95, `planned ${bits / 8} bytes`)
})

test('planBitrates drops audio to 64 kb/s when the video budget is small', () => {
  const p = C.planBitrates({ durationSec: 300, targetBytes: 10 * MB, hasAudio: true })
  assert.equal(p.audioKbps, 64)
  assert.ok(p.videoKbps > 0)
  assert.equal(C.planBitrates({ durationSec: 60, targetBytes: 10 * MB, hasAudio: false }).audioKbps, 0)
})

test('planBitrates refuses an impossible target and reports the smallest reachable size', () => {
  const p = C.planBitrates({ durationSec: 7200, targetBytes: 8 * MB, hasAudio: true })
  assert.ok(p.error)
  assert.ok(p.minBytes > 8 * MB)
  const again = C.planBitrates({ durationSec: 7200, targetBytes: p.minBytes, hasAudio: true })
  assert.equal(again.error, undefined, 'the reported minimum is reachable')
  assert.ok(C.planBitrates({ durationSec: 0, targetBytes: MB, hasAudio: true }).error)
})

test('planBitrates handles audio-only input (MP3 bitrate from the target, capped at 320)', () => {
  const p = C.planBitrates({ durationSec: 180, targetBytes: 3 * MB, hasAudio: true, hasVideo: false })
  assert.equal(p.videoKbps, 0)
  assert.ok(p.audioKbps > 100 && p.audioKbps <= 320)
  assert.equal(C.planBitrates({ durationSec: 10, targetBytes: 500 * MB, hasAudio: true, hasVideo: false }).audioKbps, 320)
  assert.ok(C.planBitrates({ durationSec: 36000, targetBytes: MB, hasAudio: true, hasVideo: false }).error)
})

test('pickResolution keeps the source when the bitrate is plentiful and steps down when it is not', () => {
  const rich = C.pickResolution({ width: 1920, height: 1080, fps: 30, videoKbps: 20000 })
  assert.deepEqual([rich.height, rich.scaled, rich.fpsCapped], [1080, false, false])
  const mid = C.pickResolution({ width: 1920, height: 1080, fps: 30, videoKbps: 2500 })
  assert.equal(mid.height, 720)
  const low = C.pickResolution({ width: 1920, height: 1080, fps: 30, videoKbps: 1000 })
  assert.equal(low.height, 480)
  assert.equal(low.width % 2, 0)
  assert.ok(low.scaled)
})

test('pickResolution never upscales, and caps 60 fps to 30 only when needed', () => {
  assert.equal(C.pickResolution({ width: 640, height: 360, fps: 24, videoKbps: 3000 }).height, 360)
  assert.equal(C.pickResolution({ width: 1280, height: 720, fps: 60, videoKbps: 6000 }).fpsCapped, false)
  // Steps down in size first (480p60 is still sharp enough here); only caps fps when even that is too thin.
  assert.deepEqual(C.pickResolution({ width: 1280, height: 720, fps: 60, videoKbps: 2200 }).height, 480)
  const capped = C.pickResolution({ width: 1280, height: 720, fps: 60, videoKbps: 400 })
  assert.deepEqual([capped.height, capped.fpsCapped, capped.fps], [360, true, 30])
  assert.match(capped.label, /30 fps/)
})

test('pickResolution falls back to the smallest size when nothing reaches the quality floor', () => {
  const r = C.pickResolution({ width: 1920, height: 1080, fps: 30, videoKbps: 100 })
  assert.equal(r.height, 360)
})

const plan = { videoKbps: 1000, audioKbps: 96 }
const res = { width: 854, height: 480, fps: 30, scaled: true, fpsCapped: false }

test('x264 passes: pass 1 has no audio and writes nothing; pass 2 has audio and the output', () => {
  const p1 = C.x264Args({ input: 'in.mp4', output: 'out.mp4', plan, res, pass: 1, passlog: '/t/p' })
  assert.deepEqual(p1.slice(p1.indexOf('-pass'), p1.indexOf('-pass') + 4), ['-pass', '1', '-passlogfile', '/t/p'])
  assert.ok(p1.includes('-an') && p1.includes('-f') && !p1.includes('out.mp4'))
  assert.ok(p1.join(' ').includes('scale=854:480'))
  const p2 = C.x264Args({ input: 'in.mp4', output: 'out.mp4', plan, res, pass: 2, passlog: '/t/p' })
  assert.equal(p2[p2.length - 1], 'out.mp4')
  assert.ok(p2.includes('aac') && p2.includes('96k') && p2.includes('2'))
  assert.equal(p2[p2.indexOf('-b:v') + 1], '1000k')
  assert.equal(C.x264Args({ input: 'i', output: 'o', plan, res, pass: 2, passlog: 'x', scale: 0.92 }).includes('920k'), true)
})

test('NVENC args use vbr with a max rate and no -pass flag', () => {
  const a = C.nvencArgs({ input: 'in.mp4', output: 'out.mp4', plan, res })
  assert.ok(a.includes('h264_nvenc') && a.includes('-multipass') && a.includes('fullres'))
  assert.equal(a[a.indexOf('-maxrate') + 1], '1250k')
  assert.equal(a.includes('-pass'), false)
})

test('a source-size, no-audio video has no scale filter and no audio', () => {
  const a = C.x264Args({ input: 'i', output: 'o', plan: { videoKbps: 900, audioKbps: 0 }, res: { width: 640, height: 360, fps: 24, scaled: false, fpsCapped: false }, pass: 2, passlog: 'x' })
  assert.equal(a.includes('-vf'), false)
  assert.equal(a.includes('-an'), true)
})

test('audio-only args make an MP3 at the planned bitrate', () => {
  const a = C.audioOnlyArgs({ input: 'in.wav', output: 'out.mp3', plan: { audioKbps: 128 } })
  assert.ok(a.includes('-vn') && a.includes('libmp3lame'))
  assert.equal(a[a.indexOf('-b:a') + 1], '128k')
})

test('the MCP tool validates targetMB and quality', () => {
  const ok = buildStartRequest('compress', { inputPath: '/x/a.mp4', targetMB: 10 })
  assert.equal(ok.channel, 'tasks:startCompress')
  assert.deepEqual([ok.req.targetMB, ok.req.quality], [10, 'fast'])
  assert.throws(() => buildStartRequest('compress', { inputPath: '/x/a.mp4' }), /targetMB/)
  assert.throws(() => buildStartRequest('compress', { inputPath: '/x/a.mp4', targetMB: 0.1 }))
  assert.throws(() => buildStartRequest('compress', { inputPath: '/x/a.mp4', targetMB: 5, quality: 'x' }))
  assert.throws(() => buildStartRequest('compress', { inputPath: '/x/a.mp4', targetMB: 5, destination: '/tmp' }))
})
