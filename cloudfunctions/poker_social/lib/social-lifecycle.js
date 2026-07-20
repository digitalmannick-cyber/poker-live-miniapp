const { socialError } = require('./social-error')

const SOCIAL_LIFECYCLE = Object.freeze({
  ACTIVE: 'active',
  CLEARING: 'clearing',
  DELETED: 'deleted'
})

function lifecycleOf(user) {
  if (!user || typeof user !== 'object') return ''
  if (user.socialLifecycle === SOCIAL_LIFECYCLE.CLEARING) return SOCIAL_LIFECYCLE.CLEARING
  if (user.deleted === true || user.socialLifecycle === SOCIAL_LIFECYCLE.DELETED) return SOCIAL_LIFECYCLE.DELETED
  const stage = user.accountClear && typeof user.accountClear.stage === 'string' ? user.accountClear.stage : ''
  if (stage === 'complete') return SOCIAL_LIFECYCLE.DELETED
  if (stage) return SOCIAL_LIFECYCLE.CLEARING
  return SOCIAL_LIFECYCLE.ACTIVE
}

function requireActiveSocialUser(user) {
  if (lifecycleOf(user) !== SOCIAL_LIFECYCLE.ACTIVE) {
    throw socialError('SOCIAL_PROFILE_REQUIRED', 'social profile required')
  }
  return user
}

module.exports = { SOCIAL_LIFECYCLE, lifecycleOf, requireActiveSocialUser }
