const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const modulePath = path.resolve(__dirname, '../utils/social-demo-data.js')

function loadWithPlatform(platform) {
  const previousWx = global.wx
  global.wx = { getSystemInfoSync: () => ({ platform }) }
  delete require.cache[modulePath]
  const demo = require(modulePath)
  return {
    demo,
    restore() {
      delete require.cache[modulePath]
      global.wx = previousWx
    }
  }
}

test('social demo data is enabled only inside WeChat DevTools', () => {
  const devtools = loadWithPlatform('devtools')
  try { assert.equal(devtools.demo.isEnabled(), true) } finally { devtools.restore() }

  const phone = loadWithPlatform('ios')
  try { assert.equal(phone.demo.isEnabled(), false) } finally { phone.restore() }
})

test('social demo covers friends, three feed scopes, top 10 and an out-of-list self rank', () => {
  const loaded = loadWithPlatform('devtools')
  try {
    const friends = loaded.demo.getFriends()
    const feed = loaded.demo.getFeed()
    const ranking = loaded.demo.getRanking('week')
    assert.ok(friends.length >= 6)
    assert.equal(friends.every(item => item.note.type && item.note.note && item.note.leakTags.length), true)
    assert.deepEqual(feed.map(item => item.scope), ['square', 'friends', 'selected'])
    assert.equal(feed.every(item => item.summary.potBb >= 0 && item.summary.effectiveStackBb >= 0), true)
    assert.equal(ranking.top10.length, 10)
    assert.equal(ranking.myRank.rank > 10, true)
  } finally { loaded.restore() }
})

test('friend hub labels simulator fixtures and makes the demo surface read-only', () => {
  const wxml = require('node:fs').readFileSync(path.resolve(__dirname, '../components/friend-hub/friend-hub.wxml'), 'utf8')
  const js = require('node:fs').readFileSync(path.resolve(__dirname, '../components/friend-hub/friend-hub.js'), 'utf8')
  assert.match(wxml, /开发者工具演示数据 · 仅用于查看界面效果/)
  assert.match(js, /demoMode: socialDemoData\.isEnabled\(\)/)
  assert.match(js, /friendsReadOnly: true/)
  assert.match(js, /feedReadOnly: true/)
  assert.match(js, /rankingReadOnly: true/)
})
