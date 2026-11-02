const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'manifest.json'), 'utf8'))

test('the manifest asks for only what it needs, with a strict page policy', () => {
  assert.equal(manifest.manifest_version, 3)
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'contextMenus', 'storage'])
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*', 'https://ntfy.sh/*'])
  assert.ok(!JSON.stringify(manifest).includes('<all_urls>'))
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/)
  assert.ok(manifest.browser_specific_settings.gecko.id.includes('@'))
})

test('every file the manifest and pages point at exists', () => {
  const root = path.join(__dirname, '..', 'extension')
  for (const f of ['background.js', 'popup.html', 'popup.js', 'options.html', 'options.js', 'lib/envelope.mjs', manifest.icons['48'], manifest.icons['128'], manifest.options_ui.page, manifest.action.default_popup]) {
    assert.ok(fs.existsSync(path.join(root, f)), f)
  }
})

test('the Chrome and Firefox manifests differ only where the browsers need them to', async () => {
  const { manifestFor, zip } = await import('../scripts/build-extension.mjs')
  const chrome = manifestFor(manifest, 'chrome')
  const firefox = manifestFor(manifest, 'firefox')
  assert.ok(chrome.background.service_worker && !chrome.background.scripts && !chrome.browser_specific_settings)
  assert.ok(firefox.background.scripts && !firefox.background.service_worker && firefox.browser_specific_settings.gecko.id)
  assert.equal(chrome.name, firefox.name)
  assert.ok(manifest.background.service_worker && manifest.background.scripts, 'the source manifest is not modified')
  void zip
})

test('the zip writer makes a valid archive that reads back byte for byte', async () => {
  const { zip } = await import('../scripts/build-extension.mjs')
  const entries = [{ name: 'a.txt', data: Buffer.from('hello') }, { name: 'dir/b.bin', data: Buffer.alloc(5000, 7) }, { name: 'ü.txt', data: Buffer.from('') }]
  const buf = zip(entries)
  // read the central directory by hand
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  assert.equal(buf.readUInt16LE(end + 10), 3)
  let p = buf.readUInt32LE(end + 16)
  const seen = []
  for (let i = 0; i < 3; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50)
    const nameLen = buf.readUInt16LE(p + 28)
    const crc = buf.readUInt32LE(p + 16)
    const csize = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const off = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    const lhNameLen = buf.readUInt16LE(off + 26)
    const data = zlib.inflateRawSync(buf.subarray(off + 30 + lhNameLen, off + 30 + lhNameLen + csize))
    assert.equal(data.length, size)
    assert.equal(zlib.crc32(data), crc)
    seen.push([name, data])
    p += 46 + nameLen
  }
  assert.deepEqual(seen.map((x) => x[0]), entries.map((e) => e.name))
  assert.ok(seen[1][1].equals(entries[1].data))
})

test('build() writes both archives into dist-extension', async () => {
  const { build } = await import('../scripts/build-extension.mjs')
  const files = build()
  assert.equal(files.length, 2)
  for (const f of files) assert.ok(fs.statSync(f).size > 1000, f)
  void os
})
