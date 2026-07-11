const test = require('node:test')
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
const dataService = require('../services/data-service')

function resetStore(data) {
  Object.keys(storage).forEach(key => delete storage[key])
  store.__test.resetCachedStoreForTest()
  store.importBackup(data)
  store.__test.resetCachedStoreForTest()
}

function session(id) {
  return {
    _id: id,
    title: id,
    date: '2026-07-07',
    startTime: '2026-07-07 12:00',
    status: 'finished',
    buyIn: 1000,
    cashOut: 1200,
    durationMinutes: 60,
    createdAt: 1,
    updatedAt: 1
  }
}

function hand(id, sessionId, reviewed) {
  return {
    _id: id,
    sessionId,
    playedDate: '2026-07-07',
    currentProfit: 0,
    aiReview: reviewed ? { summary: 'ok' } : null,
    createdAt: 1,
    updatedAt: 1
  }
}

test('session list summary scans review hands once instead of once per session', async () => {
  resetStore(Object.assign({}, store.__test.buildInitialStoreData(), {
    profile: {
      playerId: 'WX-PERF',
      name: 'Perf'
    },
    sessions: [session('s1'), session('s2'), session('s3')],
    hands: [
      hand('h1', 's1', true),
      hand('h2', 's1', false),
      hand('h3', 's2', true)
    ],
    handActions: [],
    bankrollLogs: []
  }))

  const originalGetReviewHands = store.getReviewHands
  const originalGetHandsBySessionId = store.getHandsBySessionId
  let reviewHandsCalls = 0
  let handsBySessionCalls = 0
  store.getReviewHands = function wrappedGetReviewHands(filters) {
    reviewHandsCalls += 1
    return originalGetReviewHands.call(store, filters)
  }
  store.getHandsBySessionId = function wrappedGetHandsBySessionId(sessionId) {
    handsBySessionCalls += 1
    return originalGetHandsBySessionId.call(store, sessionId)
  }

  try {
    const data = await dataService.getSessionListData()
    const first = data.sessions.find(item => item._id === 's1')

    assert.equal(reviewHandsCalls, 1)
    assert.equal(handsBySessionCalls, 0)
    assert.equal(first.totalHandCount, 2)
    assert.equal(first.reviewedHandCount, 1)
    assert.equal(first.summaryEligible, false)
  } finally {
    store.getReviewHands = originalGetReviewHands
    store.getHandsBySessionId = originalGetHandsBySessionId
  }
})

test('review page can request lightweight sessions without summary scanning', async () => {
  resetStore(Object.assign({}, store.__test.buildInitialStoreData(), {
    profile: {
      playerId: 'WX-PERF',
      name: 'Perf'
    },
    sessions: [session('s1')],
    hands: [hand('h1', 's1', true)],
    handActions: [],
    bankrollLogs: []
  }))

  const originalGetReviewHands = store.getReviewHands
  let reviewHandsCalls = 0
  store.getReviewHands = function wrappedGetReviewHands(filters) {
    reviewHandsCalls += 1
    return originalGetReviewHands.call(store, filters)
  }

  try {
    const data = await dataService.getSessionListData({ includeSummary: false })

    assert.equal(reviewHandsCalls, 0)
    assert.equal(data.sessions.length, 1)
    assert.equal(Object.prototype.hasOwnProperty.call(data.sessions[0], 'summaryEligible'), false)
  } finally {
    store.getReviewHands = originalGetReviewHands
  }
})
