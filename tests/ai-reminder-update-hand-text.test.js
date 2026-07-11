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

function resetStore() {
  Object.keys(storage).forEach(key => delete storage[key])
  store.__test.resetCachedStoreForTest()
  const seed = store.__test.buildInitialStoreData()
  seed.settings = Object.assign({}, seed.settings, {
    aiReminders: {
      enabled: true,
      openAgentOnTrigger: true,
      extraChannels: { subscribeMessage: false },
      rules: {
        profitTarget: { amount: 0, subscribeMessage: false },
        lossLimit: { amount: 0, subscribeMessage: false },
        trailingProfit: { percent: 0, subscribeMessage: false },
        postLossExtraRisk: { percent: 0, subscribeMessage: false },
        sessionPreReminder: { hoursBefore: 0, subscribeMessage: false },
        sessionMaxHours: { hours: 0, subscribeMessage: false }
      },
      textReminders: [{
        id: 'text_no_overcall',
        title: '不要 overcall',
        content: '连输后检查是否无计划跟注',
        enabled: true,
        subscribeMessage: false
      }]
    }
  })
  seed.sessions = [{
    _id: 'session_text',
    title: 'MGM',
    status: 'active',
    startTime: '2026-07-01 01:00',
    buyIn: 100000,
    cashOut: 100000,
    currentProfit: 0,
    createdAt: 1000,
    updatedAt: 1000
  }]
  seed.hands = [{
    _id: 'hand_text',
    sessionId: 'session_text',
    playedDate: '2026-07-01',
    currentProfit: 0,
    createdAt: 2000,
    updatedAt: 2000
  }]
  store.importBackup(seed)
}

test('updating an existing hand enqueues configured text reminders', () => {
  resetStore()

  store.updateHand('hand_text', { currentProfit: 100000 })

  const reminders = store.getPendingAiReminders()
  assert.equal(reminders.length, 1)
  assert.equal(reminders[0].type, 'text_reminder')
  assert.equal(reminders[0].title, '不要 overcall')
})
