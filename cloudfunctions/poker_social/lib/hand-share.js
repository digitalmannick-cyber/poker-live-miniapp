const crypto = require('crypto')
const { buildHandSnapshot, resolveBigBlind } = require('./hand-snapshot')
const { socialError } = require('./social-error')
const { getPairId } = require('./friendship')
const { runIdempotent, restoreIdempotent } = require('./idempotency')
const { canReadShare, hasAcceptedPair } = require('./visibility')

const COLLECTIONS = Object.freeze({
  USERS: 'social_users',
  FRIENDSHIPS: 'social_friendships',
  SHARES: 'social_hand_shares',
  SLOTS: 'social_hand_share_slots',
  RATE_LIMITS: 'social_rate_limits',
  OUTBOX: 'social_notification_outbox',
  HANDS: 'hands',
  SESSIONS: 'sessions',
  ACTIONS: 'hand_actions'
})
const SHARE_SCOPES = Object.freeze(['square', 'friends', 'selected'])
const MAX_SELECTED_TARGETS = 50
const MAX_PUBLISHES_PER_HOUR = 20
const PUBLISH_WINDOW_MS = 3_600_000
const DEFAULT_DELIVERY_TARGETS = 10
const DEFAULT_COMPENSATION_OUTBOXES = 5

function stableSerialize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw socialError('INVALID_HAND_SNAPSHOT', 'invalid hand snapshot')
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') throw socialError('INVALID_HAND_SNAPSHOT', 'invalid hand snapshot')
  if (Array.isArray(value)) return '[' + value.map(stableSerialize).join(',') + ']'
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableSerialize(value[key])).join(',') + '}'
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function tupleId(prefix, values) {
  return prefix + '_' + sha256(JSON.stringify(values))
}

function shareSlotId(publisherId, handId) {
  return tupleId('shs', [publisherId, handId])
}

function rateLimitId(publisherId) {
  return tupleId('rl', [publisherId, 'publish_hand'])
}

function notificationOutboxId(shareId, targetUserIds) {
  return tupleId('no', ['selected_hand', shareId, sortedUniqueTargets(targetUserIds)])
}

function mutationFingerprint(input) {
  return sha256(stableSerialize(input || {}))
}

function normalizeId(value) {
  return String(value || '').trim()
}

function sortedUniqueTargets(values) {
  if (!Array.isArray(values)) return []
  return Array.from(new Set(values.map(normalizeId).filter(Boolean))).sort()
}

function ownerMatches(row, ownerOpenId, privatePlayerId) {
  return !!row && normalizeId(row.ownerOpenId || row._openid) === normalizeId(ownerOpenId) &&
    normalizeId(row.privatePlayerId || row.playerId).toUpperCase() === normalizeId(privatePlayerId).toUpperCase()
}

async function resolveSocialUser(store, actor) {
  const ownerOpenId = normalizeId(actor && actor.ownerOpenId)
  if (!ownerOpenId || !store || typeof store.findSocialUserByOpenId !== 'function') throw socialError('SOCIAL_PROFILE_REQUIRED', 'social profile required')
  const user = await store.findSocialUserByOpenId(ownerOpenId)
  if (!user || !normalizeId(user._id) || !normalizeId(user.privatePlayerId)) {
    throw socialError('SOCIAL_PROFILE_REQUIRED', 'social profile required')
  }
  return user
}

async function loadOwnedHandBundle(store, actorOrUser, handIdValue) {
  const handId = normalizeId(handIdValue)
  const socialUser = actorOrUser && actorOrUser._id && actorOrUser.privatePlayerId
    ? actorOrUser
    : await resolveSocialUser(store, actorOrUser)
  const ownerOpenId = normalizeId(socialUser.ownerOpenId || actorOrUser && actorOrUser.ownerOpenId)
  const privatePlayerId = normalizeId(socialUser.privatePlayerId)
  if (!handId || typeof store.get !== 'function' || typeof store.listOwnedHandActions !== 'function') {
    throw socialError('FORBIDDEN', 'not allowed')
  }
  const hand = await store.get(COLLECTIONS.HANDS, handId)
  if (!ownerMatches(hand, ownerOpenId, privatePlayerId)) throw socialError('FORBIDDEN', 'not allowed')
  if (normalizeId(hand.actionRevisionPending)) throw socialError('HAND_SOURCE_UPDATING', 'hand source updating')
  const sessionId = normalizeId(hand.sessionId)
  const session = sessionId && await store.get(COLLECTIONS.SESSIONS, sessionId)
  if (!session || !ownerMatches(session, ownerOpenId, privatePlayerId)) throw socialError('FORBIDDEN', 'not allowed')
  const committedRevision = normalizeId(hand.actionRevision)
  const actions = await store.listOwnedHandActions(ownerOpenId, privatePlayerId, handId)
  if (!Array.isArray(actions) || actions.some(row => !ownerMatches(row, ownerOpenId, privatePlayerId) || normalizeId(row.handId) !== handId)) {
    throw socialError('FORBIDDEN', 'not allowed')
  }
  const handAfter = await store.get(COLLECTIONS.HANDS, handId)
  const sessionAfter = await store.get(COLLECTIONS.SESSIONS, sessionId)
  if (!sameHandEvidence(hand, handAfter) || !sameSessionEvidence(hand, session, handAfter, sessionAfter)) {
    throw socialError('HAND_SOURCE_UPDATING', 'hand source updating')
  }
  const orderedActions = actions.slice().sort((left, right) => Number(left.sequence) - Number(right.sequence) || normalizeId(left._id).localeCompare(normalizeId(right._id)))
  const revisionMismatch = committedRevision
    ? orderedActions.some(action => normalizeId(action.actionRevision) !== committedRevision)
    : orderedActions.some(action => normalizeId(action.actionRevision))
  if (revisionMismatch) throw socialError('HAND_SOURCE_UPDATING', 'hand source updating')
  return { socialUser, ownerOpenId, privatePlayerId, hand: handAfter, session: sessionAfter, actions: orderedActions }
}

function sameHandEvidence(left, right) {
  return !!left && !!right && !normalizeId(right.actionRevisionPending) &&
    normalizeId(left._id) === normalizeId(right._id) &&
    normalizeId(left.ownerOpenId || left._openid) === normalizeId(right.ownerOpenId || right._openid) &&
    normalizeId(left.privatePlayerId || left.playerId).toUpperCase() === normalizeId(right.privatePlayerId || right.playerId).toUpperCase() &&
    normalizeId(left.sessionId) === normalizeId(right.sessionId) &&
    (Number(left.updatedAt) || 0) === (Number(right.updatedAt) || 0) &&
    normalizeId(left.actionRevision) === normalizeId(right.actionRevision) &&
    Math.max(0, Math.floor(Number(left.handVersion) || 0)) === Math.max(0, Math.floor(Number(right.handVersion) || 0))
}

function sameSessionEvidence(handLeft, left, handRight, right) {
  if (!left || !right || !sameHandSourceTuple(handLeft, handRight)) return false
  try {
    return normalizeId(left._id) === normalizeId(right._id) &&
      normalizeId(left.ownerOpenId || left._openid) === normalizeId(right.ownerOpenId || right._openid) &&
      normalizeId(left.privatePlayerId || left.playerId).toUpperCase() === normalizeId(right.privatePlayerId || right.playerId).toUpperCase() &&
      (Number(left.updatedAt) || 0) === (Number(right.updatedAt) || 0) &&
      resolveBigBlind(handLeft, left) === resolveBigBlind(handRight, right)
  } catch (error) {
    return false
  }
}

function sameHandSourceTuple(left, right) {
  return !!left && !!right && normalizeId(left._id) === normalizeId(right._id) && normalizeId(left.sessionId) === normalizeId(right.sessionId)
}

function previewHashForBundle(bundle, snapshotValue) {
  const snapshot = snapshotValue || buildHandSnapshot({ hand: bundle.hand, actions: bundle.actions, session: bundle.session })
  return mutationFingerprint({
    version: 1,
    handId: normalizeId(bundle.hand && bundle.hand._id),
    sessionId: normalizeId(bundle.session && bundle.session._id),
    sessionUpdatedAt: Number(bundle.session && bundle.session.updatedAt) || 0,
    bigBlind: resolveBigBlind(bundle.hand, bundle.session),
    handUpdatedAt: Number(bundle.hand && bundle.hand.updatedAt) || 0,
    handVersion: Math.max(0, Math.floor(Number(bundle.hand && bundle.hand.handVersion) || 0)),
    committedActionRevision: normalizeId(bundle.hand && bundle.hand.actionRevision),
    rowActionRevision: (bundle.actions || []).map(action => [normalizeId(action._id), Number(action.sequence), Number(action.updatedAt) || 0, normalizeId(action.actionRevision)]),
    snapshot
  })
}

function normalizeScope(event, publisherId) {
  const scope = normalizeId(event && event.scope)
  const rawTargets = event && event.targetUserIds
  if (!SHARE_SCOPES.includes(scope) || !Array.isArray(rawTargets)) throw socialError('INVALID_SHARE_SCOPE', 'invalid share scope')
  if (rawTargets.some(value => typeof value !== 'string' || !normalizeId(value))) throw socialError('INVALID_SHARE_SCOPE', 'invalid share scope')
  const targetUserIds = sortedUniqueTargets(rawTargets)
  if (scope !== 'selected') {
    if (targetUserIds.length !== 0) throw socialError('INVALID_SHARE_SCOPE', 'invalid share scope')
  } else if (targetUserIds.length < 1 || targetUserIds.length > MAX_SELECTED_TARGETS || targetUserIds.includes(normalizeId(publisherId))) {
    throw socialError('INVALID_SHARE_SCOPE', 'invalid share scope')
  }
  const publicShareConfirmed = scope === 'square' && event && event.publicShareConfirmed === true
  if (scope === 'square' && !publicShareConfirmed) throw socialError('INVALID_SHARE_SCOPE', 'invalid share scope')
  return { scope, targetUserIds, publicShareConfirmed }
}

async function validateScopeInsideTransaction(store, publisherId, normalized, friendWitnessId) {
  if (normalized.scope === 'friends') {
    const witness = friendWitnessId && await store.get(COLLECTIONS.FRIENDSHIPS, friendWitnessId)
    const otherId = witness && (witness.userA === publisherId ? witness.userB : witness.userA)
    if (!otherId || !hasAcceptedPair(witness, publisherId, otherId)) {
      throw socialError('INVALID_SHARE_SCOPE', 'invalid share scope')
    }
  }
  if (normalized.scope === 'selected') {
    for (const targetUserId of normalized.targetUserIds) {
      let pairId
      try {
        pairId = getPairId(publisherId, targetUserId)
      } catch (error) {
        throw socialError('INVALID_SHARE_SCOPE', 'invalid share scope')
      }
      const friendship = await store.get(COLLECTIONS.FRIENDSHIPS, pairId)
      if (!hasAcceptedPair(friendship, publisherId, targetUserId)) throw socialError('INVALID_SHARE_SCOPE', 'invalid share scope')
    }
  }
}

function publisherSnapshot(user) {
  return {
    socialUserId: normalizeId(user && user._id),
    nickname: normalizeId(user && (user.nickname || user.profile && user.profile.nickname)).slice(0, 24),
    avatarFileId: normalizeId(user && (user.avatarFileId || user.profile && user.profile.avatarFileId)),
    avatarText: normalizeId(user && (user.avatarText || user.profile && user.profile.avatarText)).slice(0, 2)
  }
}

async function createOutbox(store, share, targets, user, nowMs) {
  const targetUserIds = sortedUniqueTargets(targets)
  if (!targetUserIds.length) return null
  const id = notificationOutboxId(share._id, targetUserIds)
  const existing = await store.get(COLLECTIONS.OUTBOX, id)
  if (existing) return existing
  const row = {
    _id: id,
    publisherId: share.publisherId,
    shareId: share._id,
    publisherSnapshot: publisherSnapshot(user),
    targetUserIds,
    deliveredTargetIds: [],
    skippedTargetIds: [],
    status: 'pending',
    attemptCount: 0,
    lastAttemptAt: 0,
    lastErrorCode: '',
    createdAt: nowMs,
    updatedAt: nowMs
  }
  await store.set(COLLECTIONS.OUTBOX, id, row)
  return row
}

function addressedTargets(row) {
  return new Set(sortedUniqueTargets([].concat(row && row.deliveredTargetIds || [], row && row.skippedTargetIds || [])))
}

async function deliverOutboxTarget(repository, outboxId, targetUserId, options) {
  const writer = options && options.notificationWriter
  if (!writer || typeof writer.write !== 'function') return false
  return repository.runTransaction(async store => {
    const outbox = await store.get(COLLECTIONS.OUTBOX, outboxId)
    if (!outbox || outbox.status !== 'pending' || !Array.isArray(outbox.targetUserIds) || !outbox.targetUserIds.includes(targetUserId)) return false
    const addressed = addressedTargets(outbox)
    if (addressed.has(targetUserId)) return false
    const share = await store.get(COLLECTIONS.SHARES, outbox.shareId)
    let valid = !!(share && share.status === 'active' && share.scope === 'selected' &&
      Array.isArray(share.targetUserIds) && share.targetUserIds.includes(targetUserId) && share.publisherId !== targetUserId)
    if (valid) {
      const friendship = await store.get(COLLECTIONS.FRIENDSHIPS, getPairId(share.publisherId, targetUserId))
      valid = hasAcceptedPair(friendship, share.publisherId, targetUserId)
    }
    const deliveredTargetIds = sortedUniqueTargets(outbox.deliveredTargetIds)
    const skippedTargetIds = sortedUniqueTargets(outbox.skippedTargetIds)
    if (valid) {
      await writer.write(store, {
        recipientId: targetUserId,
        kind: 'selected_hand',
        actor: outbox.publisherSnapshot,
        targetType: 'hand_share',
        targetId: outbox.shareId,
        sourceEventId: `selected_hand:${outbox.shareId}:${targetUserId}`,
        at: Number(outbox.createdAt) || Date.now()
      })
      deliveredTargetIds.push(targetUserId)
    } else {
      skippedTargetIds.push(targetUserId)
    }
    const done = new Set(deliveredTargetIds.concat(skippedTargetIds)).size >= outbox.targetUserIds.length
    await store.set(COLLECTIONS.OUTBOX, outbox._id, Object.assign({}, outbox, {
      deliveredTargetIds: sortedUniqueTargets(deliveredTargetIds),
      skippedTargetIds: sortedUniqueTargets(skippedTargetIds),
      status: done ? 'delivered' : 'pending',
      attemptCount: Math.max(0, Math.floor(Number(outbox.attemptCount) || 0)) + 1,
      lastAttemptAt: Number(options && options.now && options.now()) || Date.now(),
      lastErrorCode: '',
      updatedAt: Number(options && options.now && options.now()) || Date.now()
    }))
    return true
  })
}

async function recordOutboxFailure(repository, outboxId, error, options) {
  return repository.runTransaction(async store => {
    const outbox = await store.get(COLLECTIONS.OUTBOX, outboxId)
    if (!outbox || outbox.status !== 'pending') return false
    const at = Number(options && options.now && options.now()) || Date.now()
    const code = String(error && (error.code || error.errCode) || 'DELIVERY_FAILED').replace(/[^0-9A-Z_-]/gi, '_').slice(0, 64)
    await store.set(COLLECTIONS.OUTBOX, outboxId, Object.assign({}, outbox, {
      attemptCount: Math.max(0, Math.floor(Number(outbox.attemptCount) || 0)) + 1,
      lastAttemptAt: at,
      lastErrorCode: code || 'DELIVERY_FAILED',
      updatedAt: at
    }))
    return true
  })
}

async function drainNotificationOutbox(repository, outboxId, options) {
  const config = options || {}
  const maximum = Math.min(50, Math.max(0, Number(config.maxTargets) || DEFAULT_DELIVERY_TARGETS))
  const row = await repository.get(COLLECTIONS.OUTBOX, outboxId)
  if (!row || row.status !== 'pending') return { processed: 0 }
  const addressed = addressedTargets(row)
  let targets = sortedUniqueTargets(row.targetUserIds).filter(target => !addressed.has(target))
  const preferred = normalizeId(config.preferredTargetId)
  if (preferred && targets.includes(preferred)) targets = [preferred].concat(targets.filter(target => target !== preferred))
  let processed = 0
  for (const targetUserId of targets.slice(0, maximum)) {
    try {
      if (await deliverOutboxTarget(repository, outboxId, targetUserId, config)) processed += 1
    } catch (error) {
      try {
        await recordOutboxFailure(repository, outboxId, error, config)
      } catch (recordError) {}
      break
    }
  }
  return { processed }
}

async function compensateRecipientOutboxes(repository, recipientId, options) {
  const config = options || {}
  if (typeof repository.listNotificationOutboxesForRecipient !== 'function') return { processed: 0 }
  const maxOutboxes = Math.min(5, Math.max(0, Number(config.maxOutboxes) || DEFAULT_COMPENSATION_OUTBOXES))
  const maxTargets = Math.min(10, Math.max(0, Number(config.maxTargets) || DEFAULT_DELIVERY_TARGETS))
  const rows = await repository.listNotificationOutboxesForRecipient(recipientId, maxOutboxes)
  let processed = 0
  for (const row of rows.slice(0, maxOutboxes)) {
    const result = await drainNotificationOutbox(repository, row._id, Object.assign({}, config, { maxTargets, preferredTargetId: recipientId }))
    processed += result.processed
  }
  return { processed }
}

async function requireReadableShare(repository, viewerId, shareIdValue) {
  const shareId = normalizeId(shareIdValue)
  const share = shareId && await repository.get(COLLECTIONS.SHARES, shareId)
  if (!share || !share.source || !normalizeId(share.source.handId)) throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
  const sourceHand = await repository.get(COLLECTIONS.HANDS, share.source.handId)
  const sourceSession = await repository.get(COLLECTIONS.SESSIONS, share.source.sessionId)
  if (!ownerMatches(sourceHand, share.source.ownerOpenId, share.source.privatePlayerId) ||
    !ownerMatches(sourceSession, share.source.ownerOpenId, share.source.privatePlayerId) ||
    normalizeId(sourceHand.sessionId) !== normalizeId(share.source.sessionId)) {
    throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
  }
  let friendship = null
  if (viewerId !== share.publisherId && share.scope !== 'square') {
    try {
      friendship = await repository.get(COLLECTIONS.FRIENDSHIPS, getPairId(viewerId, share.publisherId))
    } catch (error) {
      friendship = null
    }
  }
  if (!canReadShare(viewerId, share, friendship)) throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
  return share
}

function publishFingerprint(event, normalized) {
  return mutationFingerprint({
    action: 'publish_hand', handId: normalizeId(event && event.handId), shareId: '',
    previewHash: normalizeId(event && event.previewHash), scope: normalized.scope,
    targetUserIds: normalized.targetUserIds,
    publicShareConfirmed: normalized.scope === 'square' && normalized.publicShareConfirmed
  })
}

function shareMutationFingerprint(action, event, normalized) {
  return mutationFingerprint({
    action, handId: normalizeId(event && event.handId), shareId: normalizeId(event && event.shareId),
    previewHash: '', scope: normalized && normalized.scope || '',
    targetUserIds: normalized && normalized.targetUserIds || [],
    publicShareConfirmed: !!(normalized && normalized.scope === 'square' && normalized.publicShareConfirmed)
  })
}

function createHandShareHandlers(repository, options) {
  const config = options || {}
  const now = typeof config.now === 'function' ? config.now : () => Date.now()
  const randomShareId = typeof config.randomShareId === 'function'
    ? config.randomShareId
    : () => 'sh_' + crypto.randomBytes(18).toString('hex')
  const notificationWriter = config.notificationWriter

  async function currentUser(actor) {
    return resolveSocialUser(repository, actor)
  }

  async function friendWitnessFor(normalized, publisherId) {
    if (normalized.scope !== 'friends') return null
    if (typeof repository.findOneAcceptedFriend !== 'function') throw socialError('INVALID_SHARE_SCOPE', 'invalid share scope')
    const witness = await repository.findOneAcceptedFriend(publisherId)
    return witness && normalizeId(witness._id)
  }

  async function verifyCandidate(store, bundle) {
    const hand = await store.get(COLLECTIONS.HANDS, bundle.hand._id)
    const session = await store.get(COLLECTIONS.SESSIONS, bundle.session._id)
    if (!ownerMatches(hand, bundle.ownerOpenId, bundle.privatePlayerId) || !ownerMatches(session, bundle.ownerOpenId, bundle.privatePlayerId) ||
      !sameHandEvidence(bundle.hand, hand) || !sameSessionEvidence(bundle.hand, bundle.session, hand, session)) {
      throw socialError('HAND_PREVIEW_STALE', 'hand preview stale')
    }
  }

  async function drainResult(result) {
    for (const outboxId of sortedUniqueTargets(result && result.outboxIds)) {
      await drainNotificationOutbox(repository, outboxId, { notificationWriter, maxTargets: DEFAULT_DELIVERY_TARGETS, now })
    }
    return result.publicResult
  }

  return {
    async preview_hand_share(event, actor) {
      const bundle = await loadOwnedHandBundle(repository, actor, event && event.handId)
      const snapshot = buildHandSnapshot({ hand: bundle.hand, actions: bundle.actions, session: bundle.session })
      const defaultShareScope = SHARE_SCOPES.includes(bundle.socialUser.defaultShareScope) ? bundle.socialUser.defaultShareScope : 'friends'
      return { previewHash: previewHashForBundle(bundle, snapshot), snapshot, defaultShareScope }
    },

    async publish_hand(event, actor) {
      const user = await currentUser(actor)
      const normalized = normalizeScope(event, user._id)
      const fingerprint = publishFingerprint(event, normalized)
      const restored = await restoreIdempotent(repository, user._id, 'publish_hand', event, { inputFingerprint: fingerprint })
      if (restored.found) return drainResult(restored.result)
      const bundle = await loadOwnedHandBundle(repository, user, event && event.handId)
      const snapshot = buildHandSnapshot({ hand: bundle.hand, actions: bundle.actions, session: bundle.session })
      const serverHash = previewHashForBundle(bundle, snapshot)
      if (!normalizeId(event && event.previewHash) || normalizeId(event.previewHash) !== serverHash) {
        throw socialError('HAND_PREVIEW_STALE', 'hand preview stale')
      }
      const friendWitnessId = await friendWitnessFor(normalized, user._id)
      const result = await runIdempotent(repository, user._id, 'publish_hand', event, async store => {
        const transactionalUser = await store.get(COLLECTIONS.USERS, user._id)
        if (!transactionalUser || normalizeId(transactionalUser.ownerOpenId) !== normalizeId(actor.ownerOpenId) || !normalizeId(transactionalUser.privatePlayerId)) {
          throw socialError('FORBIDDEN', 'not allowed')
        }
        if (normalizeId(transactionalUser.privatePlayerId).toUpperCase() !== normalizeId(bundle.privatePlayerId).toUpperCase()) {
          throw socialError('FORBIDDEN', 'not allowed')
        }
        await verifyCandidate(store, bundle)
        await validateScopeInsideTransaction(store, user._id, normalized, friendWitnessId)
        const handId = normalizeId(bundle.hand._id)
        const slotId = shareSlotId(user._id, handId)
        const oldSlot = await store.get(COLLECTIONS.SLOTS, slotId)
        const pointedShare = oldSlot && oldSlot.shareId ? await store.get(COLLECTIONS.SHARES, oldSlot.shareId) : null
        if (pointedShare && pointedShare.status === 'active' && pointedShare.publisherId === user._id &&
          pointedShare.source && normalizeId(pointedShare.source.handId) === handId &&
          normalizeId(pointedShare.source.ownerOpenId) === normalizeId(bundle.ownerOpenId) &&
          normalizeId(pointedShare.source.privatePlayerId).toUpperCase() === normalizeId(bundle.privatePlayerId).toUpperCase() &&
          normalizeId(pointedShare.source.sessionId) === normalizeId(bundle.session && bundle.session._id)) {
          throw socialError('HAND_ALREADY_SHARED', 'hand already shared')
        }
        const at = Number(now()) || Date.now()
        const rateId = rateLimitId(user._id)
        const rate = await store.get(COLLECTIONS.RATE_LIMITS, rateId)
        const floor = at - PUBLISH_WINDOW_MS
        const publishedAt = (Array.isArray(rate && rate.publishedAt) ? rate.publishedAt : [])
          .map(Number).filter(value => Number.isFinite(value) && value > floor && value <= at).sort((a, b) => a - b)
        if (publishedAt.length >= MAX_PUBLISHES_PER_HOUR) throw socialError('RATE_LIMITED', 'rate limited')
        let shareId = ''
        for (let attempt = 0; attempt < 3 && !shareId; attempt += 1) {
          const candidate = normalizeId(randomShareId())
          if (candidate && !await store.get(COLLECTIONS.SHARES, candidate)) shareId = candidate
        }
        if (!shareId) throw socialError('SOCIAL_ERROR', 'share id unavailable')
        const generation = Math.max(0, Math.floor(Number(oldSlot && oldSlot.generation) || 0)) + 1
        const share = {
          _id: shareId,
          publisherId: user._id,
          source: {
            ownerOpenId: bundle.ownerOpenId,
            privatePlayerId: bundle.privatePlayerId,
            handId,
            sessionId: normalizeId(bundle.session._id)
          },
          snapshot,
          status: 'active',
          scope: normalized.scope,
          targetUserIds: normalized.targetUserIds,
          generation,
          likeCount: 0,
          commentCount: 0,
          sourceDeletedAt: 0,
          createdAt: at,
          updatedAt: at
        }
        await store.set(COLLECTIONS.SHARES, shareId, share)
        await store.set(COLLECTIONS.SLOTS, slotId, {
          publisherId: user._id, handId, shareId, generation, updatedAt: at
        })
        await store.set(COLLECTIONS.RATE_LIMITS, rateId, {
          publisherId: user._id, action: 'publish_hand', publishedAt: publishedAt.concat(at).slice(-MAX_PUBLISHES_PER_HOUR), updatedAt: at
        })
        const outbox = normalized.scope === 'selected'
          ? await createOutbox(store, share, normalized.targetUserIds, transactionalUser, at)
          : null
        return {
          publicResult: { shareId, status: 'active', scope: normalized.scope },
          outboxIds: outbox ? [outbox._id] : []
        }
      }, { inputFingerprint: fingerprint })
      return drainResult(result)
    },

    async update_hand_share_scope(event, actor) {
      const user = await currentUser(actor)
      const normalized = normalizeScope(event, user._id)
      const fingerprint = shareMutationFingerprint('update_hand_share_scope', event, normalized)
      const restored = await restoreIdempotent(repository, user._id, 'update_hand_share_scope', event, { inputFingerprint: fingerprint })
      if (restored.found) return drainResult(restored.result)
      const friendWitnessId = await friendWitnessFor(normalized, user._id)
      const result = await runIdempotent(repository, user._id, 'update_hand_share_scope', event, async store => {
        const shareId = normalizeId(event && event.shareId)
        const share = shareId && await store.get(COLLECTIONS.SHARES, shareId)
        if (!share || share.publisherId !== user._id || share.status !== 'active') throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
        const transactionalUser = await store.get(COLLECTIONS.USERS, user._id)
        if (!transactionalUser || normalizeId(transactionalUser._id) !== normalizeId(user._id) ||
          normalizeId(transactionalUser.ownerOpenId) !== normalizeId(actor && actor.ownerOpenId) ||
          !share.source || normalizeId(transactionalUser.privatePlayerId).toUpperCase() !== normalizeId(share.source.privatePlayerId).toUpperCase()) {
          throw socialError('FORBIDDEN', 'not allowed')
        }
        const sourceHand = share.source && await store.get(COLLECTIONS.HANDS, share.source.handId)
        const sourceSession = share.source && await store.get(COLLECTIONS.SESSIONS, share.source.sessionId)
        if (!share.source || !ownerMatches(sourceHand, share.source.ownerOpenId, share.source.privatePlayerId) ||
          !ownerMatches(sourceSession, share.source.ownerOpenId, share.source.privatePlayerId) ||
          normalizeId(sourceHand && sourceHand.sessionId) !== normalizeId(share.source.sessionId)) {
          throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
        }
        await validateScopeInsideTransaction(store, user._id, normalized, friendWitnessId)
        const previousTargets = share.scope === 'selected' ? sortedUniqueTargets(share.targetUserIds) : []
        const newTargets = normalized.scope === 'selected'
          ? normalized.targetUserIds.filter(target => !previousTargets.includes(target))
          : []
        const at = Number(now()) || Date.now()
        const updated = Object.assign({}, share, {
          scope: normalized.scope,
          targetUserIds: normalized.targetUserIds,
          updatedAt: at
        })
        await store.set(COLLECTIONS.SHARES, shareId, updated)
        const outbox = await createOutbox(store, updated, newTargets, transactionalUser, at)
        return { publicResult: { shareId, status: 'active', scope: normalized.scope }, outboxIds: outbox ? [outbox._id] : [] }
      }, { inputFingerprint: fingerprint })
      return drainResult(result)
    },

    async withdraw_hand_share(event, actor) {
      const user = await currentUser(actor)
      const fingerprint = shareMutationFingerprint('withdraw_hand_share', event)
      const result = await runIdempotent(repository, user._id, 'withdraw_hand_share', event, async store => {
        const shareId = normalizeId(event && event.shareId)
        const share = shareId && await store.get(COLLECTIONS.SHARES, shareId)
        if (!share || share.publisherId !== user._id) throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
        if (share.status !== 'withdrawn') {
          const at = Number(now()) || Date.now()
          await store.set(COLLECTIONS.SHARES, shareId, Object.assign({}, share, { status: 'withdrawn', withdrawnAt: at, updatedAt: at }))
          const slotId = shareSlotId(user._id, share.source && share.source.handId)
          const slot = await store.get(COLLECTIONS.SLOTS, slotId)
          if (slot && slot.shareId === shareId) await store.set(COLLECTIONS.SLOTS, slotId, Object.assign({}, slot, { shareId: '', updatedAt: at }))
        }
        return { publicResult: { shareId, status: 'withdrawn' }, outboxIds: [] }
      }, { inputFingerprint: fingerprint })
      return drainResult(result)
    },

    async withdraw_shares_by_source_hand(event, actor) {
      const user = await currentUser(actor)
      const fingerprint = shareMutationFingerprint('withdraw_shares_by_source_hand', event)
      const result = await runIdempotent(repository, user._id, 'withdraw_shares_by_source_hand', event, async store => {
        const handId = normalizeId(event && event.handId)
        if (!handId) throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
        const slotId = shareSlotId(user._id, handId)
        const slot = await store.get(COLLECTIONS.SLOTS, slotId)
        const share = slot && slot.shareId ? await store.get(COLLECTIONS.SHARES, slot.shareId) : null
        let withdrawnCount = 0
        if (share && share.publisherId === user._id && share.source && normalizeId(share.source.handId) === handId &&
          normalizeId(share.source.ownerOpenId) === normalizeId(actor.ownerOpenId) &&
          normalizeId(share.source.privatePlayerId).toUpperCase() === normalizeId(user.privatePlayerId).toUpperCase() && share.status === 'active') {
          const at = Number(now()) || Date.now()
          await store.set(COLLECTIONS.SHARES, share._id, Object.assign({}, share, {
            status: 'withdrawn', sourceDeletedAt: at, withdrawnAt: at, updatedAt: at
          }))
          await store.set(COLLECTIONS.SLOTS, slotId, Object.assign({}, slot, { shareId: '', updatedAt: at }))
          withdrawnCount = 1
        }
        return { publicResult: { withdrawnCount }, outboxIds: [] }
      }, { inputFingerprint: fingerprint })
      return drainResult(result)
    }
  }
}

module.exports = {
  COLLECTIONS,
  SHARE_SCOPES,
  MAX_SELECTED_TARGETS,
  MAX_PUBLISHES_PER_HOUR,
  stableSerialize,
  mutationFingerprint,
  sortedUniqueTargets,
  shareSlotId,
  rateLimitId,
  notificationOutboxId,
  loadOwnedHandBundle,
  previewHashForBundle,
  drainNotificationOutbox,
  compensateRecipientOutboxes,
  requireReadableShare,
  createHandShareHandlers
}
