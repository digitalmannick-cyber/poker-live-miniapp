const UNAVAILABLE_CODES = new Set([
  'FORBIDDEN',
  'CONTENT_UNAVAILABLE',
  'FRIENDSHIP_REQUIRED',
  'PLAYER_CARD_UNAVAILABLE',
  'NOT_FOUND'
])

function unavailable() {
  return { type: 'unavailable' }
}

function resolveNotificationTarget(notification) {
  const item = notification || {}
  const kind = String(item.kind || '')
  const targetType = String(item.targetType || '')
  const targetId = String(item.targetId || '').trim()
  if (!targetId) return unavailable()

  if (kind === 'friend_request' && targetType === 'friendship') return { type: 'inline' }
  if (kind === 'friend_accepted' && targetType === 'friend') {
    return { type: 'navigate', url: '/pages/player-note-detail/player-note-detail?friendUserId=' + encodeURIComponent(targetId) }
  }
  if (kind === 'player_card' && targetType === 'player_card_share') {
    return { type: 'navigate', url: '/pages/social-card-preview/social-card-preview?shareId=' + encodeURIComponent(targetId) }
  }
  if (['selected_hand', 'comment', 'reply', 'like_aggregate'].includes(kind) && targetType === 'hand_share') {
    return { type: 'navigate', url: '/pages/social-hand-detail/social-hand-detail?shareId=' + encodeURIComponent(targetId) }
  }
  return unavailable()
}

function describeNotificationError(error) {
  const code = String(error && error.code || '')
  if (UNAVAILABLE_CODES.has(code)) return '内容已不可访问'
  return '好友功能暂时不可用'
}

module.exports = { resolveNotificationTarget, describeNotificationError }
