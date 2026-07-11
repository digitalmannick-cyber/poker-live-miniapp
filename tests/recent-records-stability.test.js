const assert = require('node:assert/strict')

const storage = {}
global.wx = {
  getStorageSync(key) {
    return storage[key]
  },
  setStorageSync(key, value) {
    storage[key] = value
  },
  removeStorageSync(key) {
    delete storage[key]
  }
}

const store = require('../utils/store')

function resetStore(data) {
  Object.keys(storage).forEach(key => delete storage[key])
  store.__test.resetCachedStoreForTest()
  store.importBackup(data)
  store.__test.resetCachedStoreForTest()
}

const baseData = store.__test.buildInitialStoreData()
const session = {
  _id: 'session_recent',
  title: 'MGM 200/400',
  date: '2026-06-30',
  startTime: '2026-06-30 12:00',
  endTime: '',
  venue: 'MGM',
  smallBlind: 200,
  bigBlind: 400,
  tableSize: 8,
  buyIn: 10000,
  cashOut: 0,
  totalProfit: 0,
  durationMinutes: 0,
  handCount: 2,
  status: 'active',
  notes: '',
  createdAt: 1000,
  updatedAt: 3000
}
const handA = {
  _id: 'hand_recent_a',
  sessionId: session._id,
  playedDate: '2026-06-30',
  stakeLevel: '200/400',
  heroPosition: '',
  villainPosition: '',
  heroCardsInput: 'AsKd',
  currentProfit: 0,
  createdAt: 2000,
  updatedAt: 2000
}
const handB = Object.assign({}, handA, {
  _id: 'hand_recent_b',
  createdAt: 7000,
  updatedAt: 7000
})

resetStore(Object.assign({}, baseData, {
  sessions: [session],
  hands: [handA, handB],
  handActions: [],
  bankrollLogs: []
}))

const reviewHands = store.getReviewHands({ sessionStatus: 'active' })
assert.equal(reviewHands.length, 2, 'recent list reads must not remove quick-entered hands with similar fields')
assert.deepEqual(
  reviewHands.map(hand => hand._id).sort(),
  ['hand_recent_a', 'hand_recent_b'],
  'both recent hands should remain visible in the local cache'
)

const backup = store.exportBackup()
assert.equal(backup.hands.length, 2, 'exporting or background merging must not persistently delete recent hands')

console.log('recent records stability tests passed')
