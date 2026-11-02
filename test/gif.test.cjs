const test = require('node:test')
const assert = require('node:assert/strict')
const G = require('../electron/core/gif.cjs')
const { buildStartRequest } = require('../electron/mcp_tools.cjs')

const clip = { start: 5, length: 2.5 }

test('planClip: defaults to the preset limit, refuses a clip that is too long or out of range', () => {
  assert.deepEqual(G.planClip({ preset: 'telegram', start: 5, end: null, duration: 60 }), { start: 5, length: 3 })
  assert.deepEqual(G.planClip({ preset: 'gif', start: 0, end: 4, duration: 60 }), { start: 0, length: 4 })
  assert.deepEqual(G.planClip({ preset: 'gif', start: 55, end: null, duration: 60 }), { start: 55, length: 5 }, 'stops at the end of the file')
  assert.throws(() => G.planClip({ preset: 'telegram', start: 0, end: 10, duration: 60 }), /at most 3 seconds/)
  assert.throws(() => G.planClip({ preset: 'gif', start: 70, end: null, duration: 60 }), /past the end/)
  assert.throws(() => G.planClip({ preset: 'gif', start: 5, end: 3, duration: 60 }), /after the start/)
  assert.throws(() => G.planClip({ preset: 'gif', start: -1, end: null, duration: 60 }), /Invalid start/)
})

test('attemptsFor: GIF/WebP try once; stickers step down fps, then size, then quality', () => {
  assert.deepEqual(G.attemptsFor('gif', { width: 640, fps: 20 }), [{ width: 640, fps: 20, quality: 0 }])
  const t = G.attemptsFor('telegram', {})
  assert.equal(t.length, 4)
  assert.deepEqual(t[0], { width: 512, fps: 30, quality: 0 })
  assert.ok(t[1].fps < 30 && t[1].width === 512)
  assert.ok(t[2].width < 512 && t[2].quality === 1)
  assert.ok(t[3].width < t[2].width && t[3].quality === 2 && t[3].fps <= 15)
  assert.ok(t.every((a) => a.width % 2 === 0))
  assert.equal(G.attemptsFor('discord', {})[0].width, 320)
})

test('gifArgs: GIF uses one palettegen/paletteuse pass and loops forever by default', () => {
  const a = G.gifArgs({ input: 'in.mp4', output: 'o.gif', preset: 'gif', clip, attempt: { width: 480, fps: 15, quality: 0 } })
  const s = a.join(' ')
  assert.ok(s.includes('-ss 5 -t 2.5 -i in.mp4') && s.includes('-an'))
  assert.ok(s.includes('fps=15,scale=480:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a'))
  assert.equal(a[a.indexOf('-loop') + 1], '0')
  const noLoop = G.gifArgs({ input: 'i', output: 'o.gif', preset: 'gif', clip, attempt: { width: 480, fps: 15, quality: 0 }, loop: false })
  assert.equal(noLoop[noLoop.indexOf('-loop') + 1], '-1')
  assert.ok(G.gifArgs({ input: 'i', output: 'o.gif', preset: 'gif', clip, attempt: { width: 480, fps: 15, quality: 2 } }).join(' ').includes('max_colors=64'))
})

test('gifArgs: WebP, Telegram and Discord use their codecs, no audio, and the right size boxes', () => {
  const webp = G.gifArgs({ input: 'i', output: 'o.webp', preset: 'webp', clip, attempt: { width: 480, fps: 15, quality: 0 } })
  assert.ok(webp.includes('libwebp_anim') && webp.includes('75'))
  const tg = G.gifArgs({ input: 'i', output: 'o.webm', preset: 'telegram', clip, attempt: { width: 512, fps: 30, quality: 0 } })
  assert.ok(tg.includes('libvpx-vp9') && tg.includes('yuva420p') && tg.includes('-an'))
  assert.ok(tg.join(' ').includes('scale=512:512:force_original_aspect_ratio=decrease'))
  const dc = G.gifArgs({ input: 'i', output: 'o.png', preset: 'discord', clip, attempt: { width: 320, fps: 15, quality: 0 } })
  assert.ok(dc.includes('apng') && dc.includes('-plays') && dc.join(' ').includes('scale=320:320'))
  for (const a of [webp, tg, dc]) assert.equal(a[a.length - 1].startsWith('o.'), true)
})

test('the MCP tool make_gif validates its arguments and fills defaults', () => {
  const ok = buildStartRequest('make_gif', { inputPath: '/x/a.mp4' })
  assert.equal(ok.channel, 'tasks:startGif')
  assert.deepEqual([ok.req.preset, ok.req.start, ok.req.end, ok.req.loop], ['gif', 0, null, true])
  assert.throws(() => buildStartRequest('make_gif', { inputPath: '/x/a.mp4', preset: 'mp4' }))
  assert.throws(() => buildStartRequest('make_gif', { inputPath: '/x/a.mp4', width: 10 }))
  assert.throws(() => buildStartRequest('make_gif', { inputPath: '/x/a.mp4', destination: '/tmp' }))
})
