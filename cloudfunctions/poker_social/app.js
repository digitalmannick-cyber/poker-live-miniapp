const { createProfileHandlers } = require('./lib/profile')
const { createFriendshipHandlers } = require('./lib/friendship')
const { createRankingHandlers } = require('./lib/ranking')

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
  INVALID_SOCIAL_SETTINGS: 'invalid social settings'
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
  const profileHandlers = config.repository
    ? createProfileHandlers(config.repository, { avatarUrl: config.avatarUrl })
    : {}
  const friendshipHandlers = config.repository
    ? createFriendshipHandlers(config.repository, Object.assign({}, config.friendship || {}, { avatarUrl: config.avatarUrl }))
    : {}
  const rankingHandlers = config.repository
    ? createRankingHandlers(config.repository, Object.assign({}, config.ranking || {}, { avatarUrl: config.avatarUrl || config.ranking && config.ranking.avatarUrl }))
    : {}
  const handlers = Object.assign({}, profileHandlers, friendshipHandlers, rankingHandlers, config.handlers || {})
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
