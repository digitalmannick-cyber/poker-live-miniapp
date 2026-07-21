const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

test('feed routes detail, comments and replay through explicit direct targets', () => {
  const hubWxml = fs.readFileSync(path.join(root, 'components/friend-hub/friend-hub.wxml'), 'utf8')
  const hubJs = fs.readFileSync(path.join(root, 'components/friend-hub/friend-hub.js'), 'utf8')
  assert.match(hubWxml, /data-target="comments"[^>]+catchtap="openHand"/)
  assert.match(hubJs, /target:\s*'replay'/)
  assert.match(hubJs, /triggerEvent\('openhand',\s*\{\s*shareId,\s*target\s*\}\)/)
})

test('detail is prefetched before navigation and the blocking loading card is removed', () => {
  const playerJs = fs.readFileSync(path.join(root, 'pages/player-notes/player-notes.js'), 'utf8')
  const detailJs = fs.readFileSync(path.join(root, 'pages/social-hand-detail/social-hand-detail.js'), 'utf8')
  const detailWxml = fs.readFileSync(path.join(root, 'pages/social-hand-detail/social-hand-detail.wxml'), 'utf8')
  assert.match(playerJs, /socialHandPrefetch\.prefetch[\s\S]*socialService\.getHandShare[\s\S]*wx\.navigateTo/)
  assert.match(detailJs, /socialHandPrefetch\.consume\(shareId\)/)
  assert.match(detailJs, /section\)\s*===\s*'comments'/)
  assert.doesNotMatch(detailWxml, /class="state-card loading-state"/)
  assert.doesNotMatch(detailWxml, /正在读取分享/)
})

test('prefetched hand detail is consumed once', async () => {
  const prefetch = require('../utils/social-hand-prefetch')
  prefetch.__test.clearForTest()
  const detail = { shareId: 'share-1' }
  await prefetch.prefetch('share-1', async () => detail)
  assert.equal(prefetch.consume('share-1'), detail)
  assert.equal(prefetch.consume('share-1'), null)
})
