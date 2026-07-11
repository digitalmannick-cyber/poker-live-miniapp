const assert = require('node:assert/strict')

const storage = {
  pokerLivePendingRecordSessionId: 'session_finished_yesterday'
}

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
  showToast() {},
  switchTab() {}
}

let pageConfig = null
global.Page = function Page(config) {
  pageConfig = config
}

function setByPath(target, path, value) {
  const parts = String(path).split('.')
  let cursor = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index]
    cursor[key] = cursor[key] || {}
    cursor = cursor[key]
  }
  cursor[parts[parts.length - 1]] = value
}

function createPageInstance(config) {
  const instance = Object.assign({}, config, {
    data: JSON.parse(JSON.stringify(config.data || {})),
    setData(patch, callback) {
      Object.keys(patch || {}).forEach(key => setByPath(this.data, key, patch[key]))
      if (typeof callback === 'function') callback()
    }
  })
  Object.keys(config).forEach(key => {
    if (typeof config[key] === 'function') instance[key] = config[key].bind(instance)
  })
  return instance
}

const dataService = require('../services/data-service')
const tabBar = require('../utils/tab-bar')
const onboardingGuide = require('../utils/onboarding-guide')

dataService.getAppSettings = function getAppSettings() {
  return {
    positions: ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'],
    opponentTypes: [],
    blindPresets: ['200/400']
  }
}
dataService.getSessionListData = async function getSessionListData() {
  return {
    sessions: [
      {
        _id: 'session_finished_yesterday',
        title: 'MGM 200/400',
        date: '2026-06-29',
        startTime: '2026-06-29 20:00',
        status: 'finished',
        smallBlind: 200,
        bigBlind: 400,
        updatedAt: 999999
      },
      {
        _id: 'session_active_today',
        title: 'MGM 200/400',
        date: '2026-06-30',
        startTime: '2026-06-30 20:00',
        status: 'active',
        smallBlind: 200,
        bigBlind: 400,
        hasStraddle: true,
        updatedAt: 1000
      }
    ]
  }
}
let createHandCalls = []
dataService.createHand = async function createHand(payload) {
  createHandCalls.push(payload)
  return payload
}
tabBar.syncCustomTabBar = function syncCustomTabBar() {}
onboardingGuide.getActiveStep = function getActiveStep() { return null }
onboardingGuide.shouldAutoShowGuide = function shouldAutoShowGuide() { return false }
onboardingGuide.getStepForRoute = function getStepForRoute() { return null }

delete require.cache[require.resolve('../pages/hand-record/hand-record.js')]
require('../pages/hand-record/hand-record.js')

const page = createPageInstance(pageConfig)
page.onLoad({})

page.onShow().then(() => {
  assert.equal(
    page.data.sessionId,
    'session_active_today',
    'stale legacy pending session id should not route new records into a finished session while an active session exists'
  )
  assert.equal(page.data.form.hasStraddle, true, 'active session straddle setting should be inherited by new hands')
  assert.equal(storage.pokerLivePendingRecordSessionId, undefined, 'pending session hint should be consumed')
  storage.pokerLivePendingRecordSessionId = {
    sessionId: 'session_finished_yesterday',
    allowFinished: true,
    createdAt: Date.now()
  }
  const supplementPage = createPageInstance(pageConfig)
  supplementPage.onLoad({})
  return supplementPage.onShow().then(() => {
    assert.equal(
      supplementPage.data.sessionId,
      'session_finished_yesterday',
      'fresh supplement hints from a finished session detail should still route to that finished session'
    )
  })
}).then(() => {
  let resolveSessionList
  dataService.getSessionListData = function getDelayedSessionListData() {
    return new Promise(resolve => {
      resolveSessionList = resolve
    })
  }
  storage.pokerLivePendingRecordSessionId = {
    sessionId: 'session_active_today',
    allowFinished: false,
    createdAt: Date.now()
  }
  createHandCalls = []
  const staleTabPage = createPageInstance(pageConfig)
  staleTabPage.onLoad({})
  staleTabPage.setData({
    sessionId: 'session_finished_yesterday',
    session: { _id: 'session_finished_yesterday', status: 'finished' },
    'form.heroCardsInput': 'AhQd',
    'form.currentProfit': '-50000'
  })
  const onShowPromise = staleTabPage.onShow()
  return staleTabPage.saveHand().then(() => {
    assert.equal(createHandCalls.length, 0, 'quick save must not use stale tab sessionId while session target is loading')
    resolveSessionList({
      sessions: [
        {
          _id: 'session_active_today',
          title: 'MGM 200/400',
          date: '2026-06-30',
          startTime: '2026-06-30 20:00',
          status: 'active',
          smallBlind: 200,
          bigBlind: 400,
          hasStraddle: true,
          updatedAt: 1000
        },
        {
          _id: 'session_finished_yesterday',
          title: 'MGM 200/400',
          date: '2026-06-29',
          startTime: '2026-06-29 20:00',
          status: 'finished',
          smallBlind: 200,
          bigBlind: 400,
          updatedAt: 999999
        }
      ]
    })
    return onShowPromise
  }).then(() => {
    assert.equal(staleTabPage.data.sessionId, 'session_active_today')
  })
}).then(() => {
  console.log('hand record pending session routing checks passed')
}).catch(error => {
  console.error(error)
  process.exit(1)
})
