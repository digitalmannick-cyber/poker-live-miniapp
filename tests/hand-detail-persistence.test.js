const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const store = require('../utils/store')
const cloudRepo = require('../services/cloud-repo')

const root = path.resolve(__dirname, '..')
const STORAGE_KEY = 'pokerLiveMiniappStore'
const CANONICAL_FIELDS = {
  hasStraddle: true,
  heroQuestion: 'turn shove?',
  opponentName: 'KKQJ',
  showdown: 'AhQd',
  detailBackfilled: true
}

function setupWxStorage() {
  const storage = {}
  global.wx = {
    getStorageSync(key) {
      return storage[key]
    },
    setStorageSync(key, value) {
      storage[key] = value
    }
  }
  store.__test.resetCachedStoreForTest()
  storage[STORAGE_KEY] = store.__test.buildInitialStoreData()
  return storage
}

function cleanupWxStorage() {
  store.__test.resetCachedStoreForTest()
  delete global.wx
}

function assertCanonicalFields(target, expected) {
  assert.equal(target.hasStraddle, expected.hasStraddle)
  assert.equal(target.heroQuestion, expected.heroQuestion)
  assert.equal(target.opponentName, expected.opponentName)
  assert.equal(target.showdown, expected.showdown)
  assert.equal(target.detailBackfilled, expected.detailBackfilled)
}

test('local store createHand persists new canonical fields', () => {
  const source = fs.readFileSync(path.join(root, 'utils/store.js'), 'utf8')

  assert.match(source, /hasStraddle:\s*!!payload\.hasStraddle/)
  assert.match(source, /heroQuestion:\s*payload\.heroQuestion\s*\|\|\s*''/)
  assert.match(source, /opponentName:\s*payload\.opponentName\s*\|\|\s*''/)
  assert.match(source, /detailBackfilled:\s*!!payload\.detailBackfilled/)
})

test('cloud repo normalization preserves new canonical fields', () => {
  const source = fs.readFileSync(path.join(root, 'services/cloud-repo.js'), 'utf8')

  assert.match(source, /hasStraddle:\s*!!merged\.hasStraddle/)
  assert.match(source, /heroQuestion:\s*merged\.heroQuestion\s*\|\|\s*''/)
  assert.match(source, /opponentName:\s*merged\.opponentName\s*\|\|\s*''/)
  assert.match(source, /detailBackfilled:\s*!!merged\.detailBackfilled/)
})

test('local store createHand persists canonical hand detail fields', () => {
  setupWxStorage()
  try {
    const hand = store.createHand(Object.assign({
      sessionId: 'session_1',
      playedDate: '2026-06-14',
      stakeLevel: '100/200'
    }, CANONICAL_FIELDS))

    assertCanonicalFields(hand, CANONICAL_FIELDS)
    assertCanonicalFields(store.getHandById(hand._id), CANONICAL_FIELDS)
  } finally {
    cleanupWxStorage()
  }
})

test('local store updateHand preserves omitted canonical fields and accepts explicit clears', () => {
  setupWxStorage()
  try {
    const hand = store.createHand(Object.assign({
      sessionId: 'session_1',
      playedDate: '2026-06-14',
      stakeLevel: '100/200'
    }, CANONICAL_FIELDS))

    const preserved = store.updateHand(hand._id, { notes: 'range check' })
    assertCanonicalFields(preserved, CANONICAL_FIELDS)

    const clearedFields = {
      hasStraddle: false,
      heroQuestion: '',
      opponentName: '',
      showdown: '',
      detailBackfilled: false
    }
    const cleared = store.updateHand(hand._id, clearedFields)
    assertCanonicalFields(cleared, clearedFields)
  } finally {
    cleanupWxStorage()
  }
})

test('cloud repo buildHandDoc preserves canonical fields on create and omitted-field merge', () => {
  const buildHandDoc = cloudRepo.__test && cloudRepo.__test.buildHandDoc
  assert.equal(typeof buildHandDoc, 'function')

  const created = buildHandDoc(null, Object.assign({
    sessionId: 'session_1',
    playedDate: '2026-06-14',
    stakeLevel: '100/200'
  }, CANONICAL_FIELDS))
  assertCanonicalFields(created, CANONICAL_FIELDS)

  const merged = buildHandDoc(created, { notes: 'range check' })
  assertCanonicalFields(merged, CANONICAL_FIELDS)
})
