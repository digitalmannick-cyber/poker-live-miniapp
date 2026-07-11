const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const test = require('node:test')

const pagePath = path.resolve(__dirname, '../pages/session-list/session-list.js')
const originalLoad = Module._load

let pageDefinition = null

function setByPath(target, keyPath, value) {
  const parts = String(keyPath).split('.')
  let cursor = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index]
    if (!cursor[key]) cursor[key] = {}
    cursor = cursor[key]
  }
  cursor[parts[parts.length - 1]] = value
}

function createPageInstance(config) {
  const page = {
    data: JSON.parse(JSON.stringify(config.data || {})),
    setData(patch, callback) {
      Object.keys(patch || {}).forEach(key => setByPath(this.data, key, patch[key]))
      if (typeof callback === 'function') callback()
    }
  }
  Object.keys(config).forEach(key => {
    if (key !== 'data') page[key] = typeof config[key] === 'function' ? config[key].bind(page) : config[key]
  })
  return page
}

function installPage() {
  pageDefinition = null
  global.wx = {
    showToast() {},
    navigateTo() {},
    switchTab() {},
    getStorageSync() {},
    setStorageSync() {},
    removeStorageSync() {}
  }
  global.Page = definition => {
    pageDefinition = definition
  }
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('../../services/data-service')) {
      return {
        getAppSettings() {
          return { chipUnit: 'HKD' }
        }
      }
    }
    if (request.endsWith('../../services/ai-service')) return {}
    if (request.endsWith('../../utils/tab-bar')) return { syncCustomTabBar() {} }
    if (request.endsWith('../../utils/onboarding-guide')) return { getStepForRoute() { return null } }
    if (request.endsWith('../../utils/agent-reminder-cards')) return { buildReminderCard() { return null } }
    return originalLoad.call(this, request, parent, isMain)
  }
  delete require.cache[pagePath]
  require(pagePath)
  Module._load = originalLoad
  if (!pageDefinition) throw new Error('session-list page was not registered')
  return createPageInstance(pageDefinition)
}

test('history quick hand editor formats millisecond playedDate instead of showing raw timestamp', () => {
  const page = installPage()
  const session = {
    _id: 'history_session_draft',
    status: 'history_edit',
    startTime: '2026-07-09 20:00',
    endTime: '2026-07-10 01:00',
    buyIn: 100000,
    cashOut: 207000,
    smallBlind: 500,
    bigBlind: 1000,
    tableSize: 8,
    timelineEvents: []
  }
  const hand = {
    _id: 'history_hand_time',
    heroCardsInput: 'AdKd',
    heroPosition: 'CO',
    currentProfit: 107000,
    playedDate: '1783593255151'
  }
  page.setData({
    historySessionEditMode: true,
    activeSession: session,
    settings: { chipUnit: 'HKD' },
    historyDraftHands: [hand]
  })

  page.openTimelineEventEditor({ currentTarget: { dataset: { id: hand._id } } })

  assert.equal(page.data.quickEntryVisible, true)
  assert.equal(page.data.quickEditingHandId, hand._id)
  assert.match(page.data.quickForm.date, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(page.data.quickForm.time, /^\d{2}:\d{2}$/)
  assert.notEqual(page.data.quickForm.date, hand.playedDate)
  assert.notEqual(page.data.quickForm.time, hand.playedDate)
})
