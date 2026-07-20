const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('shared unread formats the header badge and boolean tab dot', () => {
  const { createSocialUnreadState } = require('../utils/social-unread-state')
  const state = createSocialUnreadState({ service: {}, now: () => 1000 })
  ;[
    [0, '', false],
    [1, '1', true],
    [99, '99', true],
    [100, '99+', true]
  ].forEach(([count, label, hasUnread]) => {
    state.applyAuthoritativeCount(count)
    assert.deepEqual(state.getSnapshot(), { count, label, hasUnread })
  })
})
test('a mutation prevents an older unread refresh from overwriting the count', async () => {
  const pending = deferred()
  const { createSocialUnreadState } = require('../utils/social-unread-state')
  const state = createSocialUnreadState({
    service: { getUnreadNotificationCount: () => pending.promise },
    now: () => 1000,
    throttleMs: 0
  })
  const refresh = state.refresh({ force: true })
  state.applyAuthoritativeCount(2)
  pending.resolve({ unreadCount: 9 })
  await refresh
  assert.equal(state.getSnapshot().count, 2)
})

test('a post-mutation refresh can surface a newly arrived notification', async () => {
  const responses = [{ unreadCount: 7 }, { unreadCount: 1 }]
  const { createSocialUnreadState } = require('../utils/social-unread-state')
  const state = createSocialUnreadState({
    service: { getUnreadNotificationCount: async () => responses.shift() },
    now: () => 1000,
    throttleMs: 0
  })
  state.applyAuthoritativeCount(0)
  await state.refresh({ force: true })
  assert.equal(state.getSnapshot().count, 7)
})

test('subscribe returns an unsubscribe function and account changes reset state', () => {
  const { createSocialUnreadState } = require('../utils/social-unread-state')
  const state = createSocialUnreadState({ service: {}, now: () => 1000 })
  let calls = 0
  const unsubscribe = state.subscribe(() => { calls += 1 })
  state.setAccountKey('WX-A')
  state.applyAuthoritativeCount(3)
  unsubscribe()
  state.applyAuthoritativeCount(4)
  state.setAccountKey('WX-B')
  assert.equal(calls, 3)
  assert.equal(state.getSnapshot().count, 0)
})

test('player header uses a real image badge and navigates to message center', () => {
  const js = fs.readFileSync(path.join(root, 'pages/player-notes/player-notes.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(root, 'pages/player-notes/player-notes.wxml'), 'utf8')
  assert.match(js, /socialUnread/)
  assert.match(js, /pages\/social-messages\/social-messages/)
  assert.doesNotMatch(js, /消息中心即将开放/)
  assert.match(wxml, /<image[^>]+comment-bubble-v263\.png/)
  assert.match(wxml, /socialUnread\.label/)
  assert.doesNotMatch(wxml, /<text>◌<\/text>/)
})

test('custom tab stores unread separately and route polling does not fetch it', () => {
  const js = fs.readFileSync(path.join(root, 'custom-tab-bar/index.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(root, 'custom-tab-bar/index.wxml'), 'utf8')
  assert.match(js, /socialUnread:/)
  assert.match(js, /subscribe/)
  assert.match(js, /isAccountLoggedOut/)
  assert.match(js, /setAccountKey/)
  assert.doesNotMatch(js, /routePollTimer[\s\S]{0,240}getUnreadNotificationCount/)
  assert.match(wxml, /socialUnread[^\n]+player-notes/)
})

test('player library core markup and library source filter remain intact', () => {
  const js = fs.readFileSync(path.join(root, 'pages/player-notes/player-notes.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(root, 'pages/player-notes/player-notes.wxml'), 'utf8')
  ;['player-search', 'player-type-scroll', 'player-card', 'player-empty'].forEach(className => assert.match(wxml, new RegExp('class="[^"]*' + className)))
  assert.match(js, /sourceKind:\s*'library'/)
})

test('player unread account key honors an explicit logout and tolerates older mocks', () => {
  const js = fs.readFileSync(path.join(root, 'pages/player-notes/player-notes.js'), 'utf8')
  assert.match(js, /isAccountLoggedOut/)
  assert.match(js, /typeof dataService\.isAccountLoggedOut === 'function'/)
})
