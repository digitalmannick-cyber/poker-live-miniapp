const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const Module = require('node:module')

const root = path.join(__dirname, '..')

test('message center is registered once and exposes the required states', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.equal(app.pages.filter(item => item === 'pages/social-messages/social-messages').length, 1)

  const json = JSON.parse(fs.readFileSync(path.join(root, 'pages/social-messages/social-messages.json'), 'utf8'))
  const wxml = fs.readFileSync(path.join(root, 'pages/social-messages/social-messages.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(root, 'pages/social-messages/social-messages.wxss'), 'utf8')
  assert.equal(json.navigationBarTitleText, '消息中心')
  ;['全部已读', '内容已不可访问', '好友功能暂时不可用', '离线内容'].forEach(text => assert.match(wxml, new RegExp(text)))
  assert.match(wxml, /aria-label=.*未读/)
  assert.match(wxml, /disabled=/)
  assert.match(wxss, /min-height:\s*(8[0-9]|[9-9][0-9])rpx/)
})

test('notification routing uses only kind, canonical target type, and target id', () => {
  const route = require('../utils/social-notification-route')
  assert.deepEqual(route.resolveNotificationTarget({ kind: 'friend_request', targetType: 'friendship', targetId: 'f-1' }), { type: 'inline' })
  assert.deepEqual(route.resolveNotificationTarget({ kind: 'friend_accepted', targetType: 'friend', targetId: 'u-1' }), {
    type: 'navigate',
    url: '/pages/player-note-detail/player-note-detail?friendUserId=u-1'
  })
  assert.deepEqual(route.resolveNotificationTarget({ kind: 'player_card', targetType: 'player_card_share', targetId: 's/1' }), {
    type: 'navigate',
    url: '/pages/social-card-preview/social-card-preview?shareId=s%2F1'
  })
  ;['selected_hand', 'comment', 'reply', 'like_aggregate'].forEach(kind => {
    assert.deepEqual(route.resolveNotificationTarget({ kind, targetType: 'hand_share', targetId: 'h-1' }), { type: 'unavailable' })
  })
  assert.deepEqual(route.resolveNotificationTarget({ kind: 'friend_accepted', targetType: 'friend', targetId: '', url: '/evil' }), { type: 'unavailable' })
  assert.deepEqual(route.resolveNotificationTarget({ kind: 'unknown', targetType: 'friend', targetId: 'u', path: '/evil' }), { type: 'unavailable' })
})

test('notification errors distinguish network from unavailable content', () => {
  const route = require('../utils/social-notification-route')
  assert.equal(route.describeNotificationError({ code: 'NETWORK_ERROR' }), '好友功能暂时不可用')
  assert.equal(route.describeNotificationError({ code: 'FORBIDDEN' }), '内容已不可访问')
  assert.equal(route.describeNotificationError({ code: 'PLAYER_CARD_UNAVAILABLE' }), '内容已不可访问')
  assert.equal(route.describeNotificationError({ code: 'SOCIAL_ERROR' }), '好友功能暂时不可用')
  assert.equal(route.describeNotificationError({ code: 'NOTIFICATION_STATE_UNSTABLE' }), '好友功能暂时不可用')
  assert.equal(route.describeNotificationError({ code: 'SOMETHING_NEW' }), '好友功能暂时不可用')
})

test('first-page cache is account scoped, five minutes, and DTO-whitelisted', () => {
  const pageSource = fs.readFileSync(path.join(root, 'pages/social-messages/social-messages.js'), 'utf8')
  assert.match(pageSource, /5\s*\*\s*60\s*\*\s*1000/)
  assert.match(pageSource, /getCurrentPlayerId\(\)/)
  assert.match(pageSource, /notificationId/)
  assert.doesNotMatch(pageSource, /cache[^\n]*(openId|sourceHand|playerCardSnapshot)/i)
})

test('pagination is cursor based, single flight, deduplicated, and stale-safe', async () => {
  const more = deferred()
  const fresh = deferred()
  const loaded = loadMessagePage({
    listResponses: [
      { items: [notification('n1')], nextCursor: 'opaque:cursor', unreadCount: 1 },
      more.promise,
      fresh.promise
    ]
  })
  const page = createInstance(loaded.definition)
  page.onLoad()
  await page._firstFlight
  assert.deepEqual(loaded.calls.list[0], { cursor: '', limit: 20 })
  const firstMore = page.loadMore()
  const secondMore = page.loadMore()
  assert.equal(loaded.calls.list.length, 2)
  assert.deepEqual(loaded.calls.list[1], { cursor: 'opaque:cursor', limit: 20 })
  const refresh = page.loadFirst()
  fresh.resolve({ items: [notification('fresh')], nextCursor: null, unreadCount: 0 })
  await refresh
  more.resolve({ items: [notification('n1'), notification('old')], nextCursor: null, unreadCount: 4 })
  await firstMore
  assert.deepEqual(page.data.items.map(item => item.notificationId), ['fresh'])
  loaded.restore()
})

test('friend request double tap shares a flight and applies authoritative server state/count', async () => {
  const action = deferred()
  const loaded = loadMessagePage({
    listResponses: [{ items: [notification('request', { kind: 'friend_request', targetType: 'friendship', targetId: 'friendship-1', actionState: 'pending' })], nextCursor: '', unreadCount: 8 }],
    accept: () => action.promise
  })
  const page = createInstance(loaded.definition)
  page.onLoad()
  await page._firstFlight
  const event = { currentTarget: { dataset: { id: 'request', decision: 'accept' } } }
  const first = page.actOnFriendRequest(event)
  const second = page.actOnFriendRequest(event)
  assert.equal(loaded.calls.accept.length, 1)
  action.resolve({ actionState: 'accepted', unreadCount: 3 })
  await Promise.all([first, second])
  assert.equal(page.data.items[0].actionState, 'accepted')
  assert.equal(page.data.items[0].canAct, false)
  assert.equal(loaded.unread.applied.at(-1), 3)
  loaded.restore()
})

test('network failure uses only the current account fresh cache as read-only content', async () => {
  const storage = new Map()
  const online = loadMessagePage({ storage, playerId: 'WX-A', listResponses: [{ items: [notification('cached', { injectedOpenId: 'secret' })], nextCursor: 'next', unreadCount: 1 }] })
  const onlinePage = createInstance(online.definition)
  onlinePage.onLoad()
  await onlinePage._firstFlight
  const stored = Array.from(storage.values())[0]
  assert.equal(stored.items[0].injectedOpenId, undefined)
  online.restore()

  const wrongAccount = loadMessagePage({ storage, playerId: 'WX-B', listResponses: [Promise.reject(networkError())] })
  const wrongPage = createInstance(wrongAccount.definition)
  wrongPage.onLoad()
  await wrongPage._firstFlight
  assert.equal(wrongPage.data.offline, false)
  assert.equal(wrongPage.data.firstError, '好友功能暂时不可用')
  wrongAccount.restore()

  const offline = loadMessagePage({ storage, playerId: 'WX-A', listResponses: [Promise.reject(networkError())] })
  const offlinePage = createInstance(offline.definition)
  offlinePage.onLoad()
  await offlinePage._firstFlight
  assert.equal(offlinePage.data.offline, true)
  assert.deepEqual(offlinePage.data.items.map(item => item.notificationId), ['cached'])
  await offlinePage.markAllRead()
  assert.equal(offline.calls.markAll.length, 0)
  offline.restore()
})

test('ordinary unread is marked before safe navigation and network failure stops navigation', async () => {
  const loaded = loadMessagePage({
    listResponses: [{ items: [notification('card', { kind: 'player_card', targetType: 'player_card_share', targetId: 'share/1', read: false })], nextCursor: '', unreadCount: 1 }],
    markRead: async () => ({ unreadCount: 0 })
  })
  const page = createInstance(loaded.definition)
  page.onLoad()
  await page._firstFlight
  await page.openNotification({ currentTarget: { dataset: { id: 'card' } } })
  assert.equal(loaded.calls.markRead.length, 1)
  assert.equal(loaded.calls.navigate[0].url, '/pages/social-card-preview/social-card-preview?shareId=share%2F1')
  assert.equal(page.data.items[0].read, true)
  loaded.restore()

  const failed = loadMessagePage({
    listResponses: [{ items: [notification('card', { kind: 'player_card', targetType: 'player_card_share', targetId: 'share-1', read: false })], nextCursor: '', unreadCount: 1 }],
    markRead: async () => { throw networkError() }
  })
  const failedPage = createInstance(failed.definition)
  failedPage.onLoad()
  await failedPage._firstFlight
  await failedPage.openNotification({ currentTarget: { dataset: { id: 'card' } } })
  assert.equal(failed.calls.navigate.length, 0)
  assert.equal(failedPage.data.items[0].read, false)
  failed.restore()
})

test('repeated open shares one mark-read request and unload prevents late navigation', async () => {
  const mark = deferred()
  const loaded = loadMessagePage({
    listResponses: [{ items: [notification('card', { kind: 'player_card', targetType: 'player_card_share', targetId: 'share-1', read: false })], nextCursor: '', unreadCount: 1 }],
    markRead: () => mark.promise
  })
  const page = createInstance(loaded.definition)
  page.onLoad()
  await page._firstFlight
  const event = { currentTarget: { dataset: { id: 'card' } } }
  const first = page.openNotification(event)
  const second = page.openNotification(event)
  assert.equal(loaded.calls.markRead.length, 1)
  page.onUnload()
  mark.resolve({ unreadCount: 0 })
  await Promise.all([first, second])
  assert.equal(loaded.calls.navigate.length, 0)
  assert.equal(page.data.items[0].read, false)
  loaded.restore()
})

test('resolved inline friend request never becomes unavailable', async () => {
  const loaded = loadMessagePage({
    listResponses: [{ items: [notification('request', { kind: 'friend_request', targetType: 'friendship', targetId: 'friendship-1', actionState: 'accepted', read: true })], nextCursor: '', unreadCount: 0 }]
  })
  const page = createInstance(loaded.definition)
  page.onLoad()
  await page._firstFlight
  await page.openNotification({ currentTarget: { dataset: { id: 'request' } } })
  assert.equal(page.data.items[0].unavailable, false)
  assert.equal(loaded.calls.navigate.length, 0)
  loaded.restore()
})

test('mark all changes nothing on failure and uses the authoritative count on success', async () => {
  let attempts = 0
  const loaded = loadMessagePage({
    listResponses: [{ items: [notification('n1')], nextCursor: '', unreadCount: 4 }],
    markAll: async () => {
      attempts += 1
      if (attempts === 1) throw networkError()
      return { unreadCount: 1 }
    }
  })
  const page = createInstance(loaded.definition)
  page.onLoad()
  await page._firstFlight
  page.data.unread = { count: 4, label: '4', hasUnread: true }
  await page.markAllRead()
  assert.equal(page.data.items[0].read, false)
  assert.equal(loaded.unread.applied.at(-1), 4)
  await page.markAllRead()
  assert.equal(page.data.items[0].read, true)
  assert.equal(loaded.unread.applied.at(-1), 1)
  loaded.restore()
})

test('cache is exact, account-bound, authoritative offline, and storage failures are harmless', async () => {
  const storage = new Map()
  const online = loadMessagePage({
    storage,
    playerId: 'WX-A',
    listResponses: [{ items: [notification('cache-1')], nextCursor: null, unreadCount: 6 }]
  })
  const page = createInstance(online.definition)
  page.onLoad()
  await page._firstFlight
  const cached = storage.get('socialNotificationsFirstPage:WX-A')
  assert.deepEqual(Object.keys(cached).sort(), ['accountId', 'items', 'nextCursor', 'savedAt', 'unreadCount'])
  assert.equal(cached.accountId, 'WX-A')
  assert.equal(cached.nextCursor, '')
  assert.equal(cached.unreadCount, 6)
  online.restore()

  const offline = loadMessagePage({ storage, playerId: 'WX-A', listResponses: [Promise.reject(networkError())] })
  const offlinePage = createInstance(offline.definition)
  offlinePage.onLoad()
  await offlinePage._firstFlight
  assert.equal(offlinePage.data.offline, true)
  assert.equal(offline.unread.applied.at(-1), 6)
  offline.restore()

  const throwingStorage = {
    get() { throw new Error('storage read failed') },
    set() { throw new Error('storage write failed') }
  }
  const storageFailure = loadMessagePage({ storage: throwingStorage, listResponses: [{ items: [notification('online')], nextCursor: '', unreadCount: 0 }] })
  const storageFailurePage = createInstance(storageFailure.definition)
  storageFailurePage.onLoad()
  await storageFailurePage._firstFlight
  assert.deepEqual(storageFailurePage.data.items.map(item => item.notificationId), ['online'])
  assert.equal(storageFailurePage.data.firstError, '')
  storageFailure.restore()
})

test('cache rejects future, malformed, cross-account, logged-out, and missing-id records', async () => {
  const cases = [
    { accountId: 'WX-A', savedAt: Date.now() + 10000, items: [], nextCursor: '', unreadCount: 0 },
    { accountId: 'WX-A', savedAt: Date.now() - (5 * 60 * 1000) - 1, items: [], nextCursor: '', unreadCount: 0 },
    { accountId: 'WX-A', savedAt: Date.now(), items: 'bad', nextCursor: '', unreadCount: 0 },
    { accountId: 'WX-B', savedAt: Date.now(), items: [], nextCursor: '', unreadCount: 0 },
    { accountId: 'WX-A', savedAt: Date.now(), items: [], nextCursor: '', unreadCount: Number.NaN }
  ]
  for (const cached of cases) {
    const storage = new Map([['socialNotificationsFirstPage:WX-A', cached]])
    const loaded = loadMessagePage({ storage, playerId: 'WX-A', listResponses: [Promise.reject(networkError())] })
    const page = createInstance(loaded.definition)
    page.onLoad()
    await page._firstFlight
    assert.equal(page.data.offline, false)
    assert.equal(page.data.firstError, '好友功能暂时不可用')
    loaded.restore()
  }

  const valid = { accountId: 'WX-A', savedAt: Date.now(), items: [], nextCursor: '', unreadCount: 2 }
  const storage = new Map([['socialNotificationsFirstPage:WX-A', valid]])
  const loggedOut = loadMessagePage({ storage, playerId: 'WX-A', loggedOut: true, listResponses: [{ items: [], nextCursor: '', unreadCount: 0 }] })
  const loggedOutPage = createInstance(loggedOut.definition)
  loggedOutPage.onLoad()
  if (loggedOutPage._firstFlight) await loggedOutPage._firstFlight
  assert.equal(loggedOutPage.data.offline, false)
  assert.deepEqual(loggedOutPage.data.items, [])
  assert.equal(loggedOut.calls.list.length, 0)
  loggedOut.restore()

  const missingId = loadMessagePage({ storage, playerId: '', listResponses: [{ items: [], nextCursor: '', unreadCount: 0 }] })
  const missingIdPage = createInstance(missingId.definition)
  missingIdPage.onLoad()
  if (missingIdPage._firstFlight) await missingIdPage._firstFlight
  assert.equal(missingIdPage.data.offline, false)
  assert.equal(missingId.calls.list.length, 0)
  missingId.restore()
})

test('account changes and hide invalidate old requests, cache writes, state writes, and toasts', async () => {
  let playerId = 'WX-A'
  const oldRequest = deferred()
  const storage = new Map()
  const loaded = loadMessagePage({
    storage,
    playerId: () => playerId,
    listResponses: [oldRequest.promise, { items: [notification('account-b')], nextCursor: '', unreadCount: 2 }]
  })
  const page = createInstance(loaded.definition)
  page.onLoad()
  playerId = 'WX-B'
  page.onHide()
  page.onShow()
  assert.deepEqual(page.data.items, [])
  if (loaded.calls.list.length < 2) {
    oldRequest.resolve({ items: [notification('account-a')], nextCursor: '', unreadCount: 9 })
    await page._firstFlight
    loaded.restore()
    assert.equal(loaded.calls.list.length, 2)
    return
  }
  await page._firstFlight
  oldRequest.resolve({ items: [notification('account-a')], nextCursor: '', unreadCount: 9 })
  await oldRequest.promise
  await Promise.resolve()
  assert.deepEqual(page.data.items.map(item => item.notificationId), ['account-b'])
  assert.equal(storage.has('socialNotificationsFirstPage:WX-A'), false)
  assert.equal(storage.has('socialNotificationsFirstPage:WX-B'), true)

  const mark = deferred()
  loaded.service.markNotificationRead = input => { loaded.calls.markRead.push(input); return mark.promise }
  page.setData({ items: [Object.assign(notification('late'), { title: 'late', summary: '', timeLabel: '', canAct: false, acting: false, unavailable: false })], offline: false })
  const open = page.openNotification({ currentTarget: { dataset: { id: 'late' } } })
  page.onHide()
  mark.reject(Object.assign(new Error('unknown'), { code: 'SOCIAL_ERROR' }))
  await open
  assert.equal(loaded.calls.toast.length, 0)
  assert.equal(page.data.items[0].read, false)
  loaded.restore()
})

test('friend action is strict and incomplete authoritative results remain pending', async () => {
  const invalidTargets = [
    { targetType: 'friend', targetId: 'friendship-1' },
    { targetType: 'friendship', targetId: '' },
    { targetType: 'friendship', targetId: 'friendship-1', actionState: 'accepted' }
  ]
  for (let index = 0; index < invalidTargets.length; index += 1) {
    const loaded = loadMessagePage({ listResponses: [{ items: [notification('bad-' + index, Object.assign({ kind: 'friend_request', actionState: 'pending' }, invalidTargets[index]))], nextCursor: '', unreadCount: 1 }] })
    const page = createInstance(loaded.definition)
    page.onLoad()
    await page._firstFlight
    assert.equal(page.data.items[0].canAct, false)
    await page.actOnFriendRequest({ currentTarget: { dataset: { id: 'bad-' + index, decision: 'accept' } } })
    assert.equal(loaded.calls.accept.length, 0)
    loaded.restore()
  }

  const responses = [{ actionState: '', unreadCount: 0 }, { actionState: 'accepted', unreadCount: Number.NaN }]
  const loaded = loadMessagePage({
    listResponses: [{ items: [notification('request', { kind: 'friend_request', targetType: 'friendship', targetId: 'friendship-1', actionState: 'pending' })], nextCursor: '', unreadCount: 1 }],
    accept: async () => responses.shift()
  })
  const page = createInstance(loaded.definition)
  page.onLoad()
  await page._firstFlight
  const event = { currentTarget: { dataset: { id: 'request', decision: 'accept' } } }
  await page.actOnFriendRequest(event)
  assert.equal(page.data.items[0].actionState, 'pending')
  assert.equal(page.data.items[0].canAct, true)
  assert.equal(page.data.items[0].read, false)
  await page.actOnFriendRequest(event)
  assert.equal(page.data.items[0].actionState, 'pending')
  assert.equal(page.data.items[0].read, false)
  assert.equal(loaded.calls.accept[0].clientMutationId, loaded.calls.accept[1].clientMutationId)
  loaded.restore()
})

test('mark-one and mark-all reuse mutation ids across failed retry chains', async () => {
  let readAttempts = 0
  let allAttempts = 0
  const loaded = loadMessagePage({
    listResponses: [{ items: [notification('card', { kind: 'player_card', targetType: 'player_card_share', targetId: 'share-1' })], nextCursor: '', unreadCount: 2 }],
    markRead: async () => {
      readAttempts += 1
      if (readAttempts === 1) throw networkError()
      return { unreadCount: 1 }
    },
    markAll: async () => {
      allAttempts += 1
      if (allAttempts === 1) throw networkError()
      return { unreadCount: 0 }
    }
  })
  const page = createInstance(loaded.definition)
  page.onLoad()
  await page._firstFlight
  const event = { currentTarget: { dataset: { id: 'card' } } }
  await page.openNotification(event)
  await page.openNotification(event)
  assert.equal(loaded.calls.markRead[0].clientMutationId, loaded.calls.markRead[1].clientMutationId)
  page.data.unread = { count: 1, label: '1', hasUnread: true }
  await page.markAllRead()
  await page.markAllRead()
  assert.equal(loaded.calls.markAll[0].clientMutationId, loaded.calls.markAll[1].clientMutationId)
  loaded.restore()
})

test('refresh clears load-more state and onShow does not duplicate the initial request', async () => {
  const first = deferred()
  const more = deferred()
  const refreshed = deferred()
  const loaded = loadMessagePage({ listResponses: [first.promise, more.promise, refreshed.promise] })
  const page = createInstance(loaded.definition)
  page.onLoad()
  page.onShow()
  assert.equal(loaded.calls.list.length, 1)
  first.resolve({ items: [notification('first')], nextCursor: 'more', unreadCount: 1 })
  await page._firstFlight
  const oldMore = page.loadMore()
  page.onHide()
  page.onShow()
  if (loaded.calls.list.length < 3) {
    more.resolve({ items: [notification('old-more')], nextCursor: '', unreadCount: 1 })
    await oldMore
    loaded.restore()
    assert.equal(loaded.calls.list.length, 3)
    return
  }
  assert.equal(page.data.loadingMore, false)
  assert.equal(page.data.moreError, false)
  refreshed.resolve({ items: [notification('fresh')], nextCursor: '', unreadCount: 0 })
  await page._firstFlight
  more.reject(networkError())
  await oldMore
  assert.equal(page.data.loadingMore, false)
  assert.equal(page.data.moreError, false)
  assert.deepEqual(page.data.items.map(item => item.notificationId), ['fresh'])
  loaded.restore()
})

test('real handler null cursor ends first and later pages while invalid cursor types fail closed', async () => {
  const firstPage = loadMessagePage({ listResponses: [{ items: [notification('single')], nextCursor: null, unreadCount: 0 }] })
  const firstPageInstance = createInstance(firstPage.definition)
  firstPageInstance.onLoad()
  await firstPageInstance._firstFlight
  assert.equal(firstPageInstance.data.firstError, '')
  assert.equal(firstPageInstance.data.nextCursor, '')
  assert.deepEqual(firstPageInstance.data.items.map(item => item.notificationId), ['single'])
  firstPage.restore()

  const paged = loadMessagePage({
    listResponses: [
      { items: [notification('page-1')], nextCursor: 'opaque-page-2', unreadCount: 1 },
      { items: [notification('page-2')], nextCursor: null, unreadCount: 1 }
    ]
  })
  const pagedInstance = createInstance(paged.definition)
  pagedInstance.onLoad()
  await pagedInstance._firstFlight
  await pagedInstance.loadMore()
  assert.equal(pagedInstance.data.nextCursor, '')
  assert.equal(pagedInstance.data.moreError, false)
  assert.deepEqual(pagedInstance.data.items.map(item => item.notificationId), ['page-1', 'page-2'])
  paged.restore()

  for (const nextCursor of [7, { cursor: 'bad' }, undefined]) {
    const invalid = loadMessagePage({ listResponses: [{ items: [notification('invalid')], nextCursor, unreadCount: 0 }] })
    const invalidInstance = createInstance(invalid.definition)
    invalidInstance.onLoad()
    await invalidInstance._firstFlight
    assert.equal(invalidInstance.data.firstError, '好友功能暂时不可用')
    assert.deepEqual(invalidInstance.data.items, [])
    invalid.restore()
  }
})

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function notification(notificationId, patch = {}) {
  return Object.assign({
    notificationId,
    kind: 'friend_accepted',
    actor: { socialUserId: 'actor', nickname: '牌友', avatarUrl: '', avatarText: '友' },
    targetType: 'friend',
    targetId: 'friend-1',
    aggregateCount: 0,
    actionState: '',
    read: false,
    createdAt: '2026-07-20T10:00:00.000Z'
  }, patch)
}

function networkError() {
  return Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' })
}

function loadMessagePage(options = {}) {
  let definition
  let mutation = 0
  const responses = (options.listResponses || []).slice()
  const calls = { list: [], accept: [], reject: [], markRead: [], markAll: [], navigate: [], toast: [] }
  const unread = {
    applied: [],
    snapshot: { count: 0, label: '', hasUnread: false },
    setAccountKey() {},
    subscribe(listener) { listener(this.snapshot); return () => {} },
    applyAuthoritativeCount(count) {
      this.applied.push(Number(count) || 0)
      this.snapshot = { count: Number(count) || 0, label: count ? String(count) : '', hasUnread: Number(count) > 0 }
      return this.snapshot
    },
    async refresh() { return this.snapshot }
  }
  const service = {
    listNotifications(input) { calls.list.push(input); return Promise.resolve(responses.shift()) },
    acceptFriendRequest(input) { calls.accept.push(input); return options.accept ? options.accept(input) : Promise.resolve({ actionState: 'accepted', unreadCount: 0 }) },
    rejectFriendRequest(input) { calls.reject.push(input); return Promise.resolve({ actionState: 'rejected', unreadCount: 0 }) },
    markNotificationRead(input) { calls.markRead.push(input); return options.markRead ? options.markRead(input) : Promise.resolve({ unreadCount: 0 }) },
    markAllNotificationsRead(input) { calls.markAll.push(input); return options.markAll ? options.markAll(input) : Promise.resolve({ unreadCount: 0 }) }
  }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (parent && /pages[\\/]social-messages[\\/]social-messages\.js$/.test(parent.filename || '')) {
      if (request === '../../services/social-service') return service
      if (request === '../../services/data-service') return {
        getCurrentPlayerId: () => typeof options.playerId === 'function' ? options.playerId() : (options.playerId === undefined ? 'WX-A' : options.playerId),
        isAccountLoggedOut: () => typeof options.loggedOut === 'function' ? options.loggedOut() : !!options.loggedOut
      }
      if (request === '../../utils/social-unread-state') return unread
      if (request === '../../utils/social-mutation') return { createMutationId: prefix => `${prefix}:${++mutation}` }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Page = value => { definition = value }
  const storage = options.storage || new Map()
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    navigateTo(input) { calls.navigate.push(input) },
    showToast(input) { calls.toast.push(input) }
  }
  const file = require.resolve('../pages/social-messages/social-messages')
  delete require.cache[file]
  try { require(file) } finally { Module._load = originalLoad; delete global.Page }
  return { definition, calls, unread, service, restore() { delete require.cache[file]; delete global.wx } }
}

function createInstance(definition) {
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) }
  }
  Object.assign(instance, definition)
  return instance
}
