const assert = require('node:assert/strict')

let pageConfig = null
global.Page = function Page(config) {
  pageConfig = config
}

const wxCalls = {
  navigateTo: [],
  redirectTo: [],
  switchTab: [],
  toast: [],
  modal: [],
  storage: {}
}

global.wx = {
  navigateTo(options) { wxCalls.navigateTo.push(options) },
  redirectTo(options) { wxCalls.redirectTo.push(options) },
  switchTab(options) { wxCalls.switchTab.push(options) },
  showToast(options) { wxCalls.toast.push(options) },
  showModal(options) {
    wxCalls.modal.push(options)
    if (options && typeof options.success === 'function') options.success({ confirm: true })
  },
  setStorageSync(key, value) { wxCalls.storage[key] = value },
  getStorageSync(key) { return wxCalls.storage[key] },
  removeStorageSync(key) { delete wxCalls.storage[key] }
}

function createPageInstance(config) {
  const page = {
    data: JSON.parse(JSON.stringify(config.data || {})),
    setData(patch, callback) {
      Object.keys(patch || {}).forEach(key => {
        const parts = key.split('.')
        let target = this.data
        while (parts.length > 1) {
          const part = parts.shift()
          if (!target[part]) target[part] = {}
          target = target[part]
        }
        target[parts[0]] = patch[key]
      })
      if (typeof callback === 'function') callback()
    }
  }
  Object.keys(config).forEach(key => {
    if (key !== 'data') page[key] = typeof config[key] === 'function' ? config[key].bind(page) : config[key]
  })
  return page
}

const dataService = require('../services/data-service')
const tabBar = require('../utils/tab-bar')
const onboardingGuide = require('../utils/onboarding-guide')
const fs = require('node:fs')
const path = require('node:path')

tabBar.syncCustomTabBar = function syncCustomTabBar() {}
onboardingGuide.getStepForRoute = function getStepForRoute() { return null }

let session = {
  _id: 'session_done',
  title: '200/400 @ MGM',
  status: 'finished',
  venue: 'MGM',
  smallBlind: 200,
  bigBlind: 400,
  gameType: 'NLHE',
  tableSize: 8,
  hasStraddle: false,
  date: '2026-07-03',
  startTime: '2026-07-03 18:00',
  endTime: '2026-07-03 23:00',
  buyIn: 100000,
  cashOut: 105000,
  endingChips: 105000,
  totalProfit: 5000,
  handCount: 1,
  timelineEvents: [
    {
      id: 'note_1',
      type: 'comment',
      title: '状态备注',
      text: '疲惫',
      createdAt: '2026-07-03 21:00',
      createdAtMs: new Date('2026-07-03T21:00:00').getTime(),
      sequence: 3
    }
  ]
}

let hands = [{
  _id: 'hand_1',
  sessionId: 'session_done',
  heroCardsInput: 'AhQh',
  heroPosition: 'BTN',
  currentProfit: 5000,
  playedDate: '2026-07-03 20:30',
  createdAtMs: new Date('2026-07-03T20:30:00').getTime(),
  sequence: 2,
  notes: 'quick note'
}, {
  _id: 'hand_encoded_time',
  sessionId: 'session_done',
  heroCardsInput: 'AsAh',
  heroPosition: 'UTG',
  currentProfit: 4000,
  recordedAt: '2026-07-03%2020%3A36',
  notes: 'legacy encoded time'
}, {
  _id: 'hand_date_only',
  sessionId: 'session_done',
  heroCardsInput: 'KcKh',
  heroPosition: 'BB',
  currentProfit: 8000,
  playedDate: '2026-07-03',
  createdAt: '2026-07-03 22:18',
  createdAtMs: new Date('2026-07-03T22:18:00').getTime(),
  sequence: 4,
  notes: 'full record',
  detailBackfilled: true,
  reviewStatus: 'reviewed',
  streetSummary: 'Preflop: Hero BB R8500, HJ C8100',
  voiceExtract: {}
}, {
  _id: 'hand_ms_time',
  sessionId: 'session_done',
  heroCardsInput: 'AdKd',
  heroPosition: 'CO',
  currentProfit: 107000,
  playedDate: '1783082700000',
  createdAtMs: 1783082700000,
  sequence: 5,
  notes: 'timestamp record'
}]

let updatedSessionPatch = null
let updatedHandPatch = null
let deletedHandId = ''
let createdHandPayload = null
let createdSessionPayload = null
let createdHands = []

dataService.getAppSettings = function getAppSettings() {
  return {
    chipUnit: 'HKD',
    venues: ['MGM', 'Wynn'],
    blindPresets: ['200/400', '100/200'],
    lastBlindPreset: '200/400'
  }
}
dataService.updateSettings = function updateSettings() {}
dataService.getSessionListData = async function getSessionListData() {
  return { sessions: [session] }
}
dataService.getSessionDetailData = async function getSessionDetailData() {
  return { session, hands }
}
dataService.createSession = async function createSession(payload) {
  createdSessionPayload = payload
  session = Object.assign({}, payload, { _id: 'session_history_saved' })
  return session
}
dataService.updateSession = async function updateSession(sessionId, patch) {
  updatedSessionPatch = patch
  session = Object.assign({}, session, patch)
  return session
}
dataService.finishSession = async function finishSession(sessionId, payload) {
  session = Object.assign({}, session, {
    status: 'finished',
    cashOut: Number(payload.cashOut),
    endingChips: Number(payload.cashOut),
    endTime: payload.endTime,
    totalProfit: Number(payload.cashOut) - Number(session.buyIn)
  })
  return session
}
dataService.updateHand = async function updateHand(handId, patch) {
  updatedHandPatch = patch
  hands = hands.map(hand => hand._id === handId ? Object.assign({}, hand, patch) : hand)
  return hands.find(hand => hand._id === handId)
}
dataService.createHand = async function createHand(payload) {
  createdHandPayload = payload
  createdHands.push(payload)
  const hand = Object.assign({ _id: 'hand_created' }, payload)
  hands = [hand].concat(hands)
  return hand
}
dataService.deleteHand = async function deleteHand(handId) {
  deletedHandId = handId
  hands = hands.filter(hand => hand._id !== handId)
}

require('../pages/session-detail/session-detail.js')

async function run() {
  const wxml = fs.readFileSync(path.join(__dirname, '..', 'pages', 'session-detail', 'session-detail.wxml'), 'utf8')
  const editPanelWxml = wxml.slice(wxml.indexOf('class="session-edit-panel"'), wxml.indexOf('class="session-edit-tools"'))
  assert.ok(wxml.includes('class="session-edit-panel"'), 'edit mode should use the new session edit panel')
  assert.ok(!wxml.includes('session-edit-type-row'), 'edit mode should not show Cash/Tournament type selector')
  assert.ok(wxml.includes('bindtap="selectTableSize"'), 'edit mode should allow table size selection')
  assert.ok(wxml.includes('class="session-detail-more edit" bindtap="enterEditMode"'), 'detail top action should enter edit mode directly')
  assert.ok(wxml.includes('class="session-quick-hand-trigger'), 'timeline quick editor should reuse quick-entry hand selector layout')
  assert.ok(wxml.includes('bindtap="openTimelineHeroPicker"'), 'timeline quick editor should open the shared hero card picker')
  assert.ok(wxml.includes('bindtap="openTimelineProfitEditor"'), 'timeline quick editor should reuse quick-entry profit editor')
  assert.ok(wxml.includes('class="session-quick-position'), 'timeline quick editor should reuse quick-entry position controls')
  assert.ok(wxml.includes('pickTimelineEditorDate'), 'timeline item editor should expose date editing')
  assert.ok(wxml.includes('pickTimelineEditorTime'), 'timeline item editor should expose time editing')
  assert.ok(wxml.includes('class="session-edit-bankroll-summary"'), 'edit mode should show buy-in and total chips as a read-only summary')
  assert.ok(!editPanelWxml.includes('value="{{form.buyIn}}" data-key="buyIn"'), 'edit mode summary should not edit buy-in outside the timeline')
  assert.ok(!editPanelWxml.includes('value="{{form.cashOut}}" data-key="cashOut"'), 'edit mode summary should not edit total chips outside the timeline')
  assert.ok(wxml.includes('bindtap="openTimelineEdit"'), 'edit-mode timeline rows should open their editor directly on tap')
  assert.ok(wxml.includes('class="session-edit-tools"'), 'edit mode should expose insertion tools')
  assert.ok(wxml.includes('data-type="quick" bindtap="openSessionEditAction"'), 'edit mode should allow inserting quick hands')
  assert.ok(wxml.includes('data-type="full" bindtap="openSessionEditAction"'), 'edit mode should allow entering full hand input')
  assert.ok(wxml.includes('data-type="buyin" bindtap="openSessionEditAction"'), 'edit mode should allow adding buy-in events')
  assert.ok(wxml.includes('data-type="comment" bindtap="openSessionEditAction"'), 'edit mode should allow adding comments')
  assert.ok(wxml.includes('data-type="ai-reminder" bindtap="openSessionEditAction"'), 'edit mode should expose the same AI reminder entry as the active session toolbar')
  assert.ok(!wxml.includes('data-type="cashout" bindtap="openSessionEditAction"'), 'edit mode toolbar should not replace active toolbar AI reminder with cash-out')

  const page = createPageInstance(pageConfig)
  page.onLoad({ id: 'session_done' })
  await page.refresh()

  assert.equal(page.data.editMode, false)
  assert.equal(page.data.detailViewVisible, true)
  assert.equal(page.data.sessionEditVisible, false)
  assert.equal(page.data.sessionDetailHero.profitDisplay, '+HK$5000')
  assert.equal(page.data.sessionTimeline[0].type, 'cashout')
  assert.ok(page.data.sessionTimeline.some(item => item.type === 'quick' && item.heroCardsVisual.length === 2))
  assert.ok(page.data.sessionTimeline.some(item => item.type === 'comment'))
  assert.ok(page.data.sessionTimeline.some(item => item.type === 'buyin'))
  const encodedHandIndex = page.data.sessionTimeline.findIndex(item => item.id === 'hand_encoded_time')
  const cashOutIndex = page.data.sessionTimeline.findIndex(item => item.id === 'session-cashout')
  const buyInIndex = page.data.sessionTimeline.findIndex(item => item.id === 'session-buyin')
  assert.ok(cashOutIndex < encodedHandIndex && encodedHandIndex < buyInIndex, 'encoded historical hand time should sort between cash-out and buy-in')
  assert.equal(page.data.sessionTimeline[encodedHandIndex].timeDisplay, '20:36')
  assert.equal(
    page.data.sessionTimeline.find(item => item.id === 'hand_date_only').timeDisplay,
    '22:18',
    'date-only hand playedDate should not display as 08:00 when exact createdAt exists'
  )
  const legacyFullTimeline = page.data.sessionTimeline.find(item => item.id === 'hand_date_only')
  assert.equal(legacyFullTimeline.type, 'full', 'legacy complete-review hands should use the full-entry timeline type in session edit')
  assert.equal(legacyFullTimeline.iconAsset, '/assets/session-icons/p5-full-v251.png')

  page.onTimelineItemTouchStart({ currentTarget: { dataset: { id: 'note_1' } }, touches: [{ clientX: 200, clientY: 10 }] })
  page.onTimelineItemTouchEnd({ currentTarget: { dataset: { id: 'note_1' } }, changedTouches: [{ clientX: 80, clientY: 12 }] })
  assert.equal(page.data.swipedTimelineEventId, '', 'view mode timeline should not open swipe actions')

  page.openSessionMore()
  assert.equal(page.data.sessionMoreVisible, true)
  page.enterEditMode()
  assert.equal(page.data.editMode, true)
  assert.equal(page.data.detailViewVisible, false)
  assert.equal(page.data.sessionEditVisible, true)

  page.openTimelineEdit({ currentTarget: { dataset: { id: 'hand_date_only' } } })
  const fullEditNavigation = wxCalls.navigateTo.pop()
  assert.equal(fullEditNavigation.url, '/pages/hand-ledger-input/hand-ledger-input?handId=hand_date_only&returnTo=session-edit')
  assert.equal(page.data.timelineEditorVisible, false, 'full-entry hand editing should not open the quick editor')

  page.openTimelineEdit({ currentTarget: { dataset: { id: 'session-buyin' } } })
  assert.equal(page.data.timelineEditorVisible, true)
  assert.equal(page.data.timelineEditor.type, 'buyin')
  assert.equal(page.data.timelineEditor.amount, '100000', 'buy-in editor should preload the existing buy-in amount')
  assert.equal(page.data.timelineEditor.date, '2026-07-03')
  assert.equal(page.data.timelineEditor.time, '18:00')

  page.openTimelineEdit({ currentTarget: { dataset: { id: 'session-cashout' } } })
  assert.equal(page.data.timelineEditor.type, 'cashout')
  assert.equal(page.data.timelineEditor.amount, '105000', 'cash-out editor should preload the existing cash-out amount')
  assert.equal(page.data.timelineEditor.date, '2026-07-03')
  assert.equal(page.data.timelineEditor.time, '23:00')

  page.openTimelineEdit({ currentTarget: { dataset: { id: 'hand_encoded_time' } } })
  assert.equal(page.data.timelineEditor.date, '2026-07-03')
  assert.equal(page.data.timelineEditor.time, '20:36', 'encoded historical hand time should be normalized in the editor')

  page.onTimelineItemTouchStart({ currentTarget: { dataset: { id: 'note_1' } }, touches: [{ clientX: 200, clientY: 10 }] })
  page.onTimelineItemTouchEnd({ currentTarget: { dataset: { id: 'note_1' } }, changedTouches: [{ clientX: 80, clientY: 12 }] })
  assert.equal(page.data.swipedTimelineEventId, 'note_1')

  page.openTimelineEdit({ currentTarget: { dataset: { id: 'note_1' } } })
  assert.equal(page.data.timelineEditorVisible, true)
  assert.equal(page.data.timelineEditor.type, 'comment')
  page.setData({ 'timelineEditor.text': '状态备注 Agame' })
  await page.saveTimelineEditor()
  assert.ok(updatedSessionPatch.timelineEvents.some(item => item.id === 'note_1' && item.text === '状态备注 Agame'))

  page.openTimelineEdit({ currentTarget: { dataset: { id: 'hand_ms_time' } } })
  assert.equal(page.data.timelineEditorVisible, true)
  assert.equal(page.data.timelineEditor.type, 'quick')
  assert.match(page.data.timelineEditor.date, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(page.data.timelineEditor.time, /^\d{2}:\d{2}$/)
  assert.notEqual(page.data.timelineEditor.date, '1783082700000')

  page.openTimelineEdit({ currentTarget: { dataset: { id: 'hand_1' } } })
  page.openTimelineHeroPicker()
  assert.equal(page.data.timelineHeroPickerVisible, true)
  page.pickTimelineHeroCard({ currentTarget: { dataset: { token: 'Ts' } } })
  page.pickTimelineHeroCard({ currentTarget: { dataset: { token: '9s' } } })
  assert.equal(page.data.timelineEditor.heroCardsInput, 'Ts9s')
  page.openTimelineProfitEditor()
  assert.equal(page.data.timelineProfitEditorVisible, true)
  page.pickTimelineProfitSign({ currentTarget: { dataset: { sign: '-' } } })
  page.handleTimelineProfitEditorTool({ currentTarget: { dataset: { action: 'clear' } } })
  page.appendTimelineProfitDigit({ currentTarget: { dataset: { digit: '3' } } })
  page.appendTimelineProfitDigit({ currentTarget: { dataset: { digit: '0' } } })
  page.applyTimelineProfitEditor()
  assert.equal(page.data.timelineEditor.currentProfit, '-30')
  page.selectTimelinePosition({ currentTarget: { dataset: { position: 'CO' } } })
  page.setData({ 'timelineEditor.heroPosition': 'CO', 'timelineEditor.currentProfit': '-3000' })
  await page.saveTimelineEditor()
  assert.equal(updatedHandPatch.heroPosition, 'CO')
  assert.equal(updatedHandPatch.currentProfit, -3000)

  page.openSessionEditAction({ currentTarget: { dataset: { type: 'quick' } } })
  assert.equal(page.data.timelineEditorVisible, true)
  assert.equal(page.data.timelineEditor.type, 'quick')
  assert.equal(page.data.timelineEditor.isNew, true)
  page.setData({
    'timelineEditor.heroCardsInput': 'AsAd',
    'timelineEditor.heroCardsVisual': [{ rank: 'A', suit: 's' }, { rank: 'A', suit: 'd' }],
    'timelineEditor.heroPosition': 'SB',
    'timelineEditor.currentProfit': '+12000',
    'timelineEditor.notes': '历史补录',
    'timelineEditor.date': '2026-07-03',
    'timelineEditor.time': '22:10'
  })
  await page.saveTimelineEditor()
  assert.equal(createdHandPayload.sessionId, 'session_done')
  assert.equal(createdHandPayload.heroCardsInput, 'AsAd')
  assert.equal(createdHandPayload.heroPosition, 'SB')
  assert.equal(createdHandPayload.currentProfit, 12000)
  assert.equal(createdHandPayload.playedDate, '2026-07-03 22:10')
  assert.equal(createdHandPayload.stakeLevel, '200/400')

  page.openSessionEditAction({ currentTarget: { dataset: { type: 'buyin' } } })
  assert.equal(page.data.timelineEditor.type, 'buyin_add')
  page.setData({
    'timelineEditor.amount': '20000',
    'timelineEditor.date': '2026-07-03',
    'timelineEditor.time': '22:20'
  })
  await page.saveTimelineEditor()
  assert.equal(updatedSessionPatch.buyIn, 120000)
  assert.ok(updatedSessionPatch.timelineEvents.some(item => item.type === 'buyin_add' && item.amount === 20000))

  page.openSessionEditAction({ currentTarget: { dataset: { type: 'comment' } } })
  assert.equal(page.data.timelineEditor.type, 'comment')
  page.setData({
    'timelineEditor.text': '插入历史备注',
    'timelineEditor.date': '2026-07-03',
    'timelineEditor.time': '22:30'
  })
  await page.saveTimelineEditor()
  assert.ok(updatedSessionPatch.timelineEvents.some(item => item.type === 'comment' && item.text === '插入历史备注'))

  page.openSessionEditAction({ currentTarget: { dataset: { type: 'ai-reminder' } } })
  assert.equal(wxCalls.storage.pokerLiveOpenAiReminderEditor, '1')
  assert.ok(wxCalls.switchTab.some(item => item.url === '/pages/profile/profile'), 'AI reminder action should open the existing reminder settings entry')

  page.openSessionEditAction({ currentTarget: { dataset: { type: 'full' } } })
  const existingFullEntryNavigation = wxCalls.navigateTo.find(item => item.url.startsWith('/pages/hand-ledger-input/hand-ledger-input?sessionId=session_done'))
  assert.ok(existingFullEntryNavigation)
  assert.ok(existingFullEntryNavigation.url.includes('returnTo=session-edit'))
  assert.ok(existingFullEntryNavigation.url.includes('playedDate=' + encodeURIComponent('2026-07-03 20:30')))

  page.deleteTimelineItem({ currentTarget: { dataset: { id: 'hand_1' } } })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(deletedHandId, 'hand_1')

  session = {
    _id: 'session_done',
    title: '200/400 @ MGM',
    status: 'finished',
    venue: 'MGM',
    smallBlind: 200,
    bigBlind: 400,
    gameType: 'NLHE',
    tableSize: 8,
    hasStraddle: false,
    date: '2026-07-03',
    startTime: '2026-07-03 18:00',
    endTime: '2026-07-03 23:00',
    buyIn: 100000,
    cashOut: 105000,
    endingChips: 105000,
    totalProfit: 5000,
    handCount: 1,
    timelineEvents: []
  }
  hands = []
  createdHands = []
  createdSessionPayload = null
  const historyPage = createPageInstance(pageConfig)
  historyPage.onLoad({ mode: 'history', edit: '1' })
  await historyPage.refresh()
  assert.equal(historyPage.data.mode, 'history')
  assert.equal(historyPage.data.editMode, true)
  assert.equal(historyPage.data.sessionEditVisible, true)
  assert.equal(historyPage.data.session._id, 'history_session_draft')
  assert.equal(historyPage.data.session.status, 'finished')
  assert.ok(historyPage.data.sessionTimeline.some(item => item.id === 'session-buyin'))
  assert.ok(historyPage.data.sessionTimeline.some(item => item.id === 'session-cashout'))
  assert.equal(
    new Date(historyPage.data.session.endTime.replace(' ', 'T')).getTime() - new Date(historyPage.data.session.startTime.replace(' ', 'T')).getTime(),
    60 * 60 * 1000,
    'new history session should default cash-out to one hour after buy-in'
  )

  historyPage.setData({
    'form.venue': 'MGM',
    'form.blindPreset': '300/600',
    'form.smallBlind': '300',
    'form.bigBlind': '600',
    'form.buyIn': '60000',
    'form.cashOut': '72000',
    'form.startDate': '2026-07-09',
    'form.startTime': '12:00',
    'form.endDate': '2026-07-09',
    'form.endTime': '18:00'
  })
  historyPage.syncHistoryDraftFromForm()

  historyPage.openSessionEditAction({ currentTarget: { dataset: { type: 'comment' } } })
  assert.equal(historyPage.data.timelineEditor.date, '2026-07-09')
  assert.equal(historyPage.data.timelineEditor.time, '15:00', 'new timeline events should default inside the session time range')
  historyPage.closeTimelineEditor()

  historyPage.openSessionEditAction({ currentTarget: { dataset: { type: 'quick' } } })
  historyPage.setData({
    'timelineEditor.heroCardsInput': 'Td9d',
    'timelineEditor.heroCardsVisual': [{ rank: 'T', suit: 'd' }, { rank: '9', suit: 'd' }],
    'timelineEditor.heroPosition': 'BTN',
    'timelineEditor.currentProfit': '+8000',
    'timelineEditor.notes': '历史速记',
    'timelineEditor.date': '2026-07-09',
    'timelineEditor.time': '12:58'
  })
  await historyPage.saveTimelineEditor()
  assert.equal(historyPage.data.historyDraftHands.length, 1)
  assert.equal(historyPage.data.historyDraftHands[0].playedDate, '2026-07-09 12:58')
  assert.equal(historyPage.data.historyDraftHands[0].currentProfit, 8000)

  historyPage.openSessionEditAction({ currentTarget: { dataset: { type: 'comment' } } })
  historyPage.setData({
    'timelineEditor.text': '历史备注',
    'timelineEditor.date': '2026-07-09',
    'timelineEditor.time': '13:10'
  })
  await historyPage.saveTimelineEditor()
  assert.ok(historyPage.data.session.timelineEvents.some(item => item.type === 'comment' && item.text === '历史备注'))

  await historyPage.saveSession()
  assert.equal(createdSessionPayload.status, 'finished')
  assert.equal(createdSessionPayload.venue, 'MGM')
  assert.equal(createdSessionPayload.smallBlind, 300)
  assert.equal(createdSessionPayload.bigBlind, 600)
  assert.equal(createdSessionPayload.buyIn, 60000)
  assert.equal(createdSessionPayload.cashOut, 72000)
  assert.equal(createdSessionPayload.totalProfit, 12000)
  assert.equal(createdSessionPayload.handCount, 1)
  assert.equal(createdHands.length, 1)
  assert.equal(createdHands[0].sessionId, 'session_history_saved')
  assert.equal(createdHands[0].heroCardsInput, 'Td9d')
  assert.equal(wxCalls.redirectTo.some(item => item.url === '/pages/session-detail/session-detail?id=session_history_saved'), true)

  createdSessionPayload = null
  createdHands = []
  wxCalls.redirectTo.length = 0
  const historyFullPage = createPageInstance(pageConfig)
  historyFullPage.onLoad({ mode: 'history', edit: '1' })
  await historyFullPage.refresh()
  historyFullPage.setData({
    'form.venue': 'MGM',
    'form.blindPreset': '300/600',
    'form.smallBlind': '300',
    'form.bigBlind': '600',
    'form.buyIn': '60000',
    'form.cashOut': '60000',
    'form.startDate': '2026-07-09',
    'form.startTime': '12:00',
    'form.endDate': '2026-07-09',
    'form.endTime': '18:00'
  })
  historyFullPage.syncHistoryDraftFromForm()
  historyFullPage.openSessionEditAction({ currentTarget: { dataset: { type: 'full' } } })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(createdSessionPayload.status, 'finished')
  const fullEntryNavigation = wxCalls.redirectTo.find(item => item.url.startsWith('/pages/hand-ledger-input/hand-ledger-input?sessionId=session_history_saved'))
  assert.ok(fullEntryNavigation, 'history session full entry should open the ledger recorder')
  assert.ok(fullEntryNavigation.url.includes('returnTo=session-edit'), 'full entry should carry the session edit return target')
  assert.ok(fullEntryNavigation.url.includes('playedDate=' + encodeURIComponent('2026-07-09 15:00')), 'full entry should default inside the history session range')
}

run().then(() => {
  console.log('session detail edit timeline ok')
}).catch(error => {
  console.error(error)
  process.exit(1)
})
