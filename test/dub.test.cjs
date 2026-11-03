const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const D = require('../electron/core/dub.cjs')

const h = { assertAbsolutePath: (p, n) => { if (!path.isAbsolute(String(p))) throw new Error(`${n} abs`) }, assertOneOf: (v, l, n) => { if (!l.includes(v)) throw new Error(`${n} bad`) } }

test('requests are validated: target language, placement, model, source code', () => {
  assert.equal(D.validate({ inputPath: '/a.mp4', target: 'sv' }, h).placement, 'track')
  assert.throws(() => D.validate({ inputPath: '/a.mp4', target: 'klingon' }, h), /target bad/)
  assert.throws(() => D.validate({ inputPath: 'a.mp4', target: 'sv' }, h), /inputPath abs/)
  assert.throws(() => D.validate({ inputPath: '/a.mp4', target: 'sv', placement: 'mix' }, h), /placement bad/)
  assert.throws(() => D.validate({ inputPath: '/a.mp4', target: 'sv', whisperModel: 'huge' }, h), /whisperModel bad/)
  assert.throws(() => D.validate({ inputPath: '/a.mp4', target: 'sv', source: 'en; rm' }, h), /source/)
  assert.throws(() => D.validate({ inputPath: '/a.mp4', target: 'sv', keepOriginal: 'yes' }, h), /keepOriginal/)
})

test('the mux keeps the picture untouched and puts the dub first, or alone', () => {
  const base = { input: '/i.mp4', audio: '/d.wav', output: '/o.mp4', language: 'sv' }
  const track = D.muxArgs({ ...base, placement: 'track' })
  assert.deepEqual(track.slice(track.indexOf('-map'), track.indexOf('-map') + 6), ['-map', '0:v', '-map', '1:a', '-map', '0:a'])
  assert.ok(track.includes('copy') && track[track.indexOf('-c:v') + 1] === 'copy')
  const only = D.muxArgs({ ...base, placement: 'replace' })
  assert.ok(!only.includes('0:a'), 'the original audio is dropped')
  assert.ok(track.includes('language=swe'))
})

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const venv = path.join(process.env.OPNDUCK_VENV || path.join(os.homedir(), '.opnduck-venv'), 'bin', 'python')
const hasDub = hasFfmpeg && fs.existsSync(venv) && spawnSync(venv, ['-c', 'import faster_whisper, argostranslate, piper, demucs']).status === 0 && spawnSync('espeak-ng', ['--version']).status === 0 && process.env.OPNDUCK_SLOW_TESTS === '1'

test('a real dub: English speech becomes a Swedish audio track beside the original (slow, needs downloads)', { skip: !hasDub }, async () => {
  const { createCore } = require('../electron/core/index.cjs')
  const { createNodePlatform } = require('../electron/core/platform.cjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dub-'))
  const platform = createNodePlatform({ version: 'test' })
  platform.paths = { userData: path.join(dir, 'app'), downloads: path.join(dir, 'dl'), documents: dir }
  const c = createCore({ platform, safeMode: true })
  const wav = path.join(dir, 's.wav')
  spawnSync('espeak-ng', ['-w', wav, 'Hello. Today we are cooking a simple soup with potatoes and carrots.'])
  const v = path.join(dir, 'v.mp4')
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:r=10', '-i', wav, '-shortest', '-c:v', 'libx264', '-c:a', 'aac', v])
  c.noteFile(v)
  const id = await c.startJob('tasks:startDub', { inputPath: v, target: 'sv', destination: dir })
  let s
  for (let i = 0; i < 3000; i++) { s = c.engine.tasks.get(id).state; if (['done', 'error'].includes(s.status)) break; await new Promise((r) => setTimeout(r, 500)) }
  assert.equal(s.status, 'done', s.error)
  const out = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream_tags=language', '-of', 'csv=p=0', c.engine.tasks.get(id).finalPath], { encoding: 'utf8' }).stdout
  assert.match(out, /swe/)
  c.shutdown()
})
