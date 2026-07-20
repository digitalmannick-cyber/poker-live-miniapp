const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const root = path.resolve(__dirname, '..')
const cachePath = path.join(root, 'utils/social-cache.js')
const hubPath = path.join(root, 'components/friend-hub/friend-hub.js')

test('scoped cache uses unique keys and an exact five-minute account envelope', () => {
  const storage = installStorage()
  try {
    const cache = freshCache()
    assert.equal(cache.getScopedCacheKey('friends', 'WX/A'), 'socialFriendsFirstPage:WX%2FA')
    assert.equal(cache.getScopedCacheKey('ranking:week', 'WX/A'), 'socialRankingFirstPage:WX%2FA:week')
    assert.equal(cache.getScopedCacheKey('ranking:month', 'WX/A'), 'socialRankingFirstPage:WX%2FA:month')
    assert.equal(cache.getScopedCacheKey('ranking:all', 'WX/A'), 'socialRankingFirstPage:WX%2FA:all')
    assert.equal(cache.getScopedCacheKey('friends', ''), '')

    const input = { items: [{ socialUserId: 'su_friend', nickname: '牌友' }], nextOffset: 20 }
    assert.equal(cache.writeScopedFirstPage({ namespace: 'friends', accountKey: 'WX/A', schemaVersion: 1, data: input }, 1000), true)
    const stored = storage.map.get('socialFriendsFirstPage:WX%2FA')
    assert.deepEqual(Object.keys(stored).sort(), ['accountId', 'data', 'savedAt', 'schemaVersion'])
    assert.deepEqual(stored, { accountId: 'WX/A', schemaVersion: 1, savedAt: 1000, data: input })
    input.items[0].nickname = 'mutated'
    assert.equal(stored.data.items[0].nickname, '牌友')

    assert.deepEqual(cache.readScopedFirstPage({ namespace: 'friends', accountKey: 'WX/A', schemaVersion: 1 }, 301000), stored.data)
    assert.equal(cache.readScopedFirstPage({ namespace: 'friends', accountKey: 'WX/A', schemaVersion: 1 }, 301001), null)
    assert.equal(cache.readScopedFirstPage({ namespace: 'friends', accountKey: 'WX/B', schemaVersion: 1 }, 1000), null)
  } finally { storage.restore() }
})

test('scoped cache fails closed for future time, bad structures, private fields and storage errors', () => {
  const storage = installStorage()
  try {
    const cache = freshCache()
    const key = cache.getScopedCacheKey('friends', 'WX-A')
    const valid = { accountId: 'WX-A', schemaVersion: 1, savedAt: 1000, data: { items: [], nextOffset: null } }
    for (const bad of [
      Object.assign({}, valid, { savedAt: 1001 }),
      Object.assign({}, valid, { accountId: 'WX-B' }),
      Object.assign({}, valid, { schemaVersion: 2 }),
      Object.assign({}, valid, { extra: true }),
      Object.assign({}, valid, { data: { ownerOpenId: 'private' } })
    ]) {
      storage.map.set(key, bad)
      assert.equal(cache.readScopedFirstPage({ namespace: 'friends', accountKey: 'WX-A', schemaVersion: 1 }, 1000), null)
    }
    assert.equal(cache.writeScopedFirstPage({ namespace: 'friends', accountKey: '', schemaVersion: 1, data: {} }, 1000), false)
    assert.equal(cache.writeScopedFirstPage({ namespace: 'friends', accountKey: 'WX-A', schemaVersion: 1, data: { privatePlayerId: 'P5' } }, 1000), false)

    storage.failGet = true
    assert.equal(cache.readScopedFirstPage({ namespace: 'friends', accountKey: 'WX-A', schemaVersion: 1 }, 1000), null)
    storage.failGet = false
    storage.failSet = true
    assert.equal(cache.writeScopedFirstPage({ namespace: 'friends', accountKey: 'WX-A', schemaVersion: 1, data: {} }, 1000), false)
  } finally { storage.restore() }
})

test('scoped cache recursively rejects private note and identity field variants while preserving public DTO fields', () => {
  const storage = installStorage()
  try {
    const cache = freshCache()
    const base = {
      items: [{
        socialUserId: 'su_public',
        displayName: '牌友',
        avatarUrl: 'https://example.com/avatar.png',
        avatarText: '牌',
        hours: 12.5,
        handCount: 88
      }],
      nextOffset: null
    }
    assert.equal(cache.writeScopedFirstPage({
      namespace: 'friends', accountKey: 'WX-A', schemaVersion: 1, data: base
    }, 1000), true)
    assert.deepEqual(cache.readScopedFirstPage({
      namespace: 'friends', accountKey: 'WX-A', schemaVersion: 1
    }, 1000), base)

    const privateVariants = [
      'note', 'NOTES', 'leak', 'Leak_Tags', 'battle-hand-ids', 'linked hand ids',
      'private_player_id', 'PlayerID', 'owner-open-id', 'open_id',
      'notePreview', 'note_preview', 'note-preview', 'note preview'
    ]
    for (const field of privateVariants) {
      const privateData = { items: [{ socialUserId: 'su_public', nested: [{ [field]: 'private-canary' }] }], nextOffset: null }
      assert.equal(cache.writeScopedFirstPage({
        namespace: 'friends', accountKey: 'WX-A', schemaVersion: 1, data: privateData
      }, 1000), false, `cache write must reject ${field}`)

      const key = cache.getScopedCacheKey('friends', 'WX-A')
      storage.map.set(key, { accountId: 'WX-A', schemaVersion: 1, savedAt: 1000, data: privateData })
      assert.equal(cache.readScopedFirstPage({
        namespace: 'friends', accountKey: 'WX-A', schemaVersion: 1
      }, 1000), null, `legacy cache read must reject ${field}`)
    }
  } finally { storage.restore() }
})

test('clearAccountCaches removes only captured account keys without scanning another account', () => {
  const storage = installStorage()
  try {
    const cache = freshCache()
    const own = [
      'socialNotificationsFirstPage:WX-A',
      'socialFriendsFirstPage:WX-A',
      'socialRankingFirstPage:WX-A:week',
      'socialRankingFirstPage:WX-A:month',
      'socialRankingFirstPage:WX-A:all',
      'socialCacheAccountIdentity:WX-A',
      cache.getFeedCacheKey('su-a')
    ]
    const other = ['socialNotificationsFirstPage:WX-B', 'socialFriendsFirstPage:WX-B', cache.getFeedCacheKey('su-b')]
    own.concat(other).forEach(key => storage.map.set(key, { key }))
    assert.equal(cache.clearAccountCaches({ accountId: 'WX-A', socialUserId: 'su-a' }), own.length)
    own.forEach(key => assert.equal(storage.map.has(key), false))
    other.forEach(key => assert.equal(storage.map.has(key), true))
    assert.equal(storage.infoCalls, 0)
    assert.equal(cache.clearAccountCaches({ accountId: '', socialUserId: '' }), 0)
  } finally { storage.restore() }
})

test('account identity mapping lets offline logout clear only its feed and rejects cross-account mappings', () => {
  const storage = installStorage()
  try {
    const cache = freshCache()
    assert.equal(cache.registerAccountIdentity({ accountId: 'WX/A', socialUserId: 'su-a' }), true)
    assert.deepEqual(storage.map.get('socialCacheAccountIdentity:WX%2FA'), { accountId: 'WX/A', socialUserId: 'su-a' })
    storage.map.set(cache.getFeedCacheKey('su-a'), { own: true })
    storage.map.set(cache.getFeedCacheKey('su-b'), { other: true })
    cache.clearAccountCaches({ accountId: 'WX/A', socialUserId: '' })
    assert.equal(storage.map.has(cache.getFeedCacheKey('su-a')), false)
    assert.equal(storage.map.has(cache.getFeedCacheKey('su-b')), true)
    assert.equal(storage.map.has('socialCacheAccountIdentity:WX%2FA'), false)

    storage.map.set('socialCacheAccountIdentity:WX-A', { accountId: 'WX-B', socialUserId: 'su-b' })
    cache.clearAccountCaches({ accountId: 'WX-A', socialUserId: '' })
    assert.equal(storage.map.has(cache.getFeedCacheKey('su-b')), true)
    assert.equal(storage.map.has('socialCacheAccountIdentity:WX-A'), false)
  } finally { storage.restore() }
})

test('friends and every ranking range fall back only on network errors as read-only first pages', async () => {
  const storage = installStorage()
  try {
    const loaded = loadHub({
      friends: [friendsResponse('su-live', 20), typedError('NETWORK_ERROR')],
      rankings: [
        rankingResponse('su-week'), typedError('CLOUD_UNAVAILABLE'),
        rankingResponse('su-month'), typedError('NETWORK_ERROR'),
        rankingResponse('su-all'), typedError('CLOUD_UNAVAILABLE')
      ]
    })
    const hub = loaded.create('WX-A', 'su-me')
    await hub.loadFriends(true)
    await hub.loadRanking('week')
    assert.equal(hub.data.friendsReadOnly, false)
    assert.equal(hub.data.rankingReadOnly, false)

    await hub.loadFriends(true)
    await hub.loadRanking('week')
    assert.equal(hub.data.status, 'ready')
    assert.equal(hub.data.friendsReadOnly, true)
    assert.equal(hub.data.friendsOffline, true)
    assert.equal(hub.data.nextOffset, null)
    assert.equal(hub.data.rankingStatus, 'ready')
    assert.equal(hub.data.rankingReadOnly, true)
    assert.equal(hub.data.rankingOffline, true)
    assert.deepEqual(hub.data.rankingRows.map(row => row.socialUserId), ['su-week'])
    assert.equal(loaded.calls.notes, 1, 'offline fallback must not create or update local friend notes')
    await hub.loadRanking('month')
    await hub.loadRanking('month')
    assert.equal(hub.data.rankingReadOnly, true)
    assert.deepEqual(hub.data.rankingRows.map(row => row.socialUserId), ['su-month'])
    await hub.loadRanking('all')
    await hub.loadRanking('all')
    assert.equal(hub.data.rankingReadOnly, true)
    assert.deepEqual(hub.data.rankingRows.map(row => row.socialUserId), ['su-all'])
    assert.doesNotMatch(JSON.stringify(Array.from(storage.map.values())), /ownerOpenId|sourceHandId/)

    const before = loaded.events.length
    hub.openFriend({ currentTarget: { dataset: { id: 'su-live' } } })
    hub.openMessages()
    await hub.loadMoreFriends()
    assert.equal(loaded.events.length, before)
    assert.equal(loaded.calls.friends.length, 2)
  } finally { storage.restore() }
})

test('permission errors never fall back and account switches suppress stale writes and cache callbacks', async () => {
  const storage = installStorage()
  try {
    const cache = freshCache()
    cache.writeScopedFirstPage({ namespace: 'friends', accountKey: 'WX-A', schemaVersion: 1, data: friendsResponse('su-cache', null) }, 1000)

    const pending = deferred()
    const loaded = loadHub({ friends: [typedError('FORBIDDEN'), pending.promise] })
    const hub = loaded.create('WX-A', 'su-a')
    await hub.loadFriends(true)
    assert.equal(hub.data.status, 'error')
    assert.equal(hub.data.friendsReadOnly, false)

    const stale = hub.loadFriends(true)
    hub.data.accountKey = 'WX-B'
    loaded.definition.properties.accountKey.observer.call(hub, 'WX-B', 'WX-A')
    pending.resolve(friendsResponse('su-stale', null))
    await stale
    assert.deepEqual(hub.data.friends, [])
    assert.equal(cache.readScopedFirstPage({ namespace: 'friends', accountKey: 'WX-B', schemaVersion: 1 }, Date.now()), null)
  } finally { storage.restore() }
})

test('player page passes accountKey and clears the captured previous account namespace', () => {
  const js = fs.readFileSync(path.join(root, 'pages/player-notes/player-notes.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(root, 'pages/player-notes/player-notes.wxml'), 'utf8')
  assert.match(wxml, /account-key="\{\{socialAccountKey\}\}"/)
  assert.match(js, /clearAccountCaches\(\{\s*accountId:\s*previousAccountKey,\s*socialUserId:\s*previousSocialUserId\s*\}\)/)
  assert.match(js, /registerAccountIdentity\(\{\s*accountId:\s*currentAccountKey,\s*socialUserId\s*\}\)/)
  assert.doesNotMatch(js, /removeFeedFirstPage\(previousSocialUserId\)/)
})

function friendsResponse(id, nextOffset) {
  return { items: [{ socialUserId: id, nickname: id, avatarUrl: '', avatarText: '友', title: '', statsVisible: true, durationMinutes: 60, recordedHandCount: 2, ownerOpenId: 'must-not-cache' }], nextOffset }
}

function rankingResponse(id) {
  return { top10: [{ socialUserId: id, nickname: id, avatarUrl: '', avatarText: '榜', title: '', rank: 1, durationMinutes: 120, recordedHandCount: 3, sourceHandId: 'must-not-cache' }], myRank: null }
}

function loadHub(options = {}) {
  let definition
  const queues = { friends: (options.friends || []).slice(), rankings: (options.rankings || []).slice() }
  const calls = { friends: [], rankings: [], notes: 0 }
  const events = []
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (parent && /components[\\/]friend-hub[\\/]friend-hub\.js$/.test(parent.filename || '')) {
      if (request === '../../services/social-service') return {
        listFriends(input) { calls.friends.push(input); return next(queues.friends) },
        listRanking(input) { calls.rankings.push(input); return next(queues.rankings) }
      }
      if (request === '../../services/data-service') return {
        async ensureFriendPlayerNote(remote) { calls.notes += 1; return { name: remote.nickname, avatarUrl: remote.avatarUrl, avatarText: remote.avatarText, type: '未分类', typeColor: '#8891a7', leakTags: [], note: '', battleHandIds: [] } }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Component = value => { definition = value }
  const resolved = require.resolve(hubPath)
  delete require.cache[resolved]
  try { require(resolved) } finally { Module._load = originalLoad; delete global.Component }
  return {
    definition, calls, events,
    create(accountKey, socialUserId) {
      const data = JSON.parse(JSON.stringify(definition.data || {}))
      data.accountKey = accountKey
      data.socialUserId = socialUserId
      const instance = { data, setData(patch) { Object.assign(this.data, patch) }, triggerEvent(name, detail) { events.push({ name, detail }) } }
      Object.assign(instance, definition.methods)
      definition.lifetimes.attached.call(instance)
      return instance
    }
  }
}

function installStorage() {
  const previous = global.wx
  const map = new Map()
  const state = { map, failGet: false, failSet: false, infoCalls: 0 }
  global.wx = {
    getStorageSync(key) { if (state.failGet) throw new Error('get failed'); return map.get(key) },
    setStorageSync(key, value) { if (state.failSet) throw new Error('set failed'); map.set(key, value) },
    removeStorageSync(key) { map.delete(key) },
    getStorageInfoSync() { state.infoCalls += 1; return { keys: Array.from(map.keys()) } }
  }
  state.restore = () => { delete require.cache[require.resolve(cachePath)]; if (previous === undefined) delete global.wx; else global.wx = previous }
  return state
}

function freshCache() { delete require.cache[require.resolve(cachePath)]; return require(cachePath) }
function next(queue) { const value = queue.shift(); return value instanceof Error ? Promise.reject(value) : Promise.resolve(value) }
function typedError(code) { const error = new Error(code); error.code = code; return error }
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
