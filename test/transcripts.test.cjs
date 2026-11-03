const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const T = require('../electron/core/ai/transcripts.cjs')
const V = require('../electron/core/ai/video.cjs')

const SRT = '1\n00:00:01,000 --> 00:00:03,500\nHello there, welcome to the show\n\n2\n00:00:04,000 --> 00:00:06,000\n<i>Today:</i> pineapple pizza\n\n3\n00:01:02.500 --> 00:01:05.000\nÅsa visits Östersund\n'
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tr-'))

test('subtitle files become segments: srt and vtt clocks, tags stripped, broken blocks skipped', () => {
  const s = T.parseSubtitles(SRT)
  assert.deepEqual(s.map((x) => [x.start, x.end]), [[1, 3.5], [4, 6], [62.5, 65]])
  assert.equal(s[1].text, 'Today: pineapple pizza')
  assert.deepEqual(T.parseSubtitles('WEBVTT\n\n00:01.000 --> 00:02.000 align:start\nHi\n\nnonsense\n\n01:00:00.000 --> 01:00:01.000\nLate').map((x) => [x.start, x.text]), [[1, 'Hi'], [3600, 'Late']])
  assert.equal(T.parseClock('1:02:03,5'), 3723.5)
  assert.equal(T.parseClock('nope'), null)
})

test('search: words anywhere, prefixes, accents, several words together, and nothing dangerous reaches the query', () => {
  const dir = tmp()
  const video = path.join(dir, 'show.mp4')
  fs.writeFileSync(video, 'x')
  const t = T.createTranscripts({ dir: path.join(dir, 't') })
  t.add(video, T.parseSubtitles(SRT))
  assert.equal(t.search('PINEAPPLE')[0].start, 4)
  assert.equal(t.search('welc')[0].text, 'Hello there, welcome to the show')
  assert.equal(t.search('asa ostersund').length, 1, 'accents do not matter')
  assert.equal(t.search('pineapple welcome').length, 0, 'every word has to match one line')
  assert.deepEqual(t.search('"; DROP TABLE seg; --'), [])
  assert.deepEqual(t.search('   '), [])
  assert.deepEqual(t.search('NEAR(a b) OR *'), [])
  assert.equal(t.list()[0].segments, 3)
  assert.equal(t.get(video).title, 'show.mp4')
  assert.equal(t.search('hello', { videoPath: path.join(dir, 'other.mp4') }).length, 0)
  fs.rmSync(video)
  assert.deepEqual(t.search('pineapple'), [], 'a video that is gone is not listed')
  t.close()
})

test('re-indexing replaces, removing deletes, and an empty transcript is refused', () => {
  const dir = tmp()
  const video = path.join(dir, 'a.mp4')
  fs.writeFileSync(video, 'x')
  const t = T.createTranscripts({ dir: path.join(dir, 't') })
  t.add(video, [{ start: 0, end: 1, text: 'first version' }])
  t.add(video, [{ start: 0, end: 1, text: 'second version' }])
  assert.equal(t.search('first').length, 0)
  assert.equal(t.search('second').length, 1)
  t.remove(video)
  assert.equal(t.search('second').length, 0)
  assert.equal(t.has(video), false)
  assert.throws(() => t.add(video, []), /no speech/)
  assert.throws(() => t.add('relative.mp4', [{ start: 0, end: 1, text: 'x' }]), /absolute/)
  t.close()
})

test('chunks never split a segment and keep every segment', () => {
  const segs = Array.from({ length: 40 }, (_, i) => ({ start: i, end: i + 1, text: 'word '.repeat(30).trim() }))
  const chunks = V.chunkSegments(segs, 1000)
  assert.ok(chunks.length > 3)
  assert.equal(chunks.flat().length, 40)
  assert.ok(chunks.every((c) => c.reduce((n, s) => n + s.text.length + 8, 0) <= 1000 + 200))
  assert.equal(V.clock(75), '1:15')
  assert.equal(V.clock(3725), '1:02:05')
})

/** A model that answers by rule: `reply(messages, opts)` returns the text. */
const fakeAi = (reply, log = []) => ({ async *chat(o) { log.push(o); yield { type: 'text', delta: reply(o.messages, o) } } })

test('summary of a short transcript is one call; a long one is summarised in parts and then combined', async () => {
  const short = { segments: [{ start: 0, end: 5, text: 'We make pizza' }], duration: 5 }
  const log = []
  const r = await V.summarize(fakeAi(() => '{"summary":"A pizza video.","points":["Pizza"]}', log), short)
  assert.deepEqual([r.summary, r.points, log.length], ['A pizza video.', ['Pizza'], 1])
  const long = { segments: Array.from({ length: 200 }, (_, i) => ({ start: i * 5, end: i * 5 + 5, text: `Sentence number ${i} about topic ${Math.floor(i / 50)} and some more words to fill the line` })), duration: 1000 }
  const calls = []
  const progress = []
  const out = await V.summarize(fakeAi((m, o) => (o.jsonSchema ? '{"summary":"Four topics.","points":["a","b"]}' : 'part summary'), calls), long, { onProgress: (d, t) => progress.push([d, t]) })
  assert.equal(out.summary, 'Four topics.')
  assert.ok(calls.length >= 4 && calls.filter((c) => c.jsonSchema).length === 1, 'many part calls, one final call')
  assert.equal(calls[calls.length - 1].messages[1].content.startsWith('Part 1 (from 0:00): part summary'), true)
  assert.deepEqual(progress[progress.length - 1], [progress[0][1], progress[0][1]])
  await assert.rejects(V.summarize(fakeAi(() => 'not json'), short), /usable answer/)
})

test('chapters are tidied: sorted, first at 0:00, spaced, trimmed; metadata and the YouTube list come out right', async () => {
  const messy = [{ start: 300, title: '  The   end ' }, { start: 20, title: 'Intro' }, { start: 25, title: 'Too close' }, { start: 100, title: '' }, { start: 900, title: 'After the video' }]
  const ch = V.tidyChapters(messy, 600)
  assert.deepEqual(ch, [{ start: 0, title: 'Intro' }, { start: 300, title: 'The end' }, { start: 600, title: 'After the video' }])
  const meta = V.chaptersMetadata([{ start: 0, title: 'A=b;c' }, { start: 61.5, title: 'Two' }], 120)
  assert.match(meta, /^;FFMETADATA1\n\[CHAPTER\]\nTIMEBASE=1\/1000\nSTART=0\nEND=61500\ntitle=A b c\n\[CHAPTER\]\nTIMEBASE=1\/1000\nSTART=61500\nEND=120000\ntitle=Two\n$/)
  assert.equal(V.chaptersList([{ start: 0, title: 'Intro' }, { start: 3725, title: 'Late' }]), '0:00 Intro\n1:02:05 Late')
  const segs = Array.from({ length: 12 }, (_, i) => ({ start: i * 60, end: i * 60 + 59, text: `topic ${i}` }))
  const got = await V.proposeChapters(fakeAi((m) => '{"chapters":[{"start":0,"title":"Start"},{"start":' + (/\[(\d+:\d+) = (\d+)s\]/.exec(m[1].content) ? 120 : 0) + ',"title":"Middle"}]}'), { segments: segs, duration: 720 })
  assert.deepEqual(got.map((c) => c.title), ['Start', 'Middle'])
  await assert.rejects(V.proposeChapters(fakeAi(() => '{"chapters":[]}'), { segments: segs, duration: 720 }), /No chapters/)
})

test('asking a video: a short transcript goes in whole, a long one only the passages that match, and the model is told to cite times', async () => {
  const log = []
  const segs = Array.from({ length: 400 }, (_, i) => ({ start: i * 3, end: i * 3 + 3, text: i === 200 ? 'the secret ingredient is basil' : `filler line number ${i} with plenty of padding words here` }))
  const t = { segments: segs, duration: 1200 }
  const store = T.createTranscripts({ dir: tmp() })
  const video = path.join(tmp(), 'v.mp4')
  fs.writeFileSync(video, 'x')
  store.add(video, segs)
  let answer = ''
  for await (const ev of V.ask(fakeAi(() => 'It is basil [10:00].', log), t, 'what is the secret ingredient', (q) => store.search(q, { videoPath: video, any: true, limit: 12 }))) if (ev.type === 'text') answer += ev.delta
  assert.equal(answer, 'It is basil [10:00].')
  const sys = log[0].messages[0].content
  assert.match(sys, /only the passages most related/)
  assert.match(sys, /\[10:00\] the secret ingredient is basil/)
  assert.ok(sys.length < 8000, `the long transcript was cut down (${sys.length})`)
  assert.match(sys, /square brackets/)
  const small = { segments: [{ start: 5, end: 8, text: 'only line' }], duration: 8 }
  log.length = 0
  for await (const _ of V.ask(fakeAi(() => 'x', log), small, 'q')) void _
  assert.doesNotMatch(log[0].messages[0].content, /only the passages/)
  assert.match(log[0].messages[0].content, /\[0:05\] only line/)
  store.close()
})

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
test('chapters are written into a copy of the file without re-encoding, and other formats are refused', { skip: !hasFfmpeg }, async () => {
  const dir = tmp()
  const video = path.join(dir, 'talk.mp4')
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=10:size=160x120:rate=10', '-f', 'lavfi', '-i', 'sine=duration=10', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', video])
  const unique = (d, base, ext) => path.join(d, `${base}.${ext}`)
  const out = await V.writeChapters(video, [{ start: 0, title: 'Intro' }, { start: 4, title: 'Main part' }], 10, dir, unique)
  assert.match(out, /talk-chapters\.mp4$/)
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', out], { encoding: 'utf8' })
  const chapters = JSON.parse(probe.stdout).chapters
  assert.deepEqual(chapters.map((c) => c.tags.title), ['Intro', 'Main part'])
  assert.ok(Math.abs(Number(chapters[1].start_time) - 4) < 0.01)
  await assert.rejects(V.writeChapters(path.join(dir, 'x.avi'), [{ start: 0, title: 'a' }], 5, dir, unique), /not \.avi/)
})
