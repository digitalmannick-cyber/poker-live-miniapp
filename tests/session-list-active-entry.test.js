const assert = require('node:assert/strict')
const fs = require('node:fs')

let pageConfig = null
global.Page = function Page(config) {
  pageConfig = config
}

const wxCalls = {
  navigateTo: [],
  switchTab: [],
  toasts: [],
  storage: {}
}

global.wx = {
  navigateTo(config) {
    wxCalls.navigateTo.push(config)
  },
  switchTab(config) {
    wxCalls.switchTab.push(config)
  },
  showToast(config) {
    wxCalls.toasts.push(config)
  },
  setStorageSync(key, value) {
    wxCalls.storage[key] = value
  },
  getStorageSync(key) {
    return wxCalls.storage[key]
  },
  removeStorageSync(key) {
    delete wxCalls.storage[key]
  }
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

let sessions = []
let hands = []
let aiReminders = []
let createdPayload = null
let createdHandPayload = null
let appSettings = {
  chipUnit: 'HKD',
  venues: ['Wynn', 'MGM'],
  blindPresets: ['200/400', '100/200'],
  lastBlindPreset: '200/400'
}

dataService.getAppSettings = function getAppSettings() {
  return appSettings
}

dataService.updateSettings = function updateSettings(patch) {
  appSettings = Object.assign({}, appSettings, patch || {})
  return appSettings
}

dataService.getSessionListData = async function getSessionListData() {
  return { sessions }
}

dataService.getSessionDetailData = async function getSessionDetailData(sessionId) {
  return {
    session: sessions.find(session => session._id === sessionId) || null,
    hands: hands.filter(hand => hand.sessionId === sessionId)
  }
}

dataService.getAiRemindersBySessionId = async function getAiRemindersBySessionId(sessionId) {
  return aiReminders.filter(reminder => reminder.sessionId === sessionId)
}

dataService.markAiReminderShown = async function markAiReminderShown(reminderId) {
  aiReminders = aiReminders.map(reminder => {
    if (reminder._id !== reminderId) return reminder
    return Object.assign({}, reminder, { status: 'shown', shownAt: Date.now() })
  })
  return aiReminders.find(reminder => reminder._id === reminderId) || null
}

dataService.createSession = async function createSession(payload) {
  createdPayload = payload
  const status = payload.status || 'active'
  const session = {
    _id: status === 'finished' ? 'session_history_created' : 'session_active_created',
    title: payload.venue + ' ' + payload.smallBlind + '/' + payload.bigBlind,
    date: payload.date,
    startTime: payload.startTime,
    endTime: payload.endTime || '',
    status,
    venue: payload.venue,
    smallBlind: Number(payload.smallBlind),
    bigBlind: Number(payload.bigBlind),
    buyIn: Number(payload.buyIn),
    cashOut: Number(payload.cashOut) || 0,
    totalProfit: Number(payload.totalProfit) || 0,
    handCount: Number(payload.handCount) || 0,
    tableSize: Number(payload.tableSize),
    hasStraddle: !!payload.hasStraddle,
    currentProfit: Number(payload.totalProfit) || 0,
    timelineEvents: payload.timelineEvents || []
  }
  sessions = [session].concat(sessions)
  return session
}

dataService.createHand = async function createHand(payload) {
  createdHandPayload = payload
  const hand = Object.assign({
    _id: 'hand_' + (hands.length + 1),
    createdAt: Date.now(),
    reviewStatus: 'pending'
  }, payload)
  hands = [hand].concat(hands)
  sessions = sessions.map(session => {
    if (session._id !== payload.sessionId) return session
    return Object.assign({}, session, {
      handCount: (Number(session.handCount) || 0) + 1,
      currentProfit: (Number(session.currentProfit) || 0) + (Number(payload.currentProfit) || 0),
      totalProfit: (Number(session.totalProfit) || Number(session.currentProfit) || 0) + (Number(payload.currentProfit) || 0)
    })
  })
  return hand
}

dataService.updateSession = async function updateSession(sessionId, patch) {
  sessions = sessions.map(session => {
    if (session._id !== sessionId) return session
    return Object.assign({}, session, patch, { updatedAt: Date.now() })
  })
  return sessions.find(session => session._id === sessionId) || null
}

dataService.finishSession = async function finishSession(sessionId, payload) {
  sessions = sessions.map(session => {
    if (session._id !== sessionId) return session
    const cashOut = Number(payload.cashOut) || 0
    return Object.assign({}, session, {
      status: 'finished',
      cashOut,
      endingChips: cashOut,
      endTime: payload.endTime,
      totalProfit: cashOut - (Number(session.buyIn) || 0),
      currentProfit: cashOut - (Number(session.buyIn) || 0),
      timerPausedAt: ''
    })
  })
  return sessions.find(session => session._id === sessionId) || null
}

require('../pages/session-list/session-list.js')

async function run() {
  const wxml = fs.readFileSync('pages/session-list/session-list.wxml', 'utf8')
  const wxss = fs.readFileSync('pages/session-list/session-list.wxss', 'utf8')
  assert.ok(!/session-tool primary\"[^>]+data-type=\"quick\"/.test(wxml), 'quick tool should not be highlighted by default')
  assert.ok(!wxml.includes('data-type="stack"'), 'stack update action should not be shown in active session tools')
  assert.ok(wxml.includes('/assets/session-icons/p5-buyin-v251.png'), 'buy-in tool should use the aligned P5 icon asset')
  assert.ok(wxml.includes('/assets/session-icons/p5-comment-v251.png'), 'comment tool should use the aligned P5 icon asset')
  assert.ok(wxml.includes('/assets/session-icons/p5-quick-v251.png'), 'quick tool should use the aligned P5 icon asset')
  assert.ok(wxml.includes('/assets/session-icons/p5-full-v251.png'), 'full entry tool should use the aligned P5 icon asset')
  assert.ok(/session-event-cards[\s\S]+session-live-event-title hand-position[\s\S]+session-live-event-amount/.test(wxml), 'timeline hand rows should render cards, position, then profit')
  assert.ok(wxss.includes('grid-template-columns: 56rpx 76rpx minmax(0, 1fr) auto'), 'timeline rows should reserve the right edge for profit')
  assert.ok(wxss.includes('align-items: center'), 'timeline rows should vertically align icon, time, title, and amount')
  assert.ok(!wxml.includes('reminderCard.label'), 'session timeline reminder card should not repeat the strong-reminder label')
  assert.ok(wxml.includes('wx:if="{{!item.reminderCard.acknowledged}}" class="session-reminder-ack"'), 'acknowledged reminders should stay visible without the ack button')
  assert.ok(wxml.includes('bindtap="showSessionListFromActive"'), 'active session page should expose a back-to-list control')
  assert.ok(wxml.includes('bindtap="editActiveSession"'), 'active session page should expose direct edit entry')
  assert.ok(wxml.includes('bindchange="pickCreateBlind"'), 'blind level should use picker dropdown')
  assert.ok(wxml.includes('bindchange="pickCreateTableSize"'), 'table size should use picker dropdown')
  assert.ok(wxml.includes('bindchange="pickCreateVenue"'), 'venue should use picker dropdown')

  const page = createPageInstance(pageConfig)
  await page.refreshSessions()

  assert.equal(page.data.activeSession, null)
  wxCalls.storage.pokerLiveOpenCreateSession = true
  page.consumeOpenCreateSessionHint()
  assert.equal(page.data.sessionCreateChoiceVisible, true)
  assert.equal(wxCalls.storage.pokerLiveOpenCreateSession, undefined)
  page.closeCreateSession()

  page.goNewSession()
  assert.equal(page.data.sessionCreateChoiceVisible, true)
  page.openLiveSessionCreate()
  assert.equal(page.data.sessionCreateVisible, true)
  assert.deepEqual(wxCalls.navigateTo, [], 'new session should not navigate to old create page')
  assert.equal(page.data.createForm.venue, 'Wynn')
  assert.equal(page.data.createForm.blindPreset, '200/400')
  assert.equal(page.data.createForm.buyIn, '40000')
  assert.deepEqual(page.data.tableSizeOptions.map(item => item.label), ['6max', '8max', '9max'])
  page.closeCreateSession()

  dataService.updateSettings({
    venues: ['Wynn', 'MGM', 'Studio City'],
    blindPresets: ['200/400', '100/200', '500/1000'],
    lastBlindPreset: '500/1000'
  })
  page.goNewSession()
  page.openLiveSessionCreate()
  assert.deepEqual(page.data.venueOptions.map(item => item.value), ['Wynn', 'MGM', 'Studio City'])
  assert.deepEqual(page.data.blindPresetOptions.map(item => item.value), ['500/1000', '200/400', '100/200'])
  assert.equal(page.data.createForm.blindPreset, '500/1000')
  assert.equal(page.data.createForm.bigBlind, '1000')
  page.closeCreateSession()
  dataService.updateSettings({
    venues: ['Wynn', 'MGM'],
    blindPresets: ['200/400', '100/200'],
    lastBlindPreset: '200/400'
  })

  page.goNewSession()
  page.startHistorySessionDraft()
  assert.equal(page.data.historySessionEditMode, false)
  assert.ok(wxCalls.navigateTo.some(item => item.url === '/pages/session-detail/session-detail?mode=history&edit=1'))

  page.goNewSession()
  page.openLiveSessionCreate()
  page.pickCreateVenue({ detail: { value: page.data.venueOptions.findIndex(item => item.value === 'MGM') } })
  page.pickCreateBlind({ detail: { value: page.data.blindPresetOptions.findIndex(item => item.value === '100/200') } })
  page.pickCreateTableSize({ detail: { value: 0 } })
  assert.equal(page.data.createForm.venue, 'MGM')
  assert.equal(page.data.createForm.blindPreset, '100/200')
  assert.equal(page.data.createForm.smallBlind, '100')
  assert.equal(page.data.createForm.bigBlind, '200')
  assert.equal(page.data.createForm.tableSize, '6')

  await page.startSessionFromSheet()
  assert.equal(page.data.sessionCreateVisible, false)
  assert.equal(createdPayload.venue, 'MGM')
  assert.equal(createdPayload.smallBlind, '100')
  assert.equal(createdPayload.bigBlind, '200')
  assert.equal(createdPayload.tableSize, '6')
  assert.equal(createdPayload.endTime, '')
  assert.match(createdPayload.startTime, /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/)
  assert.equal(page.data.activeSessionView.venueDisplay, 'MGM')
  assert.equal(page.data.activeSessionView.levelDisplay, '100/200')
  assert.equal(page.data.showActiveSessionHome, true)
  page.showSessionListFromActive()
  assert.equal(page.data.showActiveSessionHome, false, 'active page back button should reveal the session list')
  page.setData({ showActiveSessionHome: true })
  page.editActiveSession()
  assert.equal(wxCalls.navigateTo.pop().url, '/pages/session-detail/session-detail?id=session_active_created&edit=1')
  assert.match(page.data.durationDisplay, /^\d{2}:\d{2}$/)
  assert.ok(page.data.activeSessionView.currentStackDisplay, 'active view should display current stack')
  assert.ok(page.data.activeTimeline.some(item => item.type === 'buyin'), 'timeline should include initial buy-in')
  assert.ok(page.data.activeTimelineGroups.length >= 1, 'timeline should be grouped by date')
  assert.match(page.data.activeTimelineGroups[0].label, /^\d{4}年\d{1,2}月\d{1,2}日 周[日一二三四五六]$/)

  await page.toggleActiveSessionTimer()
  assert.ok(sessions[0].timerPausedAt, 'pause should write timerPausedAt')
  assert.equal(page.data.activeSessionView.paused, true)

  page.openActiveAction({ currentTarget: { dataset: { type: 'quick' } } })
  assert.equal(page.data.quickEntryVisible, true)
  assert.deepEqual(page.data.positionOptions, ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'])
  page.setData({ activeSession: Object.assign({}, page.data.activeSession, { tableSize: 8 }) })
  page.openActiveAction({ currentTarget: { dataset: { type: 'quick' } } })
  assert.deepEqual(page.data.positionOptions, ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'])
  page.setData({ activeSession: Object.assign({}, page.data.activeSession, { tableSize: 9 }) })
  page.openActiveAction({ currentTarget: { dataset: { type: 'quick' } } })
  assert.deepEqual(page.data.positionOptions, ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'])
  page.openQuickHeroPicker()
  assert.equal(page.data.quickHeroPickerVisible, true, 'quick hand trigger should open hero card picker')
  page.pickQuickHeroCard({ currentTarget: { dataset: { token: 'Ah' } } })
  page.pickQuickHeroCard({ currentTarget: { dataset: { token: 'Qh' } } })
  page.selectQuickPosition({ currentTarget: { dataset: { position: 'BTN' } } })
  page.setData({
    'quickForm.currentProfit': '+20000',
    'quickForm.notes': 'SB 3bet，翻后待补。'
  })
  await page.saveQuickEntry()
  assert.equal(createdHandPayload.sessionId, 'session_active_created')
  assert.equal(createdHandPayload.heroCardsInput, 'AhQh')
  assert.equal(createdHandPayload.heroPosition, 'BTN')
  assert.equal(createdHandPayload.currentProfit, 20000)
  assert.equal(createdHandPayload.effectiveStack, 40000, 'quick hand should inherit hero stack at the time before this hand is recorded')
  assert.equal(page.data.quickEntryVisible, false)
  assert.equal(wxCalls.switchTab.length, 0, 'quick save should stay on the active session page')
  assert.equal(page.data.activeSessionView.totalProfitDisplay, '+HK$20000')
  assert.equal(page.data.activeSessionView.currentStackDisplay, 'HK$60000')
  assert.ok(page.data.activeTimeline.some(item => item.type === 'quick' && item.heroCardsVisual.length === 2), 'timeline should include quick hand cards')
  assert.equal(page.data.activeTimeline[0].type, 'quick', 'new quick entry should be at the top of the timeline')
  assert.ok(page.data.activeTimeline[0].iconAsset, 'timeline quick entry should use an icon asset')
  assert.ok(page.data.activeTimelineGroups.some(group => group.events.some(item => item.type === 'quick' && item.heroCardsVisual.length === 2)), 'grouped timeline should include quick hand cards')
  assert.ok(page.data.activeTimeline.every(item => item.type !== 'quick' || item.title !== '速记'), 'quick timeline item should not repeat quick label')

  hands.unshift({
    _id: 'hand_full_ledger_time',
    sessionId: 'session_active_created',
    heroCardsInput: 'QsQh',
    heroPosition: 'CO',
    playedDate: '2026-07-10',
    createdAt: '2026-07-10 21:56',
    createdAtMs: new Date('2026-07-10T21:56:00').getTime(),
    currentProfit: 24000,
    inputMode: 'ledger_full',
    reviewSource: 'ledger_full',
    ledgerState: { actions: [] }
  })
  aiReminders = [{
    _id: 'reminder_session_max',
    sessionId: 'session_active_created',
    type: 'session_max_hours',
    title: 'Session 时长预提醒',
    message: '距离 8 小时时长上限还有约 2 小时。',
    channels: { sessionTimeline: true },
    status: 'pending',
    createdAt: '2026-07-10 21:57'
  }]
  await page.refreshActiveTimeline(page.data.activeSession, page.data.settings)
  const fullTimelineItem = page.data.activeTimeline.find(item => item.id === 'hand_full_ledger_time')
  assert.equal(fullTimelineItem.type, 'full', 'full ledger hands should use the full-record timeline type')
  assert.equal(fullTimelineItem.iconAsset, '/assets/session-icons/p5-full-v251.png', 'full ledger hands should use the full-record icon')
  assert.equal(fullTimelineItem.timeDisplay, '21:56', 'date-only playedDate should fall back to exact createdAt time')
  hands.unshift({
    _id: 'hand_full_legacy_marker',
    sessionId: 'session_active_created',
    heroCardsInput: 'QdQs',
    heroPosition: 'CO',
    playedDate: '2026-07-10',
    createdAt: '2026-07-10 21:58',
    currentProfit: 24000,
    tags: ['精准录入'],
    streetInputs: {
      preflop: { actionLine: 'Hero CO R1000, BB C600', pot: 2200 }
    }
  })
  await page.refreshActiveTimeline(page.data.activeSession, page.data.settings)
  const legacyFullTimelineItem = page.data.activeTimeline.find(item => item.id === 'hand_full_legacy_marker')
  assert.equal(legacyFullTimelineItem.type, 'full', 'legacy precision-entry hands should use the full-record timeline type')
  assert.equal(legacyFullTimelineItem.iconAsset, '/assets/session-icons/p5-full-v251.png', 'legacy precision-entry hands should use the full-record icon')
  assert.equal(legacyFullTimelineItem.timeDisplay, '21:58')
  hands.unshift({
    _id: 'hand_full_legacy_compact_cloud',
    sessionId: 'session_active_created',
    heroCardsInput: 'AsKh',
    heroPosition: 'BTN',
    playedDate: '2026-07-10',
    createdAt: '2026-07-10 22:02',
    currentProfit: 0,
    detailBackfilled: true,
    reviewStatus: 'reviewed',
    streetSummary: 'Preflop: Hero BTN R1600, BB C1200',
    voiceExtract: {}
  })
  await page.refreshActiveTimeline(page.data.activeSession, page.data.settings)
  const compactLegacyFullItem = page.data.activeTimeline.find(item => item.id === 'hand_full_legacy_compact_cloud')
  assert.equal(compactLegacyFullItem.type, 'full', 'legacy compact cloud full-entry hands should not fall back to quick type')
  assert.equal(compactLegacyFullItem.iconAsset, '/assets/session-icons/p5-full-v251.png')
  assert.equal(page.data.activeSessionView.totalProfitDisplay, '+HK$68000', 'active session live profit should include recorded hand results')
  page.refreshDurationDisplay()
  assert.equal(page.data.activeSessionView.totalProfitDisplay, '+HK$68000', 'duration refresh should keep the live recorded profit instead of resetting it to zero')
  const reminderTimelineItem = page.data.activeTimeline.find(item => item.id === 'ai-reminder-reminder_session_max')
  assert.ok(reminderTimelineItem, 'pending AI reminder should be visible on the session timeline')
  assert.equal(reminderTimelineItem.reminderCard.advice, '', 'duplicate reminder advice should be collapsed')
  await page.acknowledgeSessionReminder({ currentTarget: { dataset: { id: 'reminder_session_max' } } })
  const acknowledgedReminder = page.data.activeTimeline.find(item => item.id === 'ai-reminder-reminder_session_max')
  assert.ok(acknowledgedReminder, 'acknowledged AI reminder should remain on the session timeline')
  assert.equal(acknowledgedReminder.reminderCard.acknowledged, true)
  hands = hands.filter(hand => hand._id !== 'hand_full_ledger_time' && hand._id !== 'hand_full_legacy_marker')
  aiReminders = []
  await page.refreshActiveTimeline(page.data.activeSession, page.data.settings)

  page.openActiveAction({ currentTarget: { dataset: { type: 'buyin' } } })
  assert.deepEqual(page.data.buyInQuickOptions.map(item => item.label), ['50bb', '100bb', '200bb'])
  assert.deepEqual(page.data.buyInQuickOptions.map(item => item.amount), [10000, 20000, 40000])
  page.selectBuyInQuick({ currentTarget: { dataset: { amount: 40000 } } })
  assert.equal(page.data.buyInInput, '40000')
  page.setData({ buyInInput: '8000' })
  await page.saveActiveBuyIn()
  assert.equal(sessions[0].buyIn, 48000)
  assert.equal(page.data.activeSessionView.currentStackDisplay, 'HK$68000')
  assert.ok(sessions[0].timelineEvents.some(item => item.type === 'buyin_add'), 'buy-in should append timeline event')
  assert.equal(page.data.activeTimeline[0].type, 'buyin_add', 'new buy-in event should be at the top of the timeline')

  page.openActiveAction({ currentTarget: { dataset: { type: 'comment' } } })
  await page.selectCommentMode({ currentTarget: { dataset: { mode: 'table_change' } } })
  assert.equal(page.data.sessionActionSheetVisible, true, 'table change should stay open for level selection')
  assert.equal(page.data.commentMode, 'table_change')
  const tableChangeIndex = page.data.tableChangeBlindOptions.findIndex(item => item.value === '200/400')
  assert.ok(tableChangeIndex >= 0, 'table change options should include configured blind presets')
  page.pickTableChangeBlind({ detail: { value: tableChangeIndex } })
  page.selectTableChangeStraddle({ currentTarget: { dataset: { value: 'true' } } })
  assert.match(page.data.tableChangeSummary, /100\/200 \/ Straddle 否 → 200\/400 \/ Straddle 是/)
  await page.saveTableChange()
  assert.equal(sessions[0].smallBlind, '200')
  assert.equal(sessions[0].bigBlind, '400')
  assert.equal(sessions[0].blindPreset, '200/400')
  assert.equal(sessions[0].hasStraddle, true)
  assert.ok(sessions[0].timelineEvents.some(item => item.type === 'table_change' && item.nextLevel === '200/400' && item.hasStraddle === true), 'table change should append semantic timeline event')
  assert.equal(page.data.sessionActionSheetVisible, false, 'table change save should close the sheet')
  assert.equal(page.data.activeTimeline[0].type, 'table_change', 'new table change event should be at the top of the timeline')

  page.openActiveAction({ currentTarget: { dataset: { type: 'quick' } } })
  page.setData({
    'quickForm.heroCardsInput': 'KcKh',
    quickHeroCardsVisual: [{ rank: 'K', suit: 'c' }, { rank: 'K', suit: 'h' }],
    'quickForm.heroPosition': 'BB',
    'quickForm.currentProfit': '-1000',
    'quickForm.notes': ''
  })
  await page.saveQuickEntry()
  assert.equal(createdHandPayload.stakeLevel, '200/400', 'quick hand after table change should inherit new level')
  assert.equal(createdHandPayload.hasStraddle, true, 'quick hand after table change should inherit new straddle state')
  assert.equal(createdHandPayload.effectiveStack, 68000, 'quick hand should inherit current session stack after earlier hands and buy-ins')

  page.openActiveAction({ currentTarget: { dataset: { type: 'comment' } } })
  await page.selectCommentMode({ currentTarget: { dataset: { mode: 'break' } } })
  assert.equal(page.data.activeTimeline[0].type, 'comment')
  assert.equal(page.data.activeTimeline[0].title, '休息', 'single-node comment should not repeat parent and child text')
  assert.notEqual(page.data.activeTimeline[0].title, '休息 休息')

  page.openActiveAction({ currentTarget: { dataset: { type: 'full' } } })
  assert.deepEqual(wxCalls.navigateTo.pop(), { url: '/pages/hand-ledger-input/hand-ledger-input?sessionId=session_active_created' })
  assert.equal(wxCalls.storage.pokerLivePendingRecordSessionId, undefined)

  page.openCashOutSheet()
  assert.equal(page.data.cashOutVisible, true)
  page.setData({ cashOutInput: '60000' })
  await page.finishActiveSession()
  assert.equal(sessions[0].status, 'finished')
  assert.equal(sessions[0].totalProfit, 12000)
  assert.equal(page.data.cashOutVisible, false)
  assert.equal(page.data.activeSessionView, null)

  page.stopDurationClock()
}

run().then(() => {
  console.log('session list active entry ok')
}).catch(error => {
  console.error(error)
  process.exit(1)
})
