const test = require('node:test')
const assert = require('node:assert/strict')

let pageConfig = null
global.Page = function Page(config) {
  pageConfig = config
}

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
  showToast() {},
  navigateTo() {}
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

tabBar.syncCustomTabBar = function syncCustomTabBar() {}
onboardingGuide.getStepForRoute = function getStepForRoute() { return null }

const sessions = [{
  _id: 'session_active',
  status: 'active',
  title: 'MGM',
  createdAt: 1,
  updatedAt: 1
}]

const hands = Array.from({ length: 55 }, (_, index) => ({
  _id: 'hand_' + String(index).padStart(2, '0'),
  sessionId: 'session_active',
  playedDate: '2026-07-07',
  heroCardsInput: 'AsKd',
  currentProfit: index,
  createdAt: 1000 + index,
  updatedAt: 1000 + index
})).reverse()

dataService.getAppSettings = function getAppSettings() {
  return {
    chipUnit: 'HKD',
    blindPresets: [],
    positions: [],
    opponentTypes: []
  }
}
dataService.getSessionListData = async function getSessionListData() {
  return { sessions }
}
dataService.getReviewData = async function getReviewData(filters, options) {
  return {
    sessions: options && options.sessions || sessions,
    hands,
    summary: {
      totalHands: hands.length,
      totalProfit: hands.reduce((sum, hand) => sum + hand.currentProfit, 0)
    }
  }
}
dataService.refreshOnboardingGuideContext = function refreshOnboardingGuideContext() {}

require('../pages/review-list/review-list.js')

test('review list refresh renders first batch before progressive chunks', async () => {
  const page = createPageInstance(pageConfig)

  await page.refresh()

  assert.equal(page.data.hands.length, 20)
  assert.equal(page.data.handRenderComplete, false)
  assert.equal(page.data.summary.totalHands, 55)

  await new Promise(resolve => setTimeout(resolve, 80))

  assert.equal(page.data.hands.length, 55)
  assert.equal(page.data.handRenderComplete, true)
})
