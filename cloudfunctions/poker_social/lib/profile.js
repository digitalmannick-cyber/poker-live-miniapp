const crypto = require('crypto')
const { socialError } = require('./social-error')
const { runIdempotent } = require('./idempotency')

const PROFILE_COLLECTION = 'social_users'
const SHARE_SCOPES = new Set(['square', 'friends', 'selected'])
const AVATAR_MODES = new Set(['wechat', 'custom'])

function normalizeProfileInput(input) {
  const source = input || {}
  const nickname = String(source.nickname || '').trim().slice(0, 24)
  const avatarMode = String(source.avatarMode || '').trim()
  if (!nickname || !AVATAR_MODES.has(avatarMode)) {
    throw socialError('INVALID_PROFILE', 'invalid social profile')
  }

  return {
    privatePlayerId: String(source.playerId || '').trim().toUpperCase(),
    profile: {
      nickname,
      avatarFileId: String(source.avatarFileId || '').trim(),
      avatarText: nickname.slice(0, 1)
    },
    avatarMode,
    statsVisible: source.statsVisible !== false,
    defaultShareScope: SHARE_SCOPES.has(source.defaultShareScope) ? source.defaultShareScope : 'friends'
  }
}

function toProfileDto(record, options) {
  const source = record || {}
  const profile = source.profile || {}
  const config = options || {}
  const nickname = String(profile.nickname || '')
  return {
    socialUserId: String(source._id || ''),
    nickname,
    avatarUrl: config.avatarUrl || '',
    avatarText: String(profile.avatarText || nickname.slice(0, 1)),
    title: String(source.title || '初来乍到'),
    statsVisible: source.statsVisible !== false,
    defaultShareScope: SHARE_SCOPES.has(source.defaultShareScope) ? source.defaultShareScope : 'friends'
  }
}

async function resolveAvatarUrl(record, avatarUrl) {
  const fileId = record && record.profile && record.profile.avatarFileId
  return fileId && typeof avatarUrl === 'function' ? avatarUrl(fileId) : ''
}

function createProfileHandlers(repository, options) {
  const config = options || {}

  async function getDto(record) {
    return toProfileDto(record, { avatarUrl: await resolveAvatarUrl(record, config.avatarUrl) })
  }

  return {
    async initialize_social_profile(event, actor) {
      const normalized = normalizeProfileInput(event)
      const existing = await repository.find(PROFILE_COLLECTION, { ownerOpenId: actor.ownerOpenId })
      const now = Date.now()
      const record = Object.assign({}, normalized, {
        _id: existing ? existing._id : 'su_' + crypto.randomBytes(16).toString('hex'),
        ownerOpenId: actor.ownerOpenId,
        createdAt: existing && existing.createdAt || now,
        updatedAt: now
      })
      const saved = await repository.set(PROFILE_COLLECTION, record._id, record)
      return getDto(saved)
    },

    async get_my_social_profile(event, actor) {
      const record = await repository.find(PROFILE_COLLECTION, { ownerOpenId: actor.ownerOpenId })
      if (!record) throw socialError('SOCIAL_PROFILE_REQUIRED', 'social profile required')
      return getDto(record)
    },

    async update_social_settings(event, actor) {
      const record = await repository.find(PROFILE_COLLECTION, { ownerOpenId: actor.ownerOpenId })
      if (!record) throw socialError('SOCIAL_PROFILE_REQUIRED', 'social profile required')
      if (typeof event.statsVisible !== 'boolean' || !SHARE_SCOPES.has(event.defaultShareScope)) {
        throw socialError('INVALID_SOCIAL_SETTINGS', 'invalid social settings')
      }
      return runIdempotent(repository, record._id, 'update_social_settings', event, async store => {
        if (typeof store.patchSocialSettings !== 'function') throw new Error('social repository settings support unavailable')
        const updated = await store.patchSocialSettings(record._id, {
          statsVisible: event.statsVisible,
          defaultShareScope: event.defaultShareScope,
          updatedAt: Date.now()
        })
        return {
          statsVisible: updated.statsVisible !== false,
          defaultShareScope: SHARE_SCOPES.has(updated.defaultShareScope) ? updated.defaultShareScope : 'friends'
        }
      })
    }
  }
}

module.exports = { PROFILE_COLLECTION, normalizeProfileInput, toProfileDto, createProfileHandlers }
