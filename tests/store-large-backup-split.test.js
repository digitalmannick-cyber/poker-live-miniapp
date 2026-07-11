const assert = require('node:assert/strict')

const storage = {}
const MAX_ENTRY_SIZE = 9000

global.wx = {
  getStorageSync(key) {
    return storage[key]
  },
  setStorageSync(key, value) {
    const size = Buffer.byteLength(JSON.stringify(value), 'utf8')
    if (size > MAX_ENTRY_SIZE) {
      throw new Error('setStorageSync: entry size limit exceeded: ' + key + ' ' + size)
    }
    storage[key] = value
  },
  removeStorageSync(key) {
    delete storage[key]
  }
}

const store = require('../utils/store')

function resetStorage() {
  Object.keys(storage).forEach(key => delete storage[key])
  store.__test.resetCachedStoreForTest()
}

function buildLargeHand(index) {
  return {
    _id: 'hand_large_' + index,
    sessionId: 'session_large',
    playedDate: '2026-06-30',
    stakeLevel: '200/400',
    heroCardsInput: 'AsKd',
    currentProfit: index,
    notes: 'x'.repeat(1200),
    aiReview: {
      summary: 'y'.repeat(1200),
      advice: 'z'.repeat(1200)
    },
    createdAt: 1000 + index,
    updatedAt: 1000 + index
  }
}

resetStorage()

const backup = store.__test.buildInitialStoreData()
backup.profile = Object.assign({}, backup.profile, { playerId: 'WX-LARGE' })
backup.sessions = [{
  _id: 'session_large',
  title: 'Large Session',
  status: 'active',
  createdAt: 1000,
  updatedAt: 1000
}]
backup.hands = Array.from({ length: 24 }, (_, index) => buildLargeHand(index))

assert.doesNotThrow(() => store.importBackup(backup), 'large restored backups should persist without single-key storage failure')

store.__test.resetCachedStoreForTest()
const restored = store.exportBackup()
assert.equal(restored.hands.length, backup.hands.length, 'split storage should restore every hand')
assert.equal(restored.hands[23].aiReview.summary.length, 1200, 'split storage should preserve full hand detail')
assert.ok(
  Object.keys(storage).some(key => key.indexOf('pokerLiveMiniappStore:hands:') === 0),
  'large hands should be stored in split hand chunks'
)

console.log('store large backup split tests passed')
