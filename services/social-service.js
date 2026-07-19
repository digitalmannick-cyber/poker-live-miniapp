const { callSocialFunction } = require('./social-api')

function initializeSocialProfile(input) {
  return callSocialFunction('initialize_social_profile', input)
}

function getMySocialProfile() {
  return callSocialFunction('get_my_social_profile')
}

module.exports = { initializeSocialProfile, getMySocialProfile }
