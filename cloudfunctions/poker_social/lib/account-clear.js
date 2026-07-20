const crypto = require('crypto')
const { socialError } = require('./social-error')
const { requireClientMutationId } = require('./idempotency')
const { stateDocumentId } = require('./notification')
const { shareSlotId, sortedUniqueTargets } = require('./hand-share')
const { SOCIAL_LIFECYCLE } = require('./social-lifecycle')

const BATCH_SIZE = 50
const USER_COLLECTION = 'social_users'
const CHECKPOINT_KEY = 'accountClear'
const ANONYMOUS_SOCIAL_USER_ID = 'deleted_user'
const ANONYMOUS_COMMENT_AUTHOR = Object.freeze({
  socialUserId: ANONYMOUS_SOCIAL_USER_ID,
  nickname: '已注销用户',
  avatarUrl: '',
  avatarText: '匿'
})
const ANONYMOUS_NOTIFICATION_ACTOR = Object.freeze({
  socialUserId: ANONYMOUS_SOCIAL_USER_ID,
  nickname: '已注销用户',
  avatarFileId: '',
  avatarText: '匿'
})

const STAGES = Object.freeze([
  'profile',
  'invites',
  'friendships_a_pending',
  'friendships_a_accepted',
  'friendships_a_rejected',
  'friendships_b_pending',
  'friendships_b_accepted',
  'friendships_b_rejected',
  'hand_shares',
  'card_shares_sent',
  'card_shares_received',
  'comments',
  'likes',
  'recipient_notifications',
  'recipient_heads',
  'recipient_state',
  'actor_notifications',
  'actor_memberships',
  'outbox_publisher',
  'outbox_target',
  'rate_actor',
  'rate_publisher',
  'mutations',
  'daily_stats',
  'complete'
])

function nextStage(stage) {
  const index = STAGES.indexOf(stage)
  return index >= 0 && index < STAGES.length - 1 ? STAGES[index + 1] : 'complete'
}

function mutationHash(socialUserId, clientMutationId) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([String(socialUserId || ''), 'clear_my_social_data', String(clientMutationId || '')]))
    .digest('hex')
}

function validClock(value) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error('account clear clock unavailable')
  return result
}

function checkpointOf(user) {
  const source = user && user[CHECKPOINT_KEY]
  const stage = source && STAGES.includes(source.stage) ? source.stage : 'profile'
  return {
    stage,
    mutationHash: typeof (source && source.mutationHash) === 'string' ? source.mutationHash : '',
    startedAt: Number.isSafeInteger(source && source.startedAt) && source.startedAt > 0 ? source.startedAt : 0,
    updatedAt: Number.isSafeInteger(source && source.updatedAt) && source.updatedAt > 0 ? source.updatedAt : 0,
    completedAt: Number.isSafeInteger(source && source.completedAt) && source.completedAt > 0 ? source.completedAt : 0
  }
}

function publicResult(socialUserId, stage) {
  const completed = stage === 'complete'
  return { completed, remainingStage: completed ? '' : stage, socialUserId }
}

function checkpoint(stage, hash, previous, at) {
  return {
    stage,
    mutationHash: hash,
    startedAt: previous.startedAt || at,
    updatedAt: at,
    completedAt: stage === 'complete' ? previous.completedAt || at : 0
  }
}

async function saveCheckpoint(store, socialUserId, stage, hash, previous, at, userPatch) {
  const current = await store.get(USER_COLLECTION, socialUserId)
  if (!current) throw socialError('SOCIAL_PROFILE_REQUIRED', 'social profile required')
  const next = Object.assign({}, current, userPatch || {}, {
    [CHECKPOINT_KEY]: checkpoint(stage, hash, previous, at)
  })
  await store.set(USER_COLLECTION, socialUserId, next)
  return next
}

function friendshipStage(stage) {
  const match = /^friendships_([ab])_(pending|accepted|rejected)$/.exec(stage)
  return match ? { side: match[1] === 'a' ? 'userA' : 'userB', status: match[2] } : null
}

async function processRows(store, stage, sourceRows, socialUserId, at) {
  const relationship = friendshipStage(stage)
  for (const source of sourceRows) {
    if (!source || typeof source._id !== 'string' || !source._id) continue
    if (relationship) {
      const row = await store.get('social_friendships', source._id)
      if (row && row[relationship.side] === socialUserId && row.status === relationship.status) {
        await store.set('social_friendships', row._id, Object.assign({}, row, {
          status: 'removed', removedAt: at, updatedAt: at, cooldownUntil: 0
        }))
      }
      continue
    }

    if (stage === 'invites') {
      const row = await store.get('social_invites', source._id)
      if (row && row.inviterId === socialUserId && row.revokedAt === 0) {
        await store.set('social_invites', row._id, Object.assign({}, row, { revokedAt: at, updatedAt: at }))
      }
    } else if (stage === 'hand_shares') {
      const row = await store.get('social_hand_shares', source._id)
      if (row && row.publisherId === socialUserId && row.status === 'active') {
        await store.set('social_hand_shares', row._id, Object.assign({}, row, { status: 'withdrawn', withdrawnAt: at, updatedAt: at }))
        const handId = String(row.source && row.source.handId || '').trim()
        const slotId = handId && shareSlotId(socialUserId, handId)
        const slot = slotId && await store.get('social_hand_share_slots', slotId)
        if (slot && slot.shareId === row._id) {
          await store.set('social_hand_share_slots', slotId, Object.assign({}, slot, { shareId: '', updatedAt: at }))
        }
      }
    } else if (stage === 'card_shares_sent') {
      const row = await store.get('social_player_card_shares', source._id)
      if (row && row.senderUserId === socialUserId && row.status === 'active') {
        await store.set('social_player_card_shares', row._id, Object.assign({}, row, { status: 'withdrawn', withdrawnAt: at }))
      }
    } else if (stage === 'card_shares_received') {
      const row = await store.get('social_player_card_shares', source._id)
      if (row && row.targetUserId === socialUserId && row.status === 'active' && Number(row.importedAt) === 0) {
        await store.set('social_player_card_shares', row._id, Object.assign({}, row, { status: 'invalidated', invalidatedAt: at }))
      }
    } else if (stage === 'comments') {
      const row = await store.get('social_comments', source._id)
      if (row && row.authorId === socialUserId && row.deleted === false) {
        await store.set('social_comments', row._id, Object.assign({}, row, {
          authorSnapshot: ANONYMOUS_COMMENT_AUTHOR,
          deleted: true,
          deletedAt: at,
          updatedAt: at
        }))
        const share = await store.get('social_hand_shares', row.shareId)
        if (share) {
          const commentCount = Number.isSafeInteger(share.commentCount) && share.commentCount > 0 ? share.commentCount - 1 : 0
          await store.set('social_hand_shares', share._id, Object.assign({}, share, { commentCount, updatedAt: at }))
        }
      }
    } else if (stage === 'likes') {
      const row = await store.get('social_likes', source._id)
      if (row && row.actorId === socialUserId && row.active === true) {
        await store.set('social_likes', row._id, Object.assign({}, row, { active: false, updatedAt: at }))
        const share = await store.get('social_hand_shares', row.shareId)
        if (share) {
          const likeCount = Number.isSafeInteger(share.likeCount) && share.likeCount > 0 ? share.likeCount - 1 : 0
          await store.set('social_hand_shares', share._id, Object.assign({}, share, { likeCount, updatedAt: at }))
        }
      }
    } else if (stage === 'recipient_heads') {
      const row = await store.get('social_notification_heads', source._id)
      if (row && row.recipientId === socialUserId) await store.remove('social_notification_heads', row._id)
    } else if (stage === 'actor_notifications') {
      const row = await store.get('social_notifications', source._id)
      if (row && row.actorSnapshot && row.actorSnapshot.socialUserId === socialUserId) {
        await store.set('social_notifications', row._id, Object.assign({}, row, { actorSnapshot: ANONYMOUS_NOTIFICATION_ACTOR }))
      }
    } else if (stage === 'actor_memberships') {
      const row = await store.get('social_notification_actors', source._id)
      if (row && row.actorId === socialUserId) {
        await store.set('social_notification_actors', row._id, Object.assign({}, row, { actorId: ANONYMOUS_SOCIAL_USER_ID }))
      }
    } else if (stage === 'outbox_publisher') {
      const row = await store.get('social_notification_outbox', source._id)
      if (row && row.publisherId === socialUserId && row.status === 'pending') {
        const delivered = sortedUniqueTargets(row.deliveredTargetIds)
        const skipped = sortedUniqueTargets([].concat(row.skippedTargetIds || [], row.targetUserIds || []).filter(id => !delivered.includes(id)))
        await store.set('social_notification_outbox', row._id, Object.assign({}, row, {
          skippedTargetIds: skipped, status: 'delivered', updatedAt: at
        }))
      }
    } else if (stage === 'outbox_target') {
      const row = await store.get('social_notification_outbox', source._id)
      const addressed = sortedUniqueTargets([].concat(row && row.deliveredTargetIds || [], row && row.skippedTargetIds || []))
      if (row && row.status === 'pending' && Array.isArray(row.targetUserIds) && row.targetUserIds.includes(socialUserId) && !addressed.includes(socialUserId)) {
        const skippedTargetIds = sortedUniqueTargets([].concat(row.skippedTargetIds || [], socialUserId))
        const targetUserIds = sortedUniqueTargets(row.targetUserIds).filter(id => id !== socialUserId)
        const nextAddressed = new Set([].concat(row.deliveredTargetIds || [], skippedTargetIds))
        const done = targetUserIds.every(id => nextAddressed.has(id))
        await store.set('social_notification_outbox', row._id, Object.assign({}, row, {
          targetUserIds, skippedTargetIds, status: done ? 'delivered' : 'pending', updatedAt: at
        }))
      }
    } else if (stage === 'rate_actor' || stage === 'rate_publisher') {
      const row = await store.get('social_rate_limits', source._id)
      const field = stage === 'rate_actor' ? 'actorId' : 'publisherId'
      if (row && row[field] === socialUserId) await store.remove('social_rate_limits', row._id)
    } else if (stage === 'mutations') {
      const row = await store.get('social_mutations', source._id)
      if (row && row.actorId === socialUserId) await store.remove('social_mutations', row._id)
    } else if (stage === 'daily_stats') {
      const row = await store.get('social_daily_stats', source._id)
      if (row && row.socialUserId === socialUserId) await store.remove('social_daily_stats', row._id)
    }
  }
}

async function recipientNotificationWork(repository, notifications) {
  let remaining = BATCH_SIZE
  const actorRows = []
  const removableNotifications = []
  for (const notification of notifications) {
    if (remaining <= 0) break
    const actorLimit = remaining
    const actors = await repository.listAccountClearNotificationActors(notification._id, actorLimit)
    actorRows.push.apply(actorRows, actors)
    remaining -= actors.length
    if (actors.length < actorLimit && remaining > 0) {
      removableNotifications.push(notification)
      remaining -= 1
    }
  }
  return { actorRows, removableNotifications }
}

function createAccountClearHandlers(repository, options) {
  const config = options || {}
  const now = typeof config.now === 'function' ? config.now : () => Date.now()

  async function findUser(ownerOpenId) {
    if (typeof repository.findAccountClearUserByOpenId === 'function') {
      return repository.findAccountClearUserByOpenId(ownerOpenId)
    }
    if (typeof repository.find === 'function') return repository.find(USER_COLLECTION, { ownerOpenId })
    throw new Error('account clear repository unavailable')
  }

  return {
    async clear_my_social_data(event, actor) {
      if (!event || typeof event.clientMutationId !== 'string') {
        throw socialError('INVALID_MUTATION', 'invalid mutation')
      }
      const clientMutationId = requireClientMutationId(event)
      const ownerOpenId = actor && typeof actor.ownerOpenId === 'string' ? actor.ownerOpenId.trim() : ''
      const user = ownerOpenId && await findUser(ownerOpenId)
      if (!user || typeof user._id !== 'string' || !user._id) throw socialError('SOCIAL_PROFILE_REQUIRED', 'social profile required')
      const socialUserId = user._id
      const hash = mutationHash(socialUserId, clientMutationId)
      const at = validClock(now())
      let current = checkpointOf(user)
      if (current.stage === 'complete') return publicResult(socialUserId, 'complete')

      if (current.stage === 'profile') {
        const stage = nextStage('profile')
        await repository.runTransaction(store => saveCheckpoint(store, socialUserId, stage, hash, current, at, {
          deleted: true,
          deletedAt: at,
          socialLifecycle: SOCIAL_LIFECYCLE.CLEARING,
          statsVisible: false,
          publicStats: { durationMinutes: 0, recordedHandCount: 0 },
          profile: { nickname: ANONYMOUS_NOTIFICATION_ACTOR.nickname, avatarFileId: '', avatarText: ANONYMOUS_NOTIFICATION_ACTOR.avatarText },
          updatedAt: at
        }))
        return publicResult(socialUserId, stage)
      }

      for (let guard = 0; guard < STAGES.length; guard += 1) {
        const stage = current.stage
        if (stage === 'complete') return publicResult(socialUserId, stage)

        if (stage === 'recipient_state') {
          const following = nextStage(stage)
          await repository.runTransaction(async store => {
            const stateId = stateDocumentId(socialUserId)
            const state = await store.get('social_notification_state', stateId)
            if (state && state.recipientId === socialUserId) await store.remove('social_notification_state', stateId)
            await saveCheckpoint(store, socialUserId, following, hash, current, at)
          })
          return publicResult(socialUserId, following)
        }

        if (typeof repository.listAccountClearBatch !== 'function') throw new Error('account clear query unavailable')
        const sourceRows = await repository.listAccountClearBatch(stage, socialUserId, BATCH_SIZE)
        if (!Array.isArray(sourceRows)) throw new Error('account clear query unavailable')

        if (stage === 'recipient_notifications' && sourceRows.length) {
          if (typeof repository.listAccountClearNotificationActors !== 'function') throw new Error('account clear actor query unavailable')
          const work = await recipientNotificationWork(repository, sourceRows)
          await repository.runTransaction(async store => {
            for (const source of work.actorRows) {
              const row = await store.get('social_notification_actors', source._id)
              if (row && row.notificationId === source.notificationId) await store.remove('social_notification_actors', row._id)
            }
            for (const source of work.removableNotifications) {
              const row = await store.get('social_notifications', source._id)
              if (row && row.recipientId === socialUserId) await store.remove('social_notifications', row._id)
            }
            await saveCheckpoint(store, socialUserId, stage, hash, current, at)
          })
          return publicResult(socialUserId, stage)
        }

        if (sourceRows.length) {
          await repository.runTransaction(async store => {
            await processRows(store, stage, sourceRows, socialUserId, at)
            await saveCheckpoint(store, socialUserId, stage, hash, current, at)
          })
          return publicResult(socialUserId, stage)
        }

        const following = nextStage(stage)
        const lifecyclePatch = following === 'complete'
          ? { deleted: true, socialLifecycle: SOCIAL_LIFECYCLE.DELETED, updatedAt: at }
          : null
        await repository.runTransaction(store => saveCheckpoint(store, socialUserId, following, hash, current, at, lifecyclePatch))
        current = Object.assign({}, current, { stage: following, mutationHash: hash, updatedAt: at })
      }
      throw new Error('account clear stage unavailable')
    }
  }
}

module.exports = {
  BATCH_SIZE,
  STAGES,
  ANONYMOUS_COMMENT_AUTHOR,
  ANONYMOUS_NOTIFICATION_ACTOR,
  mutationHash,
  createAccountClearHandlers
}
