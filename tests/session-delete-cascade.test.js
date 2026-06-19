const assert = require('assert')
const fs = require('fs')
const store = require('../utils/store')

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
const data = store.__test.buildInitialStoreData()
data.sessions = [
  { _id: 'session_target', status: 'finished', handCount: 2, updatedAt: 2 },
  { _id: 'session_keep', status: 'active', handCount: 1, updatedAt: 1 }
]
data.hands = [
  { _id: 'hand_target_1', sessionId: 'session_target' },
  { _id: 'hand_target_2', sessionId: 'session_target' },
  { _id: 'hand_keep', sessionId: 'session_keep' }
]
data.handActions = [
  { _id: 'action_target_1', handId: 'hand_target_1' },
  { _id: 'action_target_2', handId: 'hand_target_2' },
  { _id: 'action_keep', handId: 'hand_keep' }
]
data.bankrollLogs = [
  { _id: 'log_target', sessionId: 'session_target' },
  { _id: 'log_keep', sessionId: 'session_keep' }
]
store.importBackup(data)

assert.strictEqual(store.deleteSession('session_target'), true)
assert.strictEqual(store.getSessionById('session_target'), null)
assert.strictEqual(store.getHandsBySessionId('session_target').length, 0)
assert.strictEqual(store.getActionsByHandId('hand_target_1').length, 0)
assert.ok(store.getSessionById('session_keep'))
assert.strictEqual(store.getHandsBySessionId('session_keep').length, 1)

const backup = store.exportBackup()
assert.deepStrictEqual(backup.handActions.map(item => item._id), ['action_keep'])
assert.deepStrictEqual(backup.bankrollLogs.map(item => item._id), ['log_keep'])

const dataServiceSource = fs.readFileSync('services/data-service.js', 'utf8')
const cloudRepoSource = fs.readFileSync('services/cloud-repo.js', 'utf8')
assert.match(dataServiceSource, /async function deleteSession\(sessionId\)/)
assert.match(dataServiceSource, /deleteSession,/)
assert.match(cloudRepoSource, /async function deleteSession\(sessionId\)/)
assert.match(cloudRepoSource, /deleteSession,/)

store.__test.resetCachedStoreForTest()
delete global.wx
console.log('session delete cascade tests passed')
