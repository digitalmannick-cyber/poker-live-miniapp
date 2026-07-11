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

function resetStore(sessionStatus) {
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
      textReminders: []
    }
  })
  seed.sessions = [{
    _id: 'session_guard',
    title: 'MGM',
    status: sessionStatus || 'active',
    startTime: '2026-07-01 01:00',
    endTime: sessionStatus === 'finished' ? '2026-07-01 03:00' : '',
    buyIn: 100000,
    cashOut: 100000,
    currentProfit: 0,
    createdAt: 1000,
    updatedAt: 1000
  }]
  seed.hands = [
    {
      _id: 'hand_loss_1',
      sessionId: 'session_guard',
      playedDate: '2026-07-01',
      currentProfit: -1000,
      createdAt: 2000,
      updatedAt: 2000
    },
    {
      _id: 'hand_loss_2',
      sessionId: 'session_guard',
      playedDate: '2026-07-01',
      currentProfit: -1000,
      createdAt: 3000,
      updatedAt: 3000
    },
    {
      _id: 'hand_loss_3',
      sessionId: 'session_guard',
      playedDate: '2026-07-01',
      currentProfit: -1000,
      createdAt: 4000,
      updatedAt: 4000
    }
  ]
  store.importBackup(seed)
}

test('AI reminders are not enqueued for finished sessions while reviewing history', () => {
  resetStore('finished')

  const reminders = store.enqueueAiRemindersForHand('hand_loss_3')

  assert.equal(reminders.length, 0)
  assert.equal(store.getPendingAiReminders().length, 0)
})

test('pending AI reminders from non-active sessions are not shown', () => {
  resetStore('finished')
  const data = store.exportBackup()
  data.aiReminderQueue = [{
    _id: 'reminder_old_finished_session',
    type: 'consecutive_loss',
    severity: 'warning',
    title: '连续亏损提醒',
    message: '旧提醒',
    sessionId: 'session_guard',
    handId: 'hand_loss_3',
    channels: { evBrain: true, subscribeMessage: false },
    status: 'pending',
    createdAt: 5000
  }]
  store.importBackup(data)

  assert.equal(store.getPendingAiReminders().length, 0)
})

test('stale pending AI reminders are not shown later during review', () => {
  resetStore('active')
  const data = store.exportBackup()
  data.aiReminderQueue = [{
    _id: 'reminder_stale_active_session',
    type: 'consecutive_loss',
    severity: 'warning',
    title: '连续亏损提醒',
    message: '旧提醒',
    sessionId: 'session_guard',
    handId: 'hand_loss_3',
    channels: { evBrain: true, subscribeMessage: false },
    status: 'pending',
    createdAt: Date.now() - 11 * 60 * 1000
  }]
  store.importBackup(data)

  assert.equal(store.getPendingAiReminders().length, 0)
})

test('consecutive loss reminder is only queued once per active session', () => {
  resetStore('active')

  const first = store.enqueueAiRemindersForHand('hand_loss_3')
  const second = store.enqueueAiRemindersForHand('hand_loss_3')

  assert.equal(first.filter(item => item.type === 'consecutive_loss').length, 1)
  assert.equal(second.filter(item => item.type === 'consecutive_loss').length, 0)
  assert.equal(store.getPendingAiReminders().filter(item => item.type === 'consecutive_loss').length, 1)
})
