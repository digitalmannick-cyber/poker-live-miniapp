const assert = require('node:assert/strict')

global.wx = {
  getStorageSync() {},
  setStorageSync() {},
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

let savedPayload = null
dataService.createHand = async function createHand(payload) {
  savedPayload = payload
  return payload
}
dataService.getAppSettings = function getAppSettings() {
  return {
    positions: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
    opponentTypes: [],
    blindPresets: ['200/400']
  }
}
tabBar.syncCustomTabBar = function syncCustomTabBar() {}
onboardingGuide.getActiveStep = function getActiveStep() { return null }
onboardingGuide.shouldAutoShowGuide = function shouldAutoShowGuide() { return false }
onboardingGuide.getStepForRoute = function getStepForRoute() { return null }

delete require.cache[require.resolve('../pages/hand-record/hand-record.js')]
require('../pages/hand-record/hand-record.js')

async function run() {
  const page = createPageInstance(pageConfig)
  page.setData({
    sessionId: 'session_1',
    session: {
      _id: 'session_1',
      status: 'active',
      smallBlind: 200,
      bigBlind: 400
    },
    'form.heroCardsInput': 'AsAh',
    'form.currentProfit': '38800',
    'form.potSize': '78200',
    'form.preflopActionLine': 'BU all-in 38800, HJ call all-in',
    'form.preflopPot': '78200',
    'form.preflopAllIn': true,
    'form.flop': '8s9h6c',
    'form.turn': '2d',
    'form.river': '3c',
    'form.flopActionLine': 'should not save',
    'form.flopPot': '999',
    'form.turnActionLine': 'should not save',
    'form.turnPot': '999',
    'form.riverActionLine': 'should not save',
    'form.riverPot': '999',
    actions: [
      { street: 'Pre', actorLabel: 'BU', actionType: 'all-in', amount: '38800' },
      { street: 'Flop', actorLabel: 'HJ', actionType: 'bet', amount: '999' }
    ]
  })

  page.togglePreflopAllIn({ detail: { value: true } })
  assert.equal(page.data.form.flopActionLine, '')
  assert.equal(page.data.form.turnPot, '')

  await page.saveHand()

  assert.equal(savedPayload.allInStreet, 'preflop')
  assert.equal(savedPayload.allInPot, '78200')
  assert.equal(savedPayload.streetInputs.flop.board, '8s9h6c')
  assert.equal(savedPayload.streetInputs.turn.board, '2d')
  assert.equal(savedPayload.streetInputs.river.board, '3c')
  assert.equal(savedPayload.streetInputs.flop.actionLine, '')
  assert.equal(savedPayload.streetInputs.turn.actionLine, '')
  assert.equal(savedPayload.streetInputs.river.actionLine, '')
  assert.equal(savedPayload.streetInputs.flop.pot, '')
  assert.equal(savedPayload.streetInputs.turn.pot, '')
  assert.equal(savedPayload.streetInputs.river.pot, '')
  assert.deepEqual(savedPayload.actions, [
    { street: 'Pre', actorLabel: 'BU', actionType: 'all-in', amount: '38800' }
  ])
}

run().then(() => {
  console.log('hand record preflop all-in checks passed')
}).catch(error => {
  console.error(error)
  process.exit(1)
})
