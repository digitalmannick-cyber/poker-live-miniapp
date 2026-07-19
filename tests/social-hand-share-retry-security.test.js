const test = require('node:test')
const assert = require('node:assert/strict')

const { createMemorySocialRepository } = require('./helpers/social-fixture')
const { createCloudSocialRepository } = require('../cloudfunctions/poker_social/lib/repository')
const { getPairId } = require('../cloudfunctions/poker_social/lib/friendship')
const { createNotificationWriter } = require('../cloudfunctions/poker_social/lib/notification')
const {
  COLLECTIONS,
  createHandShareHandlers,
  shareSlotId
} = require('../cloudfunctions/poker_social/lib/hand-share')

function socialUser(id, number) {
  return {
    _id: id,
    ownerOpenId: `openid-${id}`,
    privatePlayerId: `PLAYER-${number}`,
    nickname: `User ${number}`,
    avatarText: `U${number}`,
    defaultShareScope: 'friends'
  }
}

function acceptedFriendship(left, right) {
  const pair = [left, right].sort()
  return { _id: getPairId(left, right), userA: pair[0], userB: pair[1], status: 'accepted', acceptedAt: 100 }
}

function baseSeed(friendCount = 1) {
  const publisher = socialUser('su_a', 1)
  const friends = Array.from({ length: friendCount }, (_, index) => socialUser(`su_${index + 2}`, index + 2))
  return {
    social_users: [publisher].concat(friends),
    social_friendships: friends.map(friend => acceptedFriendship(publisher._id, friend._id)),
    hands: [{
      _id: 'hand_1', ownerOpenId: publisher.ownerOpenId, privatePlayerId: publisher.privatePlayerId,
      sessionId: 'session_1', updatedAt: 100, playerCount: 2, heroSeat: 1,
      heroPosition: 'BTN', heroCardsInput: 'AsKs', stakeLevel: '100/200',
      board: { flop: '', turn: '', river: '' }, effectiveStack: 20000, potSize: 1200, allInPot: 0
    }],
    sessions: [{
      _id: 'session_1', ownerOpenId: publisher.ownerOpenId,
      privatePlayerId: publisher.privatePlayerId, bigBlind: 200, updatedAt: 100
    }],
    hand_actions: [{
      _id: 'action_1', ownerOpenId: publisher.ownerOpenId, privatePlayerId: publisher.privatePlayerId,
      handId: 'hand_1', sessionId: 'session_1', street: 'Pre', actorSeat: 1,
      actorLabel: 'Hero BTN', actionType: 'raise', amount: 600, sequence: 1, updatedAt: 100
    }]
  }
}

function setup(seed) {
  const repository = createMemorySocialRepository(seed || baseSeed())
  let nextShare = 0
  const notificationWriter = createNotificationWriter({ now: () => 1_000_000 })
  const handlers = createHandShareHandlers(repository, {
    now: () => 1_000_000,
    randomShareId: () => `share_retry_${++nextShare}`,
    notificationWriter
  })
  return { repository, handlers }
}

function expectCode(promise, code) {
  return assert.rejects(promise, error => error && error.code === code)
}

async function selectedPublish(ctx, clientMutationId = 'publish-retry') {
  const actor = { ownerOpenId: 'openid-su_a' }
  const targetUserIds = ctx.repository.where('social_users', row => row._id !== 'su_a').map(row => row._id)
  const preview = await ctx.handlers.preview_hand_share({ handId: 'hand_1' }, actor)
  const event = {
    handId: 'hand_1', previewHash: preview.previewHash, scope: 'selected', targetUserIds,
    publicShareConfirmed: false, clientMutationId
  }
  const result = await ctx.handlers.publish_hand(event, actor)
  return { actor, event, result, targetUserIds }
}

test('exact publish retry restores after source change and continues the bounded outbox drain', async () => {
  const ctx = setup(baseSeed(12))
  const first = await selectedPublish(ctx)
  assert.equal(ctx.repository.where('social_notifications', row => row.kind === 'selected_hand').length, 10)

  const hand = ctx.repository.get('hands', 'hand_1')
  ctx.repository.set('hands', 'hand_1', Object.assign({}, hand, { updatedAt: hand.updatedAt + 1 }))

  const restored = await ctx.handlers.publish_hand(first.event, first.actor)
  assert.deepEqual(restored, first.result)
  assert.equal(ctx.repository.where('social_notifications', row => row.kind === 'selected_hand').length, 12)
  assert.equal(ctx.repository.where(COLLECTIONS.SHARES, () => true).length, 1)
})

test('exact publish retry restores after source deletion and continues the bounded outbox drain', async () => {
  const ctx = setup(baseSeed(12))
  const first = await selectedPublish(ctx, 'publish-delete-retry')
  assert.equal(ctx.repository.where('social_notifications', row => row.kind === 'selected_hand').length, 10)

  const originalGet = ctx.repository.get.bind(ctx.repository)
  ctx.repository.get = (collection, id) => collection === 'hands' && id === 'hand_1' ? null : originalGet(collection, id)

  const restored = await ctx.handlers.publish_hand(first.event, first.actor)
  assert.deepEqual(restored, first.result)
  assert.equal(ctx.repository.where('social_notifications', row => row.kind === 'selected_hand').length, 12)
  assert.equal(ctx.repository.where(COLLECTIONS.SHARES, () => true).length, 1)
})

test('publish transaction rejects a social user whose privatePlayerId no longer matches the preview bundle', async () => {
  const ctx = setup(baseSeed())
  const actor = { ownerOpenId: 'openid-su_a' }
  const preview = await ctx.handlers.preview_hand_share({ handId: 'hand_1' }, actor)
  const originalTransaction = ctx.repository.runTransaction.bind(ctx.repository)
  let changed = false
  ctx.repository.runTransaction = callback => {
    if (!changed) {
      changed = true
      const user = ctx.repository.get('social_users', 'su_a')
      ctx.repository.set('social_users', 'su_a', Object.assign({}, user, { privatePlayerId: 'PLAYER-OTHER' }))
    }
    return originalTransaction(callback)
  }

  await expectCode(ctx.handlers.publish_hand({
    handId: 'hand_1', previewHash: preview.previewHash, scope: 'friends', targetUserIds: [],
    publicShareConfirmed: false, clientMutationId: 'profile-race'
  }, actor), 'FORBIDDEN')
  assert.equal(ctx.repository.where(COLLECTIONS.SHARES, () => true).length, 0)
  assert.equal(ctx.repository.where('social_mutations', () => true).length, 0)
})

test('production action query never silently accepts exactly 100 rows when a 101st row exists', async () => {
  const sourceRows = Array.from({ length: 101 }, (_, index) => ({
    _id: `action_${String(index + 1).padStart(3, '0')}`,
    ownerOpenId: 'openid-su_a', playerId: 'PLAYER-1', handId: 'hand_1', sequence: index + 1
  }))
  let queryLimit = Infinity
  const query = {
    where() { return this },
    orderBy() { return this },
    limit(value) { queryLimit = Number(value); return this },
    async get() { return { data: sourceRows.slice(0, queryLimit) } }
  }
  const repository = createCloudSocialRepository({
    collection() { return query },
    runTransaction() { throw new Error('not used') }
  })

  let outcome = 'silent-truncation'
  try {
    const rows = await repository.listOwnedHandActions('openid-su_a', 'PLAYER-1', 'hand_1')
    if (rows.length === 101) outcome = 'complete'
  } catch (error) {
    if (error && error.code === 'HAND_ACTIONS_LIMIT_EXCEEDED') outcome = 'rejected'
  }
  assert.notEqual(outcome, 'silent-truncation')
})

test('production action query merges canonical ownerOpenId and legacy _openid rows exactly once', async () => {
  const sourceRows = [
    { _id: 'modern', ownerOpenId: 'openid-su_a', playerId: 'PLAYER-1', handId: 'hand_1', sequence: 2 },
    { _id: 'legacy', _openid: 'openid-su_a', playerId: 'PLAYER-1', handId: 'hand_1', sequence: 1 }
  ]
  function queryFor(filters) {
    const matching = sourceRows.filter(row => Object.keys(filters || {}).every(key => row[key] === filters[key]))
    return {
      where() { return this },
      orderBy() { return this },
      limit() { return this },
      async count() { return { total: matching.length } },
      async get() { return { data: matching } }
    }
  }
  const repository = createCloudSocialRepository({
    collection() {
      return { where(filters) { return queryFor(filters) } }
    },
    runTransaction() { throw new Error('not used') }
  })

  const rows = await repository.listOwnedHandActions('openid-su_a', 'PLAYER-1', 'hand_1')
  assert.deepEqual(rows.map(row => row._id), ['legacy', 'modern'])
})

test('active slot with the wrong complete source tuple is stale and repaired', async () => {
  const ctx = setup(baseSeed())
  const actor = { ownerOpenId: 'openid-su_a' }
  const preview = await ctx.handlers.preview_hand_share({ handId: 'hand_1' }, actor)
  const slotId = shareSlotId('su_a', 'hand_1')
  ctx.repository.set(COLLECTIONS.SHARES, 'wrong_source_share', {
    _id: 'wrong_source_share', publisherId: 'su_a', status: 'active', scope: 'friends',
    source: { ownerOpenId: 'openid-su_a', privatePlayerId: 'PLAYER-OTHER', handId: 'hand_1', sessionId: 'other_session' }
  })
  ctx.repository.set(COLLECTIONS.SLOTS, slotId, {
    _id: slotId, publisherId: 'su_a', handId: 'hand_1', shareId: 'wrong_source_share', generation: 7
  })

  const published = await ctx.handlers.publish_hand({
    handId: 'hand_1', previewHash: preview.previewHash, scope: 'friends', targetUserIds: [],
    publicShareConfirmed: false, clientMutationId: 'repair-full-source'
  }, actor)
  assert.notEqual(published.shareId, 'wrong_source_share')
  assert.equal(ctx.repository.get(COLLECTIONS.SHARES, published.shareId).generation, 8)
  assert.equal(ctx.repository.get(COLLECTIONS.SLOTS, slotId).shareId, published.shareId)
})

test('zero-action quick record follows Task 1 and fails with HAND_ACTIONS_REQUIRED', async () => {
  const seed = baseSeed()
  seed.hand_actions = []
  const ctx = setup(seed)
  await expectCode(
    ctx.handlers.preview_hand_share({ handId: 'hand_1' }, { ownerOpenId: 'openid-su_a' }),
    'HAND_ACTIONS_REQUIRED'
  )
})

test('scope update rechecks the exact source inside its transaction', async () => {
  const ctx = setup(baseSeed())
  const actor = { ownerOpenId: 'openid-su_a' }
  const preview = await ctx.handlers.preview_hand_share({ handId: 'hand_1' }, actor)
  const published = await ctx.handlers.publish_hand({
    handId: 'hand_1', previewHash: preview.previewHash, scope: 'friends', targetUserIds: [],
    publicShareConfirmed: false, clientMutationId: 'scope-source-publish'
  }, actor)
  const originalTransaction = ctx.repository.runTransaction.bind(ctx.repository)
  let sourceChanged = false
  ctx.repository.runTransaction = callback => {
    if (!sourceChanged) {
      sourceChanged = true
      const session = ctx.repository.get('sessions', 'session_1')
      ctx.repository.set('sessions', 'session_1', Object.assign({}, session, { ownerOpenId: 'other-owner' }))
    }
    return originalTransaction(callback)
  }

  await expectCode(ctx.handlers.update_hand_share_scope({
    shareId: published.shareId, scope: 'selected', targetUserIds: ['su_2'],
    publicShareConfirmed: false, clientMutationId: 'scope-source-race'
  }, actor), 'CONTENT_UNAVAILABLE')
  assert.equal(ctx.repository.get(COLLECTIONS.SHARES, published.shareId).scope, 'friends')
  assert.equal(ctx.repository.where(COLLECTIONS.OUTBOX, () => true).length, 0)
})

test('scope update rejects a transactional profile remap with zero mutation writes', async () => {
  const ctx = setup(baseSeed())
  const actor = { ownerOpenId: 'openid-su_a' }
  const preview = await ctx.handlers.preview_hand_share({ handId: 'hand_1' }, actor)
  const published = await ctx.handlers.publish_hand({
    handId: 'hand_1', previewHash: preview.previewHash, scope: 'square', targetUserIds: [],
    publicShareConfirmed: true, clientMutationId: 'scope-profile-publish'
  }, actor)
  const mutationCount = ctx.repository.where('social_mutations', () => true).length
  const originalTransaction = ctx.repository.runTransaction.bind(ctx.repository)
  let profileChanged = false
  ctx.repository.runTransaction = callback => {
    if (!profileChanged) {
      profileChanged = true
      const user = ctx.repository.get('social_users', 'su_a')
      ctx.repository.set('social_users', 'su_a', Object.assign({}, user, { privatePlayerId: 'PLAYER-OTHER' }))
    }
    return originalTransaction(callback)
  }

  await expectCode(ctx.handlers.update_hand_share_scope({
    shareId: published.shareId, scope: 'friends', targetUserIds: [],
    publicShareConfirmed: false, clientMutationId: 'scope-profile-race'
  }, actor), 'FORBIDDEN')
  assert.equal(ctx.repository.get(COLLECTIONS.SHARES, published.shareId).scope, 'square')
  assert.equal(ctx.repository.where('social_mutations', () => true).length, mutationCount)
  assert.equal(ctx.repository.where(COLLECTIONS.OUTBOX, () => true).length, 0)
})
