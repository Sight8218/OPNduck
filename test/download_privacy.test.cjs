// End-to-end privacy test: the real download engine and real yt-dlp against a password-protected page that embeds media on
// another origin. A login typed into a link must not appear in any process's argv/environment, the task state or log, the
// console, history.json or any other file, and the other origin must never receive it.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { spawnSync } = require('node:child_process')
const hasTools = spawnSync('yt-dlp', ['--version']).status === 0 && spawnSync('ffmpeg', ['-version']).status === 0
test('a login in a link stays private: argv, environment, logs, history, files and other origins', { skip: !hasTools && 'needs yt-dlp and ffmpeg', timeout: 180_000 }, async () => {
const PW = 'Zq7xPassWord9'
const root = path.join(__dirname, '..') + path.sep
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'))
spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=5', '-t', '1', '-pix_fmt', 'yuv420p', path.join(dir, 't.mp4')])
const mp4 = fs.readFileSync(path.join(dir, 't.mp4'))
const seen = []
const other = http.createServer((req, res) => { seen.push(['other', req.url, req.headers.authorization, req.headers.referer]); res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': mp4.length }); res.end(req.method === 'HEAD' ? undefined : mp4) })
let redirectTo
const page = http.createServer((req, res) => {
  seen.push(['page', req.url, req.headers.authorization ? 'present' : undefined])
  if (req.headers.authorization !== 'Basic ' + Buffer.from('bob:' + PW).toString('base64')) { res.writeHead(401, { 'www-authenticate': 'Basic realm=x' }); return res.end() }
  if (req.url === '/file.mp4') { res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': mp4.length }); return res.end(req.method === 'HEAD' ? undefined : mp4) }
  if (req.url === '/redir') { res.writeHead(302, { location: `http://127.0.0.1:${other.address().port}/o.mp4` }); return res.end() }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<html><head><title>t</title></head><body><video src="http://127.0.0.1:${other.address().port}/o.mp4"></video></body></html>`)
})
const leaks = []
for (const st of ['stdout','stderr']) { const w = process[st].write.bind(process[st]); process[st].write = (d, ...a) => { if (String(d).includes('Zq7x') || String(d).includes('WrongPw')) leaks.push('console ' + st); return w(d, ...a) } }
const sample = () => { // every process: argv and environment
  for (const pid of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    for (const f of ['cmdline', 'environ']) { try { const t = fs.readFileSync(`/proc/${pid}/${f}`, 'latin1'); if (t.includes(PW) || t.includes('Ym9iOl')) leaks.push(`process ${pid} ${f}`) } catch {} }
  }
}
  {

  await new Promise((r) => other.listen(0, '127.0.0.1', r)); await new Promise((r) => page.listen(0, '127.0.0.1', r))
  const { createCore } = require(root + 'electron/core/index.cjs')
  const { createNodePlatform } = require(root + 'electron/core/platform.cjs')
  const platform = createNodePlatform({ version: 'test' })
  platform.paths = { userData: path.join(dir, 'app'), downloads: path.join(dir, 'dl'), documents: dir }
  const c = createCore({ platform, safeMode: true })
  const timer = setInterval(sample, 25)
  const results = {}
  for (const [name, urlPath, user] of [['web page (refused)', '/page', 'bob'], ['direct file', '/file.mp4', 'bob'], ['redirect to other origin', '/redir', 'bob'], ['wrong password (error path)', '/page', 'bob']]) {
    const pw = name.startsWith('wrong') ? 'WrongPw' + PW : PW
    const url = `http://${user}:${pw}@127.0.0.1:${page.address().port}${urlPath}`
    const id = await c.startJob('tasks:start', { url, format: 'MP4', destination: path.join(dir, 'dl') })
    let st
    for (let i = 0; i < 600; i++) { st = c.engine.tasks.get(id).state; if (['done', 'error', 'canceled'].includes(st.status)) break; await new Promise((r) => setTimeout(r, 100)) }
    results[name] = st.status
    const entry = c.engine.tasks.get(id)
    const blob = JSON.stringify({ state: st, log: entry.log?.lines ? [...entry.log.lines] : null })
    if (blob.includes(PW) || blob.includes('WrongPw')) { leaks.push(`task state/log (${name})`); for (const k of Object.keys(st)) if (JSON.stringify(st[k]).includes(PW)||JSON.stringify(st[k]).includes('WrongPw')) leaks.push(`  state.${k}`); (entry.log?.lines ? [...entry.log.lines] : []).filter((l)=>String(l).includes(PW)||String(l).includes('WrongPw')).slice(0,2).forEach((l)=>leaks.push('  log: '+String(l).slice(0,160))) }
    if (name === 'web page (refused)') { results.label = st.label; results.error = st.error; assert.match(String(st.error), /only works for a direct file link/) }
  }
  clearInterval(timer)
  other.close(); page.close()
  c.engine.saveHistory()
  // everything the app wrote anywhere, plus leftover temp folders
  const scan = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) scan(p); else { try { const t = fs.readFileSync(p, 'latin1'); if (t.includes(PW) || t.includes('WrongPw')) leaks.push('file ' + p.replace(dir, '<dir>')) } catch {} } } }
  scan(dir)
  const leftover = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('opnduck-auth-'))
  assert.deepEqual(Object.values(results).filter((v)=>['done','error'].includes(v)), ['error','done','done','error'])
  assert.ok(seen.some((s) => s[0] === 'other'), 'the other origin was contacted')
  assert.deepEqual(seen.filter((s) => s[0] === 'other' && s[2]), [], 'the other origin received the login')
  assert.deepEqual(seen.filter((s) => s[0] === 'other' && s[3]), [], 'the other origin received a Referer carrying the login')
  assert.equal(leftover.length, 0, 'private config folders are removed')
  assert.deepEqual([...new Set(leaks)], [], 'the login leaked')
  }
})
