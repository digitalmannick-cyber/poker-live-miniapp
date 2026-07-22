const { socialError } = require('./social-error')

const COMMENT_SCENE = 2
const LEGACY_RISKY_ERROR_CODE = '87014'

function blocked() {
  return socialError('COMMENT_CONTENT_BLOCKED', 'comment content blocked')
}

function unavailable() {
  return socialError('COMMENT_CHECK_UNAVAILABLE', 'comment check unavailable')
}

function createCommentTextSafety(openapi) {
  return async function checkCommentText(input) {
    const content = input && typeof input.content === 'string' ? input.content.trim() : ''
    const openId = input && typeof input.openId === 'string' ? input.openId.trim() : ''
    const msgSecCheck = openapi && openapi.security && openapi.security.msgSecCheck
    if (!content || !openId || typeof msgSecCheck !== 'function') throw unavailable()

    let response
    try {
      response = await msgSecCheck({
        content,
        version: 2,
        scene: COMMENT_SCENE,
        openid: openId
      })
    } catch (error) {
      if (String(error && error.errCode || '') === LEGACY_RISKY_ERROR_CODE) throw blocked()
      throw unavailable()
    }

    const suggest = String(response && response.result && response.result.suggest || '').trim().toLowerCase()
    if (suggest === 'pass') return
    if (suggest === 'risky' || suggest === 'review') throw blocked()
    throw unavailable()
  }
}

module.exports = { COMMENT_SCENE, createCommentTextSafety }
