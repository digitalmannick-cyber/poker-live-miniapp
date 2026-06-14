const test = require('node:test')
const assert = require('node:assert/strict')

const store = require('../utils/store')

const STORAGE_KEY = 'pokerLiveMiniappStore'

test('store caches normalized data after the first storage read', () => {
  const storage = {}
  let reads = 0
  let writes = 0

  global.wx = {
    getStorageSync(key) {
      reads += 1
      return storage[key]
    },
    setStorageSync(key, value) {
      writes += 1
      storage[key] = value
    }
  }

  store.__test.resetCachedStoreForTest()
  storage[STORAGE_KEY] = store.__test.buildInitialStoreData()

  store.initStore()
  store.getSessions()
  store.getSettings()

  assert.equal(reads, 1)
  assert.equal(writes, 0)

  store.__test.resetCachedStoreForTest()
  delete global.wx
})
