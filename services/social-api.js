const SOCIAL_FUNCTION_NAME = 'poker_social'

async function callSocialFunction(action, payload) {
  if (!global.wx || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    const error = new Error('social function unavailable')
    error.code = 'NETWORK_ERROR'
    throw error
  }
  const response = await wx.cloud.callFunction({
    name: SOCIAL_FUNCTION_NAME,
    data: Object.assign({}, payload || {}, { action })
  })
  const body = response && response.result || {}
  if (body.code && body.code !== 0) {
    const error = new Error(body.message || 'social function failed')
    error.code = body.code
    throw error
  }
  return body.data || {}
}

module.exports = { SOCIAL_FUNCTION_NAME, callSocialFunction }
