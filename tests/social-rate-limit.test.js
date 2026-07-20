const test = require('node:test')
const assert = require('node:assert/strict')

const { createMemorySocialRepository } = require('./helpers/social-fixture')
const { buildInviteRecord } = require('../cloudfunctions/poker_social/lib/invite')
const { createFriendshipHandlers, getPairId } = require('../cloudfunctions/poker_social/lib/friendship')
const { createPlayerCardHandlers } = require('../cloudfunctions/poker_social/lib/player-card')
const {
  RATE_LIMITS,
  rateLimitId
} = require('../cloudfunctions/poker_social/lib/validation')
const {
  COLLECTIONS,
  createHandShareHandlers,
  rateLimitId: handShareRateLimitId
} = require('../cloudfunctions/poker_social/lib/hand-share')

const DAY_MS = 24 * 60 * 60 * 1000

function activeUser(id) {
  return {
    _id: id,
    ownerOpenId: 'openid-' + id,
    privatePlayerId: 'PLAYER-' + id.toUpperCase(),
    profile: { nickname: id, avatarText: id.slice(-1) },
    defaultShareScope: 'friends'
  }
}

test('friendRequest counts only successful pending transitions and drops the exact 24h left boundary', async () => {
  const nowRef = { value: 1_000 }
  const requester = activeUser('su_requester')
  const inviters = Array.from({ length: 21 }, (_, index) => activeUser('su_inviter_' + index))
  const tokens = inviters.map((_, index) => ('friendrate' + String(index).padStart(2, '0')).padEnd(22, 'x'))
  const repository = createMemorySocialRepository({
    social_users: [requester].concat(inviters),
    social_invites: inviters.map((user, index) => buildInviteRecord(tokens[index], user._id, nowRef.value))
  })
  const handlers = createFriendshipHandlers(repository, { now: () => nowRef.value })
  const actor = { ownerOpenId: requester.ownerOpenId }

  assert.deepEqual(RATE_LIMITS.friendRequest, { windowMs: DAY_MS, max: 20 })
  for (let index = 0; index < 20; index += 1) {
    const result = await handlers.send_friend_request({ token: tokens[index], clientMutationId: 'friend-' + index }, actor)
    assert.equal(result.status, 'pending')
    assert.equal(repository.get('social_rate_limits', rateLimitId(requester._id, 'friendRequest')).occurredAt.length, index + 1)
  }

  const blockedEvent = { token: tokens[20], clientMutationId: 'friend-20' }
  await assert.rejects(handlers.send_friend_request(blockedEvent, actor), error => error && error.code === 'RATE_LIMITED')
  const rateAfterBlock = repository.get('social_rate_limits', rateLimitId(requester._id, 'friendRequest'))
  assert.equal(rateAfterBlock.occurredAt.length, 20)
  assert.equal(repository.where('social_mutations', row => row.action === 'send_friend_request').length, 20)

  nowRef.value += DAY_MS
  await handlers.send_friend_request(blockedEvent, actor)
  assert.deepEqual(repository.get('social_rate_limits', rateLimitId(requester._id, 'friendRequest')).occurredAt, [nowRef.value])

  await handlers.send_friend_request({ token: tokens[0], clientMutationId: 'friend-0' }, actor)
  await handlers.send_friend_request({ token: tokens[0], clientMutationId: 'friend-pending-noop' }, actor)
  assert.deepEqual(repository.get('social_rate_limits', rateLimitId(requester._id, 'friendRequest')).occurredAt, [nowRef.value])
})

test('playerCard counts only successful new shares while restore and failed writes consume nothing', async () => {
  const nowRef = { value: 2_000 }
  const sender = activeUser('su_sender')
  const receiver = activeUser('su_receiver')
  const repository = createMemorySocialRepository({
    social_users: [sender, receiver],
    social_friendships: [{
      _id: getPairId(sender._id, receiver._id),
      userA: [sender._id, receiver._id].sort()[0],
      userB: [sender._id, receiver._id].sort()[1],
      status: 'accepted',
      acceptedAt: 1
    }],
    player_notes: [{
      _id: 'note-rate', ownerOpenId: sender.ownerOpenId, playerId: sender.privatePlayerId,
      sourceKind: 'library', archived: false, name: 'Rate card'
    }]
  })
  const handlers = createPlayerCardHandlers(repository, { now: () => nowRef.value })
  const actor = { ownerOpenId: sender.ownerOpenId }
  const event = index => ({ playerNoteId: 'note-rate', targetUserId: receiver._id, clientMutationId: 'card-' + index })

  assert.deepEqual(RATE_LIMITS.playerCard, { windowMs: DAY_MS, max: 20 })
  for (let index = 0; index < 20; index += 1) {
    await handlers.share_player_card(event(index), actor)
    assert.equal(repository.get('social_rate_limits', rateLimitId(sender._id, 'playerCard')).occurredAt.length, index + 1)
  }

  await handlers.share_player_card(event(0), actor)
  assert.equal(repository.get('social_rate_limits', rateLimitId(sender._id, 'playerCard')).occurredAt.length, 20)
  await assert.rejects(handlers.share_player_card(event(20), actor), error => error && error.code === 'RATE_LIMITED')
  assert.equal(repository.where('social_mutations', row => row.action === 'share_player_card').length, 20)
  await assert.rejects(
    handlers.share_player_card({ playerNoteId: 'missing', targetUserId: receiver._id, clientMutationId: 'card-invalid' }, actor),
    error => error && error.code === 'PLAYER_CARD_SOURCE_NOT_FOUND'
  )
  assert.equal(repository.get('social_rate_limits', rateLimitId(sender._id, 'playerCard')).occurredAt.length, 20)

  nowRef.value += DAY_MS
  const boundaryShare = await handlers.share_player_card(event(20), actor)
  assert.deepEqual(repository.get('social_rate_limits', rateLimitId(sender._id, 'playerCard')).occurredAt, [nowRef.value])
  await handlers.withdraw_player_card_share({ shareId: boundaryShare.shareId, clientMutationId: 'card-withdraw' }, actor)
  assert.deepEqual(repository.get('social_rate_limits', rateLimitId(sender._id, 'playerCard')).occurredAt, [nowRef.value])
})

test('friendRequest and playerCard roll back an already-consumed slot when a later write fails', async () => {
  const now = 2_500
  const requester = activeUser('su_rollback_requester')
  const inviter = activeUser('su_rollback_inviter')
  const token = 'rollbackfriendtokenxxx'
  const friendRepository = createMemorySocialRepository({
    social_users: [requester, inviter],
    social_invites: [buildInviteRecord(token, inviter._id, now)]
  })
  const failingWriter = { write: async () => { throw new Error('notification failed') } }
  const friendship = createFriendshipHandlers(friendRepository, { now: () => now, notificationWriter: failingWriter })
  await assert.rejects(
    friendship.send_friend_request({ token, clientMutationId: 'friend-rollback' }, { ownerOpenId: requester.ownerOpenId }),
    /notification failed/
  )
  assert.equal(friendRepository.get('social_rate_limits', rateLimitId(requester._id, 'friendRequest')), null)
  assert.equal(friendRepository.where('social_friendships', () => true).length, 0)
  assert.equal(friendRepository.where('social_mutations', () => true).length, 0)

  const sender = activeUser('su_rollback_sender')
  const receiver = activeUser('su_rollback_receiver')
  const cardRepository = createMemorySocialRepository({
    social_users: [sender, receiver],
    social_friendships: [{
      _id: getPairId(sender._id, receiver._id),
      userA: [sender._id, receiver._id].sort()[0],
      userB: [sender._id, receiver._id].sort()[1],
      status: 'accepted', acceptedAt: 1
    }],
    player_notes: [{
      _id: 'note-rollback', ownerOpenId: sender.ownerOpenId, playerId: sender.privatePlayerId,
      sourceKind: 'library', archived: false, name: 'Rollback card'
    }]
  })
  const cards = createPlayerCardHandlers(cardRepository, { now: () => now, notificationWriter: failingWriter })
  await assert.rejects(cards.share_player_card({
    playerNoteId: 'note-rollback', targetUserId: receiver._id, clientMutationId: 'card-rollback'
  }, { ownerOpenId: sender.ownerOpenId }), /notification failed/)
  assert.equal(cardRepository.get('social_rate_limits', rateLimitId(sender._id, 'playerCard')), null)
  assert.equal(cardRepository.where('social_player_card_shares', () => true).length, 0)
  assert.equal(cardRepository.where('social_mutations', () => true).length, 0)
})

test('friendRequest and playerCard use separate actor rate keys while cross-action mutation reuse changes neither rate', async () => {
  const now = 2_750
  const actorUser = activeUser('su_shared_actor')
  const inviter = activeUser('su_shared_inviter')
  const cardReceiver = activeUser('su_shared_receiver')
  const token = 'sharedmutationtokenxxx'
  const repository = createMemorySocialRepository({
    social_users: [actorUser, inviter, cardReceiver],
    social_invites: [buildInviteRecord(token, inviter._id, now)],
    social_friendships: [{
      _id: getPairId(actorUser._id, cardReceiver._id),
      userA: [actorUser._id, cardReceiver._id].sort()[0],
      userB: [actorUser._id, cardReceiver._id].sort()[1],
      status: 'accepted', acceptedAt: 1
    }],
    player_notes: [{
      _id: 'note-shared', ownerOpenId: actorUser.ownerOpenId, playerId: actorUser.privatePlayerId,
      sourceKind: 'library', archived: false, name: 'Shared mutation card'
    }]
  })
  const friendship = createFriendshipHandlers(repository, { now: () => now })
  const cards = createPlayerCardHandlers(repository, { now: () => now })
  const actor = { ownerOpenId: actorUser.ownerOpenId }
  const friendRateId = rateLimitId(actorUser._id, 'friendRequest')
  const cardRateId = rateLimitId(actorUser._id, 'playerCard')

  assert.notEqual(friendRateId, cardRateId)

  await friendship.send_friend_request({ token, clientMutationId: 'shared-friend-first' }, actor)
  const afterFriend = {
    friend: repository.get('social_rate_limits', friendRateId),
    card: repository.get('social_rate_limits', cardRateId)
  }
  await assert.rejects(cards.share_player_card({
    playerNoteId: 'note-shared', targetUserId: cardReceiver._id, clientMutationId: 'shared-friend-first'
  }, actor), error => error && error.code === 'MUTATION_CONFLICT')
  assert.deepEqual(repository.get('social_rate_limits', friendRateId), afterFriend.friend)
  assert.deepEqual(repository.get('social_rate_limits', cardRateId), afterFriend.card)

  await cards.share_player_card({
    playerNoteId: 'note-shared', targetUserId: cardReceiver._id, clientMutationId: 'shared-card-first'
  }, actor)
  const afterCard = {
    friend: repository.get('social_rate_limits', friendRateId),
    card: repository.get('social_rate_limits', cardRateId)
  }
  await assert.rejects(
    friendship.send_friend_request({ token, clientMutationId: 'shared-card-first' }, actor),
    error => error && error.code === 'MUTATION_CONFLICT'
  )
  assert.deepEqual(repository.get('social_rate_limits', friendRateId), afterCard.friend)
  assert.deepEqual(repository.get('social_rate_limits', cardRateId), afterCard.card)
})

function handShareSeed() {
  const publisher = activeUser('su_publisher')
  const friend = activeUser('su_friend')
  return {
    social_users: [publisher, friend],
    social_friendships: [{
      _id: getPairId(publisher._id, friend._id),
      userA: [publisher._id, friend._id].sort()[0],
      userB: [publisher._id, friend._id].sort()[1],
      status: 'accepted', acceptedAt: 1
    }],
    hands: [{
      _id: 'hand-rate', ownerOpenId: publisher.ownerOpenId, privatePlayerId: publisher.privatePlayerId,
      sessionId: 'session-rate', updatedAt: 100, playerCount: 2, heroSeat: 1,
      heroPosition: 'BTN', heroCardsInput: 'AsKs', stakeLevel: '100/200',
      board: { flop: '', turn: '', river: '' }, effectiveStack: 20_000, potSize: 1_200, allInPot: 0
    }],
    sessions: [{
      _id: 'session-rate', ownerOpenId: publisher.ownerOpenId,
      privatePlayerId: publisher.privatePlayerId, bigBlind: 200
    }],
    hand_actions: [{
      _id: 'action-rate', ownerOpenId: publisher.ownerOpenId, privatePlayerId: publisher.privatePlayerId,
      handId: 'hand-rate', sessionId: 'session-rate', street: 'Pre', actorSeat: 1,
      actorLabel: 'Hero BTN', actionType: 'raise', amount: 600, sequence: 1, updatedAt: 100
    }]
  }
}

test('publish_hand keeps its single Task 2 limiter and appends exactly one timestamp per success', async () => {
  const nowRef = { value: 3_000 }
  const repository = createMemorySocialRepository(handShareSeed())
  let nextId = 0
  const handlers = createHandShareHandlers(repository, {
    now: () => nowRef.value,
    randomShareId: () => 'share-rate-' + (++nextId)
  })
  const actor = { ownerOpenId: 'openid-su_publisher' }
  const rateId = handShareRateLimitId('su_publisher')

  for (let index = 0; index < 20; index += 1) {
    const preview = await handlers.preview_hand_share({ handId: 'hand-rate' }, actor)
    const result = await handlers.publish_hand({
      handId: 'hand-rate', previewHash: preview.previewHash, scope: 'friends', targetUserIds: [],
      publicShareConfirmed: false, clientMutationId: 'publish-rate-' + index
    }, actor)
    const rateRows = repository.where(COLLECTIONS.RATE_LIMITS, () => true)
    assert.equal(rateRows.length, 1)
    assert.equal(rateRows[0]._id, rateId)
    assert.equal(rateRows[0].publishedAt.length, index + 1)
    assert.equal(Object.hasOwn(rateRows[0], 'occurredAt'), false)
    await handlers.withdraw_hand_share({ shareId: result.shareId, clientMutationId: 'withdraw-rate-' + index }, actor)
  }

  const preview = await handlers.preview_hand_share({ handId: 'hand-rate' }, actor)
  await assert.rejects(handlers.publish_hand({
    handId: 'hand-rate', previewHash: preview.previewHash, scope: 'friends', targetUserIds: [],
    publicShareConfirmed: false, clientMutationId: 'publish-rate-20'
  }, actor), error => error && error.code === 'RATE_LIMITED')
  assert.equal(repository.where(COLLECTIONS.RATE_LIMITS, () => true).length, 1)
  assert.equal(repository.get(COLLECTIONS.RATE_LIMITS, rateId).publishedAt.length, 20)
})
