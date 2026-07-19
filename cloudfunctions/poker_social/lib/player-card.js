const crypto = require('crypto')
const { socialError } = require('./social-error')
const { runIdempotent, requireClientMutationId } = require('./idempotency')
const { requireAcceptedFriendship, isReadableCardShare } = require('./visibility')

const USER_COLLECTION = 'social_users'
const PLAYER_NOTE_COLLECTION = 'player_notes'
const CARD_SHARE_COLLECTION = 'social_player_card_shares'
const CARD_SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function normalizeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength)
}

function normalizeStringList(value) {
  const seen = new Set()
  const result = []
  for (const item of Array.isArray(value) ? value : []) {
    const normalized = normalizeText(item, 40)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
    if (result.length >= 20) break
  }
  return result
}

function normalizeAvatarAsset(value) {
  const asset = normalizeText(value, 2048)
  if (asset.startsWith('cloud://')) return asset
  try {
    const parsed = new URL(asset)
    return parsed.protocol === 'https:' ? parsed.toString() : ''
  } catch (error) {
    return ''
  }
}

function buildSnapshot(note) {
  const source = note || {}
  return {
    avatarAsset: normalizeAvatarAsset(source.avatarFileId || source.avatarUrl),
    name: normalizeText(source.name, 40),
    type: normalizeText(source.type || '未分类', 24) || '未分类',
    leakTags: normalizeStringList(source.leakTags),
    note: normalizeText(source.note, 5000)
  }
}

function validateTarget(value) {
  const targetUserId = normalizeText(value, 128)
  if (!targetUserId) throw socialError('INVALID_CARD_TARGET', 'invalid card target')
  return targetUserId
}

function validateTargets(value) {
  if (!Array.isArray(value) || value.length !== 1) throw socialError('INVALID_CARD_TARGET', 'invalid card target')
  return validateTarget(value[0])
}

function safeHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || ''))
    return parsed.protocol === 'https:' ? parsed.toString() : ''
  } catch (error) {
    return ''
  }
}

async function resolveAvatarAsset(asset, avatarUrl) {
  const normalized = normalizeAvatarAsset(asset)
  if (normalized.startsWith('https://')) return normalized
  if (!normalized.startsWith('cloud://') || typeof avatarUrl !== 'function') return ''
  return safeHttpsUrl(await avatarUrl(normalized))
}

async function toCardShareDto(share, options) {
  const source = share || {}
  const config = options || {}
  const snapshot = source.snapshot || {}
  const sender = source.sender || source.senderSnapshot || config.sender || {}
  return {
    shareId: String(source._id || source.shareId || ''),
    sender: {
      socialUserId: String(sender.socialUserId || source.senderUserId || ''),
      nickname: normalizeText(sender.nickname, 24),
      avatarUrl: await resolveAvatarAsset(sender.avatarAsset || sender.avatarFileId || sender.avatarUrl, config.avatarUrl),
      avatarText: normalizeText(sender.avatarText || String(sender.nickname || '').slice(0, 1), 2)
    },
    card: {
      avatarUrl: await resolveAvatarAsset(snapshot.avatarAsset, config.avatarUrl),
      name: normalizeText(snapshot.name, 40),
      type: normalizeText(snapshot.type || '未分类', 24) || '未分类',
      leakTags: normalizeStringList(snapshot.leakTags),
      note: normalizeText(snapshot.note, 5000)
    },
    expiresAt: Number(source.expiresAt) || 0,
    imported: !!source.importedAt
  }
}

async function findActorUser(repository, actor) {
  const user = await repository.find(USER_COLLECTION, { ownerOpenId: actor && actor.ownerOpenId })
  if (!user) throw socialError('SOCIAL_PROFILE_REQUIRED', 'social profile required')
  return user
}

async function getShareForParticipant(repository, shareId, actorUser, role) {
  const share = await repository.get(CARD_SHARE_COLLECTION, normalizeText(shareId, 128))
  const expected = role === 'sender' ? share && share.senderUserId : share && share.targetUserId
  if (!share || expected !== actorUser._id) throw socialError('FORBIDDEN', 'not allowed')
  return share
}

async function requireReadableShare(repository, share, actorUser, nowMs) {
  if (!isReadableCardShare(share, actorUser._id, nowMs)) throw socialError('PLAYER_CARD_UNAVAILABLE', 'player card unavailable')
  await requireAcceptedFriendship(repository, share.senderUserId, share.targetUserId)
  return share
}

function createPlayerCardHandlers(repository, options) {
  const config = options || {}
  const now = typeof config.now === 'function' ? config.now : () => Date.now()
  const avatarUrl = typeof config.avatarUrl === 'function' ? config.avatarUrl : async () => ''

  async function dto(share) {
    return toCardShareDto(share, { avatarUrl })
  }

  return {
    async share_player_card(event, actor) {
      requireClientMutationId(event)
      const sender = await findActorUser(repository, actor)
      const targetUserId = validateTarget(event && event.targetUserId)
      if (targetUserId === sender._id) throw socialError('INVALID_CARD_TARGET', 'invalid card target')
      await requireAcceptedFriendship(repository, sender._id, targetUserId)
      const playerNoteId = normalizeText(event && event.playerNoteId, 128)
      if (!playerNoteId) throw socialError('PLAYER_CARD_SOURCE_NOT_FOUND', 'player card source not found')

      const result = await runIdempotent(repository, sender._id, 'share_player_card', event, async store => {
        await requireAcceptedFriendship(store, sender._id, targetUserId)
        const source = await store.find(PLAYER_NOTE_COLLECTION, {
          _id: playerNoteId,
          ownerOpenId: actor.ownerOpenId,
          playerId: sender.privatePlayerId,
          sourceKind: 'library',
          archived: false
        })
        if (!source) throw socialError('PLAYER_CARD_SOURCE_NOT_FOUND', 'player card source not found')
        const at = now()
        const share = {
          _id: 'pcs_' + crypto.randomBytes(16).toString('hex'),
          senderUserId: sender._id,
          targetUserId,
          senderSnapshot: {
            socialUserId: sender._id,
            nickname: normalizeText(sender.profile && sender.profile.nickname, 24),
            avatarAsset: normalizeAvatarAsset(sender.profile && sender.profile.avatarFileId),
            avatarText: normalizeText(sender.profile && (sender.profile.avatarText || sender.profile.nickname && sender.profile.nickname.slice(0, 1)), 2)
          },
          snapshot: buildSnapshot(source),
          status: 'active',
          createdAt: at,
          expiresAt: at + CARD_SHARE_TTL_MS,
          importedAt: 0,
          withdrawnAt: 0
        }
        await store.set(CARD_SHARE_COLLECTION, share._id, share)
        return share
      }, {
        persistResult: share => ({ shareId: share._id }),
        restoreResult: async stored => {
          const share = await repository.get(CARD_SHARE_COLLECTION, stored && stored.shareId)
          if (!share || share.senderUserId !== sender._id) throw socialError('PLAYER_CARD_UNAVAILABLE', 'player card unavailable')
          return share
        }
      })
      return dto(result)
    },

    async get_player_card_share(event, actor) {
      const receiver = await findActorUser(repository, actor)
      const share = await getShareForParticipant(repository, event && event.shareId, receiver, 'target')
      await requireReadableShare(repository, share, receiver, now())
      return dto(share)
    },

    async withdraw_player_card_share(event, actor) {
      requireClientMutationId(event)
      const sender = await findActorUser(repository, actor)
      const shareId = normalizeText(event && event.shareId, 128)
      await getShareForParticipant(repository, shareId, sender, 'sender')
      return runIdempotent(repository, sender._id, 'withdraw_player_card_share', event, async store => {
        const share = await getShareForParticipant(store, shareId, sender, 'sender')
        if (share.status !== 'active') return { shareId: share._id, withdrawn: true }
        const next = Object.assign({}, share, { status: 'withdrawn', withdrawnAt: now() })
        await store.set(CARD_SHARE_COLLECTION, share._id, next)
        return { shareId: share._id, withdrawn: true }
      })
    },

    async confirm_player_card_import(event, actor) {
      requireClientMutationId(event)
      const receiver = await findActorUser(repository, actor)
      const shareId = normalizeText(event && event.shareId, 128)
      const current = await getShareForParticipant(repository, shareId, receiver, 'target')
      await requireReadableShare(repository, current, receiver, now())
      return runIdempotent(repository, receiver._id, 'confirm_player_card_import', event, async store => {
        const share = await getShareForParticipant(store, shareId, receiver, 'target')
        await requireReadableShare(store, share, receiver, now())
        if (!share.importedAt) {
          const next = Object.assign({}, share, { importedAt: now() })
          await store.set(CARD_SHARE_COLLECTION, share._id, next)
        }
        return { shareId: share._id, imported: true }
      })
    }
  }
}

module.exports = {
  CARD_SHARE_COLLECTION,
  CARD_SHARE_TTL_MS,
  normalizeStringList,
  buildSnapshot,
  validateTarget,
  validateTargets,
  toCardShareDto,
  createPlayerCardHandlers
}
