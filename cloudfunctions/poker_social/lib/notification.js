const crypto = require('crypto')
const { socialError } = require('./social-error')
const { runIdempotent } = require('./idempotency')

const COLLECTIONS = Object.freeze({
  NOTIFICATIONS: 'social_notifications',
  STATE: 'social_notification_state',
  HEADS: 'social_notification_heads',
  ACTORS: 'social_notification_actors'
})

const NOTIFICATION_KINDS = Object.freeze([
  'friend_request',
  'friend_accepted',
  'selected_hand',
  'comment',
  'reply',
  'like_aggregate',
  'player_card'
])

const NOTIFICATION_TARGET_TYPES = Object.freeze({
  friend_request: 'friendship',
  friend_accepted: 'friend',
  selected_hand: 'hand_share',
  comment: 'hand_share',
  reply: 'hand_share',
  like_aggregate: 'hand_share',
  player_card: 'player_card_share'
})

const LIKE_WINDOW_MS = 10 * 60 * 1000
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const MAX_CURSOR_LENGTH = 2048
const MAX_LIST_STATE_ATTEMPTS = 2

function canonicalTuple(parts) {
  return JSON.stringify((parts || []).map(value => String(value == null ? '' : value)))
}

function stableDocumentId(prefix, parts) {
  const safePrefix = String(prefix || '').replace(/[^a-z0-9_]/gi, '').slice(0, 16) || 'id'
  return safePrefix + '_' + crypto.createHash('sha256').update(canonicalTuple(parts)).digest('hex')
}

function notificationDocumentId(recipientId, kind, sourceEventId) {
  return stableDocumentId('sn', [recipientId, kind, sourceEventId])
}

function stateDocumentId(recipientId) {
  return stableDocumentId('ns', [recipientId])
}

function headDocumentId(recipientId, shareId) {
  return stableDocumentId('nh', [recipientId, shareId])
}

function actorDocumentId(notificationId, actorId) {
  return stableDocumentId('na', [notificationId, actorId])
}

function paginationError() {
  return socialError('INVALID_PAGINATION', 'invalid pagination')
}

function encodeCursor(tuple) {
  const createdAt = Number(tuple && tuple.createdAt)
  const id = String(tuple && tuple.id || '')
  if (!Number.isFinite(createdAt) || createdAt < 0 || !id || id.length > 256) throw paginationError()
  return Buffer.from(JSON.stringify({ v: 1, createdAt, id }), 'utf8').toString('base64url')
}

function decodeCursor(value) {
  const encoded = String(value || '')
  if (!encoded || encoded.length > MAX_CURSOR_LENGTH) throw paginationError()
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed).sort() : []
    if (keys.join(',') !== 'createdAt,id,v' || parsed.v !== 1) throw paginationError()
    if (typeof parsed.createdAt !== 'number' || !Number.isFinite(parsed.createdAt) || !Number.isSafeInteger(parsed.createdAt) || parsed.createdAt < 0) {
      throw paginationError()
    }
    if (typeof parsed.id !== 'string' || !parsed.id || parsed.id.length > 256 || parsed.id.trim() !== parsed.id) throw paginationError()
    return { createdAt: parsed.createdAt, id: parsed.id }
  } catch (error) {
    if (error && error.code === 'INVALID_PAGINATION') throw error
    throw paginationError()
  }
}

function compareTuple(leftCreatedAt, leftId, rightCreatedAt, rightId) {
  const time = Number(leftCreatedAt) - Number(rightCreatedAt)
  if (time) return time
  return String(leftId || '').localeCompare(String(rightId || ''))
}

function emptyState(recipientId) {
  return {
    _id: stateDocumentId(recipientId),
    recipientId: String(recipientId || ''),
    latestCreatedAt: 0,
    latestId: '',
    readThroughCreatedAt: 0,
    readThroughId: '',
    unreadCount: 0,
    version: 0,
    updatedAt: 0
  }
}

function unreadCountOf(state) {
  return Math.max(0, Math.floor(Number(state && state.unreadCount) || 0))
}

function stateVersionOf(state) {
  return Math.max(0, Math.floor(Number(state && state.version) || 0))
}

function isEffectivelyRead(notification, state) {
  if (Number(notification && notification.readAt) > 0) return true
  const watermarkAt = Number(state && state.readThroughCreatedAt) || 0
  const watermarkId = String(state && state.readThroughId || '')
  if (!watermarkAt || !watermarkId) return false
  return compareTuple(notification && notification.createdAt, notification && notification._id, watermarkAt, watermarkId) <= 0
}

function normalizeActor(actor) {
  const source = actor || {}
  const socialUserId = String(source.socialUserId || source._id || '').trim()
  const nickname = String(source.nickname || source.profile && source.profile.nickname || '').trim().slice(0, 24)
  const avatarFileId = String(source.avatarFileId || source.profile && source.profile.avatarFileId || '').trim()
  const avatarText = String(source.avatarText || source.profile && source.profile.avatarText || nickname.slice(0, 1)).trim().slice(0, 2)
  return { socialUserId, nickname, avatarFileId, avatarText }
}

function safeHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || ''))
    return parsed.protocol === 'https:' ? parsed.toString() : ''
  } catch (error) {
    return ''
  }
}

async function toNotificationDto(row, state, options) {
  const config = options || {}
  const avatarUrl = typeof config.avatarUrl === 'function' ? config.avatarUrl : async () => ''
  const actor = normalizeActor(row && row.actorSnapshot)
  const resolvedAvatar = actor.avatarFileId ? safeHttpsUrl(await avatarUrl(actor.avatarFileId)) : ''
  const targetType = String(row && row.targetType || '')
  const targetId = String(row && row.targetId || '')
  return {
    notificationId: String(row && row._id || ''),
    kind: String(row && row.kind || ''),
    actor: {
      socialUserId: actor.socialUserId,
      nickname: actor.nickname,
      avatarUrl: resolvedAvatar,
      avatarText: actor.avatarText
    },
    targetType,
    targetId,
    actionState: String(row && row.actionState || ''),
    aggregateCount: Math.max(1, Math.floor(Number(row && row.aggregateCount) || 1)),
    read: isEffectivelyRead(row, state),
    createdAt: Math.max(0, Number(row && row.createdAt) || 0)
  }
}

function validateWrite(input) {
  const source = input || {}
  const recipientId = String(source.recipientId || '').trim()
  const kind = String(source.kind || '').trim()
  const actor = normalizeActor(source.actor)
  const targetType = String(source.targetType || '').trim()
  const targetId = String(source.targetId || '').trim()
  const sourceEventId = String(source.sourceEventId || '').trim()
  if (!recipientId || !NOTIFICATION_KINDS.includes(kind) || !actor.socialUserId || targetType !== NOTIFICATION_TARGET_TYPES[kind] || !targetId || !sourceEventId) {
    throw socialError('INVALID_NOTIFICATION', 'invalid notification')
  }
  return { recipientId, kind, actor, targetType, targetId, sourceEventId }
}

function createNotificationWriter(options) {
  const config = options || {}
  const clock = typeof config.now === 'function' ? config.now : () => Date.now()

  async function write(store, input) {
    const normalized = validateWrite(input)
    if (normalized.recipientId === normalized.actor.socialUserId) return null
    const id = notificationDocumentId(normalized.recipientId, normalized.kind, normalized.sourceEventId)
    const existing = await store.get(COLLECTIONS.NOTIFICATIONS, id)
    if (existing) return existing
    const stateId = stateDocumentId(normalized.recipientId)
    const state = await store.get(COLLECTIONS.STATE, stateId) || emptyState(normalized.recipientId)
    const requestedAt = Number(input && input.at)
    const at = Number.isFinite(requestedAt) && requestedAt >= 0 ? requestedAt : Number(clock()) || Date.now()
    const createdAt = Math.max(at, (Number(state.latestCreatedAt) || 0) + 1)
    const row = {
      _id: id,
      recipientId: normalized.recipientId,
      kind: normalized.kind,
      actorSnapshot: normalized.actor,
      targetType: normalized.targetType,
      targetId: normalized.targetId,
      sourceEventId: normalized.sourceEventId,
      actionState: String(input && input.actionState || '').trim().slice(0, 32),
      aggregateCount: Math.max(1, Math.floor(Number(input && input.aggregateCount) || 1)),
      windowStartedAt: Math.max(0, Number(input && input.windowStartedAt) || 0),
      createdAt,
      latestAt: createdAt,
      readAt: 0
    }
    await store.set(COLLECTIONS.NOTIFICATIONS, id, row)
    await store.set(COLLECTIONS.STATE, stateId, Object.assign({}, state, {
      _id: stateId,
      recipientId: normalized.recipientId,
      latestCreatedAt: createdAt,
      latestId: id,
      unreadCount: Math.max(0, Math.floor(Number(state.unreadCount) || 0)) + 1,
      version: stateVersionOf(state) + 1,
      updatedAt: createdAt
    }))
    return row
  }

  async function setActionState(store, input) {
    const recipientId = String(input && input.recipientId || '').trim()
    const kind = String(input && input.kind || '').trim()
    const sourceEventId = String(input && input.sourceEventId || '').trim()
    const actionState = String(input && input.actionState || '').trim().slice(0, 32)
    if (!recipientId || !kind || !sourceEventId || !actionState) return null
    const id = notificationDocumentId(recipientId, kind, sourceEventId)
    const row = await store.get(COLLECTIONS.NOTIFICATIONS, id)
    if (!row || row.recipientId !== recipientId || row.kind !== kind) return null
    const next = Object.assign({}, row, { actionState })
    await store.set(COLLECTIONS.NOTIFICATIONS, id, next)
    return next
  }

  async function writeLikeAggregate(store, input) {
    const source = input || {}
    const recipientId = String(source.recipientId || '').trim()
    const shareId = String(source.shareId || '').trim()
    const actor = normalizeActor(source.actor)
    const sourceEventId = String(source.sourceEventId || '').trim()
    const requestedAt = Number(source.at)
    const at = Number.isFinite(requestedAt) && requestedAt >= 0 ? requestedAt : Number(clock()) || Date.now()
    if (!recipientId || !shareId || !actor.socialUserId || !sourceEventId) throw socialError('INVALID_NOTIFICATION', 'invalid notification')
    if (recipientId === actor.socialUserId) return null
    const state = await store.get(COLLECTIONS.STATE, stateDocumentId(recipientId)) || emptyState(recipientId)
    const headId = headDocumentId(recipientId, shareId)
    const head = await store.get(COLLECTIONS.HEADS, headId)
    const current = head && await store.get(COLLECTIONS.NOTIFICATIONS, head.notificationId)
    const open = !!(head && current && at < Number(head.windowStartedAt) + LIKE_WINDOW_MS && !isEffectivelyRead(current, state))
    if (open) {
      const membershipId = actorDocumentId(current._id, actor.socialUserId)
      const membership = await store.get(COLLECTIONS.ACTORS, membershipId)
      if (membership) return current
      await store.set(COLLECTIONS.ACTORS, membershipId, {
        _id: membershipId,
        notificationId: current._id,
        actorId: actor.socialUserId,
        createdAt: at
      })
      const next = Object.assign({}, current, {
        aggregateCount: Math.max(1, Math.floor(Number(current.aggregateCount) || 1)) + 1,
        latestAt: at
      })
      await store.set(COLLECTIONS.NOTIFICATIONS, current._id, next)
      await store.set(COLLECTIONS.HEADS, headId, Object.assign({}, head, { latestAt: at }))
      return next
    }
    const row = await write(store, {
      recipientId,
      kind: 'like_aggregate',
      actor,
      targetType: 'hand_share',
      targetId: shareId,
      sourceEventId,
      aggregateCount: 1,
      windowStartedAt: at,
      at
    })
    if (!row) return null
    const membershipId = actorDocumentId(row._id, actor.socialUserId)
    await store.set(COLLECTIONS.ACTORS, membershipId, {
      _id: membershipId,
      notificationId: row._id,
      actorId: actor.socialUserId,
      createdAt: at
    })
    await store.set(COLLECTIONS.HEADS, headId, {
      _id: headId,
      recipientId,
      shareId,
      notificationId: row._id,
      windowStartedAt: at,
      latestAt: at
    })
    return row
  }

  return { write, setActionState, writeLikeAggregate }
}

async function findActorUser(repository, actor) {
  const query = { ownerOpenId: actor && actor.ownerOpenId }
  const user = typeof repository.find === 'function'
    ? await repository.find('social_users', query)
    : repository.where('social_users', row => row.ownerOpenId === query.ownerOpenId)[0]
  if (!user) throw socialError('SOCIAL_PROFILE_REQUIRED', 'social profile required')
  return user
}

function parseLimit(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_LIMIT
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw paginationError()
  return limit
}

function createNotificationHandlers(repository, options) {
  const config = options || {}
  const now = typeof config.now === 'function' ? config.now : () => Date.now()
  return {
    async list_notifications(event, actor) {
      const actorUser = await findActorUser(repository, actor)
      const limit = parseLimit(event && event.limit)
      const cursor = event && event.cursor ? decodeCursor(event.cursor) : null
      const stateId = stateDocumentId(actorUser._id)
      for (let attempt = 0; attempt < MAX_LIST_STATE_ATTEMPTS; attempt += 1) {
        const beforeState = await repository.get(COLLECTIONS.STATE, stateId) || emptyState(actorUser._id)
        const rows = await repository.listNotifications(actorUser._id, { cursor, limit })
        const state = await repository.get(COLLECTIONS.STATE, stateId) || emptyState(actorUser._id)
        if (stateVersionOf(beforeState) !== stateVersionOf(state)) continue
        const hasMore = rows.length > limit
        const pageRows = rows.slice(0, limit)
        const items = []
        for (const row of pageRows) items.push(await toNotificationDto(row, state, config))
        const tail = pageRows[pageRows.length - 1]
        return {
          items,
          nextCursor: hasMore && tail ? encodeCursor({ createdAt: tail.createdAt, id: tail._id }) : null,
          unreadCount: unreadCountOf(state)
        }
      }
      throw socialError('NOTIFICATION_STATE_UNSTABLE', 'notification state changed')
    },

    async mark_notification_read(event, actor) {
      const actorUser = await findActorUser(repository, actor)
      return runIdempotent(repository, actorUser._id, 'mark_notification_read', event, async store => {
        const notificationId = String(event && event.notificationId || '').trim()
        const row = notificationId && await store.get(COLLECTIONS.NOTIFICATIONS, notificationId)
        if (!row || row.recipientId !== actorUser._id) throw socialError('FORBIDDEN', 'not allowed')
        const stateId = stateDocumentId(actorUser._id)
        const state = await store.get(COLLECTIONS.STATE, stateId) || emptyState(actorUser._id)
        let unreadCount = unreadCountOf(state)
        if (!isEffectivelyRead(row, state)) {
          const at = Number(now()) || Date.now()
          unreadCount = Math.max(0, unreadCount - 1)
          await store.set(COLLECTIONS.NOTIFICATIONS, row._id, Object.assign({}, row, { readAt: at }))
          await store.set(COLLECTIONS.STATE, stateId, Object.assign({}, state, {
            unreadCount,
            version: stateVersionOf(state) + 1,
            updatedAt: at
          }))
        }
        return { notificationId: row._id, read: true, unreadCount }
      })
    },

    async mark_all_notifications_read(event, actor) {
      const actorUser = await findActorUser(repository, actor)
      return runIdempotent(repository, actorUser._id, 'mark_all_notifications_read', event, async store => {
        const stateId = stateDocumentId(actorUser._id)
        const state = await store.get(COLLECTIONS.STATE, stateId) || emptyState(actorUser._id)
        const at = Number(now()) || Date.now()
        await store.set(COLLECTIONS.STATE, stateId, Object.assign({}, state, {
          readThroughCreatedAt: Number(state.latestCreatedAt) || 0,
          readThroughId: String(state.latestId || ''),
          unreadCount: 0,
          version: stateVersionOf(state) + 1,
          updatedAt: at
        }))
        return { unreadCount: 0 }
      })
    },

    async get_unread_count(event, actor) {
      const actorUser = await findActorUser(repository, actor)
      const state = await repository.get(COLLECTIONS.STATE, stateDocumentId(actorUser._id))
      return { unreadCount: unreadCountOf(state) }
    }
  }
}

module.exports = {
  COLLECTIONS,
  NOTIFICATION_KINDS,
  NOTIFICATION_TARGET_TYPES,
  LIKE_WINDOW_MS,
  stableDocumentId,
  notificationDocumentId,
  stateDocumentId,
  headDocumentId,
  actorDocumentId,
  encodeCursor,
  decodeCursor,
  isEffectivelyRead,
  normalizeActor,
  toNotificationDto,
  createNotificationWriter,
  createNotificationHandlers
}
