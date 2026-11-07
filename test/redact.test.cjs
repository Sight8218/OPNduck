const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { stripLinkLogin, stripLinkLoginDeep } = require('../electron/core/redact.cjs')

test('a login inside a link is removed from text, other text is untouched', () => {
  assert.equal(stripLinkLogin('[generic] Extracting URL: http://bob:s3cret@host:8080/p?x=1#f'), '[generic] Extracting URL: http://host:8080/p?x=1#f')
  assert.equal(stripLinkLogin('see https://a@b.com and ftp://u:p@h/x'), 'see https://b.com and ftp://h/x')
  assert.equal(stripLinkLogin('mail me at bob@example.com, https://example.com/a'), 'mail me at bob@example.com, https://example.com/a')
  assert.equal(stripLinkLogin(undefined), undefined)
})

test('deep strip covers every string of a saved task and request', () => {
  const row = { state: { label: 'x', error: 'bad https://u:p@h/' }, req: { url: 'http://bob:s3cret@h/v', list: ['http://a:b@c/'] } }
  const out = JSON.stringify(stripLinkLoginDeep(row))
  assert.ok(!/s3cret|u:p|a:b/.test(out))
  assert.equal(stripLinkLoginDeep(row).req.url, 'http://h/v')
})

test('history.json never holds a login, but the task in memory keeps it for this session', () => {
  const { createTaskEngine } = require('../electron/core/tasks.cjs')
  const { createNodePlatform } = require('../electron/core/platform.cjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-hist-'))
  const platform = createNodePlatform({ version: 'test' })
  platform.paths = { userData: dir, downloads: dir, documents: dir }
  const engine = createTaskEngine({ platform, getSettings: () => ({}), onFinished() {} })
  const req = { url: 'http://bob:s3cret@h/v', format: 'MP4' }
  engine.tasks.set('a', { state: { id: 'a', kind: 'download', status: 'done', label: 'v', error: null }, channel: 'tasks:start', req, finalPath: null })
  engine.saveHistory()
  const saved = fs.readFileSync(path.join(dir, 'history.json'), 'utf8')
  assert.ok(!saved.includes('s3cret') && saved.includes('http://h/v'))
  assert.equal(engine.tasks.get('a').req.url, 'http://bob:s3cret@h/v')
  fs.rmSync(dir, { recursive: true, force: true })
})
