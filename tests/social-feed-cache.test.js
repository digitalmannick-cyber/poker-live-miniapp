const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const root = path.join(__dirname, '..')
const hubJsPath = path.join(root, 'components', 'friend-hub', 'friend-hub.js')
const hubWxmlPath = path.join(root, 'components', 'friend-hub', 'friend-hub.wxml')
const hubWxssPath = path.join(root, 'components', 'friend-hub', 'friend-hub.wxss')
const playerJsPath = path.join(root, 'pages', 'player-notes', 'player-notes.js')
const playerJsonPath = path.join(root, 'pages', 'player-notes', 'player-notes.json')
const playerWxmlPath = path.join(root, 'pages', 'player-notes', 'player-notes.wxml')
const cachePath = path.join(root, 'utils', 'social-cache.js')

function feedItem(shareId, patch = {}) {
  return Object.assign({
    shareId,
    publisher: { socialUserId: 'su_publisher', nickname: '牌友', avatarUrl: '', avatarText: '牌' },
    scope: 'square',
    scopeLabel: '广场',
    summary: {
      heroCards: ['As', 'Ks'],
      board: { flop: ['Ah', '9s', '4d'], turn: ['Kc'], river: ['2h'] },
      potBb: 12.5,
      effectiveStackBb: 100,
      actionCount: 8,
      playerCount: 6
    },
    likedByMe: false,
    likeCount: 2,
    commentCount: 3,
    createdAt: 1000
  }, patch)
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function loadFriendHub(options = {}) {
  let definition
  const feedCopier = requireFeedCache().copyFeedResponse
  const responses = (options.responses || []).slice()
  const calls = { listFeed: [], cacheRead: [], cacheWrite: [], cacheRemove: [], events: [], toast: [] }
  const service = {
    listFriends: async () => ({ items: [], nextOffset: null }),
    listRanking: async () => ({ top10: [], myRank: null }),
    listFeed(input) {
      calls.listFeed.push(input)
      const response = responses.shift()
      return typeof response === 'function' ? response(input) : Promise.resolve(response)
    }
  }
  const cache = {
    copyFeedResponse: feedCopier,
    readFeedFirstPage(socialUserId) {
      calls.cacheRead.push(socialUserId)
      return options.cached === undefined ? null : options.cached
    },
    writeFeedFirstPage(socialUserId, response) {
      calls.cacheWrite.push({ socialUserId, response })
      return true
    },
    removeFeedFirstPage(socialUserId) {
      calls.cacheRemove.push(socialUserId)
      return true
    }
  }
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (parent && /components[\\/]friend-hub[\\/]friend-hub\.js$/.test(parent.filename || '')) {
      if (request === '../../services/social-service') return service
      if (request === '../../services/data-service') return { ensureFriendPlayerNote: async value => value }
      if (request === '../../utils/social-cache') return cache
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Component = value => { definition = value }
  global.wx = {
    showToast(input) { calls.toast.push(input) }
  }
  const modulePath = require.resolve('../components/friend-hub/friend-hub')
  delete require.cache[modulePath]
  try {
    require(modulePath)
  } finally {
    Module._load = originalLoad
    delete global.Component
  }
  return {
    definition,
    calls,
    createInstance(socialUserId = 'su_viewer') {
      const data = JSON.parse(JSON.stringify(definition.data || {}))
      data.activeSection = 'feed'
      data.socialUserId = socialUserId
      const instance = {
        data,
        setData(patch) { Object.assign(this.data, patch) },
        triggerEvent(name, detail) { calls.events.push({ name, detail }) }
      }
      Object.assign(instance, definition.methods || {})
      if (definition.lifetimes && definition.lifetimes.attached) definition.lifetimes.attached.call(instance)
      return instance
    },
    restore() {
      delete require.cache[modulePath]
      delete global.wx
    }
  }
}

function requireFeedCache() {
  assert.equal(fs.existsSync(cachePath), true, 'Task 4 must create utils/social-cache.js')
  delete require.cache[require.resolve(cachePath)]
  return require(cachePath)
}

function loadPlayerPage(refreshFeed) {
  let definition
  const calls = { refreshFeed: 0, stop: 0 }
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (parent && /pages[\\/]player-notes[\\/]player-notes\.js$/.test(parent.filename || '')) {
      if (request === '../../services/data-service') return {}
      if (request === '../../utils/tab-bar') return { syncCustomTabBar() {} }
      if (request === '../../utils/player-avatar-cache') return { getAvatarDisplayUrl() { return '' }, warmPlayerAvatars() {} }
      if (request === '../../utils/onboarding-guide') return { getStepForRoute() { return null } }
      if (request === '../../utils/social-unread-state') return { subscribe() { return () => {} }, setAccountKey() {}, refresh: async () => {} }
      if (request === '../../services/social-service') return { getMySocialProfile: async () => ({ socialUserId: 'su_viewer' }) }
      if (request === '../../utils/social-cache') return { removeFeedFirstPage() {} }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Page = value => { definition = value }
  global.wx = { stopPullDownRefresh() { calls.stop += 1 } }
  const modulePath = require.resolve('../pages/player-notes/player-notes')
  delete require.cache[modulePath]
  try { require(modulePath) } finally { Module._load = originalLoad; delete global.Page }
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(patch) { Object.assign(this.data, patch) },
    selectComponent() {
      return {
        refreshFeed() {
          calls.refreshFeed += 1
          return typeof refreshFeed === 'function' ? refreshFeed() : Promise.resolve()
        }
      }
    }
  }
  Object.assign(instance, definition)
  return {
    instance,
    calls,
    restore() { delete require.cache[modulePath]; delete global.wx }
  }
}

function cacheApi(cache) {
  const read = cache.readFeedFirstPage || cache.getFeedFirstPage
  const write = cache.writeFeedFirstPage || cache.setFeedFirstPage
  const remove = cache.removeFeedFirstPage || cache.clearFeedFirstPage
  assert.equal(typeof read, 'function', 'feed cache must expose a first-page reader')
  assert.equal(typeof write, 'function', 'feed cache must expose a first-page writer')
  assert.equal(typeof remove, 'function', 'feed cache must expose an account-scoped remover')
  return { read, write, remove }
}

function withStorage(run, overrides = {}) {
  const storage = new Map()
  const originalWx = global.wx
  global.wx = {
    getStorageSync(key) {
      if (overrides.getThrows) throw new Error('storage get failed')
      return storage.get(key)
    },
    setStorageSync(key, value) {
      if (overrides.setThrows) throw new Error('storage set failed')
      storage.set(key, value)
    },
    removeStorageSync(key) {
      if (overrides.removeThrows) throw new Error('storage remove failed')
      storage.delete(key)
    }
  }
  try {
    return run(storage)
  } finally {
    global.wx = originalWx
  }
}

test('friend hub renders one unified feed panel with scope labels and compact icon actions', () => {
  const wxml = fs.readFileSync(hubWxmlPath, 'utf8')
  const wxss = fs.readFileSync(hubWxssPath, 'utf8')
  assert.doesNotMatch(wxml, /广场动态|好友动态/, 'feed must not introduce a second square/friends switch')
  assert.equal((wxml.match(/class="[^"]*feed-panel[^"]*"/g) || []).length, 1, 'friend hub must expose exactly one feed panel')
  assert.match(wxml, /\{\{item\.scopeLabel\}\}/, 'all three server scope labels must render from the feed DTO')
  assert.match(wxml, /feed-action-icon[^>]+(?:like|heart)|(?:like|heart)[^>]+feed-action-icon/i)
  assert.match(wxml, /feed-action-icon[^>]+comment|comment[^>]+feed-action-icon/i)
  assert.doesNotMatch(wxml, /<button[^>]*feed-(?:like|comment)/i, 'like/comment affordances are not large text buttons')
  assert.match(wxss, /\.feed-action\s*\{[^}]*min-width:\s*72rpx[^}]*min-height:\s*72rpx/s, 'icon hit areas must be at least 72rpx square')
  assert.match(wxss, /\.feed-action-icon\s*\{[^}]*width:\s*32rpx[^}]*height:\s*32rpx/s, 'visible icons stay at 32rpx')
})

test('feed first page and load-more are separate singleflights fixed at 20 items', async t => {
  const first = deferred()
  const more = deferred()
  const loaded = loadFriendHub({ responses: [first.promise, more.promise] })
  t.after(() => loaded.restore())
  const hub = loaded.createInstance()
  assert.equal(typeof hub.loadFeed, 'function', 'Task 4 must add the feed first-page loader')
  assert.equal(typeof hub.loadMoreFeed, 'function', 'Task 4 must add the feed pagination loader')

  const firstA = hub.loadFeed()
  const firstB = hub.loadFeed()
  assert.equal(firstA, firstB, 'duplicate first-page triggers share the same Promise')
  assert.deepEqual(loaded.calls.listFeed, [{ cursor: '', limit: 20 }])
  first.resolve({ items: [feedItem('sh_first')], nextCursor: 'opaque-2' })
  await firstA

  const moreA = hub.loadMoreFeed()
  const moreB = hub.loadMoreFeed()
  assert.equal(moreA, moreB, 'duplicate load-more triggers share the same Promise')
  assert.deepEqual(loaded.calls.listFeed[1], { cursor: 'opaque-2', limit: 20 })
  more.resolve({ items: [feedItem('sh_second')], nextCursor: null })
  await moreA
})

test('live feed response copier rejects unknown keys and invalid recursive leaves before UI or cache writes', async t => {
  const cache = requireFeedCache()
  assert.equal(typeof cache.copyFeedResponse, 'function', 'social cache must export the shared exact response copier')
  const valid = { items: [feedItem('sh_valid')], nextCursor: 'opaque-next' }
  assert.deepEqual(cache.copyFeedResponse(valid), valid)

  const unknown = { items: [feedItem('sh_unknown', { ownerOpenId: 'private-canary' })], nextCursor: null }
  const invalidLeaf = { items: [feedItem('sh_leaf', { summary: Object.assign({}, feedItem('x').summary, { potBb: { note: 'nested-canary' } }) })], nextCursor: null }
  assert.equal(cache.copyFeedResponse(unknown), null)
  assert.equal(cache.copyFeedResponse(invalidLeaf), null)

  const firstInvalid = loadFriendHub({ responses: [unknown], cached: { items: [feedItem('sh_cache')], nextCursor: '', socialUserId: 'su_viewer', savedAt: Date.now() } })
  t.after(() => firstInvalid.restore())
  const firstHub = firstInvalid.createInstance()
  await firstHub.loadFeed()
  assert.equal(firstHub.data.feedStatus, 'error')
  assert.deepEqual(firstHub.data.feedItems, [])
  assert.deepEqual(firstInvalid.calls.cacheWrite, [])
  assert.deepEqual(firstInvalid.calls.cacheRead, [], 'contract errors must not fall back to cache')

  const pageInvalid = loadFriendHub({ responses: [valid, invalidLeaf] })
  t.after(() => pageInvalid.restore())
  const pageHub = pageInvalid.createInstance()
  await pageHub.loadFeed()
  await pageHub.loadMoreFeed()
  assert.deepEqual(pageHub.data.feedItems.map(item => item.shareId), ['sh_valid'])
  assert.match(pageHub.data.feedMoreError, /加载失败/)
  assert.equal(pageInvalid.calls.cacheWrite.length, 1, 'only the valid first page may be cached')
})

test('live and cached feed DTOs accept only empty or parseable HTTPS publisher avatars', () => {
  const cache = requireFeedCache()
  const validAvatars = ['', 'https://example.com/avatar.png?token=abc']
  const invalidAvatars = ['cloud://env/avatar.png', 'signed:cloud://env/avatar.png', 'http://example.com/avatar.png', 'not-a-url']

  for (const avatarUrl of validAvatars) {
    const response = { items: [feedItem('sh_valid_avatar', {
      publisher: { socialUserId: 'su_publisher', nickname: '牌友', avatarUrl, avatarText: '牌' }
    })], nextCursor: null }
    assert.deepEqual(cache.copyFeedResponse(response), response)
  }

  for (const avatarUrl of invalidAvatars) {
    const response = { items: [feedItem('sh_invalid_avatar', {
      publisher: { socialUserId: 'su_publisher', nickname: '牌友', avatarUrl, avatarText: '牌' }
    })], nextCursor: null }
    assert.equal(cache.copyFeedResponse(response), null, `live DTO must reject ${avatarUrl}`)
    withStorage(storage => {
      assert.equal(cache.writeFeedFirstPage('su_viewer', response, 1000), false, `cache write must reject ${avatarUrl}`)
      assert.equal(storage.size, 0)
      storage.set('socialFeedFirstPage:su_viewer', {
        socialUserId: 'su_viewer', items: response.items, nextCursor: '', savedAt: 1000
      })
      assert.equal(cache.readFeedFirstPage('su_viewer', 1000), null, `cache read must reject ${avatarUrl}`)
    })
  }
})

test('pull-down refresh targets only Player > Feed and always stops the native indicator', async t => {
  const pageJson = JSON.parse(fs.readFileSync(playerJsonPath, 'utf8'))
  assert.equal(pageJson.enablePullDownRefresh, true)

  const loaded = loadPlayerPage()
  t.after(() => loaded.restore())
  assert.equal(typeof loaded.instance.onPullDownRefresh, 'function')
  loaded.instance.data.playerSection = 'friends'
  loaded.instance.data.friendSection = 'feed'
  await loaded.instance.onPullDownRefresh()
  assert.deepEqual(loaded.calls, { refreshFeed: 1, stop: 1 })

  loaded.instance.data.friendSection = 'friends'
  await loaded.instance.onPullDownRefresh()
  loaded.instance.data.playerSection = 'library'
  loaded.instance.data.friendSection = 'feed'
  await loaded.instance.onPullDownRefresh()
  assert.deepEqual(loaded.calls, { refreshFeed: 1, stop: 3 }, 'other player sections must not refresh the feed')

  const rejected = loadPlayerPage(() => Promise.reject(new Error('offline')))
  t.after(() => rejected.restore())
  rejected.instance.data.playerSection = 'friends'
  rejected.instance.data.friendSection = 'feed'
  await assert.rejects(rejected.instance.onPullDownRefresh(), /offline/)
  assert.deepEqual(rejected.calls, { refreshFeed: 1, stop: 1 }, 'finally must stop the native indicator')
})

test('feed append deduplicates by shareId without reordering and drops stale cursor responses', async t => {
  const first = Promise.resolve({ items: [feedItem('sh_b'), feedItem('sh_a')], nextCursor: 'cursor-1' })
  const oldMore = deferred()
  const refresh = deferred()
  const loaded = loadFriendHub({ responses: [first, oldMore.promise, refresh.promise] })
  t.after(() => loaded.restore())
  const hub = loaded.createInstance()
  assert.equal(typeof hub.loadFeed, 'function')
  assert.equal(typeof hub.loadMoreFeed, 'function')
  assert.equal(typeof hub.refreshFeed, 'function', 'explicit refresh must reset the feed generation')
  await hub.loadFeed()
  const pendingMore = hub.loadMoreFeed()
  const pendingRefresh = hub.refreshFeed()
  refresh.resolve({ items: [feedItem('sh_new')], nextCursor: null })
  await pendingRefresh
  oldMore.resolve({ items: [feedItem('sh_a'), feedItem('sh_c')], nextCursor: null })
  await pendingMore
  assert.deepEqual(hub.data.feedItems.map(item => item.shareId), ['sh_new'], 'response from the old cursor/generation must be ignored')

  const appendLoaded = loadFriendHub({
    responses: [
      { items: [feedItem('sh_b'), feedItem('sh_a')], nextCursor: 'cursor-2' },
      { items: [feedItem('sh_a'), feedItem('sh_c')], nextCursor: null }
    ]
  })
  t.after(() => appendLoaded.restore())
  const appendHub = appendLoaded.createInstance()
  await appendHub.loadFeed()
  await appendHub.loadMoreFeed()
  assert.deepEqual(appendHub.data.feedItems.map(item => item.shareId), ['sh_b', 'sh_a', 'sh_c'])
})

test('consecutive explicit feed refreshes share one first-page flight until it settles', async t => {
  const refresh = deferred()
  const loaded = loadFriendHub({
    responses: [
      { items: [feedItem('sh_initial')], nextCursor: null },
      refresh.promise,
      { items: [feedItem('sh_after')], nextCursor: null }
    ]
  })
  t.after(() => loaded.restore())
  const hub = loaded.createInstance()
  await hub.loadFeed()

  const first = hub.refreshFeed()
  const second = hub.refreshFeed()
  assert.equal(first, second, 'refresh must return the existing first-page Promise')
  assert.equal(loaded.calls.listFeed.length, 2, 'a pending refresh must issue only one request')

  refresh.resolve({ items: [feedItem('sh_refreshed')], nextCursor: null })
  await first
  const afterSettled = hub.refreshFeed()
  assert.equal(loaded.calls.listFeed.length, 3, 'a new explicit refresh is allowed after settlement')
  await afterSettled
  assert.deepEqual(hub.data.feedItems.map(item => item.shareId), ['sh_after'])
})

test('account change and detach suppress stale UI, cache writes, toasts, and navigation', async t => {
  const accountA = deferred()
  const accountB = deferred()
  const detachedRequest = deferred()
  const loaded = loadFriendHub({ responses: [accountA.promise, accountB.promise, detachedRequest.promise] })
  t.after(() => loaded.restore())
  const hub = loaded.createInstance('su_a')
  assert.ok(loaded.definition.properties && loaded.definition.properties.socialUserId, 'friend hub must accept the public socialUserId property')
  const observer = loaded.definition.properties.socialUserId.observer
  assert.equal(typeof observer, 'function', 'socialUserId changes must invalidate old feed work')
  assert.equal(typeof hub.loadFeed, 'function')
  const old = hub.loadFeed()
  hub.data.socialUserId = 'su_b'
  observer.call(hub, 'su_b', 'su_a')
  const current = hub._feedFirstFlight
  accountB.resolve({ items: [feedItem('sh_b')], nextCursor: null })
  await current
  accountA.resolve({ items: [feedItem('sh_a')], nextCursor: null })
  await old
  assert.deepEqual(hub.data.feedItems.map(item => item.shareId), ['sh_b'])
  assert.deepEqual(loaded.calls.cacheWrite.map(item => item.socialUserId), ['su_b'])

  const lateRefresh = hub.refreshFeed()
  if (loaded.definition.lifetimes && loaded.definition.lifetimes.detached) loaded.definition.lifetimes.detached.call(hub)
  detachedRequest.resolve({ items: [feedItem('sh_detached')], nextCursor: null })
  await lateRefresh
  assert.equal((hub.data.feedItems || []).some(item => item.shareId === 'sh_detached'), false)
  assert.deepEqual(loaded.calls.cacheWrite.map(item => item.socialUserId), ['su_b'])
  assert.deepEqual(loaded.calls.toast, [])
  const before = loaded.calls.events.length
  if (typeof hub.openHand === 'function') hub.openHand({ currentTarget: { dataset: { shareId: 'sh_b' } } })
  assert.equal(loaded.calls.events.length, before, 'detached components cannot navigate')
})

test('publisher profile handoff uses only public socialUserId and player page passes its verified profile id', () => {
  const hubWxml = fs.readFileSync(hubWxmlPath, 'utf8')
  const pageJs = fs.readFileSync(playerJsPath, 'utf8')
  const pageWxml = fs.readFileSync(playerWxmlPath, 'utf8')
  assert.match(hubWxml, /data-(?:social-user-id|id)="\{\{item\.publisher\.socialUserId\}\}"[^>]+(?:catchtap|bindtap)="openPublisher"/)
  assert.doesNotMatch(hubWxml, /publisher\.(?:ownerOpenId|privatePlayerId|playerId)/)
  assert.match(pageJs, /getMySocialProfile\s*\(/, 'player page must resolve the current verified social profile')
  assert.match(pageWxml, /<friend-hub[^>]+social-user-id="\{\{socialUserId\}\}"/)
  assert.match(pageWxml, /<friend-hub[^>]+bindopenhand="openHand"/)
  assert.match(pageJs, /friendUserId='?\s*\+\s*encodeURIComponent\(friendUserId\)/, 'publisher opens the reused friend player detail by public id')
})

test('feed cache stores only an exact first-page whitelist under the public account key', () => {
  withStorage(storage => {
    const cache = cacheApi(requireFeedCache())
    const item = feedItem('sh_cache')
    item.ownerOpenId = 'openid-canary'
    item.publisher.privatePlayerId = 'private-canary'
    item.summary.sourceHandId = 'hand-canary'
    item.summary.targets = ['su_target']
    assert.equal(cache.write('su/a', { items: [item], nextCursor: 'next-private-page' }, 1000000), false)
    const key = 'socialFeedFirstPage:' + encodeURIComponent('su/a')
    assert.equal(storage.has(key), false)

    const cleanItem = feedItem('sh_cache')
    assert.equal(cache.write('su/a', { items: [cleanItem], nextCursor: 'next-private-page' }, 1000000), true)
    const stored = storage.get(key)
    assert.deepEqual(Object.keys(stored).sort(), ['items', 'nextCursor', 'savedAt', 'socialUserId'])
    assert.equal(stored.socialUserId, 'su/a')
    assert.equal(stored.nextCursor, 'next-private-page', 'the exact first-page envelope keeps its opaque next cursor')
    assert.deepEqual(Object.keys(stored.items[0]).sort(), ['commentCount', 'createdAt', 'likeCount', 'likedByMe', 'publisher', 'scope', 'scopeLabel', 'shareId', 'summary'])
    assert.deepEqual(Object.keys(stored.items[0].publisher).sort(), ['avatarText', 'avatarUrl', 'nickname', 'socialUserId'])
    assert.deepEqual(Object.keys(stored.items[0].summary).sort(), ['actionCount', 'board', 'effectiveStackBb', 'heroCards', 'playerCount', 'potBb'])
    assert.doesNotMatch(JSON.stringify(stored), /openid-canary|private-canary|hand-canary|su_target|ownerOpenId|privatePlayerId|sourceHandId|targets/)
  })
})

test('feed cache rejects nested private field variants on write and malformed legacy reads', () => {
  withStorage(storage => {
    const cache = cacheApi(requireFeedCache())
    const privateItem = feedItem('sh_private_variant')
    privateItem.publisher.profile = { nested: [{ Owner_Open_ID: 'private-canary' }] }
    assert.equal(cache.write('su_viewer', { items: [privateItem], nextCursor: null }, 1000), false)

    const key = 'socialFeedFirstPage:su_viewer'
    const legacyItem = feedItem('sh_legacy_private')
    legacyItem.summary.metadata = [{ leak_tags: ['private-canary'] }]
    storage.set(key, { socialUserId: 'su_viewer', items: [legacyItem], nextCursor: '', savedAt: 1000 })
    assert.equal(cache.read('su_viewer', 1000), null)
  })
})

test('feed cache accepts exactly 300000ms and rejects stale, future, malformed, and cross-account envelopes', () => {
  withStorage(storage => {
    const cache = cacheApi(requireFeedCache())
    const now = 2000000
    cache.write('su_a', { items: [feedItem('sh_ttl')], nextCursor: null }, now - 300000)
    assert.equal(cache.read('su_a', now).items[0].shareId, 'sh_ttl')

    cache.write('su_a', { items: [feedItem('sh_stale')], nextCursor: null }, now - 300001)
    assert.equal(cache.read('su_a', now), null)
    cache.write('su_a', { items: [feedItem('sh_future')], nextCursor: null }, now + 1)
    assert.equal(cache.read('su_a', now), null)

    storage.set('socialFeedFirstPage:su_a', {
      socialUserId: 'su_b', items: [feedItem('sh_cross')], nextCursor: '', savedAt: now
    })
    assert.equal(cache.read('su_a', now), null)
    storage.set('socialFeedFirstPage:su_a', {
      socialUserId: 'su_a', items: [feedItem('sh_unknown')], nextCursor: '', savedAt: now, extra: true
    })
    assert.equal(cache.read('su_a', now), null)
    assert.equal(cache.read('', now), null, 'unknown current account must never guess the previous cache key')
  })
})

test('feed cache storage failures are harmless and removal is scoped to one public account', () => {
  const cache = cacheApi(requireFeedCache())
  assert.doesNotThrow(() => withStorage(() => cache.write('su_a', { items: [feedItem('sh')], nextCursor: null }, Date.now()), { setThrows: true }))
  assert.doesNotThrow(() => withStorage(() => assert.equal(cache.read('su_a', Date.now()), null), { getThrows: true }))
  assert.doesNotThrow(() => withStorage(() => cache.remove('su_a'), { removeThrows: true }))
  withStorage(storage => {
    storage.set('socialFeedFirstPage:su_a', { marker: 'a' })
    storage.set('socialFeedFirstPage:su_b', { marker: 'b' })
    cache.remove('su_a')
    assert.equal(storage.has('socialFeedFirstPage:su_a'), false)
    assert.equal(storage.has('socialFeedFirstPage:su_b'), true)
  })
})

test('only network errors may use cache and offline feed is read-only with navigation disabled', async t => {
  const cached = { items: [feedItem('sh_offline')], nextCursor: '', socialUserId: 'su_viewer', savedAt: Date.now() }
  const network = loadFriendHub({ responses: [() => Promise.reject(Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' }))], cached })
  t.after(() => network.restore())
  const hub = network.createInstance()
  assert.equal(typeof hub.loadFeed, 'function')
  await hub.loadFeed()
  assert.equal(hub.data.feedOffline, true)
  assert.equal(hub.data.feedReadOnly, true)
  assert.ok(hub.data.feedNextCursor === '' || hub.data.feedNextCursor === null)
  assert.deepEqual(hub.data.feedItems.map(item => item.shareId), ['sh_offline'])
  assert.equal(typeof hub.openHand, 'function')
  assert.equal(typeof hub.openPublisher, 'function')
  hub.openHand({ currentTarget: { dataset: { shareId: 'sh_offline' } } })
  hub.openPublisher({ currentTarget: { dataset: { socialUserId: 'su_publisher' } } })
  assert.deepEqual(network.calls.events, [], 'cached content is display-only and grants no detail/profile navigation')

  const forbidden = loadFriendHub({ responses: [() => Promise.reject(Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' }))], cached })
  t.after(() => forbidden.restore())
  const forbiddenHub = forbidden.createInstance()
  await forbiddenHub.loadFeed()
  assert.equal(forbiddenHub.data.feedOffline, false)
  assert.deepEqual(forbiddenHub.data.feedItems, [], 'authorization and contract failures must not fall back to old cache')
})

test('Task 4 preserves the player library list, filters, create, and detail flow', () => {
  const js = fs.readFileSync(playerJsPath, 'utf8')
  const wxml = fs.readFileSync(playerWxmlPath, 'utf8')
  assert.match(wxml, /wx:if="\{\{playerSection === 'library'\}\}"/)
  assert.match(wxml, /class="player-search"/)
  assert.match(wxml, /class="player-type-scroll"/)
  assert.match(wxml, /class="player-list"/)
  assert.match(wxml, /class="player-card"[^>]+bindtap="openDetail"/)
  assert.match(wxml, /bindtap="openCreate"/)
  assert.match(js, /getPlayerNotes\(\{[\s\S]*?sourceKind:\s*'library'[\s\S]*?\}\)/)
  assert.match(js, /navigateTo\(\{\s*url:\s*'\/pages\/player-note-detail\/player-note-detail\?id='/)
  assert.match(js, /navigateTo\(\{\s*url:\s*'\/pages\/player-note-detail\/player-note-detail\?mode=new'/)
})
