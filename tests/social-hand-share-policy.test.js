const test = require('node:test')
const assert = require('node:assert/strict')

const { createMemorySocialRepository } = require('./helpers/social-fixture')
const { getPairId } = require('../cloudfunctions/poker_social/lib/friendship')
const { createNotificationWriter } = require('../cloudfunctions/poker_social/lib/notification')
const {
  COLLECTIONS,
  createHandShareHandlers,
  loadOwnedHandBundle,
  previewHashForBundle,
  shareSlotId,
  rateLimitId,
  notificationOutboxId,
  drainNotificationOutbox,
  requireReadableShare
} = require('../cloudfunctions/poker_social/lib/hand-share')
const { canReadShare } = require('../cloudfunctions/poker_social/lib/visibility')
const { runIdempotent } = require('../cloudfunctions/poker_social/lib/idempotency')

function user(id, n) {
  return {
    _id: id,
    ownerOpenId: `openid-${id}`,
    privatePlayerId: `PLAYER-${String(n).padStart(2, '0')}`,
    nickname: `User ${n}`,
    avatarText: `U${n}`,
    avatarFileId: `cloud://avatar-${n}`,
    defaultShareScope: 'friends'
  }
}

function friendship(left, right, status = 'accepted') {
  return { _id: getPairId(left, right), userA: [left, right].sort()[0], userB: [left, right].sort()[1], status }
}

function sourceRows(owner = user('su_a', 1), patch) {
  const hand = Object.assign({
    _id: 'hand_1', ownerOpenId: owner.ownerOpenId, privatePlayerId: owner.privatePlayerId,
    sessionId: 'session_1', updatedAt: 100, playerCount: 2, heroSeat: 1,
    heroPosition: 'BTN', heroCardsInput: 'AsKs', stakeLevel: '100/200',
    board: { flop: '', turn: '', river: '' }, effectiveStack: 20000, potSize: 1200, allInPot: 0
  }, patch && patch.hand)
  const session = Object.assign({
    _id: 'session_1', ownerOpenId: owner.ownerOpenId, privatePlayerId: owner.privatePlayerId, bigBlind: 200
  }, patch && patch.session)
  const actions = (patch && patch.actions) || [{
    _id: 'action_1', ownerOpenId: owner.ownerOpenId, privatePlayerId: owner.privatePlayerId,
    handId: hand._id, sessionId: session._id, street: 'Pre', actorSeat: 1,
    actorLabel: 'Hero BTN', actionType: 'raise', amount: 600, sequence: 1, updatedAt: 100
  }]
  return { hands: [hand], sessions: [session], hand_actions: actions }
}

function seedWithFriends(count = 1) {
  const publisher = user('su_a', 1)
  const targets = Array.from({ length: count }, (_, index) => user(`su_${index + 2}`, index + 2))
  return Object.assign(sourceRows(publisher), {
    social_users: [publisher].concat(targets),
    social_friendships: targets.map(target => friendship(publisher._id, target._id))
  })
}

function setup(seed, options) {
  const repository = createMemorySocialRepository(seed || seedWithFriends())
  let id = 0
  const nowRef = options && options.nowRef || { value: 1_000_000 }
  const notificationWriter = createNotificationWriter({ now: () => nowRef.value })
  const handlers = createHandShareHandlers(repository, {
    now: () => nowRef.value,
    randomShareId: () => `share_${++id}`,
    notificationWriter
  })
  return { repository, handlers, nowRef, notificationWriter }
}

async function previewAndPublish(ctx, patch) {
  const actor = { ownerOpenId: 'openid-su_a' }
  const preview = await ctx.handlers.preview_hand_share({ handId: 'hand_1' }, actor)
  return ctx.handlers.publish_hand(Object.assign({
    handId: 'hand_1', previewHash: preview.previewHash, scope: 'friends', targetUserIds: [],
    publicShareConfirmed: false, clientMutationId: 'publish-1'
  }, patch), actor)
}

function expectCode(promise, code) {
  return assert.rejects(promise, error => error && error.code === code)
}

test('authoritative bundle resolves OpenID profile and exact private ownership without existence disclosure', async () => {
  const ctx = setup(seedWithFriends())
  const bundle = await loadOwnedHandBundle(ctx.repository, { ownerOpenId: 'openid-su_a' }, 'hand_1')
  assert.equal(bundle.socialUser._id, 'su_a')
  assert.equal(bundle.hand._id, 'hand_1')
  assert.equal(bundle.actions.length, 1)

  for (const mutation of [
    data => { data.hands[0].ownerOpenId = 'other' },
    data => { data.hands[0].privatePlayerId = 'OTHER' },
    data => { data.sessions[0].ownerOpenId = 'other' },
    data => { data.hands = [] }
  ]) {
    const data = seedWithFriends()
    mutation(data)
    await expectCode(loadOwnedHandBundle(createMemorySocialRepository(data), { ownerOpenId: 'openid-su_a' }, 'hand_1'), 'FORBIDDEN')
  }
})

test('preview hash is stable over canonical snapshot and changes with source or action revision', async () => {
  const ctx = setup(seedWithFriends())
  const first = await ctx.handlers.preview_hand_share({ handId: 'hand_1' }, { ownerOpenId: 'openid-su_a' })
  const bundle = await loadOwnedHandBundle(ctx.repository, { ownerOpenId: 'openid-su_a' }, 'hand_1')
  assert.equal(first.previewHash, previewHashForBundle(bundle))
  assert.equal(first.defaultShareScope, 'friends')
  assert.equal(first.snapshot.version, 1)

  ctx.repository.set('hand_actions', 'action_1', Object.assign({}, ctx.repository.get('hand_actions', 'action_1'), { updatedAt: 101 }))
  const second = await ctx.handlers.preview_hand_share({ handId: 'hand_1' }, { ownerOpenId: 'openid-su_a' })
  assert.notEqual(second.previewHash, first.previewHash)
})

test('stale preview aborts with zero share, slot, rate, outbox, or mutation writes', async () => {
  const ctx = setup(seedWithFriends())
  const actor = { ownerOpenId: 'openid-su_a' }
  const preview = await ctx.handlers.preview_hand_share({ handId: 'hand_1' }, actor)
  const hand = ctx.repository.get('hands', 'hand_1')
  ctx.repository.set('hands', 'hand_1', Object.assign({}, hand, { updatedAt: 101 }))
  await expectCode(ctx.handlers.publish_hand({
    handId: 'hand_1', previewHash: preview.previewHash, scope: 'friends', targetUserIds: [],
    publicShareConfirmed: false, clientMutationId: 'stale'
  }, actor), 'HAND_PREVIEW_STALE')
  for (const table of [COLLECTIONS.SHARES, COLLECTIONS.SLOTS, COLLECTIONS.RATE_LIMITS, COLLECTIONS.OUTBOX, 'social_mutations']) {
    assert.deepEqual(ctx.repository.where(table, () => true), [], table)
  }
})

test('scope validation enforces exact square, friends and selected contracts at 1/50/51 boundaries', async () => {
  const square = setup(seedWithFriends())
  await expectCode(previewAndPublish(square, { scope: 'square', publicShareConfirmed: false }), 'INVALID_SHARE_SCOPE')
  const squareResult = await previewAndPublish(square, { scope: 'square', publicShareConfirmed: true, clientMutationId: 'square' })
  assert.equal(squareResult.scope, 'square')

  const noFriend = setup(Object.assign(sourceRows(user('su_a', 1)), { social_users: [user('su_a', 1)] }))
  await expectCode(previewAndPublish(noFriend, { clientMutationId: 'friends-none' }), 'INVALID_SHARE_SCOPE')

  for (const count of [1, 50]) {
    const selected = setup(seedWithFriends(count))
    const targetUserIds = selected.repository.where('social_users', row => row._id !== 'su_a').map(row => row._id).reverse()
    targetUserIds.push(targetUserIds[0])
    const result = await previewAndPublish(selected, { scope: 'selected', targetUserIds, clientMutationId: `selected-${count}` })
    assert.equal(result.scope, 'selected')
    const share = selected.repository.get(COLLECTIONS.SHARES, result.shareId)
    assert.equal(share.targetUserIds.length, count)
    assert.deepEqual(share.targetUserIds, share.targetUserIds.slice().sort())
  }

  const over = setup(seedWithFriends(51))
  const targets = over.repository.where('social_users', row => row._id !== 'su_a').map(row => row._id)
  await expectCode(previewAndPublish(over, { scope: 'selected', targetUserIds: targets, clientMutationId: 'selected-51' }), 'INVALID_SHARE_SCOPE')

  const changed = setup(seedWithFriends(1))
  const actor = { ownerOpenId: 'openid-su_a' }
  const preview = await changed.handlers.preview_hand_share({ handId: 'hand_1' }, actor)
  changed.repository.set('social_friendships', getPairId('su_a', 'su_2'), friendship('su_a', 'su_2', 'removed'))
  await expectCode(changed.handlers.publish_hand({
    handId: 'hand_1', previewHash: preview.previewHash, scope: 'selected', targetUserIds: ['su_2'],
    publicShareConfirmed: false, clientMutationId: 'relationship-changed'
  }, actor), 'INVALID_SHARE_SCOPE')
  assert.equal(changed.repository.where(COLLECTIONS.SHARES, () => true).length, 0)
})

test('fingerprint restores exact retries and conflicts on action or normalized payload changes', async () => {
  const repository = createMemorySocialRepository()
  let callbacks = 0
  const event = { clientMutationId: 'same' }
  const fpA = 'a'.repeat(64)
  const fpB = 'b'.repeat(64)
  const first = await runIdempotent(repository, 'su_a', 'publish_hand', event, async () => ({ value: ++callbacks }), { inputFingerprint: fpA })
  const restored = await runIdempotent(repository, 'su_a', 'publish_hand', event, async () => ({ value: ++callbacks }), { inputFingerprint: fpA })
  assert.deepEqual(restored, first)
  assert.equal(callbacks, 1)
  await expectCode(runIdempotent(repository, 'su_a', 'publish_hand', event, async () => ({}), { inputFingerprint: fpB }), 'MUTATION_CONFLICT')
  await expectCode(runIdempotent(repository, 'su_a', 'withdraw_hand_share', event, async () => ({}), { inputFingerprint: fpA }), 'MUTATION_CONFLICT')

  const legacyEvent = { clientMutationId: 'legacy-caller' }
  const legacyFirst = await runIdempotent(repository, 'su_a', 'legacy_action', legacyEvent, async () => ({ legacy: true }))
  const legacyRetry = await runIdempotent(repository, 'su_a', 'legacy_action', legacyEvent, async () => ({ legacy: false }))
  assert.deepEqual(legacyRetry, legacyFirst)
})

test('memory transaction store exposes point operations only', async () => {
  const repository = createMemorySocialRepository(seedWithFriends())
  await repository.runTransaction(async store => {
    assert.equal(typeof store.get, 'function')
    assert.equal(typeof store.set, 'function')
    for (const method of ['find', 'where', 'listOwnedHandActions', 'findOneAcceptedFriend', 'listNotificationOutboxesForRecipient']) {
      assert.equal(typeof store[method], 'undefined', method)
    }
  })
})

test('legacy loader double-reads hand and session and fails closed when pending appears during action query', async () => {
  const repository = createMemorySocialRepository(seedWithFriends())
  const original = repository.listOwnedHandActions.bind(repository)
  repository.listOwnedHandActions = async (...args) => {
    const rows = await original(...args)
    const hand = repository.get('hands', 'hand_1')
    repository.set('hands', 'hand_1', Object.assign({}, hand, { actionRevisionPending: 'a'.repeat(64) }))
    return rows
  }
  await expectCode(loadOwnedHandBundle(repository, { ownerOpenId: 'openid-su_a' }, 'hand_1'), 'HAND_SOURCE_UPDATING')
})

test('committed loader requires every row revision and hash includes session evidence', async () => {
  const data = seedWithFriends()
  data.hands[0].actionRevision = 'a'.repeat(64)
  data.hands[0].actionRevisionPending = ''
  data.hand_actions[0].actionRevision = 'a'.repeat(64)
  const ctx = setup(data)
  const first = await ctx.handlers.preview_hand_share({ handId: 'hand_1' }, { ownerOpenId: 'openid-su_a' })
  assert.equal(first.snapshot.actions.length, 1)
  const session = ctx.repository.get('sessions', 'session_1')
  ctx.repository.set('sessions', 'session_1', Object.assign({}, session, { updatedAt: 1 }))
  const second = await ctx.handlers.preview_hand_share({ handId: 'hand_1' }, { ownerOpenId: 'openid-su_a' })
  assert.notEqual(second.previewHash, first.previewHash)

  data.hand_actions.push(Object.assign({}, data.hand_actions[0], { _id: 'mixed', actionRevision: 'b'.repeat(64), actionType: 'fold' }))
  await expectCode(setup(data).handlers.preview_hand_share({ handId: 'hand_1' }, { ownerOpenId: 'openid-su_a' }), 'HAND_SOURCE_UPDATING')
})

test('publish transaction point-proof catches hand action and session blind races with zero writes', async () => {
  for (const mutate of [
    repository => repository.set('hands', 'hand_1', Object.assign({}, repository.get('hands', 'hand_1'), { actionRevision: 'c'.repeat(64), updatedAt: 101 })),
    repository => repository.set('sessions', 'session_1', Object.assign({}, repository.get('sessions', 'session_1'), { bigBlind: 400, updatedAt: 101 }))
  ]) {
    const data = seedWithFriends()
    data.hands[0].actionRevision = 'a'.repeat(64)
    data.hands[0].actionRevisionPending = ''
    data.hand_actions[0].actionRevision = 'a'.repeat(64)
    data.sessions[0].updatedAt = 100
    const ctx = setup(data)
    const actor = { ownerOpenId: 'openid-su_a' }
    const preview = await ctx.handlers.preview_hand_share({ handId: 'hand_1' }, actor)
    const originalTransaction = ctx.repository.runTransaction.bind(ctx.repository)
    let changed = false
    ctx.repository.runTransaction = callback => {
      if (!changed) { changed = true; mutate(ctx.repository) }
      return originalTransaction(callback)
    }
    await expectCode(ctx.handlers.publish_hand({
      handId: 'hand_1', previewHash: preview.previewHash, scope: 'friends', targetUserIds: [],
      publicShareConfirmed: false, clientMutationId: 'proof-race'
    }, actor), 'HAND_PREVIEW_STALE')
    assert.equal(ctx.repository.where(COLLECTIONS.SHARES, () => true).length, 0)
    assert.equal(ctx.repository.where('social_mutations', () => true).length, 0)
  }
})

test('active slot serializes concurrent publish, repairs stale pointers, increments generation and never reuses share ids', async () => {
  const ctx = setup(seedWithFriends())
  const actor = { ownerOpenId: 'openid-su_a' }
  const preview = await ctx.handlers.preview_hand_share({ handId: 'hand_1' }, actor)
  const event = suffix => ({
    handId: 'hand_1', previewHash: preview.previewHash, scope: 'friends', targetUserIds: [],
    publicShareConfirmed: false, clientMutationId: suffix
  })
  const results = await Promise.allSettled([
    ctx.handlers.publish_hand(event('concurrent-a'), actor),
    ctx.handlers.publish_hand(event('concurrent-b'), actor)
  ])
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1)
  assert.equal(results.filter(row => row.status === 'rejected' && row.reason.code === 'HAND_ALREADY_SHARED').length, 1)
  const first = results.find(row => row.status === 'fulfilled').value
  assert.equal(ctx.repository.where(COLLECTIONS.SHARES, row => row.status === 'active').length, 1)

  await ctx.handlers.withdraw_hand_share({ shareId: first.shareId, clientMutationId: 'withdraw-1' }, actor)
  const second = await ctx.handlers.publish_hand(event('republish'), actor)
  assert.notEqual(second.shareId, first.shareId)
  assert.equal(ctx.repository.get(COLLECTIONS.SHARES, second.shareId).generation, 2)

  await ctx.handlers.withdraw_hand_share({ shareId: second.shareId, clientMutationId: 'withdraw-2' }, actor)
  const slotId = shareSlotId('su_a', 'hand_1')
  ctx.repository.set(COLLECTIONS.SLOTS, slotId, { publisherId: 'su_a', handId: 'hand_1', shareId: 'missing', generation: 7 })
  const repaired = await ctx.handlers.publish_hand(event('repair'), actor)
  assert.equal(ctx.repository.get(COLLECTIONS.SHARES, repaired.shareId).generation, 8)
  assert.equal(ctx.repository.get(COLLECTIONS.SLOTS, slotId).shareId, repaired.shareId)
})

test('rolling limiter drops the left boundary, commits exactly 20 creates and rolls back failed transactions', async () => {
  const nowRef = { value: 3_700_000 }
  const ctx = setup(seedWithFriends(), { nowRef })
  const actor = { ownerOpenId: 'openid-su_a' }
  const rateId = rateLimitId('su_a')
  ctx.repository.set(COLLECTIONS.RATE_LIMITS, rateId, {
    publisherId: 'su_a', action: 'publish_hand', publishedAt: [100_000].concat(Array.from({ length: 19 }, (_, i) => 100_001 + i))
  })
  const result = await previewAndPublish(ctx, { clientMutationId: 'boundary-20' })
  assert.equal(result.status, 'active')
  assert.equal(ctx.repository.get(COLLECTIONS.RATE_LIMITS, rateId).publishedAt.length, 20)
  await ctx.handlers.withdraw_hand_share({ shareId: result.shareId, clientMutationId: 'rate-withdraw' }, actor)
  await expectCode(previewAndPublish(ctx, { clientMutationId: 'rate-21' }), 'RATE_LIMITED')
  assert.equal(ctx.repository.where(COLLECTIONS.SHARES, row => row.status === 'active').length, 0)
})

test('selected publish stores one outbox, bounded delivery is idempotent, and removed relationships are skipped', async () => {
  const ctx = setup(seedWithFriends(50))
  const targets = ctx.repository.where('social_users', row => row._id !== 'su_a').map(row => row._id)
  const result = await previewAndPublish(ctx, { scope: 'selected', targetUserIds: targets, clientMutationId: 'outbox-50' })
  const outboxes = ctx.repository.where(COLLECTIONS.OUTBOX, () => true)
  assert.equal(outboxes.length, 1)
  assert.equal(outboxes[0]._id, notificationOutboxId(result.shareId, targets))
  assert.equal(ctx.repository.where('social_notifications', row => row.kind === 'selected_hand').length, 10)
  assert.doesNotMatch(JSON.stringify(outboxes[0]), /ownerOpenId|privatePlayerId|handId|snapshot|openid-/)

  const firstPass = ctx.repository.get(COLLECTIONS.OUTBOX, outboxes[0]._id)
  const addressed = new Set([].concat(firstPass.deliveredTargetIds || [], firstPass.skippedTargetIds || []))
  const pendingTarget = firstPass.targetUserIds.find(target => !addressed.has(target))
  assert.ok(pendingTarget)
  ctx.repository.set('social_friendships', getPairId('su_a', pendingTarget), friendship('su_a', pendingTarget, 'removed'))
  await drainNotificationOutbox(ctx.repository, outboxes[0]._id, { notificationWriter: ctx.notificationWriter, maxTargets: 50 })
  const after = ctx.repository.get(COLLECTIONS.OUTBOX, outboxes[0]._id)
  assert.ok(after.skippedTargetIds.includes(pendingTarget))
  assert.equal(ctx.repository.where('social_notifications', row => row.recipientId === pendingTarget).length, 0)
  const before = ctx.repository.where('social_notifications', () => true).length
  await drainNotificationOutbox(ctx.repository, outboxes[0]._id, { notificationWriter: ctx.notificationWriter, maxTargets: 50 })
  assert.equal(ctx.repository.where('social_notifications', () => true).length, before)
})

test('selected outbox records bounded delivery attempts and sanitized failure diagnostics', async () => {
  const ctx = setup(seedWithFriends(12))
  const targets = ctx.repository.where('social_users', row => row._id !== 'su_a').map(row => row._id)
  const result = await previewAndPublish(ctx, {
    scope: 'selected', targetUserIds: targets, clientMutationId: 'outbox-observable'
  })
  const outboxId = notificationOutboxId(result.shareId, targets)
  const afterInitial = ctx.repository.get(COLLECTIONS.OUTBOX, outboxId)
  assert.equal(afterInitial.attemptCount, 10)
  assert.equal(afterInitial.lastErrorCode, '')

  const failure = new Error('private provider detail must not persist')
  failure.code = 'NOTIFY/NETWORK'
  await drainNotificationOutbox(ctx.repository, outboxId, {
    notificationWriter: { async write() { throw failure } }, maxTargets: 1, now: () => 1_000_123
  })
  const failed = ctx.repository.get(COLLECTIONS.OUTBOX, outboxId)
  assert.equal(failed.attemptCount, 11)
  assert.equal(failed.lastAttemptAt, 1_000_123)
  assert.equal(failed.lastErrorCode, 'NOTIFY_NETWORK')
  assert.doesNotMatch(JSON.stringify(failed), /private provider detail/)
})

test('scope update preserves immutable share fields and creates one outbox only for newly selected targets', async () => {
  const ctx = setup(seedWithFriends(3))
  const actor = { ownerOpenId: 'openid-su_a' }
  const published = await previewAndPublish(ctx, { scope: 'selected', targetUserIds: ['su_2'], clientMutationId: 'selected-first' })
  const before = JSON.parse(JSON.stringify(ctx.repository.get(COLLECTIONS.SHARES, published.shareId)))
  const updated = await ctx.handlers.update_hand_share_scope({
    shareId: published.shareId, scope: 'selected', targetUserIds: ['su_2', 'su_3'],
    publicShareConfirmed: false, clientMutationId: 'selected-add'
  }, actor)
  assert.equal(updated.scope, 'selected')
  const after = ctx.repository.get(COLLECTIONS.SHARES, published.shareId)
  assert.equal(after._id, before._id)
  assert.equal(after.createdAt, before.createdAt)
  assert.deepEqual(after.snapshot, before.snapshot)
  const addedOutbox = ctx.repository.get(COLLECTIONS.OUTBOX, notificationOutboxId(published.shareId, ['su_3']))
  assert.deepEqual(addedOutbox.targetUserIds, ['su_3'])
})

test('one visibility predicate and source point-read fail closed for withdrawn, unauthorized, and missing source', async () => {
  const accepted = friendship('su_a', 'su_2')
  const base = { publisherId: 'su_a', status: 'active', sourceDeletedAt: 0, targetUserIds: ['su_2'] }
  assert.equal(canReadShare('su_a', Object.assign({}, base, { scope: 'friends' }), null), true)
  assert.equal(canReadShare('su_x', Object.assign({}, base, { scope: 'square' }), null), true)
  assert.equal(canReadShare('su_2', Object.assign({}, base, { scope: 'friends' }), accepted), true)
  assert.equal(canReadShare('su_2', Object.assign({}, base, { scope: 'selected' }), accepted), true)
  assert.equal(canReadShare('su_3', Object.assign({}, base, { scope: 'selected' }), null), false)
  assert.equal(canReadShare('su_2', Object.assign({}, base, { scope: 'selected', status: 'withdrawn' }), accepted), false)
  assert.equal(canReadShare('su_a', Object.assign({}, base, { scope: 'unknown' }), null), false)
  assert.equal(canReadShare('su_a', Object.assign({}, base, { publisherId: '', scope: 'friends' }), null), false)

  const ctx = setup(seedWithFriends())
  const result = await previewAndPublish(ctx, { clientMutationId: 'readable' })
  const readable = await requireReadableShare(ctx.repository, 'su_a', result.shareId)
  assert.equal(readable._id, result.shareId)
  ctx.repository.set('hands', 'hand_1', null)
  await expectCode(requireReadableShare(ctx.repository, 'su_a', result.shareId), 'CONTENT_UNAVAILABLE')

  const sessionCtx = setup(seedWithFriends())
  const sessionResult = await previewAndPublish(sessionCtx, { clientMutationId: 'readable-session' })
  sessionCtx.repository.set('sessions', 'session_1', null)
  await expectCode(requireReadableShare(sessionCtx.repository, 'su_a', sessionResult.shareId), 'CONTENT_UNAVAILABLE')
})

test('public mutation responses recursively exclude private source, OpenID, player and raw chip fields', async () => {
  const ctx = setup(seedWithFriends())
  const preview = await ctx.handlers.preview_hand_share({ handId: 'hand_1' }, { ownerOpenId: 'openid-su_a' })
  const published = await previewAndPublish(ctx, { clientMutationId: 'safe-response' })
  const forbidden = new Set(['ownerOpenId', '_openid', 'privatePlayerId', 'playerId', 'sessionId', 'sourceHandId', 'profit', 'effectiveStack', 'potSize', 'allInPot'])
  function scan(value, path = '$') {
    if (typeof value === 'string') {
      assert.equal(value.includes('openid-'), false, path)
      assert.equal(value.includes('CANARY'), false, path)
      return
    }
    if (Array.isArray(value)) return value.forEach((item, index) => scan(item, `${path}[${index}]`))
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbidden.has(key), false, `${path}.${key}`)
      scan(child, `${path}.${key}`)
    }
  }
  scan({ preview, published })
})

test('repository constants and deployment indexes declare exact point/query shapes', () => {
  const { SOCIAL_COLLECTIONS, ACCOUNT_CLEAR_SOCIAL_COLLECTIONS } = require('../cloudfunctions/poker_social/lib/repository')
  assert.equal(SOCIAL_COLLECTIONS.SOCIAL_HAND_SHARES, COLLECTIONS.SHARES)
  assert.equal(SOCIAL_COLLECTIONS.SOCIAL_HAND_SHARE_SLOTS, COLLECTIONS.SLOTS)
  assert.equal(SOCIAL_COLLECTIONS.SOCIAL_RATE_LIMITS, COLLECTIONS.RATE_LIMITS)
  assert.equal(SOCIAL_COLLECTIONS.SOCIAL_NOTIFICATION_OUTBOX, COLLECTIONS.OUTBOX)
  for (const collection of [COLLECTIONS.SHARES, COLLECTIONS.SLOTS, COLLECTIONS.RATE_LIMITS, COLLECTIONS.OUTBOX]) {
    assert.equal(ACCOUNT_CLEAR_SOCIAL_COLLECTIONS.includes(collection), true, collection)
  }
  const indexes = require('node:fs').readFileSync(require('node:path').join(__dirname, '../cloudfunctions/poker_social/database-indexes.md'), 'utf8')
  assert.match(indexes, /social_hand_shares.*status ASC.*scope ASC.*createdAt DESC.*_id DESC/i)
  assert.match(indexes, /social_hand_shares.*publisherId ASC.*status ASC.*createdAt DESC.*_id DESC/i)
  assert.match(indexes, /social_hand_shares.*targetUserIds ARRAY.*status ASC.*createdAt DESC.*_id DESC/i)
  assert.match(indexes, /social_hand_share_slots.*point-read/i)
  assert.match(indexes, /social_rate_limits.*point-read/i)
  assert.match(indexes, /social_notification_outbox.*status ASC.*targetUserIds ARRAY.*createdAt ASC.*_id ASC/i)
})

test('production action count fails closed before CloudBase can clamp a page to 100 rows', async () => {
  const { createCloudSocialRepository } = require('../cloudfunctions/poker_social/lib/repository')
  let queriedRows = false
  const chain = {
    where() { return this },
    count: async () => ({ total: 101 }),
    orderBy() { return this },
    limit() { return this },
    async get() { queriedRows = true; return { data: Array(100).fill({}) } }
  }
  const repository = createCloudSocialRepository({ collection: () => chain })
  await expectCode(repository.listOwnedHandActions('owner', 'PLAYER', 'hand'), 'HAND_ACTIONS_LIMIT_EXCEEDED')
  assert.equal(queriedRows, false)
})

test('public app preserves fixed Task 2 codes and routes hand-share handlers', async () => {
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const repository = createMemorySocialRepository(seedWithFriends())
  const app = createSocialApp({
    repository,
    identity: { resolve: async openId => ({ ownerOpenId: openId }) },
    handShare: { now: () => 1_000_000, randomShareId: () => 'share_route' },
    requestId: () => 'share-request'
  })
  const preview = await app.handle({ action: 'preview_hand_share', handId: 'hand_1' }, { openId: 'openid-su_a' })
  assert.equal(preview.code, 0)
  const invalid = await app.handle({
    action: 'publish_hand', handId: 'hand_1', previewHash: preview.data.previewHash,
    scope: 'square', targetUserIds: [], publicShareConfirmed: false, clientMutationId: 'route-invalid'
  }, { openId: 'openid-su_a' })
  assert.deepEqual(invalid, {
    code: 'INVALID_SHARE_SCOPE', data: null, message: 'invalid share scope', requestId: 'share-request'
  })

  const codes = ['HAND_PREVIEW_STALE', 'HAND_ALREADY_SHARED', 'RATE_LIMITED', 'CONTENT_UNAVAILABLE']
  for (const code of codes) {
    const error = new Error('private hand/source details')
    error.code = code
    const isolated = createSocialApp({
      identity: { resolve: async () => ({ ownerOpenId: 'private' }) },
      handlers: { fail: async () => { throw error } }, requestId: () => 'typed'
    })
    const result = await isolated.handle({ action: 'fail' }, {})
    assert.equal(result.code, code)
    assert.equal(result.data, null)
    assert.equal(result.message.includes('private'), false)
  }
})

test('client service exposes exact preview/write payloads and never forwards snapshots or private BB/player fields', async () => {
  const apiPath = require.resolve('../services/social-api')
  const servicePath = require.resolve('../services/social-service')
  const originalApi = require.cache[apiPath]
  const calls = []
  require.cache[apiPath] = { exports: { callSocialFunction: async (action, payload) => { calls.push({ action, payload }); return {} } } }
  delete require.cache[servicePath]
  try {
    const service = require('../services/social-service')
    await service.previewHandShare({ handId: 'hand_1', snapshot: { secret: true }, playerId: 'PRIVATE' })
    await service.publishHand({
      handId: 'hand_1', previewHash: 'hash', scope: 'selected', targetUserIds: ['su_b'],
      publicShareConfirmed: false, clientMutationId: 'publish', snapshot: { secret: true }, bigBlind: 400
    })
    await service.updateHandShareScope({
      shareId: 'share_1', scope: 'friends', targetUserIds: [], publicShareConfirmed: false,
      clientMutationId: 'update', handId: 'must-not-forward'
    })
    await service.withdrawHandShare({ shareId: 'share_1', clientMutationId: 'withdraw', snapshot: {} })
    await service.withdrawSharesBySourceHand({ handId: 'hand_1', clientMutationId: 'source', playerId: 'PRIVATE' })
    assert.deepEqual(calls, [
      { action: 'preview_hand_share', payload: { handId: 'hand_1' } },
      { action: 'publish_hand', payload: { handId: 'hand_1', previewHash: 'hash', scope: 'selected', targetUserIds: ['su_b'], publicShareConfirmed: false, clientMutationId: 'publish' } },
      { action: 'update_hand_share_scope', payload: { shareId: 'share_1', scope: 'friends', targetUserIds: [], publicShareConfirmed: false, clientMutationId: 'update' } },
      { action: 'withdraw_hand_share', payload: { shareId: 'share_1', clientMutationId: 'withdraw' } },
      { action: 'withdraw_shares_by_source_hand', payload: { handId: 'hand_1', clientMutationId: 'source' } }
    ])
  } finally {
    delete require.cache[servicePath]
    if (originalApi) require.cache[apiPath] = originalApi
    else delete require.cache[apiPath]
  }
})
