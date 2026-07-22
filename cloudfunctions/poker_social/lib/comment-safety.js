const { socialError } = require('./social-error')

const COMMENT_SCENE = 2
const PROFILE_SCENE = 1
const LEGACY_RISKY_ERROR_CODE = '87014'

function safetyError(code, message) {
  return socialError(code, message)
}

function createTextSafety(openapi, options) {
  const config = options || {}
  return async function checkText(input) {
    const content = input && typeof input.content === 'string' ? input.content.trim() : ''
    const openId = input && typeof input.openId === 'string' ? input.openId.trim() : ''
    const msgSecCheck = openapi && openapi.security && openapi.security.msgSecCheck
    if (!content || !openId || typeof msgSecCheck !== 'function') {
      throw safetyError(config.unavailableCode, config.unavailableMessage)
    }

    let response
    try {
      const request = {
        content,
        version: 2,
        scene: config.scene,
        openid: openId
      }
      if (config.scene === PROFILE_SCENE) request.nickname = content
      response = await msgSecCheck(request)
    } catch (error) {
      if (String(error && error.errCode || '') === LEGACY_RISKY_ERROR_CODE) {
        throw safetyError(config.blockedCode, config.blockedMessage)
      }
      if (error && (error.code === config.blockedCode || error.code === config.unavailableCode)) throw error
      throw safetyError(config.unavailableCode, config.unavailableMessage)
    }

    const suggest = String(response && response.result && response.result.suggest || '').trim().toLowerCase()
    if (suggest === 'pass') return
    if (suggest === 'risky' || suggest === 'review') {
      throw safetyError(config.blockedCode, config.blockedMessage)
    }
    throw safetyError(config.unavailableCode, config.unavailableMessage)
  }
}

function createCommentTextSafety(openapi) {
  return createTextSafety(openapi, {
    scene: COMMENT_SCENE,
    blockedCode: 'COMMENT_CONTENT_BLOCKED',
    blockedMessage: 'comment content blocked',
    unavailableCode: 'COMMENT_CHECK_UNAVAILABLE',
    unavailableMessage: 'comment check unavailable'
  })
}

function createProfileTextSafety(openapi) {
  return createTextSafety(openapi, {
    scene: PROFILE_SCENE,
    blockedCode: 'PROFILE_CONTENT_BLOCKED',
    blockedMessage: 'profile content blocked',
    unavailableCode: 'PROFILE_CHECK_UNAVAILABLE',
    unavailableMessage: 'profile check unavailable'
  })
}

module.exports = { COMMENT_SCENE, PROFILE_SCENE, createCommentTextSafety, createProfileTextSafety }
