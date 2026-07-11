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
  },
  cloud: {
    init() {},
    callFunction(request) {
      assert.equal(request.name, 'poker_data')
      assert.equal(request.data.action, 'create_hand')
      return Promise.resolve({
        result: {
          code: 0,
          data: {
            hand: {
              _id: 'hand_cloud_loss',
              sessionId: 'session_cloud_loss',
              playedDate: '2026-06-30',
              stakeLevel: '200/400',
              heroCardsInput: 'AsKd',
              currentProfit: -6000,
              createdAt: 2000,
              updatedAt: 2000
            },
            session: {
              _id: 'session_cloud_loss',
              title: 'MGM',
              status: 'active',
              startTime: '2026-06-30 12:00',
              buyIn: 100000,
              cashOut: 94000,
              currentProfit: -6000,
              createdAt: 1000,
              updatedAt: 2000
            },
            actions: []
          }
        }
      })
    }
  }
}

const store = require('../utils/store')
const dataService = require('../services/data-service')

function resetStore() {
  Object.keys(storage).forEach(key => delete storage[key])
  store.__test.resetCachedStoreForTest()
  const seed = store.__test.buildInitialStoreData()
  seed.profile = Object.assign({}, seed.profile, { playerId: 'WX-REMINDER' })
  seed.settings = Object.assign({}, seed.settings, {
    aiReminders: {
      enabled: true,
      openAgentOnTrigger: true,
      extraChannels: { subscribeMessage: false },
      rules: {
        profitTarget: { amount: 0, subscribeMessage: false },
        lossLimit: { amount: 5000, subscribeMessage: false },
        trailingProfit: { percent: 0, subscribeMessage: false },
        postLossExtraRisk: { percent: 0, subscribeMessage: false },
        sessionPreReminder: { hoursBefore: 0, subscribeMessage: false },
        sessionMaxHours: { hours: 0, subscribeMessage: false }
      },
      textReminders: []
    }
  })
  seed.sessions = [{
    _id: 'session_cloud_loss',
    title: 'MGM',
    status: 'active',
    startTime: '2026-06-30 12:00',
    buyIn: 100000,
    cashOut: 100000,
    currentProfit: 0,
    createdAt: 1000,
    updatedAt: 1000
  }]
  store.importBackup(seed)
}

async function run() {
  resetStore()
  await dataService.createHand({
    sessionId: 'session_cloud_loss',
    currentProfit: -6000
  })
  const reminders = await dataService.getPendingAiReminders()
  assert.equal(reminders.length, 1, 'cloud-authoritative createHand should enqueue local AI reminders')
  assert.equal(reminders[0].type, 'loss_limit')
  assert.equal(reminders[0].handId, 'hand_cloud_loss')
}

run()
  .then(() => console.log('AI reminder cloud write flow checks passed'))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
