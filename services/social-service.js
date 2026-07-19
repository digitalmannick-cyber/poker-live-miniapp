const { callSocialFunction } = require('./social-api')

const SOCIAL_STATS_SYNC_INTERVAL_MS = 5 * 60 * 1000
const socialStatsSyncPromises = Object.create(null)

function normalizePlayerId(value) {
  return String(value || '').trim().toUpperCase()
}

function socialStatsStorageKey(playerId) {
  return 'pokerSocialStatsSyncedAt_' + String(playerId || '').replace(/[^0-9A-Z_]/g, '_')
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
  const value = String(input && input.clientMutationId || '').trim()
  if (!value) {
    const error = new Error('client mutation id required')
    error.code = 'INVALID_MUTATION'
    throw error
  }
  return input
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
  scheduleMyStatsSync,
  __test: { normalizePlayerId, socialStatsStorageKey }
}
