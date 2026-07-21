const socialService = require('../services/social-service')

const flights = Object.create(null)
const PLACEHOLDER_NICKNAMES = new Set(['', '\u73a9\u5bb6', '\u5fae\u4fe1\u7528\u6237'])

function accountKey(profile) {
  return String(profile && profile.playerId || '').trim().toUpperCase()
}

function isPlaceholderNickname(value) {
  return PLACEHOLDER_NICKNAMES.has(String(value || '').trim())
}

function staleAccountError() {
  const error = new Error('account changed while social profile was syncing')
  error.code = 'STALE_ACCOUNT_CONTEXT'
  return error
}

function assertCurrent(options) {
  if (options && typeof options.isCurrent === 'function' && !options.isCurrent()) throw staleAccountError()
}

function storageKey(prefix, playerId) {
  return prefix + encodeURIComponent(String(playerId || ''))
}

function readStorage(key) {
  try {
    return typeof wx !== 'undefined' && wx.getStorageSync ? wx.getStorageSync(key) : null
  } catch (error) {
    return null
  }
}

function writeStorage(key, value) {
  try {
    if (typeof wx !== 'undefined' && wx.setStorageSync) wx.setStorageSync(key, value)
  } catch (error) {}
}

function removeStorage(key) {
  try {
    if (typeof wx !== 'undefined' && wx.removeStorageSync) wx.removeStorageSync(key)
  } catch (error) {}
}

function profileFingerprint(profile) {
  const source = profile || {}
  return [accountKey(source), String(source.name || '').trim(), String(source.avatarFileId || source.avatarUrl || '').trim()].join('|')
}

function pendingKey(playerId) {
  return storageKey('pokerSocialProfilePending:', playerId)
}

function avatarKey(playerId) {
  return storageKey('pokerSocialProfileAvatar:', playerId)
}

function hasPendingProfile(playerId, fingerprint) {
  const pending = readStorage(pendingKey(playerId))
  return !!(pending && pending.fingerprint === fingerprint)
}

function markPendingProfile(playerId, fingerprint) {
  writeStorage(pendingKey(playerId), { fingerprint, updatedAt: Date.now() })
}

function clearPendingProfile(playerId) {
  removeStorage(pendingKey(playerId))
}

function uploadProfileAvatar(profile, playerId) {
  const source = String(profile && (profile.avatarFileId || profile.avatarUrl) || '').trim()
  if (!source) return Promise.resolve('')
  if (source.startsWith('cloud://')) return Promise.resolve(source)
  const cached = readStorage(avatarKey(playerId))
  if (cached && cached.source === source && String(cached.fileId || '').startsWith('cloud://')) {
    return Promise.resolve(cached.fileId)
  }
  if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
    const error = new Error('social avatar upload unavailable')
    error.code = 'SOCIAL_AVATAR_UPLOAD_UNAVAILABLE'
    return Promise.reject(error)
  }
  const suffixMatch = source.match(/\.([a-zA-Z0-9]{2,5})(?:\?|$)/)
  const suffix = suffixMatch ? suffixMatch[1].toLowerCase() : 'jpg'
  const cloudPath = 'social-profile-avatars/avatar-' + Date.now() + '-' + Math.floor(Math.random() * 1000000) + '.' + suffix
  return wx.cloud.uploadFile({ cloudPath, filePath: source }).then(result => {
    const fileId = String(result && result.fileID || '').trim()
    if (!fileId.startsWith('cloud://')) {
      const error = new Error('social avatar upload failed')
      error.code = 'SOCIAL_AVATAR_UPLOAD_FAILED'
      throw error
    }
    writeStorage(avatarKey(playerId), { source, fileId, updatedAt: Date.now() })
    return fileId
  })
}

async function executeSync(profile, options) {
  const config = options || {}
  const force = !!config.force
  const playerId = accountKey(profile)
  const nickname = String(profile && profile.name || '').trim().slice(0, 24)
  if (!/^WX-[A-Z0-9]+$/.test(playerId) || !nickname) return { skipped: true, socialUserId: '' }
  assertCurrent(config)
  const fingerprint = profileFingerprint(profile)
  let remote = null
  let missing = false
  try {
    remote = await socialService.getMySocialProfile()
  } catch (error) {
    if (error && error.code === 'SOCIAL_PROFILE_REQUIRED') missing = true
    else throw error
  }
  assertCurrent(config)
  const remoteNickname = String(remote && remote.nickname || '').trim()
  // A cache reset recreates the neutral placeholder. It is not an explicit
  // profile edit, so it must never overwrite an initialized cloud identity.
  if (!missing && remote && isPlaceholderNickname(nickname) && !isPlaceholderNickname(remoteNickname)) {
    clearPendingProfile(playerId)
    return remote
  }
  const pending = hasPendingProfile(playerId, fingerprint)
  const localAvatarSource = String(profile && (profile.avatarFileId || profile.avatarUrl) || '').trim()
  const needsAvatarRetry = pending && !!localAvatarSource && !String(remote && remote.avatarUrl || '').trim() && remoteNickname === nickname
  // Normal app startup is a read/restore operation. A nickname difference can
  // come from an older core-profile backup or WeChat-only characters, and must
  // not be treated as an explicit edit. Only a forced save may replace it.
  if (!missing && remote && !force && !needsAvatarRetry) {
    clearPendingProfile(playerId)
    return remote
  }
  const needsWrite = missing || force || needsAvatarRetry
  if (!needsWrite) return remote
  markPendingProfile(playerId, fingerprint)
  let avatarFileId = ''
  let avatarPending = false
  try {
    avatarFileId = await uploadProfileAvatar(profile, playerId)
  } catch (error) {
    // An unavailable local avatar must not block first-time social identity
    // creation. Keep the pending fingerprint so a later sync retries it.
    if (!missing) {
      assertCurrent(config)
      return remote
    }
    avatarPending = true
  }
  assertCurrent(config)
  const saved = await socialService.initializeSocialProfile({
    playerId,
    nickname,
    avatarMode: 'custom',
    avatarFileId,
    statsVisible: remote ? remote.statsVisible !== false : true,
    defaultShareScope: remote && ['square', 'friends', 'selected'].includes(remote.defaultShareScope)
      ? remote.defaultShareScope
      : 'friends'
  })
  assertCurrent(config)
  if (!avatarPending) clearPendingProfile(playerId)
  return saved
}

function syncSocialProfile(profile, options) {
  const playerId = accountKey(profile)
  if (!/^WX-[A-Z0-9]+$/.test(playerId)) return Promise.resolve({ skipped: true, socialUserId: '' })
  const fingerprint = profileFingerprint(profile)
  const force = !!(options && options.force)
  const current = flights[playerId]
  if (current) {
    if (current.fingerprint === fingerprint || !force) return current.promise
    return current.promise.catch(() => null).then(() => syncSocialProfile(profile, options))
  }
  const promise = executeSync(profile, options)
    .catch(error => {
      markPendingProfile(playerId, fingerprint)
      throw error
    })
    .finally(() => {
      if (flights[playerId] && flights[playerId].promise === promise) delete flights[playerId]
    })
  flights[playerId] = { fingerprint, promise }
  return promise
}

module.exports = {
  syncSocialProfile,
  profileFingerprint,
  _resetForTests() {
    Object.keys(flights).forEach(key => delete flights[key])
  }
}
