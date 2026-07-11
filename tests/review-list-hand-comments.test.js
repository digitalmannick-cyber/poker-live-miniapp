const assert = require('node:assert/strict')
const fs = require('node:fs')

let pageConfig = null
global.Page = function Page(config) {
  pageConfig = config
}

const wxCalls = {
  toast: [],
  storage: {}
}

global.wx = {
  getStorageSync(key) { return wxCalls.storage[key] },
  setStorageSync(key, value) { wxCalls.storage[key] = value },
  removeStorageSync(key) { delete wxCalls.storage[key] },
  showToast(options) { wxCalls.toast.push(options) },
  navigateTo() {},
  switchTab() {}
}

function setByPath(target, path, value) {
  const parts = String(path).split('.')
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

function rowByKeyFrom(detailHand, key) {
  return detailHand.detailRows.find(row => row.key === key)
}

const dataService = require('../services/data-service')
const tabBar = require('../utils/tab-bar')
const onboardingGuide = require('../utils/onboarding-guide')

tabBar.syncCustomTabBar = function syncCustomTabBar() {}
onboardingGuide.getStepForRoute = function getStepForRoute() { return null }

let hands = [{
  _id: 'hand_comment_1',
  sessionId: 'session_1',
  heroCardsInput: 'AhQh',
  currentProfit: 12000,
  playedDate: '2026-07-03 20:30',
  reviewStatus: 'reviewed',
  detailBackfilled: true,
  handComments: [{
    id: 'comment_existing',
    text: '已有评论',
    createdAt: '2026-07-03 20:31'
  }]
}, {
  _id: 'hand_quick_only',
  sessionId: 'session_1',
  heroCardsInput: 'JsJd',
  currentProfit: -8000,
  playedDate: '2026-07-03 20:20',
  source: 'session_quick_note',
  reviewStatus: 'idle'
}, {
  _id: 'hand_stale_ledger_allin',
  sessionId: 'session_1',
  heroPosition: 'BB',
  heroCardsInput: 'KhKc',
  opponentCards: 'JhJc',
  showdown: 'JhJc',
  board: { flop: '8c9c6s', turn: '3h', river: '2h' },
  currentProfit: 50000,
  effectiveStack: 219100,
  potSize: 262800,
  allInPot: 262800,
  heroInvested: 211000,
  allInEv: 2892.92,
  isAllIn: true,
  allInStreet: 'preflop',
  reviewStatus: 'reviewed',
  detailBackfilled: true,
  playedDate: '2026-07-04',
  ledgerState: {
    heroSlot: 'BB',
    heroPosition: 'BB',
    heroCardsInput: 'KhKc',
    villainCards: 'JhJc',
    board: { flop: '8c9c6s', turn: '3h', river: '2h' },
    players: {
      SB: { initialStack: 40000, stack: 39800, live: false },
      BB: { initialStack: 219100, stack: 169100, live: true, paid: 50000 },
      UTG: { initialStack: 40000, stack: 40000, live: false },
      'UTG+1': { initialStack: 40000, stack: 40000, live: false },
      MP: { initialStack: 40000, stack: 40000, live: false },
      HJ: { initialStack: 50000, stack: 0, live: true, paid: 50000, cards: 'JhJc' },
      CO: { initialStack: 40000, stack: 40000, live: false },
      BTN: { initialStack: 40000, stack: 38400, live: false, paid: 1600 }
    },
    actions: [
      { street: 'Pre', pos: 'SB', position: 'SB', action: 'Post', amount: 200 },
      { street: 'Pre', pos: 'BB', position: 'BB', action: 'Post', amount: 400 },
      { street: 'Pre', pos: 'UTG', position: 'UTG', action: 'Fold' },
      { street: 'Pre', pos: 'UTG+1', position: 'UTG+1', action: 'Fold' },
      { street: 'Pre', pos: 'MP', position: 'MP', action: 'Fold' },
      { street: 'Pre', pos: 'HJ', position: 'HJ', action: 'Call', amount: 400 },
      { street: 'Pre', pos: 'CO', position: 'CO', action: 'Fold' },
      { street: 'Pre', pos: 'BTN', position: 'BTN', action: 'Raise', amount: 1600 },
      { street: 'Pre', pos: 'SB', position: 'SB', action: 'Fold' },
      { street: 'Pre', pos: 'BB', position: 'BB', action: 'Raise', amount: 8500 },
      { street: 'Pre', pos: 'HJ', position: 'HJ', action: 'Raise', amount: 22000 },
      { street: 'Pre', pos: 'BTN', position: 'BTN', action: 'Fold' },
      { street: 'Pre', pos: 'BB', position: 'BB', action: 'All-in', amount: 211000 },
      { street: 'Pre', pos: 'HJ', position: 'HJ', action: 'All-in', amount: 50000 },
      { street: 'Pre', pos: 'HJ', position: 'HJ', action: 'Show' }
    ]
  }
}]

let updatedHandId = ''
let updatedPatch = null

dataService.getAppSettings = function getAppSettings() {
  return { chipUnit: 'HKD' }
}
dataService.getSessionListData = async function getSessionListData() {
  return { sessions: [{ _id: 'session_1', status: 'finished' }] }
}
dataService.getReviewData = async function getReviewData() {
  return {
    hands,
    sessions: [{ _id: 'session_1', status: 'finished' }],
    summary: { totalHands: hands.length, totalProfit: 12000 }
  }
}
dataService.updateHand = async function updateHand(handId, patch) {
  updatedHandId = handId
  updatedPatch = patch
  hands = hands.map(hand => hand._id === handId ? Object.assign({}, hand, patch) : hand)
  return hands.find(hand => hand._id === handId)
}
dataService.getHandById = async function getHandById(handId) {
  return hands.find(hand => hand._id === handId)
}
dataService.getSessionById = async function getSessionById(sessionId) {
  return { _id: sessionId, status: 'finished', title: 'MGM 200/400' }
}
dataService.getActionsByHandId = async function getActionsByHandId() {
  return []
}

require('../pages/review-list/review-list.js')

async function run() {
  const wxml = fs.readFileSync('pages/review-list/review-list.wxml', 'utf8')
  assert.ok(wxml.includes('openHandComment'), 'review list should expose a hand comment action')
  assert.ok(wxml.includes('review-comment-trigger'), 'review list should render the comment icon trigger')
  assert.ok(wxml.includes('review-comment-modal'), 'review list should include the comment editor modal')
  assert.equal(wxml.includes('review-comment-kicker'), false, 'comment sheet should not show the extra HAND COMMENT title block')
  assert.equal(wxml.includes('handCommentTitle'), false, 'comment sheet should not show the hand summary in the header')
  assert(
    wxml.indexOf('bindtap="saveHandComment"') > -1 &&
    wxml.indexOf('bindtap="saveHandComment"') < wxml.indexOf('class="review-comment-input"'),
    'save comment action should be visible above the text input instead of below the fold'
  )
  assert.ok(wxml.includes('bindtap="openHandDetail"'), 'tapping a review-list hand should open hand detail directly')
  assert.equal(wxml.includes('bindtap="openReviewChoice"'), false, 'review mode choice should not be the list-item tap target')
  assert.ok(
    wxml.includes('wx:if="{{detailLoading && !detailHand}}"'),
    'detail modal should render a preview hand immediately while full detail continues loading'
  )
  const reviewListJs = fs.readFileSync('pages/review-list/review-list.js', 'utf8')
  assert.match(reviewListJs, /setTimeout\(\(\) => \{\s*this\.loadHandDetail\(handId\)/s, 'full all-in detail derivation should be deferred so the detail sheet paints immediately')

  const page = createPageInstance(pageConfig)
  await page.refresh()

  assert.equal(page.data.hands[0].hasHandComments, true)
  assert.equal(page.data.hands[0].handCommentCount, 1)
  assert.equal(page.data.hands[0].canHandComment, true)
  const quickOnly = page.data.hands.find(item => item._id === 'hand_quick_only')
  assert.ok(quickOnly)
  assert.equal(quickOnly.canHandComment, false)
  const staleListItem = page.data.hands.find(item => item._id === 'hand_stale_ledger_allin')
  assert.ok(staleListItem)
  assert.equal(staleListItem.potSize, 101800)
  assert.equal(staleListItem.allInEv, 2892.92, 'review list should not run expensive equity EV derivation for every item')

  let resolveDetailRead = null
  const originalGetHandById = dataService.getHandById
  dataService.getHandById = function delayedGetHandById(handId) {
    return new Promise(resolve => {
      resolveDetailRead = () => resolve(hands.find(hand => hand._id === handId))
    })
  }
  const openingDetail = page.openHandDetail({ currentTarget: { dataset: { id: 'hand_stale_ledger_allin' } } })
  assert.equal(openingDetail, undefined, 'openHandDetail should return immediately instead of awaiting full detail derivation')
  assert.equal(page.data.detailVisible, true)
  assert.equal(page.data.detailLoading, true)
  assert(page.data.detailHand, 'detail sheet should render a list-safe preview before full EV derivation finishes')
  assert.equal(rowByKeyFrom(page.data.detailHand, 'potSize').displayValue, '101800')
  await new Promise(resolve => setTimeout(resolve, 0))
  resolveDetailRead()
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
  dataService.getHandById = originalGetHandById

  const rowByKey = key => page.data.detailHand.detailRows.find(row => row.key === key)
  assert.equal(rowByKey('effectiveStack').displayValue, '50000')
  assert.equal(rowByKey('potSize').displayValue, '101800')
  assert(page.data.detailHand.allInEvDisplay.includes('HK$'))
  assert(
    Number(page.data.detailHand.allInEv) > 30000 &&
    Number(page.data.detailHand.allInEv) < 38000,
    'full detail should asynchronously replace stale EV with rederived effective-stack EV'
  )

  page.openHandDetail({ currentTarget: { dataset: { id: 'hand_quick_only' } } })
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(page.data.detailVisible, true)
  assert.equal(page.data.voicePanelVisible, false, 'unreviewed hands should open the detail shell with review entry choices, not auto-open voice review')
  assert(page.data.detailHand, 'unreviewed hand should still render the hand detail shell')
  assert.equal(page.data.detailHand.hasCompletedReview, false)

  page.openHandComment({ currentTarget: { dataset: { id: 'hand_comment_1' } } })
  assert.equal(page.data.handCommentVisible, true)
  assert.equal(page.data.handCommentHandId, 'hand_comment_1')
  assert.equal(page.data.handCommentItems.length, 1)

  page.onHandCommentInput({ detail: { value: '这手河牌应该少亏一点' } })
  await page.saveHandComment()

  assert.equal(updatedHandId, 'hand_comment_1')
  assert.equal(updatedPatch.handComments.length, 2)
  assert.equal(updatedPatch.handComments[0].text, '这手河牌应该少亏一点')
  assert.equal(updatedPatch.handComments[1].text, '已有评论')
  assert.equal(page.data.handCommentVisible, false)
  assert.equal(page.data.hands[0].handCommentCount, 2)
}

run().then(() => {
  console.log('review list hand comments ok')
}).catch(error => {
  console.error(error)
  process.exit(1)
})
