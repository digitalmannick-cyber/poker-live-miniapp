const appVersion = require('../config/app-version')
const releaseNotesConfig = require('../config/release-notes')

const ACK_PREFIX = 'releaseNotesAck'

function normalizePlayerId(playerId) {
  return String(playerId || '').trim().toUpperCase()
}

function validateReleaseNotes(notes, expectedVersion) {
  const source = notes || {}
  const version = String(source.version || '').trim()
  const items = Array.isArray(source.items) ? source.items.filter(item => item && String(item.title || '').trim()) : []
  if (!version || version !== String(expectedVersion || '').trim()) {
    return { ok: false, reason: 'VERSION_MISMATCH' }
  }
  if (!String(source.title || '').trim() || !items.length) {
    return { ok: false, reason: 'CONTENT_MISSING' }
  }
  return { ok: true, reason: '' }
}

function getCurrentReleaseNotes() {
  return validateReleaseNotes(releaseNotesConfig, appVersion.displayVersion).ok
    ? releaseNotesConfig
    : null
}

function getAckKey(playerId, version) {
  return [ACK_PREFIX, normalizePlayerId(playerId), String(version || '').trim()].join(':')
}

function shouldShowReleaseNotes(context) {
  const source = context || {}
  const playerId = normalizePlayerId(source.playerId)
  const notes = getCurrentReleaseNotes()
  if (!notes || !playerId || source.accountLoggedOut) return false
  if (source.manual) return true
  try {
    return wx.getStorageSync(getAckKey(playerId, notes.version)) !== true
  } catch (error) {
    return true
  }
}

function acknowledgeReleaseNotes(context) {
  const source = context || {}
  const playerId = normalizePlayerId(source.playerId)
  const notes = getCurrentReleaseNotes()
  if (!notes || !playerId || source.accountLoggedOut) {
    return { ok: false, error: new Error('Release notes acknowledgement requires a logged-in account') }
  }
  try {
    wx.setStorageSync(getAckKey(playerId, notes.version), true)
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

module.exports = {
  ACK_PREFIX,
  validateReleaseNotes,
  getCurrentReleaseNotes,
  getAckKey,
  shouldShowReleaseNotes,
  acknowledgeReleaseNotes
}
