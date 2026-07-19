function withoutPrivateIdentifiers(value) {
  if (Array.isArray(value)) return value.map(withoutPrivateIdentifiers)
  if (!value || typeof value !== 'object') return value

  return Object.keys(value).reduce((result, key) => {
    if (key !== 'ownerOpenId' && key !== '_openid') {
      result[key] = withoutPrivateIdentifiers(value[key])
    }
    return result
  }, {})
}

function publicMessage(error) {
  const message = String(error && (error.message || error.errMsg) || 'social function failed')
  return /ownerOpenId|_openid/i.test(message) ? 'social function failed' : message
}

function createSocialApp(deps) {
  const config = deps || {}
  const identity = config.identity || {}
  const handlers = config.handlers || {}
  const requestId = typeof config.requestId === 'function'
    ? config.requestId
    : () => 'social_' + Date.now()

  return {
    async handle(event, context) {
      const currentRequestId = requestId()
      const action = String(event && event.action || '').trim()
      try {
        const actor = await identity.resolve(context && context.openId)
        const handler = handlers[action]
        if (typeof handler !== 'function') {
          return { code: 'UNKNOWN_ACTION', message: 'unknown social action', requestId: currentRequestId }
        }
        const data = await handler(event || {}, actor, context || {})
        return { code: 0, data: withoutPrivateIdentifiers(data || {}), requestId: currentRequestId }
      } catch (error) {
        return {
          code: String(error && error.code || 'SOCIAL_ERROR'),
          message: publicMessage(error),
          requestId: currentRequestId
        }
      }
    }
  }
}

module.exports = { createSocialApp, withoutPrivateIdentifiers }
