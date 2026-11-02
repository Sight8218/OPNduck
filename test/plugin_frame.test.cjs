const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const F = require('../electron/core/plugin_frame.cjs')

const dist = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'opnduck-frame-'))
  fs.mkdirSync(path.join(d, 'assets'))
  fs.writeFileSync(path.join(d, 'index.html'), '<link rel="stylesheet" crossorigin href="./assets/index-ab12.css">')
  fs.writeFileSync(path.join(d, 'assets', 'index-ab12.css'), 'body{}')
  fs.writeFileSync(path.join(d, 'assets', 'font.woff2'), 'f')
  fs.writeFileSync(path.join(d, 'assets', 'app.js'), 'secret()')
  return d
}

test('the card page cannot connect out, navigate forms, or load remote scripts', () => {
  assert.match(F.FRAME_CSP, /connect-src 'none'/)
  assert.match(F.FRAME_CSP, /default-src 'none'/)
  assert.match(F.FRAME_CSP, /script-src opnduck-plugin:(;|$)/)
  assert.doesNotMatch(F.FRAME_CSP, /https?:/)
})

test('the app stylesheet name is read from the built index.html', () => {
  assert.equal(F.appCssName(dist()), 'index-ab12.css')
  assert.equal(F.appCssName('/nonexistent'), '')
})

test('frameHtml links only a well-formed stylesheet name', () => {
  assert.match(F.frameHtml('index-ab12.css'), /href="__app\/index-ab12\.css"/)
  assert.doesNotMatch(F.frameHtml('x"><script>1</script>'), /<script>1/)
  assert.doesNotMatch(F.frameHtml(''), /stylesheet/)
  assert.match(F.frameHtml(''), /src="__frame\.js"/)
})

test('appAsset serves css and fonts from dist/assets and nothing else', () => {
  const d = dist()
  assert.equal(F.appAsset(d, 'index-ab12.css').type, 'text/css')
  assert.equal(F.appAsset(d, 'font.woff2').type, 'font/woff2')
  for (const bad of ['app.js', '../index.html', '..%2Findex.html', '.hidden.css', 'a/b.css', '', 'missing.css']) {
    assert.throws(() => F.appAsset(d, bad), undefined, bad)
  }
})
