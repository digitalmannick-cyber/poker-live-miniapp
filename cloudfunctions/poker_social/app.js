const { createProfileHandlers } = require('./lib/profile')
const { createFriendshipHandlers } = require('./lib/friendship')
const { createRankingHandlers } = require('./lib/ranking')
const { createPlayerCardHandlers } = require('./lib/player-card')
const { createNotificationWriter, createNotificationHandlers } = require('./lib/notification')
const { createHandShareHandlers, compensateRecipientOutboxes } = require('./lib/hand-share')

function withoutPrivateIdentifiers(value) {
  if (typeof value === 'string' && value.includes('cloud://')) return null
  if (Array.isArray(value)) return value.map(withoutPrivateIdentifiers)
  if (!value || typeof value !== 'object') return value

  return Object.keys(value).reduce((result, key) => {
    if (key !== 'ownerOpenId' && key !== '_openid' && key !== 'privatePlayerId' && key !== 'avatarFileId') {
      result[key] = withoutPrivateIdentifiers(value[key])
    }
    return result
  }, {})
}

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  FORBIDDEN: 'not allowed',
  UNAUTHENTICATED: 'identity unavailable',
  SOCIAL_PROFILE_REQUIRED: 'social profile required',
  INVALID_MUTATION: 'invalid mutation',
  MUTATION_CONFLICT: 'mutation conflict',
  INVALID_INVITE: 'invalid invite',
  INVITE_UNAVAILABLE: 'invite unavailable',
  FRIEND_REQUEST_COOLDOWN: 'friend request cooling down',
  FRIENDSHIP_NOT_FOUND: 'friendship not found',
  INVALID_FRIENDSHIP: 'invalid friendship',
  INVALID_FRIENDSHIP_STATE: 'invalid friendship state',
  SOCIAL_USER_NOT_FOUND: 'social user not found',
  QR_UNAVAILABLE: 'qr unavailable',
  INVITE_SECRET_UNAVAILABLE: 'invite unavailable',
  INVALID_PAGINATION: 'invalid pagination',
  INVALID_RANKING_RANGE: 'invalid ranking range',
  INVALID_SOCIAL_SETTINGS: 'invalid social settings',
  INVALID_CARD_TARGET: 'invalid card target',
  PLAYER_CARD_SOURCE_NOT_FOUND: 'player card source not found',
  PLAYER_CARD_UNAVAILABLE: 'player card unavailable',
  BLIND_REQUIRED: 'big blind required',
  INVALID_HAND_SNAPSHOT: 'invalid hand snapshot',
  HAND_ACTIONS_REQUIRED: 'hand actions required',
  HAND_ACTIONS_LIMIT_EXCEEDED: 'hand actions limit exceeded',
  HAND_SOURCE_UPDATING: 'hand source updating',
  HAND_PREVIEW_STALE: 'hand preview stale',
  HAND_ALREADY_SHARED: 'hand already shared',
  INVALID_SHARE_SCOPE: 'invalid share scope',
  RATE_LIMITED: 'rate limited',
  CONTENT_UNAVAILABLE: 'content unavailable'
})

function publicError(error) {
  const code = String(error && error.code || '')
  if (Object.prototype.hasOwnProperty.call(PUBLIC_ERROR_MESSAGES, code)) {
    return { code, message: PUBLIC_ERROR_MESSAGES[code] }
  }
  return { code: 'SOCIAL_ERROR', message: 'social function failed' }
}

function createSocialApp(deps) {
  const config = deps || {}
  const identity = config.identity || {}
  const notificationWriter = config.notificationWriter || createNotificationWriter(config.notification)
  const profileHandlers = config.repository
    ? createProfileHandlers(config.repository, { avatarUrl: config.avatarUrl })
    : {}
  const friendshipHandlers = config.repository
    ? createFriendshipHandlers(config.repository, Object.assign({}, config.friendship || {}, { avatarUrl: config.avatarUrl, notificationWriter }))
    : {}
  const rankingHandlers = config.repository
    ? createRankingHandlers(config.repository, Object.assign({}, config.ranking || {}, { avatarUrl: config.avatarUrl || config.ranking && config.ranking.avatarUrl }))
    : {}
  const playerCardHandlers = config.repository
    ? createPlayerCardHandlers(config.repository, Object.assign({}, config.playerCard || {}, { avatarUrl: config.avatarUrl || config.playerCard && config.playerCard.avatarUrl, notificationWriter }))
    : {}
  const handShareHandlers = config.repository
    ? createHandShareHandlers(config.repository, Object.assign({}, config.handShare || {}, { notificationWriter }))
    : {}
  const compensateSelectedHands = config.repository
    ? (recipientId, limits) => compensateRecipientOutboxes(config.repository, recipientId, Object.assign({}, config.handShare || {}, limits || {}, { notificationWriter }))
    : async () => {}
  const notificationHandlers = config.repository
    ? createNotificationHandlers(config.repository, Object.assign({}, config.notification || {}, {
      avatarUrl: config.avatarUrl || config.notification && config.notification.avatarUrl,
      compensateRecipientOutboxes: compensateSelectedHands
    }))
    : {}
  const handlers = Object.assign({}, profileHandlers, friendshipHandlers, rankingHandlers, playerCardHandlers, handShareHandlers, notificationHandlers, config.handlers || {})
  const requestId = typeof config.requestId === 'function'
    ? config.requestId
    : () => 'social_' + Date.now()

  return {
    async handle(event, context) {
      const currentRequestId = requestId()
      const action = String(event && event.action || '').trim()
      try {
        const actor = await identity.resolve(context && context.openId)
        const hasHandler = Object.prototype.hasOwnProperty.call(handlers, action)
        const handler = hasHandler ? handlers[action] : null
        if (typeof handler !== 'function') {
          return { code: 'UNKNOWN_ACTION', data: null, message: 'unknown social action', requestId: currentRequestId }
        }
        const data = await handler(event || {}, actor, context || {})
        return { code: 0, data: withoutPrivateIdentifiers(data || {}), requestId: currentRequestId }
      } catch (error) {
        const publicResult = publicError(error)
        return {
          code: publicResult.code,
          data: null,
          message: publicResult.message,
          requestId: currentRequestId
        }
      }
    }
  }
}

module.exports = { createSocialApp, withoutPrivateIdentifiers }
