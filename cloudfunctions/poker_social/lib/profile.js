const crypto = require('crypto')
const { socialError } = require('./social-error')
const { runIdempotent } = require('./idempotency')
const { requireActiveSocialUser } = require('./social-lifecycle')

const PROFILE_COLLECTION = 'social_users'
const OWNER_RESERVATION_COLLECTION = 'social_user_owners'
const SHARE_SCOPES = new Set(['square', 'friends', 'selected'])
const AVATAR_MODES = new Set(['wechat', 'custom'])

function ownerHash(ownerOpenId) {
  return crypto.createHash('sha256').update(String(ownerOpenId || '')).digest('hex')
}

function ownerReservationId(ownerOpenId) {
  return 'suo_' + ownerHash(ownerOpenId)
}

function randomSocialUserId() {
  return 'su_' + crypto.randomBytes(16).toString('hex')
}

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
  const checkProfileText = typeof config.checkProfileText === 'function' ? config.checkProfileText : null

  async function getDto(record) {
    return toProfileDto(record, { avatarUrl: await resolveAvatarUrl(record, config.avatarUrl) })
  }

  return {
    async initialize_social_profile(event, actor) {
      const normalized = normalizeProfileInput(event)
      const existing = await repository.find(PROFILE_COLLECTION, { ownerOpenId: actor.ownerOpenId })
      const now = Date.now()
      if (existing) requireActiveSocialUser(existing)
      const existingNickname = String(existing && existing.profile && existing.profile.nickname || '').trim()
      if (checkProfileText && normalized.profile.nickname !== existingNickname) {
        await checkProfileText({ content: normalized.profile.nickname, openId: String(actor.ownerOpenId || '') })
      }
      const reservationId = ownerReservationId(actor.ownerOpenId)
      const expectedOwnerHash = ownerHash(actor.ownerOpenId)
      const candidateUserId = existing && existing._id || randomSocialUserId()
      const persist = async store => {
        const canPointRead = typeof store.get === 'function'
        const reservation = canPointRead ? await store.get(OWNER_RESERVATION_COLLECTION, reservationId) : null
        if (reservation && (reservation.ownerHash !== expectedOwnerHash || typeof reservation.socialUserId !== 'string' || !reservation.socialUserId)) {
          throw socialError('FORBIDDEN', 'not allowed')
        }
        const id = reservation && reservation.socialUserId || candidateUserId
        const current = canPointRead ? await store.get(PROFILE_COLLECTION, id) : existing
        if (current) requireActiveSocialUser(current)
        if (current && current.ownerOpenId !== actor.ownerOpenId) throw socialError('FORBIDDEN', 'not allowed')
        if (reservation && !current) throw socialError('SOCIAL_PROFILE_REQUIRED', 'social profile required')
        if (current && current.privatePlayerId && normalized.privatePlayerId !== current.privatePlayerId) {
          throw socialError('SOCIAL_PROFILE_PLAYER_MISMATCH', 'social profile player mismatch')
        }
        const mutableProfileFields = current ? {
          privatePlayerId: current.privatePlayerId,
          profile: normalized.profile,
          avatarMode: normalized.avatarMode
        } : normalized
        const record = Object.assign({}, current || {}, mutableProfileFields, {
          _id: id,
          ownerOpenId: actor.ownerOpenId,
          createdAt: current && current.createdAt || now,
          updatedAt: now
        })
        if (canPointRead) {
          await store.set(OWNER_RESERVATION_COLLECTION, reservationId, {
            ownerHash: expectedOwnerHash,
            socialUserId: id,
            createdAt: Number(reservation && reservation.createdAt) || now,
            updatedAt: now
          })
        }
        await store.set(PROFILE_COLLECTION, id, record)
        return record
      }
      let saved
      if (typeof repository.runTransaction === 'function') {
        try {
          saved = await repository.runTransaction(persist)
        } catch (error) {
          if (existing || String(error && error.message || '') !== 'cloud database transactions unavailable') throw error
          saved = await persist(repository)
        }
      } else {
        saved = await persist(repository)
      }
      return getDto(saved)
    },

    async get_my_social_profile(event, actor) {
      const record = await repository.find(PROFILE_COLLECTION, { ownerOpenId: actor.ownerOpenId })
      requireActiveSocialUser(record)
      return getDto(record)
    },

    async update_social_settings(event, actor) {
      const record = await repository.find(PROFILE_COLLECTION, { ownerOpenId: actor.ownerOpenId })
      requireActiveSocialUser(record)
      if (typeof event.statsVisible !== 'boolean' || !SHARE_SCOPES.has(event.defaultShareScope)) {
        throw socialError('INVALID_SOCIAL_SETTINGS', 'invalid social settings')
      }
      return runIdempotent(repository, record._id, 'update_social_settings', event, async store => {
        const current = await store.get(PROFILE_COLLECTION, record._id)
        requireActiveSocialUser(current)
        if (current.ownerOpenId !== actor.ownerOpenId) throw socialError('FORBIDDEN', 'not allowed')
        const updated = Object.assign({}, current, {
          statsVisible: event.statsVisible,
          defaultShareScope: event.defaultShareScope,
          updatedAt: Date.now()
        })
        await store.set(PROFILE_COLLECTION, record._id, updated)
        return {
          statsVisible: updated.statsVisible !== false,
          defaultShareScope: SHARE_SCOPES.has(updated.defaultShareScope) ? updated.defaultShareScope : 'friends'
        }
      })
    }
  }
}

module.exports = {
  PROFILE_COLLECTION,
  OWNER_RESERVATION_COLLECTION,
  ownerReservationId,
  normalizeProfileInput,
  toProfileDto,
  createProfileHandlers
}
