const { socialError } = require('./social-error')
const { getPairId } = require('./friendship')

async function requireAcceptedFriendship(repository, leftUserId, rightUserId) {
  let pairId
  try {
    pairId = getPairId(leftUserId, rightUserId)
  } catch (error) {
    throw socialError('FORBIDDEN', 'not allowed')
  }
  const relationship = await repository.get('social_friendships', pairId)
  if (!relationship || relationship.status !== 'accepted') throw socialError('FORBIDDEN', 'not allowed')
  const participants = [String(relationship.userA || ''), String(relationship.userB || '')]
  if (!participants.includes(String(leftUserId)) || !participants.includes(String(rightUserId))) {
    throw socialError('FORBIDDEN', 'not allowed')
  }
  return relationship
}

function isReadableCardShare(share, viewerId, nowMs) {
  if (!share || share.status !== 'active' || share.targetUserId !== viewerId) return false
  return !!share.importedAt || Number(share.expiresAt) > Number(nowMs)
}

module.exports = { requireAcceptedFriendship, isReadableCardShare }
