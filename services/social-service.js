const { callSocialFunction } = require('./social-api')

const SOCIAL_STATS_SYNC_INTERVAL_MS = 5 * 60 * 1000
const socialStatsSyncPromises = Object.create(null)

function normalizePlayerId(value) {
  return String(value || '').trim().toUpperCase()
}

function socialStatsStorageKey(playerId) {
  return 'pokerSocialStatsSyncedAt_' + encodeURIComponent(String(playerId || ''))
}

function scheduleMyStatsSync(playerId) {
  const normalizedPlayerId = normalizePlayerId(playerId)
  if (!normalizedPlayerId || typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function' || typeof wx.setStorageSync !== 'function') {
    return Promise.resolve({ skipped: true })
  }
  if (socialStatsSyncPromises[normalizedPlayerId]) return socialStatsSyncPromises[normalizedPlayerId]
  const storageKey = socialStatsStorageKey(normalizedPlayerId)
  const lastAt = Number(wx.getStorageSync(storageKey)) || 0
  if (Date.now() - lastAt < SOCIAL_STATS_SYNC_INTERVAL_MS) return Promise.resolve({ skipped: true })
  const task = callSocialFunction('sync_my_social_stats', { playerId: normalizedPlayerId })
    .then(result => {
      wx.setStorageSync(storageKey, Date.now())
      return result
    })
    .finally(() => {
      delete socialStatsSyncPromises[normalizedPlayerId]
    })
  socialStatsSyncPromises[normalizedPlayerId] = task
  return task
}

function initializeSocialProfile(input) {
  return callSocialFunction('initialize_social_profile', input)
}

function getMySocialProfile() {
  return callSocialFunction('get_my_social_profile')
}

function requireMutation(input) {
  const raw = input && input.clientMutationId
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value || value.length > 128) {
    const error = new Error('client mutation id required')
    error.code = 'INVALID_MUTATION'
    throw error
  }
  return Object.assign({}, input, { clientMutationId: value })
}

function write(action, input) {
  return callSocialFunction(action, requireMutation(input))
}

function createInvite(input) { return write('create_invite', input) }
function createInviteQr(input) { return write('create_invite_qr', input) }
function inspectInvite(input) { return callSocialFunction('inspect_invite', input) }
function sendFriendRequest(input) { return write('send_friend_request', input) }
function acceptFriendRequest(input) { return write('accept_friend_request', input) }
function rejectFriendRequest(input) { return write('reject_friend_request', input) }
function removeFriend(input) { return write('remove_friend', input) }
function listFriends(input) {
  const source = input || {}
  return callSocialFunction('list_friends', {
    offset: Math.max(0, Number(source.offset) || 0),
    limit: Math.min(50, Math.max(1, Number(source.limit) || 20))
  })
}

function getFriendDetail(friendUserId) {
  return callSocialFunction('get_friend_detail', { friendUserId: String(friendUserId || '').trim() })
}

function listRanking(rangeKey) {
  const key = String(rangeKey && rangeKey.rangeKey || rangeKey || 'week').trim()
  return callSocialFunction('list_ranking', { rangeKey: key })
}

function updateSocialSettings(input) {
  return write('update_social_settings', input)
}

function sharePlayerCard(input) {
  return write('share_player_card', input)
}

function getPlayerCardShare(shareId) {
  return callSocialFunction('get_player_card_share', { shareId: String(shareId || '').trim() })
}

function withdrawPlayerCardShare(input) {
  return write('withdraw_player_card_share', input)
}

function confirmPlayerCardImport(input) {
  return write('confirm_player_card_import', input)
}

function listNotifications(input) {
  const source = input || {}
  return callSocialFunction('list_notifications', {
    cursor: source.cursor || '',
    limit: Math.min(50, Math.max(1, Number(source.limit) || 20))
  })
}

function getUnreadNotificationCount() {
  return callSocialFunction('get_unread_count')
}

function markNotificationRead(input) {
  return write('mark_notification_read', input)
}

function markAllNotificationsRead(input) {
  return write('mark_all_notifications_read', input)
}

function invalidPagination() {
  const error = new Error('invalid pagination')
  error.code = 'INVALID_PAGINATION'
  return error
}

function contentUnavailable() {
  const error = new Error('content unavailable')
  error.code = 'CONTENT_UNAVAILABLE'
  return error
}

function listFeed(input) {
  const source = input || {}
  const cursor = source.cursor === undefined ? '' : source.cursor
  const limit = source.limit === undefined ? 20 : source.limit
  if (typeof cursor !== 'string' || cursor.length > 2048 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    return Promise.reject(invalidPagination())
  }
  return callSocialFunction('list_feed', { cursor, limit })
}

function getHandShare(shareId) {
  if (typeof shareId !== 'string') return Promise.reject(contentUnavailable())
  const value = shareId.trim()
  if (!value || value.length > 128) return Promise.reject(contentUnavailable())
  return callSocialFunction('get_hand_share', { shareId: value })
}

function listComments(input) {
  const source = input || {}
  const cursor = source.cursor === undefined ? '' : source.cursor
  const limit = source.limit === undefined ? 20 : source.limit
  if (typeof cursor !== 'string' || cursor.length > 2048 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    return Promise.reject(invalidPagination())
  }
  return callSocialFunction('list_comments', {
    shareId: String(source.shareId || '').trim(),
    cursor,
    limit
  })
}

function createComment(input) {
  const source = requireMutation(input)
  return callSocialFunction('create_comment', {
    shareId: String(source.shareId || '').trim(),
    parentCommentId: String(source.parentCommentId || '').trim(),
    kind: String(source.kind || '').trim(),
    text: source.text === undefined ? '' : source.text,
    stickerId: source.stickerId === undefined ? '' : source.stickerId,
    clientMutationId: source.clientMutationId
  })
}

function deleteComment(input) {
  const source = requireMutation(input)
  return callSocialFunction('delete_comment', {
    commentId: String(source.commentId || '').trim(),
    clientMutationId: source.clientMutationId
  })
}

function setLike(input) {
  const source = requireMutation(input)
  return callSocialFunction('set_like', {
    shareId: String(source.shareId || '').trim(),
    liked: source.liked,
    clientMutationId: source.clientMutationId
  })
}

function previewHandShare(input) {
  return callSocialFunction('preview_hand_share', { handId: String(input && input.handId || '').trim() })
}

function publishHand(input) {
  const source = requireMutation(input)
  return callSocialFunction('publish_hand', {
    handId: String(source.handId || '').trim(),
    previewHash: String(source.previewHash || '').trim(),
    scope: String(source.scope || '').trim(),
    targetUserIds: Array.isArray(source.targetUserIds) ? source.targetUserIds.slice() : [],
    publicShareConfirmed: source.publicShareConfirmed === true,
    clientMutationId: source.clientMutationId
  })
}

function updateHandShareScope(input) {
  const source = requireMutation(input)
  return callSocialFunction('update_hand_share_scope', {
    shareId: String(source.shareId || '').trim(),
    scope: String(source.scope || '').trim(),
    targetUserIds: Array.isArray(source.targetUserIds) ? source.targetUserIds.slice() : [],
    publicShareConfirmed: source.publicShareConfirmed === true,
    clientMutationId: source.clientMutationId
  })
}

function withdrawHandShare(input) {
  const source = requireMutation(input)
  return callSocialFunction('withdraw_hand_share', {
    shareId: String(source.shareId || '').trim(),
    clientMutationId: source.clientMutationId
  })
}

function withdrawSharesBySourceHand(input) {
  const source = requireMutation(input)
  return callSocialFunction('withdraw_shares_by_source_hand', {
    handId: String(source.handId || '').trim(),
    clientMutationId: source.clientMutationId
  })
}

function clearMySocialData(input) {
  const source = requireMutation(input)
  return callSocialFunction('clear_my_social_data', {
    clientMutationId: source.clientMutationId
  })
}

module.exports = {
  initializeSocialProfile,
  getMySocialProfile,
  createInvite,
  createInviteQr,
  inspectInvite,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  listFriends,
  getFriendDetail,
  listRanking,
  updateSocialSettings,
  sharePlayerCard,
  getPlayerCardShare,
  withdrawPlayerCardShare,
  confirmPlayerCardImport,
  listNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  listFeed,
  getHandShare,
  listComments,
  createComment,
  deleteComment,
  setLike,
  previewHandShare,
  publishHand,
  updateHandShareScope,
  withdrawHandShare,
  withdrawSharesBySourceHand,
  clearMySocialData,
  scheduleMyStatsSync,
  __test: { normalizePlayerId, socialStatsStorageKey }
}
