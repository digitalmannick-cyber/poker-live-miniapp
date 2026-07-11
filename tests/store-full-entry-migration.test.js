const assert = require('node:assert/strict')

const storage = {}
global.wx = {
  getStorageSync(key) { return storage[key] },
  setStorageSync(key, value) { storage[key] = value },
  removeStorageSync(key) { delete storage[key] }
}

const store = require('../utils/store')

const migrated = store.__test.ensureStoreShape({
  sessions: [],
  hands: [
    {
      _id: 'legacy-full-tag',
      tags: ['\u7cbe\u51c6\u5f55\u5165'],
      streetInputs: { preflop: { actionLine: 'Hero BTN R1000, BB C600', pot: 2200 } }
    },
    {
      _id: 'legacy-full-snapshot',
      playerSnapshots: [{ slot: 'seat-1', position: 'BTN', stack: 40000 }],
      streetInputs: { preflop: { actionLine: 'Hero BTN R1000', pot: 1600 } }
    },
    {
      _id: 'legacy-full-compact-cloud',
      detailBackfilled: true,
      reviewStatus: 'reviewed',
      streetSummary: 'Preflop: Hero CO R1000, BB C600',
      voiceExtract: {}
    },
    {
      _id: 'legacy-quick',
      heroCardsInput: 'AhKh',
      currentProfit: 1000
    }
  ]
})

const byId = Object.fromEntries(migrated.hands.map(hand => [hand._id, hand]))
assert.equal(byId['legacy-full-tag'].inputMode, 'ledger_full')
assert.equal(byId['legacy-full-tag'].reviewSource, 'ledger_full')
assert.equal(byId['legacy-full-snapshot'].inputMode, 'ledger_full')
assert.equal(byId['legacy-full-snapshot'].reviewSource, 'ledger_full')
assert.equal(byId['legacy-full-compact-cloud'].inputMode, 'ledger_full')
assert.equal(byId['legacy-full-compact-cloud'].reviewSource, 'ledger_full')
assert.equal(byId['legacy-quick'].inputMode || '', '')

storage.pokerLiveMiniappStore = {
  initialDataVersion: 3,
  sessions: [],
  hands: [],
  handActions: [],
  bankrollLogs: [],
  aiReminderQueue: [],
  playerNotes: []
}
storage['pokerLiveMiniappStore:hands:meta'] = {
  chunkKeys: ['pokerLiveMiniappStore:hands:0']
}
storage['pokerLiveMiniappStore:hands:0'] = [{
  _id: 'legacy-full-in-split-storage',
  tags: ['\u5b8c\u6574\u5f55\u5165'],
  playerSnapshots: [{ slot: 'seat-1', position: 'CO', stack: 40000 }]
}]
store.__test.resetCachedStoreForTest()
const splitMigrated = store.exportBackup().hands[0]
assert.equal(splitMigrated.inputMode, 'ledger_full')
assert.equal(splitMigrated.reviewSource, 'ledger_full')

console.log('store full entry migration ok')
