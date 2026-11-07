const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHelp, tokens, sectionsOf, looksLikeQuestion } = require('../electron/core/ai/help.cjs')
const { createAi } = require('../electron/core/ai/index.cjs')

const help = createHelp()
const top = (q) => help.search(q)[0]

test('sections are cut at "##" headings and keep the text under them', () => {
  const s = sectionsOf('x.md', '# Doc\nintro\n## One\nalpha\nbeta\n## Two\ngamma\n')
  assert.deepEqual(s.map((x) => [x.title, x.text, x.doc]), [['One', 'alpha\nbeta', 'Doc'], ['Two', 'gamma', 'Doc']])
})

test('tokens: snake_case names also count as their parts, plurals fold, small words are dropped', () => {
  assert.deepEqual(tokens('How do plugins use make_gif?'), ['plugin', 'use', 'make_gif', 'make', 'gif'])
})

test('questions go to the docs, commands go to the tools', () => {
  for (const q of ['Can I download from Spotify', 'how do I trim a video', 'Kan jag ladda ner låtar?', 'Is safe mode on by default?']) assert.ok(looksLikeQuestion(q), q)
  for (const q of ['convert a.mp4 to mkv', 'Fix the metadata on this MP3', 'make this under 25 MB']) assert.ok(!looksLikeQuestion(q), q)
  assert.equal(help.promptBlock('convert a.mp4 to mkv'), '')
})

test('the right section comes first for questions people really ask', () => {
  assert.match(top('Can I download songs from Spotify with OPNduck?').title, /Spotify/)
  assert.match(top('Is plugins safe mode on by default?').title, /safe mode/i)
  assert.match(top('What happens if the connection is silent for too long?').title, /relay/i)
  assert.match(top('Can I start heavy jobs only when I am away?').title, /scheduling/i)
  assert.match(top('What does beat_cut do?').title, /Beat cutting/)
})

test('nothing matches an unrelated question, so no notes are added', () => {
  assert.deepEqual(help.search('What is the best pizza topping?'), [])
  assert.equal(help.promptBlock('What is the best pizza topping?'), '')
})

test('the notes are short and say what to do when they do not answer', () => {
  const block = help.promptBlock('Can I download songs from Spotify with OPNduck?')
  assert.match(block, /^Notes from OPNduck's own help/)
  assert.match(block, /DRM-protected/)
  assert.match(block, /not sure instead of guessing/)
  assert.ok(block.length < 2300, `${block.length} characters`)
})

test('a missing doc just means fewer sections', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'help-'))
  const filler = Array.from({ length: 40 }, (_, i) => `## Filler ${i}\nSomething about thing${i} and other${i}.\n`).join('\n')
  fs.writeFileSync(path.join(dir, 'a.md'), `# A\n## Teapots\nTeapots hold tea and nothing else.\n${filler}`) // scores depend on how many sections there are
  const h = createHelp({ root: dir, files: ['a.md', 'gone.md'] })
  assert.equal(h.search('what do teapots hold')[0]?.title, 'Teapots')
})

test('the assistant adds the notes to the system prompt for a question, and not for a command', async () => {
  const seen = []
  const http = require('node:http')
  const srv = http.createServer((req, res) => {
    const c = []
    req.on('data', (d) => c.push(d))
    req.on('end', () => {
      seen.push(JSON.parse(Buffer.concat(c).toString()))
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`)
    })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  try {
    const ai = createAi({ getSettings: () => ({ ai: { provider: 'machine', model: 'm', machineUrl: `http://127.0.0.1:${srv.address().port}/v1`, effort: 'medium', reasoning: 'auto', vision: false, temperature: 0.7, keepChats: true } }), keys: { get: () => null }, help })
    const deps = { tasks: new Map(), isKnownFile: () => false }
    await ai.agent({ messages: [{ role: 'user', content: 'Can I download songs from Spotify with OPNduck?' }], deps, system: 'You are the duck.' })
    await ai.agent({ messages: [{ role: 'user', content: 'convert a.mp4 to mkv' }], deps, system: 'You are the duck.' })
    assert.match(seen[0].messages[0].content, /^You are the duck\.\n\nNotes from OPNduck's own help/)
    assert.match(seen[0].messages[0].content, /YouTube match/)
    assert.equal(seen[1].messages[0].content, 'You are the duck.')
  } finally {
    srv.close()
  }
})
