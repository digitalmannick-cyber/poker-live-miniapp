const { socialError } = require('./social-error')

function resolve(openId) {
  const ownerOpenId = String(openId || '').trim()
  if (!ownerOpenId) {
    throw socialError('UNAUTHENTICATED', 'identity unavailable')
  }
  return { ownerOpenId }
}

module.exports = { resolve }
