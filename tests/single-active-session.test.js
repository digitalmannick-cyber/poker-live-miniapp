const assert = require('assert')
const fs = require('fs')
const rules = require('../utils/session-rules')
const store = require('../utils/store')

const STORAGE_KEY = 'pokerLiveMiniappStore'
const storage = {}
global.wx = {
  getStorageSync(key) {
    return storage[key]
  },
  setStorageSync(key, value) {
    storage[key] = value
  }
}

function sessionPayload(venue) {
  return {
    venue,
    smallBlind: 100,
    bigBlind: 200,
    buyIn: 10000,
    startTime: '2026-06-20 10:00',
    date: '2026-06-20'
  }
}

async function run() {
  assert.throws(
    () => rules.assertCanCreateSession([{ _id: 's1', status: 'active' }]),
    error => error.code === rules.ACTIVE_SESSION_ERROR_CODE && error.message === rules.ACTIVE_SESSION_MESSAGE
  )
  assert.doesNotThrow(() => rules.assertCanCreateSession([{ _id: 's1', status: 'finished' }]))

  store.__test.resetCachedStoreForTest()
  storage[STORAGE_KEY] = store.__test.buildInitialStoreData()
  const created = store.createSession(sessionPayload('MGM'))
  assert.ok(created && created._id)
  assert.throws(
    () => store.createSession(sessionPayload('永利')),
    error => error.code === rules.ACTIVE_SESSION_ERROR_CODE
  )
  assert.strictEqual(store.getSessions().length, 1)

  const dataService = require('../services/data-service')
  await assert.rejects(
    () => dataService.createSession(sessionPayload('威尼斯人')),
    error => error.code === rules.ACTIVE_SESSION_ERROR_CODE
  )
  assert.strictEqual(store.getSessions().length, 1)

  const cloudSource = fs.readFileSync('services/cloud-repo.js', 'utf8')
  assert.match(cloudSource, /assertCanCreateSession\(existingSessions\)/)

  store.__test.resetCachedStoreForTest()
  delete global.wx
  console.log('single active session tests passed')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
