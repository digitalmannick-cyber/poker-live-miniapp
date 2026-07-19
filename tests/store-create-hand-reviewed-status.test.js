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
  _id: 'session_ledger_reviewed',
  title: 'MGM 200/400',
  date: '2026-07-04',
  startTime: '2026-07-04 12:00',
  venue: 'MGM',
  smallBlind: 200,
  bigBlind: 400,
  tableSize: 8,
  hasStraddle: true,
  buyIn: 40000,
  status: 'active',
  createdAt: 1000,
  updatedAt: 1000
}

resetStore(Object.assign({}, baseData, {
  sessions: [session],
  hands: [],
  handActions: []
}))

const hand = store.createHand({
  sessionId: session._id,
  playedDate: '2026-07-04',
  stakeLevel: '200/400',
  playerCount: 6,
  hasStraddle: false,
  heroCardsInput: 'AhQh',
  currentProfit: 3000,
  potSize: 10000,
  detailBackfilled: true,
  reviewStatus: 'reviewed',
  inputMode: 'ledger_full',
  reviewSource: 'ledger_full',
  ledgerState: {
    version: 1,
    actions: [{ street: 'Pre', position: 'BTN', action: 'Raise', amount: 1200 }]
  },
  streetInputs: {
    preflop: { actionLine: 'BTN raise 1200', pot: 2800 }
  }
})

const saved = store.getHandById(hand._id)
assert.equal(saved.reviewStatus, 'reviewed')
assert.equal(saved.detailBackfilled, true)
assert.equal(saved.inputMode, 'ledger_full')
assert.equal(saved.reviewSource, 'ledger_full')
assert.equal(saved.playerCount, 6)
assert.equal(saved.hasStraddle, false)
assert.deepEqual(saved.ledgerState.actions[0], { street: 'Pre', position: 'BTN', action: 'Raise', amount: 1200 })
