const assert = require('node:assert/strict')

const storage = {}
global.wx = {
  getStorageSync(key) {
    return storage[key]
  },
  setStorageSync(key, value) {
    storage[key] = value
  }
}

const avatarCache = require('../utils/player-avatar-cache')

avatarCache.__test.clearAvatarCacheForTest()

assert.equal(
  avatarCache.getAvatarDisplayUrl('cloud://avatar-a', 'cloud://avatar-a'),
  'cloud://avatar-a',
  'uncached avatar should fall back to the cloud fileID'
)

avatarCache.rememberAvatarDisplay('cloud://avatar-a', 'wxfile://local-avatar-a')
assert.equal(
  avatarCache.getAvatarDisplayUrl('cloud://avatar-a', 'cloud://avatar-a'),
  'wxfile://local-avatar-a',
  'cached avatar display should prefer the local display path'
)

assert.equal(
  avatarCache.getAvatarDisplayUrl('', 'cloud://fallback-only'),
  'cloud://fallback-only',
  'missing fileID should keep the formal avatar url fallback'
)

console.log('player notes avatar cache tests passed')
