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

function session(id, date, startTime, updatedAt) {
  return {
    _id: id,
    title: 'MGM 200/400',
    date,
    startTime,
    endTime: '',
    venue: 'MGM',
    smallBlind: 200,
    bigBlind: 400,
    tableSize: 8,
    buyIn: 100000,
    cashOut: 0,
    totalProfit: 0,
    durationMinutes: 0,
    handCount: 1,
    status: 'finished',
    notes: '',
    createdAt: updatedAt - 100,
    updatedAt
  }
}

function hand(id, sessionId, playedDate, updatedAt) {
  return {
    _id: id,
    sessionId,
    playedDate,
    stakeLevel: '200/400',
    heroPosition: 'MP',
    villainPosition: 'CO',
    heroCardsInput: 'AsKd',
    currentProfit: 0,
    createdAt: updatedAt - 100,
    updatedAt
  }
}

const baseData = store.__test.buildInitialStoreData()

resetStore(Object.assign({}, baseData, {
  sessions: [
    session('session_0624_recently_touched', '2026-06-24', '2026-06-24 20:00', 9000),
    session('session_0630_old_update', '2026-06-30', '2026-06-30 12:00', 1000),
    session('session_0626_old_update', '2026-06-26', '2026-06-26 19:30', 2000)
  ],
  hands: [
    hand('hand_yesterday_recently_touched', 'session_0624_recently_touched', '2026-06-29', 9000),
    hand('hand_today_old_update', 'session_0630_old_update', '2026-06-30', 1000),
    hand('hand_0626_old_update', 'session_0626_old_update', '2026-06-26', 2000)
  ],
  handActions: [],
  bankrollLogs: []
}))

assert.deepEqual(
  store.getSessions().map(item => item._id),
  ['session_0630_old_update', 'session_0626_old_update', 'session_0624_recently_touched'],
  'session list should sort by session date/start time, not by last mutation time'
)

assert.deepEqual(
  store.getReviewHands({ sortBy: 'dateDesc' }).map(item => item._id),
  ['hand_today_old_update', 'hand_yesterday_recently_touched', 'hand_0626_old_update'],
  'review list date sort should sort by played date, not by last mutation time'
)

assert.deepEqual(
  store.getReviewHands({}).map(item => item._id),
  ['hand_yesterday_recently_touched', 'hand_0626_old_update', 'hand_today_old_update'],
  'review list default should sort by latest record time so newly entered hands stay first'
)

console.log('list business time sorting tests passed')
