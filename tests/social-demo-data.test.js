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

test('ranking demo data is enabled only inside WeChat DevTools', () => {
  const devtools = loadWithPlatform('devtools')
  try { assert.equal(devtools.demo.isRankingEnabled(), true) } finally { devtools.restore() }

  const phone = loadWithPlatform('ios')
  try { assert.equal(phone.demo.isRankingEnabled(), false) } finally { phone.restore() }
})

test('social demo is restricted to top 10 ranking and an out-of-list self rank', () => {
  const loaded = loadWithPlatform('devtools')
  try {
    const ranking = loaded.demo.getRanking('week')
    assert.equal(loaded.demo.getFriends, undefined)
    assert.equal(loaded.demo.getFeed, undefined)
    assert.equal(ranking.top10.length, 10)
    assert.equal(ranking.myRank.rank > 10, true)
  } finally { loaded.restore() }
})

test('friend hub uses real feed and friends while keeping only simulator ranking read-only', () => {
  const wxml = require('node:fs').readFileSync(path.resolve(__dirname, '../components/friend-hub/friend-hub.wxml'), 'utf8')
  const js = require('node:fs').readFileSync(path.resolve(__dirname, '../components/friend-hub/friend-hub.js'), 'utf8')
  assert.match(wxml, /activeSection === 'ranking' && rankingDemoMode/)
  assert.match(wxml, /开发者工具排行榜演示数据 · 仅用于查看界面效果/)
  assert.match(js, /rankingDemoMode: socialDemoData\.isRankingEnabled\(\)/)
  assert.doesNotMatch(js, /socialDemoData\.getFriends|socialDemoData\.getFeed/)
  assert.match(js, /socialService\.listFriends/)
  assert.match(js, /socialService\.listFeed/)
  assert.match(js, /rankingReadOnly: true/)
})
