const test = require('node:test')
const assert = require('node:assert/strict')

test('social avatars keep a stable local display path across expiring remote URLs', async () => {
  const storage = {}
  let downloads = 0
  global.wx = {
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) { storage[key] = value },
    downloadFile({ url, success }) {
      downloads += 1
      success({ tempFilePath: `wxfile://temp-${downloads}-${encodeURIComponent(url)}` })
    },
    saveFile({ success }) {
      success({ savedFilePath: 'wxfile://saved-social-avatar' })
    }
  }

  delete require.cache[require.resolve('../utils/player-avatar-cache')]
  const avatarCache = require('../utils/player-avatar-cache')
  avatarCache.__test.clearAvatarCacheForTest()

  const cacheKey = avatarCache.socialAvatarKey('user-1')
  assert.equal(avatarCache.getAvatarDisplayUrl(cacheKey, 'https://cdn.example/old'), 'https://cdn.example/old')
  await avatarCache.warmRemoteAvatar(cacheKey, 'https://cdn.example/old')
  assert.equal(avatarCache.getAvatarDisplayUrl(cacheKey, 'https://cdn.example/new'), 'wxfile://saved-social-avatar')
  assert.equal(downloads, 1)
})

test('friend hub renders cached display URLs for friends, feed and ranking avatars', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const root = path.join(__dirname, '..')
  const js = fs.readFileSync(path.join(root, 'components/friend-hub/friend-hub.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(root, 'components/friend-hub/friend-hub.wxml'), 'utf8')

  assert.match(js, /player-avatar-cache/)
  assert.match(js, /warmRemoteAvatar/)
  assert.match(wxml, /item\.avatarDisplayUrl \|\| item\.avatarUrl/)
  assert.match(wxml, /item\.publisher\.avatarDisplayUrl \|\| item\.publisher\.avatarUrl/)
  assert.match(wxml, /rankingMyRank\.avatarDisplayUrl \|\| rankingMyRank\.avatarUrl/)
})
