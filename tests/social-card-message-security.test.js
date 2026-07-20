const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

const { createSocialApp } = require('../cloudfunctions/poker_social/app')
const { getPairId } = require('../cloudfunctions/poker_social/lib/friendship')
const { toNotificationDto } = require('../cloudfunctions/poker_social/lib/notification')
const { toCardShareDto } = require('../cloudfunctions/poker_social/lib/player-card')
const notificationRoute = require('../utils/social-notification-route')

const CARD_SHARE_KEYS = ['card', 'expiresAt', 'imported', 'sender', 'shareId']
const CARD_SENDER_KEYS = ['avatarText', 'avatarUrl', 'nickname', 'socialUserId']
const CARD_KEYS = ['avatarUrl', 'leakTags', 'name', 'note', 'type']
const NOTIFICATION_KEYS = ['actionState', 'actor', 'aggregateCount', 'createdAt', 'kind', 'notificationId', 'read', 'targetId', 'targetType']
const ACTOR_KEYS = ['avatarText', 'avatarUrl', 'nickname', 'socialUserId']
const CARD_FORBIDDEN = new Set([
  'alias', 'battleHandIds', 'linkedHandIds', 'localId', 'playerNoteId', 'ownerOpenId', '_openid',
  'avatarFileId', 'createdAt', 'updatedAt', 'targetUserId'
])
const NOTIFICATION_FORBIDDEN = new Set([
  'ownerOpenId', '_openid', 'privatePlayerId', 'avatarFileId', 'accessible', 'permission', 'accessToken',
  'url', 'path', 'playerCardSnapshot', 'cardSnapshot', 'clientMutationId', 'mutationId', 'sourceEventId', 'recipientId'
])
const CACHE_FORBIDDEN = new Set([...CARD_FORBIDDEN, ...NOTIFICATION_FORBIDDEN])
CACHE_FORBIDDEN.delete('createdAt')
const ECONOMIC_FORBIDDEN = new Set(['profit', 'currentProfit', 'buyIn', 'cashOut', 'hourlyRate', 'winRate', 'venue'])

function assertExactKeys(value, keys, label) {
  assert.deepEqual(Object.keys(value).sort(), keys.slice().sort(), label + ' keys changed')
}

function assertNoKeys(value, forbidden, path = '$') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoKeys(item, forbidden, `${path}[${index}]`))
  if (!value || typeof value !== 'object') return
  Object.entries(value).forEach(([key, child]) => {
    assert.equal(forbidden.has(key), false, `${path}.${key} leaked`)
    assertNoKeys(child, forbidden, `${path}.${key}`)
  })
}

test('player-card public DTO keeps exactly five card fields and drops private player identity', async () => {
  const dto = await toCardShareDto({
    _id: 'pcs_public',
    senderUserId: 'su_sender',
    senderSnapshot: {
      socialUserId: 'su_sender', nickname: 'Sender', avatarText: 'S', avatarFileId: 'cloud://private/sender.png',
      ownerOpenId: 'open-sender', targetUserId: 'sender-target-secret',
      createdAt: 'sender-created-secret', updatedAt: 'sender-updated-secret'
    },
    snapshot: {
      avatarAsset: 'cloud://private/card.png', name: '老张', type: '激进', leakTags: ['河牌'], note: '完整 Note',
      alias: ['张总'], battleHandIds: ['hand-secret'], linkedHandIds: ['linked-secret'], localId: 'local-secret',
      playerNoteId: 'note-secret', ownerOpenId: 'open-secret', _openid: 'shadow-secret', avatarFileId: 'cloud://private/raw.png',
      targetUserId: 'snapshot-target-secret', createdAt: 'snapshot-created-secret', updatedAt: 'snapshot-updated-secret'
    },
    targetUserId: 'target-secret',
    createdAt: 'created-secret',
    updatedAt: 'updated-secret',
    expiresAt: 12345,
    importedAt: 0,
    playerNoteId: 'outer-note-secret'
  }, { avatarUrl: async () => 'https://temp.example/safe-avatar.png' })

  assertExactKeys(dto, CARD_SHARE_KEYS, 'card share')
  assertExactKeys(dto.sender, CARD_SENDER_KEYS, 'card sender')
  assertExactKeys(dto.card, CARD_KEYS, 'card')
  assertNoKeys(dto, CARD_FORBIDDEN)
  const serialized = JSON.stringify(dto)
  for (const canary of [
    'hand-secret', 'linked-secret', 'local-secret', 'note-secret', 'open-secret', 'cloud://',
    'target-secret', 'sender-target-secret', 'snapshot-target-secret',
    'created-secret', 'updated-secret', 'sender-created-secret', 'sender-updated-secret',
    'snapshot-created-secret', 'snapshot-updated-secret'
  ]) {
    assert.equal(serialized.includes(canary), false, `card DTO leaked ${canary}`)
  }
})

test('notification DTO is an exact nine-field navigation hint without identity, permission, path or card snapshot data', async () => {
  const dto = await toNotificationDto({
    _id: 'sn_public', recipientId: 'su_receiver', kind: 'player_card',
    actorSnapshot: {
      socialUserId: 'su_sender', nickname: 'Sender', avatarText: 'S', avatarFileId: 'cloud://private/actor.png',
      ownerOpenId: 'open-actor', privatePlayerId: 'PLAYER-SECRET'
    },
    targetType: 'player_card_share', targetId: 'pcs_public', sourceEventId: 'source-secret',
    aggregateCount: 1, actionState: 'available', createdAt: 1000, latestAt: 2000, readAt: 0,
    accessible: true, permission: 'granted', url: '/pages/evil', path: '/pages/evil',
    playerCardSnapshot: { name: 'private card', playerNoteId: 'note-secret' },
    clientMutationId: 'mutation-secret'
  }, {}, { avatarUrl: async () => 'https://temp.example/safe-actor.png' })

  assertExactKeys(dto, NOTIFICATION_KEYS, 'notification')
  assertExactKeys(dto.actor, ACTOR_KEYS, 'notification actor')
  assertNoKeys(dto, NOTIFICATION_FORBIDDEN)
  const serialized = JSON.stringify(dto)
  for (const canary of ['open-actor', 'PLAYER-SECRET', 'source-secret', '/pages/evil', 'private card', 'note-secret', 'mutation-secret', 'cloud://']) {
    assert.equal(serialized.includes(canary), false, `notification DTO leaked ${canary}`)
  }
})

test('real friend-detail and ranking actions omit economic results, win rate and venue data', async () => {
  const friendshipId = getPairId('su_me', 'su_friend')
  const users = [{
    _id: 'su_me', ownerOpenId: 'open-me', privatePlayerId: 'PLAYER-ME',
    profile: { nickname: 'Me', avatarText: 'M', avatarFileId: 'cloud://private/me.png' },
    statsVisible: true, publicStats: { durationMinutes: 60, recordedHandCount: 6 }
  }, {
    _id: 'su_friend', ownerOpenId: 'open-friend', privatePlayerId: 'PLAYER-FRIEND',
    profile: { nickname: 'Friend', avatarText: 'F', avatarFileId: 'cloud://private/friend.png', venue: 'nested-private-venue' },
    statsVisible: true, publicStats: { durationMinutes: 120, recordedHandCount: 12, profit: 99999, winRate: 0.99 },
    profit: 9001, currentProfit: 9002, buyIn: 9003, cashOut: 9004, hourlyRate: 9005, winRate: 0.88,
    venue: 'private-venue'
  }]
  const friendships = [{
    _id: friendshipId, userA: 'su_friend', userB: 'su_me', status: 'accepted', acceptedAt: 100,
    profileSnapshots: { su_friend: { nickname: 'Friend', avatarFileId: 'cloud://private/friend-snapshot.png', profit: 1 } }
  }]
  const repository = {
    find(collection, query) {
      const rows = collection === 'social_users' ? users : friendships
      return rows.find(row => Object.keys(query).every(key => row[key] === query[key])) || null
    },
    get(collection, id) {
      const rows = collection === 'social_users' ? users : friendships
      return rows.find(row => row._id === id) || null
    },
    listAcceptedFriendships(userId) {
      return { items: friendships.filter(row => row.status === 'accepted' && (row.userA === userId || row.userB === userId)), nextOffset: null }
    },
    listDailyStats(ids) {
      return ids.map((id, index) => ({
        socialUserId: id, dateKey: '20260720', durationMinutes: 60 + index, recordedHandCount: 6 + index,
        profit: 8001, currentProfit: 8002, buyIn: 8003, cashOut: 8004, hourlyRate: 8005, winRate: 0.77,
        venue: 'daily-private-venue'
      }))
    }
  }
  const app = createSocialApp({
    repository,
    identity: { resolve: openId => ({ ownerOpenId: openId }) },
    avatarUrl: async () => 'https://temp.example/safe-profile.png',
    ranking: { now: () => Date.parse('2026-07-20T04:00:00.000Z') },
    requestId: () => 'task6-security'
  })

  const detail = await app.handle({ action: 'get_friend_detail', friendUserId: 'su_friend' }, { openId: 'open-me' })
  const ranking = await app.handle({ action: 'list_ranking', rangeKey: 'all' }, { openId: 'open-me' })
  assert.equal(detail.code, 0)
  assert.equal(ranking.code, 0)
  assertNoKeys(detail.data, ECONOMIC_FORBIDDEN, 'friend detail')
  assertNoKeys(ranking.data, ECONOMIC_FORBIDDEN, 'ranking')
  const serialized = JSON.stringify([detail.data, ranking.data])
  for (const canary of ['private-venue', 'nested-private-venue', 'daily-private-venue', '9001', '8001']) {
    assert.equal(serialized.includes(canary), false, `social DTO leaked ${canary}`)
  }
})

test('message first-page cache stores only the account envelope and exact notification DTO whitelist', async () => {
  const storage = new Map()
  const harness = loadMessagePage({
    storage,
    response: {
      items: [{
        notificationId: 'sn_cache', kind: 'player_card',
        actor: {
          socialUserId: 'su_sender', nickname: 'Sender', avatarUrl: 'https://temp.example/a.png', avatarText: 'S',
          ownerOpenId: 'open-actor', avatarFileId: 'cloud://private/actor.png'
        },
        targetType: 'player_card_share', targetId: 'pcs_cache', aggregateCount: 1, actionState: 'available', read: false, createdAt: 1000,
        ownerOpenId: 'open-root', privatePlayerId: 'PLAYER-SECRET', url: '/pages/evil', path: '/pages/evil',
        clientMutationId: 'mutation-secret', mutationId: 'mutation-secret-2', playerCardSnapshot: { playerNoteId: 'note-secret' }
      }],
      nextCursor: null,
      unreadCount: 1
    }
  })
  try {
    const page = createPageInstance(harness.definition)
    page.onLoad()
    await page._firstFlight
    const cached = storage.get('socialNotificationsFirstPage:WX-SECURITY')
    assertExactKeys(cached, ['accountId', 'items', 'nextCursor', 'savedAt', 'unreadCount'], 'cache envelope')
    assert.equal(cached.accountId, 'WX-SECURITY')
    assert.equal(cached.items.length, 1)
    assertExactKeys(cached.items[0], NOTIFICATION_KEYS, 'cached notification')
    assertExactKeys(cached.items[0].actor, ACTOR_KEYS, 'cached actor')
    assertNoKeys(cached, CACHE_FORBIDDEN)
    const serialized = JSON.stringify(cached)
    for (const canary of ['open-root', 'open-actor', 'PLAYER-SECRET', '/pages/evil', 'mutation-secret', 'note-secret', 'cloud://']) {
      assert.equal(serialized.includes(canary), false, `message cache leaked ${canary}`)
    }
  } finally {
    harness.restore()
  }
})

test('unknown, mismatched and injected notification routes fail closed without navigation', () => {
  const cases = [
    { kind: 'unknown', targetType: 'friend', targetId: 'su_1', url: '/pages/evil' },
    { kind: 'friend_accepted', targetType: 'player_card_share', targetId: 'su_1', path: '/pages/evil' },
    { kind: 'player_card', targetType: 'player_card_share', targetId: '', url: '/pages/evil' },
    { kind: 'player_card', targetType: 'future_target', targetId: 'pcs_1', path: '/pages/evil' }
  ]
  cases.forEach(item => assert.deepEqual(notificationRoute.resolveNotificationTarget(item), { type: 'unavailable' }))
})

function loadMessagePage(options) {
  let definition
  const originalLoad = Module._load
  const service = {
    listNotifications: async () => options.response,
    acceptFriendRequest: async () => ({ actionState: 'accepted', unreadCount: 0 }),
    rejectFriendRequest: async () => ({ actionState: 'rejected', unreadCount: 0 }),
    markNotificationRead: async () => ({ unreadCount: 0 }),
    markAllNotificationsRead: async () => ({ unreadCount: 0 })
  }
  const unread = {
    setAccountKey() {},
    subscribe(listener) { listener({ count: 0, label: '', hasUnread: false }); return () => {} },
    applyAuthoritativeCount() {},
    async refresh() { return { count: 0, label: '', hasUnread: false } }
  }
  Module._load = function (request, parent, isMain) {
    if (parent && /pages[\\/]social-messages[\\/]social-messages\.js$/.test(parent.filename || '')) {
      if (request === '../../services/social-service') return service
      if (request === '../../services/data-service') return { getCurrentPlayerId: () => 'WX-SECURITY', isAccountLoggedOut: () => false }
      if (request === '../../utils/social-unread-state') return unread
      if (request === '../../utils/social-mutation') return { createMutationId: prefix => `${prefix}:1` }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Page = value => { definition = value }
  global.wx = {
    getStorageSync(key) { return options.storage.get(key) },
    setStorageSync(key, value) { options.storage.set(key, value) },
    navigateTo() {},
    showToast() {}
  }
  const file = require.resolve('../pages/social-messages/social-messages')
  delete require.cache[file]
  try { require(file) } finally { Module._load = originalLoad; delete global.Page }
  return {
    definition,
    restore() {
      delete require.cache[file]
      delete global.wx
    }
  }
}

function createPageInstance(definition) {
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) }
  }
  Object.assign(instance, definition)
  return instance
}
