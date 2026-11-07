const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { protectUrlCredentials } = require('../electron/core/download.cjs')

test('a link without credentials goes on the command line as before', () => {
  const a = protectUrlCredentials('https://example.com/v?x=1')
  assert.deepEqual(a.tail, ['--', 'https://example.com/v?x=1'])
  assert.deepEqual(a.args, [])
})

test('credentials never reach the argument list; the link sits in a private config file', () => {
  const a = protectUrlCredentials('https://bob:p%40ss@example.com/v#frag')
  try {
    assert.deepEqual(a.tail, [])
    assert.equal(a.args[0], '--config-locations')
    assert.ok(![...a.args, ...a.tail, a.url].join(' ').includes('p%40ss') && !a.url.includes('bob'))
    assert.equal(a.url, 'https://example.com/v#frag')
    const file = a.args[1]
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    assert.equal(fs.readFileSync(file, 'utf8'), '"https://bob:p%40ss@example.com/v#frag"\n') // quoted: '#' must not start a comment
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /Authorization/i) // no global header: it would go to every origin
  } finally {
    a.cleanup()
  }
  assert.ok(!fs.existsSync(a.args[1]))
})

// Real yt-dlp: the login is sent to the link's own origin and NOT to media the page hosts elsewhere.
const ytdlp = spawnSync('yt-dlp', ['--version'])
test('yt-dlp sends the login to its own origin only', { skip: ytdlp.status !== 0 && 'yt-dlp not installed' }, async () => {
  const ff = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=5', '-t', '1', '-pix_fmt', 'yuv420p', path.join(os.tmpdir(), 'opnduck-cred-test.mp4')])
  if (ff.status !== 0) return // no ffmpeg: nothing to serve
  const mp4 = fs.readFileSync(path.join(os.tmpdir(), 'opnduck-cred-test.mp4'))
  const seen = []
  const other = http.createServer((req, res) => {
    seen.push({ who: 'other', auth: req.headers.authorization })
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': mp4.length })
    res.end(req.method === 'HEAD' ? undefined : mp4)
  })
  await new Promise((r) => other.listen(0, '127.0.0.1', r))
  const page = http.createServer((req, res) => {
    seen.push({ who: 'page', auth: req.headers.authorization })
    if (req.headers.authorization !== 'Basic ' + Buffer.from('bob:s3cret').toString('base64')) return res.writeHead(401, { 'www-authenticate': 'Basic realm=x' }).end()
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<html><head><title>t</title></head><body><video src="http://127.0.0.1:${other.address().port}/o.mp4"></video></body></html>`)
  })
  await new Promise((r) => page.listen(0, '127.0.0.1', r))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-cred-out-'))
  const a = protectUrlCredentials(`http://bob:s3cret@127.0.0.1:${page.address().port}/page`)
  try {
    // Async on purpose: the test servers live in this process, so a blocking spawn would starve them.
    const r = await new Promise((resolve) => {
      const c = spawn('yt-dlp', ['--ignore-config', ...a.args, '--no-playlist', '-q', '--no-warnings', '-o', path.join(dir, 'o.%(ext)s'), ...a.tail])
      let err = ''
      c.stderr.on('data', (d) => (err += d))
      const t = setTimeout(() => c.kill(), 60_000)
      c.on('close', (status) => (clearTimeout(t), resolve({ status, stderr: err })))
    })
    assert.equal(r.status, 0, r.stderr)
    assert.ok(seen.some((s) => s.who === 'page' && s.auth), 'the page origin received the login')
    assert.ok(seen.some((s) => s.who === 'other'), 'the other origin was contacted')
    assert.ok(seen.filter((s) => s.who === 'other').every((s) => !s.auth), 'the other origin never received the login')
  } finally {
    a.cleanup()
    page.close()
    other.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
