const test = require('node:test')
const assert = require('node:assert/strict')
const { pickSmallThumbnail } = require('../electron/core/download.cjs')

test('picks the smallest thumbnail that is at least 160 px wide', () => {
  const t = [
    { url: 'https://i/maxres.jpg', width: 1280, height: 720 },
    { url: 'https://i/hq.jpg', width: 480, height: 360 },
    { url: 'https://i/mq.jpg', width: 320, height: 180 },
    { url: 'https://i/default.jpg', width: 120, height: 90 },
    { url: 'https://i/nodims.jpg' },
  ]
  assert.equal(pickSmallThumbnail(t), 'https://i/mq.jpg')
})
test('all thumbnails smaller than 160 px: takes the biggest of them', () => {
  assert.equal(pickSmallThumbnail([{ url: 'https://i/a.jpg', width: 90 }, { url: 'https://i/b.jpg', width: 120 }]), 'https://i/b.jpg')
})
test('no usable sizes, or a non-http url: falls back', () => {
  assert.equal(pickSmallThumbnail([{ url: 'https://i/x.jpg' }], 'https://i/fallback.jpg'), 'https://i/fallback.jpg')
  assert.equal(pickSmallThumbnail([{ url: 'javascript:alert(1)', width: 200 }], null), null)
  assert.equal(pickSmallThumbnail(undefined, 'f'), 'f')
})
