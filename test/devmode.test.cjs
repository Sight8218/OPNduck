const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createDevGate } = require('../electron/core/ai/devmode.cjs')

test('the developer login: right login unlocks, wrong ones do not, five wrong tries lock it for a minute, locking works', () => {
  let t = 1000
  const g = createDevGate({ now: () => t })
  assert.equal(g.isOn(), false)
  assert.equal(g.addendum(), '')
  assert.equal(g.unlock('ducky', 'wrong').ok, false)
  assert.equal(g.unlock('Ducky', '8218').ok, false, 'case matters')
  assert.equal(g.isOn(), false)
  for (let i = 0; i < 3; i++) g.unlock('x', 'y')
  const locked = g.unlock('ducky', '8218')
  assert.deepEqual([locked.ok, locked.wait > 0], [false, true], 'even the right login waits after five wrong tries')
  t += 61_000
  assert.equal(g.unlock('ducky', '8218').ok, true)
  assert.equal(g.isOn(), true)
  assert.match(g.addendum(), /DEVELOPER MODE/)
  g.lock()
  assert.deepEqual([g.isOn(), g.addendum()], [false, ''])
})

test('the login is not written in the source, only a salted hash', () => {
  const src = fs.readFileSync(path.join(__dirname, '../electron/core/ai/devmode.cjs'), 'utf8')
  assert.ok(!src.includes('8218') && !/['"]ducky['"]/.test(src))
})
