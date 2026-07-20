const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')

const {
  createAccountClearHandlers,
  BATCH_SIZE,
  ANONYMOUS_COMMENT_AUTHOR,
  ANONYMOUS_NOTIFICATION_ACTOR
} = require('../cloudfunctions/poker_social/lib/account-clear')
const { createSocialApp } = require('../cloudfunctions/poker_social/app')
const { createCloudSocialRepository } = require('../cloudfunctions/poker_social/lib/repository')
const { createProfileHandlers } = require('../cloudfunctions/poker_social/lib/profile')
const { runIdempotent } = require('../cloudfunctions/poker_social/lib/idempotency')
const { stateDocumentId, createNotificationWriter } = require('../cloudfunctions/poker_social/lib/notification')
const { shareSlotId, drainNotificationOutbox } = require('../cloudfunctions/poker_social/lib/hand-share')

const USER = {
  _id: 'su_clear', ownerOpenId: 'openid-clear', privatePlayerId: 'PLAYER-CLEAR',
  profile: { nickname: 'Clear Me', avatarFileId: 'cloud://clear', avatarText: 'C' },
  statsVisible: true, publicStats: { durationMinutes: 99, recordedHandCount: 9 }, createdAt: 1, updatedAt: 1
}
const OTHER = { _id: 'su_other', ownerOpenId: 'openid-other', privatePlayerId: 'PLAYER-OTHER', profile: { nickname: 'Other', avatarText: 'O' } }

function memoryRepository(seed) {
  const tables = JSON.parse(JSON.stringify(seed || {}))
  const listCalls = []
  let transactionTail = Promise.resolve()

  function rows(source, collection) { return source[collection] || (source[collection] = []) }
  function storeFor(source) {
    return {
      get(collection, id) { return rows(source, collection).find(row => row._id === id) || null },
      set(collection, id, value) {
        const collectionRows = rows(source, collection)
        const index = collectionRows.findIndex(row => row._id === id)
        const next = Object.assign({}, value, { _id: id })
        if (index >= 0) collectionRows[index] = next
        else collectionRows.push(next)
        return next
      },
      remove(collection, id) {
        const collectionRows = rows(source, collection)
        const index = collectionRows.findIndex(row => row._id === id)
        if (index >= 0) collectionRows.splice(index, 1)
        return true
      }
    }
  }

  const repository = Object.assign(storeFor(tables), {
    find(collection, query) {
      return rows(tables, collection).find(row => Object.entries(query || {}).every(([key, value]) => row[key] === value)) || null
    },
    findAccountClearUserByOpenId(ownerOpenId) {
      return rows(tables, 'social_users').find(row => row.ownerOpenId === ownerOpenId) || null
    },
    listAccountClearBatch(stage, socialUserId, limit) {
      assert.equal(limit, BATCH_SIZE)
      const filters = {
        invites: ['social_invites', row => row.inviterId === socialUserId && row.revokedAt === 0],
        friendships_a_pending: ['social_friendships', row => row.userA === socialUserId && row.status === 'pending'],
        friendships_a_accepted: ['social_friendships', row => row.userA === socialUserId && row.status === 'accepted'],
        friendships_a_rejected: ['social_friendships', row => row.userA === socialUserId && row.status === 'rejected'],
        friendships_b_pending: ['social_friendships', row => row.userB === socialUserId && row.status === 'pending'],
        friendships_b_accepted: ['social_friendships', row => row.userB === socialUserId && row.status === 'accepted'],
        friendships_b_rejected: ['social_friendships', row => row.userB === socialUserId && row.status === 'rejected'],
        hand_shares: ['social_hand_shares', row => row.publisherId === socialUserId && row.status === 'active'],
        card_shares_sent: ['social_player_card_shares', row => row.senderUserId === socialUserId && row.status === 'active'],
        card_shares_received: ['social_player_card_shares', row => row.targetUserId === socialUserId && row.status === 'active' && row.importedAt === 0],
        comments: ['social_comments', row => row.authorId === socialUserId && row.deleted === false],
        likes: ['social_likes', row => row.actorId === socialUserId && row.active === true],
        recipient_notifications: ['social_notifications', row => row.recipientId === socialUserId],
        recipient_heads: ['social_notification_heads', row => row.recipientId === socialUserId],
        actor_notifications: ['social_notifications', row => row.actorSnapshot && row.actorSnapshot.socialUserId === socialUserId],
        actor_memberships: ['social_notification_actors', row => row.actorId === socialUserId],
        outbox_publisher: ['social_notification_outbox', row => row.publisherId === socialUserId && row.status === 'pending'],
        outbox_target: ['social_notification_outbox', row => row.status === 'pending' && Array.isArray(row.targetUserIds) && row.targetUserIds.includes(socialUserId)],
        rate_actor: ['social_rate_limits', row => row.actorId === socialUserId],
        rate_publisher: ['social_rate_limits', row => row.publisherId === socialUserId],
        mutations: ['social_mutations', row => row.actorId === socialUserId],
        daily_stats: ['social_daily_stats', row => row.socialUserId === socialUserId]
      }
      const config = filters[stage]
      if (!config) throw new Error('unexpected account clear stage: ' + stage)
      const result = rows(tables, config[0]).filter(config[1]).sort((a, b) => String(a._id).localeCompare(String(b._id))).slice(0, limit)
      listCalls.push({ stage, limit, count: result.length })
      return result
    },
    listAccountClearNotificationActors(notificationId, limit) {
      assert.ok(limit >= 1 && limit <= BATCH_SIZE)
      const result = rows(tables, 'social_notification_actors')
        .filter(row => row.notificationId === notificationId)
        .sort((a, b) => String(a._id).localeCompare(String(b._id)))
        .slice(0, limit)
      listCalls.push({ stage: 'recipient_notification_actors', limit, count: result.length })
      return result
    },
    runTransaction(callback) {
      const execute = async () => {
        const draft = JSON.parse(JSON.stringify(tables))
        const result = await callback(storeFor(draft))
        for (const key of Object.keys(tables)) delete tables[key]
        for (const [key, value] of Object.entries(draft)) tables[key] = value
        return result
      }
      const pending = transactionTail.then(execute, execute)
      transactionTail = pending.then(() => undefined, () => undefined)
      return pending
    },
    dump() { return JSON.parse(JSON.stringify(tables)) },
    listCalls
  })
  return repository
}

async function clearUntilComplete(handlers, mutationIds) {
  const responses = []
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const clientMutationId = mutationIds[Math.min(attempt, mutationIds.length - 1)]
    const result = await handlers.clear_my_social_data({ clientMutationId }, { ownerOpenId: USER.ownerOpenId })
    responses.push(result)
    assert.deepEqual(Object.keys(result).sort(), ['completed', 'remainingStage', 'socialUserId'])
    assert.equal(result.socialUserId, USER._id)
    if (result.completed) return responses
  }
  throw new Error('account clear did not complete')
}

function baseSeed(patch) {
  return Object.assign({
    social_users: [USER, OTHER], social_invites: [], social_friendships: [], social_hand_shares: [], social_hand_share_slots: [],
    social_player_card_shares: [], social_comments: [], social_likes: [], social_notifications: [], social_notification_state: [],
    social_notification_heads: [], social_notification_actors: [], social_notification_outbox: [], social_rate_limits: [],
    social_mutations: [], social_daily_stats: []
  }, patch || {})
}

test('account clear uses a private checkpoint, batches at 50, accepts same or new retry mutation and completes stably', async () => {
  const invites = Array.from({ length: 51 }, (_, index) => ({
    _id: `invite-${String(index).padStart(2, '0')}`, inviterId: USER._id, revokedAt: 0, createdAt: index + 1, updatedAt: index + 1
  }))
  const repository = memoryRepository(baseSeed({ social_invites: invites }))
  const handlers = createAccountClearHandlers(repository, { now: () => 10_000 })

  for (const clientMutationId of [undefined, '', ' ', 1, {}, 'x'.repeat(129)]) {
    await assert.rejects(
      handlers.clear_my_social_data({ clientMutationId }, { ownerOpenId: USER.ownerOpenId }),
      error => error && error.code === 'INVALID_MUTATION'
    )
  }

  const responses = await clearUntilComplete(handlers, ['clear-first', 'clear-first', 'clear-retry'])
  assert.equal(responses.at(-1).remainingStage, '')
  assert.equal(responses.at(-1).completed, true)
  assert.ok(repository.listCalls.every(call => call.limit <= BATCH_SIZE && call.count <= BATCH_SIZE))
  assert.ok(repository.listCalls.some(call => call.stage === 'invites' && call.count === 50))
  assert.ok(repository.listCalls.some(call => call.stage === 'invites' && call.count === 1))
  assert.ok(repository.dump().social_invites.every(row => row.revokedAt === 10_000))

  const user = repository.get('social_users', USER._id)
  assert.equal(user.deleted, true)
  assert.equal(user.statsVisible, false)
  assert.equal(user.accountClear.stage, 'complete')
  assert.match(user.accountClear.mutationHash, /^[0-9a-f]{64}$/)
  assert.doesNotMatch(JSON.stringify(user.accountClear), /clear-first|clear-retry/)
  assert.deepEqual(
    await handlers.clear_my_social_data({ clientMutationId: 'after-complete' }, { ownerOpenId: USER.ownerOpenId }),
    { completed: true, remainingStage: '', socialUserId: USER._id }
  )
})

test('account clear converges every social collection while preserving replies and authoritative share counts', async () => {
  const ownShare = { _id: 'sh-own', publisherId: USER._id, source: { handId: 'hand-own' }, status: 'active', likeCount: 0, commentCount: 0, createdAt: 1 }
  const otherShare = { _id: 'sh-other', publisherId: OTHER._id, source: { handId: 'hand-other' }, status: 'active', likeCount: 2, commentCount: 2, createdAt: 2 }
  const notificationId = 'n-recipient'
  const repository = memoryRepository(baseSeed({
    social_invites: [{ _id: 'invite', inviterId: USER._id, revokedAt: 0, createdAt: 1 }],
    social_friendships: [
      { _id: 'friend-a', userA: USER._id, userB: OTHER._id, status: 'accepted', acceptedAt: 1 },
      { _id: 'friend-b', userA: OTHER._id, userB: USER._id, status: 'pending', acceptedAt: 0 }
    ],
    social_hand_shares: [ownShare, otherShare],
    social_hand_share_slots: [{ _id: shareSlotId(USER._id, 'hand-own'), publisherId: USER._id, handId: 'hand-own', shareId: ownShare._id }],
    social_player_card_shares: [
      { _id: 'card-sent', senderUserId: USER._id, targetUserId: OTHER._id, status: 'active', importedAt: 0, createdAt: 1 },
      { _id: 'card-received', senderUserId: OTHER._id, targetUserId: USER._id, status: 'active', importedAt: 0, createdAt: 2 },
      { _id: 'card-imported', senderUserId: OTHER._id, targetUserId: USER._id, status: 'active', importedAt: 5, createdAt: 3 }
    ],
    social_comments: [
      { _id: 'comment-top', shareId: otherShare._id, parentCommentId: '', authorId: USER._id, authorSnapshot: { socialUserId: USER._id, nickname: 'Clear Me', avatarUrl: '', avatarText: 'C' }, kind: 'text', text: 'erase', stickerId: '', deleted: false, createdAt: 1 },
      { _id: 'comment-reply', shareId: otherShare._id, parentCommentId: 'comment-top', authorId: OTHER._id, authorSnapshot: { socialUserId: OTHER._id, nickname: 'Other', avatarUrl: '', avatarText: 'O' }, kind: 'text', text: 'keep reply', stickerId: '', deleted: false, createdAt: 2 }
    ],
    social_likes: [
      { _id: 'like-active', shareId: otherShare._id, actorId: USER._id, active: true, createdAt: 1, updatedAt: 1 },
      { _id: 'like-inactive', shareId: otherShare._id, actorId: USER._id, active: false, createdAt: 1, updatedAt: 2 }
    ],
    social_notifications: [
      { _id: notificationId, recipientId: USER._id, actorSnapshot: { socialUserId: OTHER._id, nickname: 'Other', avatarFileId: '', avatarText: 'O' }, createdAt: 1 },
      { _id: 'n-other', recipientId: OTHER._id, actorSnapshot: { socialUserId: USER._id, nickname: 'Clear Me', avatarFileId: 'cloud://clear', avatarText: 'C' }, createdAt: 2 }
    ],
    social_notification_state: [{ _id: stateDocumentId(USER._id), recipientId: USER._id, unreadCount: 1 }],
    social_notification_heads: [{ _id: 'head', recipientId: USER._id, notificationId, latestAt: 1 }],
    social_notification_actors: [
      { _id: 'actor-recipient', notificationId, actorId: OTHER._id, createdAt: 1 },
      { _id: 'actor-other', notificationId: 'n-other', actorId: USER._id, createdAt: 2 }
    ],
    social_notification_outbox: [
      { _id: 'outbox-publisher', publisherId: USER._id, targetUserIds: [OTHER._id], deliveredTargetIds: [], skippedTargetIds: [], status: 'pending', createdAt: 1 },
      { _id: 'outbox-target', publisherId: OTHER._id, targetUserIds: [USER._id, 'su_third'], deliveredTargetIds: [], skippedTargetIds: [], status: 'pending', createdAt: 2 }
    ],
    social_rate_limits: [{ _id: 'rate-a', actorId: USER._id }, { _id: 'rate-p', publisherId: USER._id }],
    social_mutations: [{ _id: 'mutation', actorId: USER._id, action: 'x', createdAt: 1 }],
    social_daily_stats: [{ _id: 'stats', socialUserId: USER._id, dateKey: '20260720' }]
  }))
  const handlers = createAccountClearHandlers(repository, { now: () => 20_000 })
  await clearUntilComplete(handlers, ['clear-all'])
  const data = repository.dump()

  assert.ok(data.social_friendships.every(row => row.status === 'removed'))
  assert.equal(data.social_hand_shares.find(row => row._id === ownShare._id).status, 'withdrawn')
  assert.equal(data.social_hand_share_slots[0].shareId, '')
  assert.equal(data.social_player_card_shares.find(row => row._id === 'card-sent').status, 'withdrawn')
  assert.equal(data.social_player_card_shares.find(row => row._id === 'card-received').status, 'invalidated')
  assert.equal(data.social_player_card_shares.find(row => row._id === 'card-imported').status, 'active')

  const deletedComment = data.social_comments.find(row => row._id === 'comment-top')
  assert.equal(deletedComment.deleted, true)
  assert.deepEqual(deletedComment.authorSnapshot, ANONYMOUS_COMMENT_AUTHOR)
  assert.equal(data.social_comments.find(row => row._id === 'comment-reply').deleted, false)
  assert.equal(data.social_hand_shares.find(row => row._id === otherShare._id).commentCount, 1)
  assert.equal(data.social_likes.find(row => row._id === 'like-active').active, false)
  assert.equal(data.social_hand_shares.find(row => row._id === otherShare._id).likeCount, 1)

  assert.equal(data.social_notifications.some(row => row.recipientId === USER._id), false)
  assert.equal(data.social_notification_state.some(row => row.recipientId === USER._id), false)
  assert.equal(data.social_notification_heads.some(row => row.recipientId === USER._id), false)
  assert.equal(data.social_notification_actors.some(row => row.notificationId === notificationId), false)
  assert.deepEqual(data.social_notifications.find(row => row._id === 'n-other').actorSnapshot, ANONYMOUS_NOTIFICATION_ACTOR)
  assert.equal(data.social_notification_actors.find(row => row._id === 'actor-other').actorId, ANONYMOUS_NOTIFICATION_ACTOR.socialUserId)

  const publisherOutbox = data.social_notification_outbox.find(row => row._id === 'outbox-publisher')
  assert.deepEqual(publisherOutbox.skippedTargetIds, [OTHER._id])
  assert.equal(publisherOutbox.status, 'delivered')
  const targetOutbox = data.social_notification_outbox.find(row => row._id === 'outbox-target')
  assert.deepEqual(targetOutbox.skippedTargetIds, [USER._id])
  assert.deepEqual(targetOutbox.targetUserIds, ['su_third'])
  assert.equal(targetOutbox.status, 'pending')
  assert.equal(data.social_rate_limits.length, 0)
  assert.equal(data.social_mutations.length, 0)
  assert.equal(data.social_daily_stats.length, 0)
})

test('social app routes clear_my_social_data and returns only the public checkpoint envelope', async () => {
  const repository = memoryRepository(baseSeed())
  const app = createSocialApp({
    repository,
    identity: { resolve: openId => ({ ownerOpenId: openId }) },
    accountClear: { now: () => 30_000 },
    requestId: () => 'clear-request'
  })
  const response = await app.handle({ action: 'clear_my_social_data', clientMutationId: 'clear-app' }, { openId: USER.ownerOpenId })
  assert.equal(response.code, 0)
  assert.deepEqual(Object.keys(response.data).sort(), ['completed', 'remainingStage', 'socialUserId'])
  assert.equal(response.data.socialUserId, USER._id)
  assert.doesNotMatch(JSON.stringify(response), /ownerOpenId|privatePlayerId|accountClear|mutationHash/)
})

test('cloud repository exposes exact fail-closed account-clear batch queries without offset scans', async () => {
  const calls = []
  const database = {
    command: {
      and(values) { return { $and: values } },
      nin(values) { return { $nin: values } }
    },
    collection(collection) {
      const call = { collection, where: null, orders: [], limit: 0, skip: false }
      const chain = {
        doc() { return chain },
        where(query) { call.where = query; return chain },
        orderBy(field, order) { call.orders.push([field, order]); return chain },
        limit(limit) { call.limit = limit; return chain },
        skip() { call.skip = true; return chain },
        async get() { calls.push(call); return { data: [] } },
        async set() {}, async remove() {}
      }
      return chain
    },
    async runTransaction(callback) { return callback(this) }
  }
  const repository = createCloudSocialRepository(database)
  await repository.findAccountClearUserByOpenId(USER.ownerOpenId)
  for (const stage of [
    'invites', 'friendships_a_pending', 'friendships_a_accepted', 'friendships_a_rejected',
    'friendships_b_pending', 'friendships_b_accepted', 'friendships_b_rejected', 'hand_shares',
    'card_shares_sent', 'card_shares_received', 'comments', 'likes', 'recipient_notifications',
    'recipient_heads', 'actor_notifications', 'actor_memberships', 'outbox_publisher', 'outbox_target',
    'rate_actor', 'rate_publisher', 'mutations', 'daily_stats'
  ]) {
    await repository.listAccountClearBatch(stage, USER._id, BATCH_SIZE)
  }
  await repository.listAccountClearNotificationActors('notification-id', BATCH_SIZE)

  assert.equal(calls.length, 24)
  assert.ok(calls.every(call => call.limit > 0 && call.limit <= BATCH_SIZE))
  assert.ok(calls.every(call => call.skip === false))
  const outboxTarget = calls.find(call => call.collection === 'social_notification_outbox' && call.where && call.where.targetUserIds)
  assert.ok(outboxTarget)
  assert.deepEqual(outboxTarget.where, { status: 'pending', targetUserIds: USER._id })
  await assert.rejects(repository.listAccountClearBatch('unknown', USER._id, BATCH_SIZE), /stage unavailable/)
  await assert.rejects(repository.listAccountClearBatch('invites', USER._id, BATCH_SIZE + 1), /limit unavailable/)
})

test('clearing lifecycle blocks every routed entry and transactionally prevents profile or interaction rebuilds', async () => {
  const repository = memoryRepository(baseSeed())
  const clearHandlers = createAccountClearHandlers(repository, { now: () => 40_000 })
  assert.deepEqual(
    await clearHandlers.clear_my_social_data({ clientMutationId: 'lifecycle-clear' }, { ownerOpenId: USER.ownerOpenId }),
    { completed: false, remainingStage: 'invites', socialUserId: USER._id }
  )
  const clearingUser = repository.get('social_users', USER._id)
  assert.equal(clearingUser.socialLifecycle, 'clearing')
  assert.equal(clearingUser.accountClear.stage, 'invites')

  const profileHandlers = createProfileHandlers(repository)
  await assert.rejects(
    profileHandlers.initialize_social_profile({ nickname: 'Rebuilt', avatarMode: 'wechat', playerId: 'PLAYER-CLEAR' }, { ownerOpenId: USER.ownerOpenId }),
    error => error && error.code === 'SOCIAL_PROFILE_REQUIRED'
  )
  assert.equal(repository.get('social_users', USER._id).accountClear.stage, 'invites')

  let transactionRan = false
  await assert.rejects(
    runIdempotent(repository, USER._id, 'rebuild_like', { clientMutationId: 'rebuild-like' }, async store => {
      transactionRan = true
      await store.set('social_likes', 'late-like', { actorId: USER._id, active: true })
      return { ok: true }
    }),
    error => error && error.code === 'SOCIAL_PROFILE_REQUIRED'
  )
  assert.equal(transactionRan, false)
  assert.equal(repository.get('social_likes', 'late-like'), null)

  let routedEntries = 0
  const guardedActions = [
    'initialize_social_profile', 'get_my_social_profile', 'update_social_settings', 'create_invite',
    'share_player_card', 'publish_hand', 'list_feed', 'create_comment', 'list_notifications', 'get_ranking'
  ]
  const app = createSocialApp({
    repository,
    identity: { resolve: openId => ({ ownerOpenId: openId }) },
    handlers: Object.fromEntries(guardedActions.map(action => [action, async () => { routedEntries += 1; return {} }]))
  })
  for (const action of guardedActions) {
    const response = await app.handle({ action }, { openId: USER.ownerOpenId })
    assert.equal(response.code, 'SOCIAL_PROFILE_REQUIRED', action)
  }
  assert.equal(routedEntries, 0)

  const notificationWriter = createNotificationWriter({ now: () => 40_001 })
  const backgroundWrite = await repository.runTransaction(store => notificationWriter.write(store, {
    recipientId: USER._id,
    kind: 'friend_accepted',
    actor: { socialUserId: OTHER._id, nickname: 'Other', avatarFileId: '', avatarText: 'O' },
    targetType: 'friend',
    targetId: OTHER._id,
    sourceEventId: 'late-notification'
  }))
  assert.equal(backgroundWrite, null)
  const clearingActorWrite = await repository.runTransaction(store => notificationWriter.write(store, {
    recipientId: OTHER._id,
    kind: 'friend_accepted',
    actor: { socialUserId: USER._id, nickname: 'Clear Me', avatarFileId: '', avatarText: 'C' },
    targetType: 'friend',
    targetId: USER._id,
    sourceEventId: 'late-clearing-actor'
  }))
  assert.equal(clearingActorWrite, null)
  repository.set('social_notification_outbox', 'late-outbox', {
    _id: 'late-outbox', publisherId: OTHER._id, shareId: 'late-share', targetUserIds: [USER._id],
    deliveredTargetIds: [], skippedTargetIds: [], status: 'pending', createdAt: 40_001
  })
  assert.deepEqual(
    await drainNotificationOutbox(repository, 'late-outbox', { notificationWriter, maxTargets: 1 }),
    { processed: 0 }
  )
  assert.equal(repository.dump().social_notifications.some(row => row.recipientId === USER._id), false)

  await clearUntilComplete(clearHandlers, ['lifecycle-retry'])
  const completedUser = repository.get('social_users', USER._id)
  assert.equal(completedUser.socialLifecycle, 'deleted')
  assert.equal(completedUser.accountClear.stage, 'complete')
})

test('profile initialization reserves one owner mapping across concurrent creates and cannot overtake clear', async () => {
  const emptyRepository = memoryRepository(baseSeed({ social_users: [] }))
  const profileHandlers = createProfileHandlers(emptyRepository)
  const event = { nickname: 'Only One', avatarMode: 'wechat', playerId: 'PLAYER-ONE' }
  const actor = { ownerOpenId: 'openid-one' }
  const [left, right] = await Promise.all([
    profileHandlers.initialize_social_profile(event, actor),
    profileHandlers.initialize_social_profile(event, actor)
  ])
  assert.equal(left.socialUserId, right.socialUserId)
  assert.equal(emptyRepository.dump().social_users.length, 1)
  const reservations = emptyRepository.dump().social_user_owners
  assert.equal(reservations.length, 1)
  assert.equal(reservations[0].socialUserId, left.socialUserId)
  assert.doesNotMatch(JSON.stringify(reservations[0]), /openid-one/)
  assert.notEqual(left.socialUserId, 'su_' + crypto.createHash('sha256').update(actor.ownerOpenId).digest('hex').slice(0, 32))

  const repository = memoryRepository(baseSeed())
  const originalRunTransaction = repository.runTransaction.bind(repository)
  let releaseInitialize
  let initializePaused
  const paused = new Promise(resolve => { initializePaused = resolve })
  const release = new Promise(resolve => { releaseInitialize = resolve })
  let blockNextTransaction = true
  repository.runTransaction = callback => {
    if (!blockNextTransaction) return originalRunTransaction(callback)
    blockNextTransaction = false
    initializePaused()
    return release.then(() => originalRunTransaction(callback))
  }
  const existingProfile = createProfileHandlers(repository)
  const initializing = existingProfile.initialize_social_profile({
    nickname: 'Must Not Return', avatarMode: 'wechat', playerId: USER.privatePlayerId
  }, { ownerOpenId: USER.ownerOpenId })
  await paused
  const clearHandlers = createAccountClearHandlers(repository, { now: () => 50_000 })
  await clearHandlers.clear_my_social_data({ clientMutationId: 'clear-wins' }, { ownerOpenId: USER.ownerOpenId })
  releaseInitialize()
  await assert.rejects(initializing, error => error && error.code === 'SOCIAL_PROFILE_REQUIRED')
  assert.equal(repository.dump().social_users.length, 2)
  assert.equal(repository.get('social_users', USER._id).socialLifecycle, 'clearing')
  assert.equal(repository.get('social_users', USER._id).accountClear.stage, 'invites')
})
