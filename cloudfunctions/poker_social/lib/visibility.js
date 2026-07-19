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
  if (!share || share.targetUserId !== viewerId) return false
  if (share.importedAt) return true
  return share.status === 'active' && Number(share.expiresAt) > Number(nowMs)
}

function hasAcceptedPair(friendship, leftUserId, rightUserId) {
  if (!friendship || friendship.status !== 'accepted') return false
  const expected = [String(leftUserId || ''), String(rightUserId || '')].sort()
  const actual = [String(friendship.userA || ''), String(friendship.userB || '')].sort()
  return !!expected[0] && expected[0] === actual[0] && expected[1] === actual[1]
}

function canReadShare(viewerId, share, friendship) {
  const viewer = String(viewerId || '')
  if (!viewer || !share || share.status !== 'active' || Number(share.sourceDeletedAt) > 0) return false
  const publisherId = String(share.publisherId || '')
  if (!publisherId || !['square', 'friends', 'selected'].includes(share.scope)) return false
  if (viewer === publisherId) return true
  if (share.scope === 'square') return true
  if (!hasAcceptedPair(friendship, viewer, publisherId)) return false
  if (share.scope === 'friends') return true
  return share.scope === 'selected' && Array.isArray(share.targetUserIds) && share.targetUserIds.includes(viewer)
}

module.exports = { requireAcceptedFriendship, isReadableCardShare, hasAcceptedPair, canReadShare }
