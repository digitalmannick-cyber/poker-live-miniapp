const { callSocialFunction } = require('./social-api')

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
function listFriends(input) { return callSocialFunction('list_friends', input) }

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
  listFriends
}
