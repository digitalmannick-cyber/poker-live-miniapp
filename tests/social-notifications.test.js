const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createMemorySocialRepository } = require('./helpers/social-fixture')
const {
  COLLECTIONS,
  LIKE_WINDOW_MS,
  stableDocumentId,
  encodeCursor,
  decodeCursor,
  stateDocumentId,
  isEffectivelyRead,
  createNotificationWriter,
  createNotificationHandlers
} = require('../cloudfunctions/poker_social/lib/notification')
const { createFriendshipHandlers, getPairId } = require('../cloudfunctions/poker_social/lib/friendship')
const { createPlayerCardHandlers } = require('../cloudfunctions/poker_social/lib/player-card')

function users() {
  return [
    { _id: 'su_a', ownerOpenId: 'openid-a', privatePlayerId: 'PLAYER-A', profile: { nickname: 'Alice', avatarFileId: 'cloud://alice' } },
    { _id: 'su_b', ownerOpenId: 'openid-b', privatePlayerId: 'PLAYER-B', profile: { nickname: 'Bob', avatarFileId: 'cloud://bob' } },
    { _id: 'su_c', ownerOpenId: 'openid-c', privatePlayerId: 'PLAYER-C', profile: { nickname: 'Carol' } }
  ]
}

function actorSnapshot(id, nickname) {
  return { socialUserId: id, nickname, avatarFileId: 'cloud://' + id, avatarText: nickname.slice(0, 1) }
}

function rawCursor(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

test('notification ids hash canonical tuples and cursors validate a versioned stable tuple', () => {
  assert.notEqual(stableDocumentId('sn', ['a_b', 'c']), stableDocumentId('sn', ['a', 'b_c']))
  assert.match(stableDocumentId('sn', ['recipient/unsafe', 'target']), /^sn_[a-f0-9]{64}$/)
  const cursor = encodeCursor({ createdAt: 123, id: 'sn_abc' })
  assert.deepEqual(decodeCursor(cursor), { createdAt: 123, id: 'sn_abc' })
  for (const invalid of ['', 'not-base64-json', Buffer.from(JSON.stringify({ v: 2, createdAt: 1, id: 'x' })).toString('base64url')]) {
    assert.throws(() => decodeCursor(invalid), error => error.code === 'INVALID_PAGINATION')
  }
})

test('cursor decoding rejects coercible and non-canonical raw JSON field types', () => {
  const invalidPayloads = [
    { v: '1', createdAt: 1, id: 'sn_1' },
    { v: null, createdAt: 1, id: 'sn_1' },
    { v: 1, createdAt: '1', id: 'sn_1' },
    { v: 1, createdAt: null, id: 'sn_1' },
    { v: 1, createdAt: true, id: 'sn_1' },
    { v: 1, createdAt: false, id: 'sn_1' },
    { v: 1, createdAt: 1.5, id: 'sn_1' },
    { v: 1, createdAt: Number.MAX_SAFE_INTEGER + 1, id: 'sn_1' },
    { v: 1, createdAt: 1, id: 123 },
    { v: 1, createdAt: 1, id: null },
    { v: 1, createdAt: 1, id: {} },
    { v: 1, createdAt: 1, id: '   ' },
    { v: 1, createdAt: 1, id: ' sn_1' },
    { v: 1, createdAt: 1, id: 'sn_1 ' },
    { v: 1, createdAt: 1, id: 'x'.repeat(257) },
    { v: 1, createdAt: 1, id: 'sn_1', extra: true }
  ]
  for (const payload of invalidPayloads) {
    assert.throws(() => decodeCursor(rawCursor(payload)), error => error.code === 'INVALID_PAGINATION', JSON.stringify(payload))
  }
  assert.throws(() => decodeCursor('x'.repeat(2049)), error => error.code === 'INVALID_PAGINATION')
})

test('notification DTO is a safe navigation hint and list uses stable cursor pagination', async () => {
  const repository = createMemorySocialRepository({ social_users: users() })
  const writer = createNotificationWriter({ now: () => 1_000 })
  for (const [index, actorId] of ['su_a', 'su_c', 'su_a'].entries()) {
    await repository.runTransaction(store => writer.write(store, {
      recipientId: 'su_b',
      kind: index === 0 ? 'friend_request' : 'player_card',
      actor: actorSnapshot(actorId, actorId === 'su_a' ? 'Alice' : 'Carol'),
      targetType: index === 0 ? 'friendship' : 'player_card',
      targetId: 'target_' + index,
      sourceEventId: 'event_' + index,
      actionState: index === 0 ? 'pending' : ''
    }))
  }
  await repository.runTransaction(store => writer.write(store, {
    recipientId: 'su_a', kind: 'player_card', actor: actorSnapshot('su_b', 'Bob'),
    targetType: 'player_card', targetId: 'private-other-recipient', sourceEventId: 'other'
  }))

  const handlers = createNotificationHandlers(repository, { avatarUrl: async id => 'https://temp.example/' + id.slice(8) })
  const first = await handlers.list_notifications({ limit: 2, recipientId: 'su_a' }, { ownerOpenId: 'openid-b' })
  assert.equal(first.items.length, 2)
  assert.ok(first.nextCursor)
  const second = await handlers.list_notifications({ limit: 2, cursor: first.nextCursor }, { ownerOpenId: 'openid-b' })
  assert.equal(second.items.length, 1)
  assert.equal(second.nextCursor, null)
  assert.equal(new Set(first.items.concat(second.items).map(row => row.notificationId)).size, 3)
  const dto = first.items.concat(second.items).find(row => row.kind === 'friend_request')
  assert.deepEqual(dto.actor, { socialUserId: 'su_a', nickname: 'Alice', avatarUrl: 'https://temp.example/su_a', avatarText: 'A' })
  assert.equal(dto.actionState, 'pending')
  assert.deepEqual(dto.target, { type: 'friendship', id: 'target_0' })
  assert.equal(dto.read, false)
  for (const forbidden of ['recipientId', 'sourceEventId', 'avatarFileId', 'ownerOpenId', '_openid', 'accessible']) {
    assert.equal(JSON.stringify(first).includes(forbidden), false)
  }
})

test('individual and all-read mutations use an authoritative watermark and exact unread count', async () => {
  let now = 1_000
  const repository = createMemorySocialRepository({ social_users: users() })
  const writer = createNotificationWriter({ now: () => now })
  const first = await repository.runTransaction(store => writer.write(store, {
    recipientId: 'su_b', kind: 'player_card', actor: actorSnapshot('su_a', 'Alice'),
    targetType: 'player_card', targetId: 'card_1', sourceEventId: 'card_1'
  }))
  now = 2_000
  await repository.runTransaction(store => writer.write(store, {
    recipientId: 'su_b', kind: 'player_card', actor: actorSnapshot('su_a', 'Alice'),
    targetType: 'player_card', targetId: 'card_2', sourceEventId: 'card_2'
  }))
  const handlers = createNotificationHandlers(repository, { now: () => now })
  assert.deepEqual(await handlers.get_unread_count({}, { ownerOpenId: 'openid-b' }), { unreadCount: 2 })
  await handlers.mark_notification_read({ notificationId: first._id, clientMutationId: 'read-one' }, { ownerOpenId: 'openid-b' })
  await handlers.mark_notification_read({ notificationId: first._id, clientMutationId: 'read-one-again' }, { ownerOpenId: 'openid-b' })
  assert.deepEqual(await handlers.get_unread_count({}, { ownerOpenId: 'openid-b' }), { unreadCount: 1 })
  await assert.rejects(
    handlers.mark_notification_read({ notificationId: first._id, clientMutationId: 'cross-read' }, { ownerOpenId: 'openid-a' }),
    error => error.code === 'FORBIDDEN'
  )
  await handlers.mark_all_notifications_read({ clientMutationId: 'read-all' }, { ownerOpenId: 'openid-b' })
  assert.deepEqual(await handlers.get_unread_count({}, { ownerOpenId: 'openid-b' }), { unreadCount: 0 })
  const stateAfterAll = repository.get(COLLECTIONS.STATE, stateDocumentId('su_b'))
  assert.ok(stateAfterAll.readThroughId)
  now = 3_000
  const after = await repository.runTransaction(store => writer.write(store, {
    recipientId: 'su_b', kind: 'player_card', actor: actorSnapshot('su_a', 'Alice'),
    targetType: 'player_card', targetId: 'card_3', sourceEventId: 'card_3'
  }))
  assert.equal(isEffectivelyRead(after, repository.get(COLLECTIONS.STATE, stateDocumentId('su_b'))), false)
  assert.deepEqual(await handlers.get_unread_count({}, { ownerOpenId: 'openid-b' }), { unreadCount: 1 })
})

test('like aggregation counts distinct actors for ten minutes, keeps createdAt stable, and starts new after read', async () => {
  const repository = createMemorySocialRepository({ social_users: users() })
  const writer = createNotificationWriter()
  const first = await repository.runTransaction(store => writer.writeLikeAggregate(store, {
    recipientId: 'su_b', shareId: 'share_1', actor: actorSnapshot('su_a', 'Alice'), sourceEventId: 'like_a_1', at: 599_999
  }))
  const sameActor = await repository.runTransaction(store => writer.writeLikeAggregate(store, {
    recipientId: 'su_b', shareId: 'share_1', actor: actorSnapshot('su_a', 'Alice'), sourceEventId: 'like_a_2', at: 600_001
  }))
  const secondActor = await repository.runTransaction(store => writer.writeLikeAggregate(store, {
    recipientId: 'su_b', shareId: 'share_1', actor: actorSnapshot('su_c', 'Carol'), sourceEventId: 'like_c_1', at: 599_999 + LIKE_WINDOW_MS - 1
  }))
  assert.equal(sameActor._id, first._id)
  assert.equal(secondActor._id, first._id)
  assert.equal(secondActor.aggregateCount, 2)
  assert.equal(secondActor.createdAt, first.createdAt)
  assert.equal(repository.get(COLLECTIONS.STATE, stateDocumentId('su_b')).unreadCount, 1)

  const handlers = createNotificationHandlers(repository)
  await handlers.mark_notification_read({ notificationId: first._id, clientMutationId: 'like-read' }, { ownerOpenId: 'openid-b' })
  const afterRead = await repository.runTransaction(store => writer.writeLikeAggregate(store, {
    recipientId: 'su_b', shareId: 'share_1', actor: actorSnapshot('su_c', 'Carol'), sourceEventId: 'like_c_2', at: 700_000
  }))
  assert.notEqual(afterRead._id, first._id)
  assert.equal(repository.get(COLLECTIONS.STATE, stateDocumentId('su_b')).unreadCount, 1)

  const atBoundary = await repository.runTransaction(store => writer.writeLikeAggregate(store, {
    recipientId: 'su_b', shareId: 'share_2', actor: actorSnapshot('su_a', 'Alice'), sourceEventId: 'boundary_a', at: 1_000
  }))
  const newWindow = await repository.runTransaction(store => writer.writeLikeAggregate(store, {
    recipientId: 'su_b', shareId: 'share_2', actor: actorSnapshot('su_c', 'Carol'), sourceEventId: 'boundary_c', at: 1_000 + LIKE_WINDOW_MS
  }))
  assert.notEqual(newWindow._id, atBoundary._id)
})

test('memory transactions serialize concurrent standalone notifications without lost updates', async () => {
  const repository = createMemorySocialRepository({ social_users: users() })
  const writer = createNotificationWriter({ now: () => 1_000 })
  await Promise.all([
    repository.runTransaction(store => writer.write(store, {
      recipientId: 'su_b', kind: 'player_card', actor: actorSnapshot('su_a', 'Alice'),
      targetType: 'player_card', targetId: 'card_a', sourceEventId: 'concurrent_a'
    })),
    repository.runTransaction(store => writer.write(store, {
      recipientId: 'su_b', kind: 'player_card', actor: actorSnapshot('su_c', 'Carol'),
      targetType: 'player_card', targetId: 'card_c', sourceEventId: 'concurrent_c'
    }))
  ])
  assert.equal(repository.where(COLLECTIONS.NOTIFICATIONS, () => true).length, 2)
  assert.equal(repository.get(COLLECTIONS.STATE, stateDocumentId('su_b')).unreadCount, 2)
})

test('memory transactions serialize concurrent like actors into one exact aggregate', async () => {
  const repository = createMemorySocialRepository({ social_users: users() })
  const writer = createNotificationWriter()
  const first = await repository.runTransaction(store => writer.writeLikeAggregate(store, {
    recipientId: 'su_b', shareId: 'share_concurrent', actor: actorSnapshot('su_a', 'Alice'), sourceEventId: 'actor_a', at: 1_000
  }))
  await Promise.all([
    repository.runTransaction(store => writer.writeLikeAggregate(store, {
      recipientId: 'su_b', shareId: 'share_concurrent', actor: actorSnapshot('su_b_other', 'Bea'), sourceEventId: 'actor_b', at: 2_000
    })),
    repository.runTransaction(store => writer.writeLikeAggregate(store, {
      recipientId: 'su_b', shareId: 'share_concurrent', actor: actorSnapshot('su_c', 'Carol'), sourceEventId: 'actor_c', at: 3_000
    }))
  ])
  assert.equal(repository.get(COLLECTIONS.NOTIFICATIONS, first._id).aggregateCount, 3)
  assert.equal(repository.where(COLLECTIONS.ACTORS, row => row.notificationId === first._id).length, 3)
  assert.equal(repository.get(COLLECTIONS.STATE, stateDocumentId('su_b')).unreadCount, 1)
})

test('memory transaction invocation order precisely defines concurrent mark-all and insert', async () => {
  async function scenario(insertFirst) {
    const repository = createMemorySocialRepository({ social_users: users() })
    const writer = createNotificationWriter({ now: () => 1_000 })
    const old = await repository.runTransaction(store => writer.write(store, {
      recipientId: 'su_b', kind: 'player_card', actor: actorSnapshot('su_a', 'Alice'),
      targetType: 'player_card', targetId: 'old', sourceEventId: 'old'
    }))
    const handlers = createNotificationHandlers(repository, { now: () => 2_000 })
    const insert = () => repository.runTransaction(store => writer.write(store, {
      recipientId: 'su_b', kind: 'player_card', actor: actorSnapshot('su_c', 'Carol'),
      targetType: 'player_card', targetId: 'new', sourceEventId: 'new', at: 3_000
    }))
    const markAll = () => handlers.mark_all_notifications_read({ clientMutationId: insertFirst ? 'all-after' : 'all-before' }, { ownerOpenId: 'openid-b' })
    let results
    if (insertFirst) {
      results = await Promise.all([insert(), markAll()])
    } else {
      const markPromise = markAll()
      await new Promise(resolve => setImmediate(resolve))
      results = await Promise.all([markPromise, insert()])
    }
    const inserted = insertFirst ? results[0] : results[1]
    const state = repository.get(COLLECTIONS.STATE, stateDocumentId('su_b'))
    return { repository, old, inserted, state }
  }

  const markedThenInserted = await scenario(false)
  assert.equal(markedThenInserted.state.unreadCount, 1)
  assert.equal(isEffectivelyRead(markedThenInserted.old, markedThenInserted.state), true)
  assert.equal(isEffectivelyRead(markedThenInserted.inserted, markedThenInserted.state), false)

  const insertedThenMarked = await scenario(true)
  assert.equal(insertedThenMarked.state.unreadCount, 0)
  assert.equal(isEffectivelyRead(insertedThenMarked.old, insertedThenMarked.state), true)
  assert.equal(isEffectivelyRead(insertedThenMarked.inserted, insertedThenMarked.state), true)
})

test('friend request, acceptance, rejection actionState, and card share notifications are atomic domain side effects', async () => {
  let now = 1_000
  const repository = createMemorySocialRepository({
    social_users: users(),
    player_notes: [{
      _id: 'note-a', ownerOpenId: 'openid-a', playerId: 'PLAYER-A', sourceKind: 'library', archived: false,
      name: 'Player', type: 'regular', leakTags: [], note: 'note'
    }]
  })
  const friendship = createFriendshipHandlers(repository, {
    now: () => now,
    tokenSecret: '12345678901234567890123456789012'
  })
  const invite = await friendship.create_invite({ clientMutationId: 'invite-a' }, { ownerOpenId: 'openid-a' })
  const pending = await friendship.send_friend_request({ token: invite.token, clientMutationId: 'request-b' }, { ownerOpenId: 'openid-b' })
  assert.equal(repository.where(COLLECTIONS.NOTIFICATIONS, row => row.kind === 'friend_request').length, 1)
  await friendship.send_friend_request({ token: invite.token, clientMutationId: 'request-b-retry-new-id' }, { ownerOpenId: 'openid-b' })
  assert.equal(repository.where(COLLECTIONS.NOTIFICATIONS, row => row.kind === 'friend_request').length, 1)
  now = 2_000
  await friendship.accept_friend_request({ friendshipId: pending.friendshipId, clientMutationId: 'accept-a' }, { ownerOpenId: 'openid-a' })
  const requestNotification = repository.where(COLLECTIONS.NOTIFICATIONS, row => row.kind === 'friend_request')[0]
  assert.equal(requestNotification.actionState, 'accepted')
  assert.equal(repository.where(COLLECTIONS.NOTIFICATIONS, row => row.kind === 'friend_accepted').length, 1)
  await friendship.accept_friend_request({ friendshipId: pending.friendshipId, clientMutationId: 'accept-a-new-id' }, { ownerOpenId: 'openid-a' })
  assert.equal(repository.where(COLLECTIONS.NOTIFICATIONS, row => row.kind === 'friend_accepted').length, 1)

  const inviteB = await friendship.create_invite({ clientMutationId: 'invite-b' }, { ownerOpenId: 'openid-b' })
  const pendingFromC = await friendship.send_friend_request({ token: inviteB.token, clientMutationId: 'request-c' }, { ownerOpenId: 'openid-c' })
  await friendship.reject_friend_request({ friendshipId: pendingFromC.friendshipId, clientMutationId: 'reject-b' }, { ownerOpenId: 'openid-b' })
  const rejectedNotification = repository.where(COLLECTIONS.NOTIFICATIONS, row => row.kind === 'friend_request' && row.targetId === pendingFromC.friendshipId)[0]
  assert.equal(rejectedNotification.actionState, 'rejected')

  const card = createPlayerCardHandlers(repository, { now: () => 3_000 })
  const shared = await card.share_player_card({ playerNoteId: 'note-a', targetUserId: 'su_b', clientMutationId: 'card-share' }, { ownerOpenId: 'openid-a' })
  const cardNotifications = repository.where(COLLECTIONS.NOTIFICATIONS, row => row.kind === 'player_card')
  assert.equal(cardNotifications.length, 1)
  assert.equal(cardNotifications[0].targetId, shared.shareId)

  const cardCountBeforeFailure = repository.where('social_player_card_shares', () => true).length
  const failingCard = createPlayerCardHandlers(repository, {
    now: () => 3_500,
    notificationWriter: { write: async () => { throw new Error('card notification failed') } }
  })
  await assert.rejects(
    failingCard.share_player_card({ playerNoteId: 'note-a', targetUserId: 'su_b', clientMutationId: 'card-atomic-fail' }, { ownerOpenId: 'openid-a' }),
    /card notification failed/
  )
  assert.equal(repository.where('social_player_card_shares', () => true).length, cardCountBeforeFailure)
  assert.equal(repository.where('social_mutations', row => row.clientMutationId === 'card-atomic-fail').length, 0)

  const failing = createFriendshipHandlers(repository, {
    now: () => 4_000,
    tokenSecret: '12345678901234567890123456789012',
    notificationWriter: { write: async () => { throw new Error('notification failed') }, setActionState: async () => {} }
  })
  repository.set('social_friendships', getPairId('su_a', 'su_c'), {
    _id: getPairId('su_a', 'su_c'), userA: 'su_a', userB: 'su_c', requesterId: 'su_c', receiverId: 'su_a', status: 'pending', createdAt: 3_500
  })
  await assert.rejects(
    failing.accept_friend_request({ friendshipId: getPairId('su_a', 'su_c'), clientMutationId: 'atomic-fail' }, { ownerOpenId: 'openid-a' }),
    /notification failed/
  )
  assert.equal(repository.get('social_friendships', getPairId('su_a', 'su_c')).status, 'pending')
  assert.equal(repository.where('social_mutations', row => row.clientMutationId === 'atomic-fail').length, 0)
})

test('notification service wrappers preserve read/write mutation boundaries', async () => {
  const apiPath = require.resolve('../services/social-api')
  const servicePath = require.resolve('../services/social-service')
  const api = require(apiPath)
  const original = api.callSocialFunction
  const calls = []
  api.callSocialFunction = async (action, payload) => { calls.push({ action, payload }); return { ok: true } }
  delete require.cache[servicePath]
  try {
    const service = require('../services/social-service')
    await service.listNotifications({ cursor: 'cursor', limit: 20 })
    await service.getUnreadNotificationCount()
    await service.markNotificationRead({ notificationId: 'sn_1', clientMutationId: 'read-1' })
    await service.markAllNotificationsRead({ clientMutationId: 'read-all' })
    assert.throws(() => service.markNotificationRead({ notificationId: 'sn_1' }), error => error.code === 'INVALID_MUTATION')
    assert.deepEqual(calls.map(call => call.action), [
      'list_notifications', 'get_unread_count', 'mark_notification_read', 'mark_all_notifications_read'
    ])
  } finally {
    api.callSocialFunction = original
    delete require.cache[servicePath]
  }
})

test('social app routes notification actions while keeping target authorization separate', async () => {
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const repository = createMemorySocialRepository({ social_users: users() })
  const writer = createNotificationWriter({ now: () => 1_000 })
  const row = await repository.runTransaction(store => writer.write(store, {
    recipientId: 'su_b', kind: 'player_card', actor: actorSnapshot('su_a', 'Alice'),
    targetType: 'player_card', targetId: 'withdrawn-card', sourceEventId: 'withdrawn-card'
  }))
  const app = createSocialApp({
    repository,
    identity: { resolve: openId => ({ ownerOpenId: openId }) },
    requestId: () => 'notification-route',
    avatarUrl: async () => 'https://temp.example/avatar'
  })
  const listed = await app.handle({ action: 'list_notifications', limit: 20 }, { openId: 'openid-b' })
  assert.equal(listed.code, 0)
  assert.equal(listed.data.items[0].targetId, 'withdrawn-card')
  assert.equal(Object.hasOwn(listed.data.items[0], 'accessible'), false)
  const missingMutation = await app.handle({ action: 'mark_notification_read', notificationId: row._id }, { openId: 'openid-b' })
  assert.equal(missingMutation.code, 'INVALID_MUTATION')
  const marked = await app.handle({ action: 'mark_notification_read', notificationId: row._id, clientMutationId: 'route-read' }, { openId: 'openid-b' })
  assert.equal(marked.code, 0)
})

test('CloudBase notification repository uses recipient-scoped keyset queries and documents exact indexes', async () => {
  const { SOCIAL_COLLECTIONS, createCloudSocialRepository } = require('../cloudfunctions/poker_social/lib/repository')
  assert.equal(SOCIAL_COLLECTIONS.SOCIAL_NOTIFICATIONS, COLLECTIONS.NOTIFICATIONS)
  assert.equal(SOCIAL_COLLECTIONS.SOCIAL_NOTIFICATION_STATE, COLLECTIONS.STATE)
  assert.equal(SOCIAL_COLLECTIONS.SOCIAL_NOTIFICATION_HEADS, COLLECTIONS.HEADS)
  assert.equal(SOCIAL_COLLECTIONS.SOCIAL_NOTIFICATION_ACTORS, COLLECTIONS.ACTORS)
  const calls = []
  const chain = {
    orderBy(field, direction) { calls.push(['orderBy', field, direction]); return this },
    limit(value) { calls.push(['limit', value]); return this },
    async get() { return { data: [] } }
  }
  const command = {
    lt: value => ({ $lt: value }),
    eq: value => ({ $eq: value }),
    and: value => ({ $and: value }),
    or: value => ({ $or: value })
  }
  const database = {
    command,
    collection(name) {
      calls.push(['collection', name])
      return { where(query) { calls.push(['where', query]); return chain } }
    }
  }
  const repository = createCloudSocialRepository(database)
  await repository.listNotifications('su_b', { cursor: { createdAt: 123, id: 'sn_cursor' }, limit: 20 })
  assert.deepEqual(calls.filter(call => call[0] === 'orderBy'), [
    ['orderBy', 'createdAt', 'desc'], ['orderBy', '_id', 'desc']
  ])
  assert.deepEqual(calls.find(call => call[0] === 'limit'), ['limit', 21])
  assert.match(JSON.stringify(calls.find(call => call[0] === 'where')), /su_b|createdAt|sn_cursor/)
  assert.equal(calls.some(call => call[0] === 'skip'), false)
  await assert.rejects(repository.runTransaction(async () => ({})), /transactions unavailable/)

  const indexes = fs.readFileSync(path.join(__dirname, '../cloudfunctions/poker_social/database-indexes.md'), 'utf8')
  assert.match(indexes, /social_notifications.*recipientId ASC.*createdAt DESC.*_id DESC/i)
  assert.match(indexes, /social_notification_state/)
  assert.match(indexes, /social_notification_heads/)
  assert.match(indexes, /social_notification_actors/)
})
