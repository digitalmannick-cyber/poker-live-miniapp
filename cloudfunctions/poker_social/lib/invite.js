const crypto = require('crypto')
const { socialError } = require('./social-error')

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function createInviteToken() {
  return crypto.randomBytes(16).toString('base64url')
}

function digestToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

function buildInviteRecord(token, inviterId, nowMs) {
  const createdAt = Number(nowMs) || Date.now()
  return {
    _id: digestToken(token),
    inviterId: String(inviterId || ''),
    purpose: 'friend',
    expiresAt: createdAt + INVITE_TTL_MS,
    revokedAt: 0,
    usedCount: 0,
    createdAt,
    updatedAt: createdAt
  }
}

function getInviteId(token) {
  const value = String(token || '').trim()
  if (!/^[A-Za-z0-9_-]{22}$/.test(value)) throw socialError('INVALID_INVITE', 'invalid invite')
  return digestToken(value)
}

function assertActiveInvite(record, nowMs) {
  if (!record || record.revokedAt || Number(record.expiresAt) <= nowMs) {
    throw socialError('INVITE_UNAVAILABLE', 'invite unavailable')
  }
  return record
}

module.exports = { INVITE_TTL_MS, createInviteToken, digestToken, buildInviteRecord, getInviteId, assertActiveInvite }
