const crypto = require('crypto')
const { socialError } = require('./social-error')
const { deriveInviteToken, buildInviteRecord, getInviteId, assertActiveInvite } = require('./invite')
const { runIdempotent, requireClientMutationId } = require('./idempotency')
const { toProfileDto } = require('./profile')

const USER_COLLECTION = 'social_users'
const FRIENDSHIP_COLLECTION = 'social_friendships'
const INVITE_COLLECTION = 'social_invites'
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

function orderedPair(leftUserId, rightUserId) {
  const pair = [String(leftUserId || ''), String(rightUserId || '')].sort()
  if (!pair[0] || !pair[1] || pair[0] === pair[1]) throw socialError('INVALID_FRIENDSHIP', 'invalid friendship')
  return pair
}

function getPairId(leftUserId, rightUserId) {
  const pair = orderedPair(leftUserId, rightUserId)
  return 'fr_' + crypto.createHash('sha256').update(pair.join(':')).digest('hex')
}

function transition(current, operation, nowMs) {
  const now = Number(nowMs) || Date.now()
  const state = current || { status: 'none' }
  if (operation === 'request') {
    if (Number(state.cooldownUntil) > now) throw socialError('FRIEND_REQUEST_COOLDOWN', 'friend request cooling down')
    return state
  }
  if (operation === 'accept') {
    if (state.status === 'pending') return Object.assign({}, state, { status: 'accepted', acceptedAt: now, updatedAt: now, cooldownUntil: 0 })
    return state
  }
  if (operation === 'reject') {
    if (state.status === 'pending') return Object.assign({}, state, { status: 'rejected', rejectedAt: now, cooldownUntil: now + COOLDOWN_MS, updatedAt: now })
    return state
  }
  if (operation === 'remove') {
    if (state.status === 'accepted') return Object.assign({}, state, { status: 'removed', removedAt: now, cooldownUntil: now + COOLDOWN_MS, updatedAt: now })
    return state
  }
  return state
}

function buildFriendshipRecord(leftUserId, rightUserId, requesterId, nowMs) {
  const now = Number(nowMs) || Date.now()
  const [userA, userB] = orderedPair(leftUserId, rightUserId)
  const requester = String(requesterId || '')
  if (requester !== userA && requester !== userB) throw socialError('INVALID_FRIENDSHIP', 'invalid friendship')
  return {
    _id: getPairId(userA, userB),
    userIds: [userA, userB],
    userA,
    userB,
    requesterId: requester,
    receiverId: requester === userA ? userB : userA,
    status: 'pending',
    acceptedAt: 0,
    rejectedAt: 0,
    removedAt: 0,
    cooldownUntil: 0,
    createdAt: now,
    updatedAt: now
  }
}

async function findActorUser(repository, actor) {
  const user = typeof repository.find === 'function'
    ? await repository.find(USER_COLLECTION, { ownerOpenId: actor.ownerOpenId })
    : repository.where(USER_COLLECTION, row => row.ownerOpenId === actor.ownerOpenId)[0]
  if (!user) throw socialError('SOCIAL_PROFILE_REQUIRED', 'social profile required')
  return user
}

async function publicUserDto(user, avatarUrl) {
  const profile = toProfileDto(user, { avatarUrl: user && user.profile && user.profile.avatarFileId && avatarUrl ? await avatarUrl(user.profile.avatarFileId) : '' })
  return {
    socialUserId: profile.socialUserId,
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl,
    avatarText: profile.avatarText,
    title: profile.title,
    statsVisible: profile.statsVisible
  }
}

function friendshipResult(record) {
  return { friendshipId: record._id, status: record.status, cooldownUntil: Number(record.cooldownUntil) || 0 }
}

function profileSnapshot(user) {
  const profile = user && user.profile || {}
  return {
    nickname: String(profile.nickname || ''),
    avatarFileId: String(profile.avatarFileId || '')
  }
}

async function friendDto(relationship, friendId, friend, avatarUrl) {
  const current = await publicUserDto(friend, avatarUrl)
  const snapshot = relationship && relationship.profileSnapshots && relationship.profileSnapshots[friendId] || {}
  const nickname = String(snapshot.nickname || current.nickname)
  const avatarFileId = String(snapshot.avatarFileId || '')
  return Object.assign({}, current, {
    nickname,
    avatarText: nickname.slice(0, 1),
    avatarUrl: avatarFileId ? await avatarUrl(avatarFileId) : current.avatarUrl
  })
}

function createFriendshipHandlers(repository, options) {
  const config = options || {}
  const now = typeof config.now === 'function' ? config.now : () => Date.now()
  const avatarUrl = typeof config.avatarUrl === 'function' ? config.avatarUrl : async () => ''

  async function getActiveInvite(store, token, at) {
    const invite = await store.get(INVITE_COLLECTION, getInviteId(token))
    return assertActiveInvite(invite, at)
  }

  async function findUserById(store, socialUserId) {
    const user = await store.get(USER_COLLECTION, String(socialUserId || ''))
    if (!user) throw socialError('SOCIAL_USER_NOT_FOUND', 'social user not found')
    return user
  }

  async function createInvite(event, actor, createQr) {
    const actorUser = await findActorUser(repository, actor)
    const action = createQr ? 'create_invite_qr' : 'create_invite'
    const clientMutationId = requireClientMutationId(event)
    const token = deriveInviteToken(config.tokenSecret, actorUser._id, action, clientMutationId)
    const result = await runIdempotent(repository, actorUser._id, action, event, async store => {
      const invite = buildInviteRecord(token, actorUser._id, now())
      await store.set(INVITE_COLLECTION, invite._id, invite)
      return { inviteId: invite._id, expiresAt: invite.expiresAt }
    }, {
      persistResult: value => ({ inviteId: value.inviteId, expiresAt: value.expiresAt }),
      restoreResult: value => ({ inviteId: value.inviteId, expiresAt: value.expiresAt })
    })
    if (!createQr) return { token, expiresAt: result.expiresAt }
      if (!config.qrCode || typeof config.qrCode.getUnlimited !== 'function' || typeof config.uploadTempFile !== 'function') {
        throw socialError('QR_UNAVAILABLE', 'qr unavailable')
      }
      const image = await config.qrCode.getUnlimited({ scene: token, page: 'pages/social-invite/social-invite' })
      const uploaded = await config.uploadTempFile({ cloudPath: 'social-invites/' + result.inviteId + '.png', fileContent: image })
      const qrCodeUrl = String(uploaded && uploaded.url || '')
      if (!qrCodeUrl) throw socialError('QR_UNAVAILABLE', 'qr unavailable')
      return { expiresAt: result.expiresAt, qrCodeUrl }
  }

  return {
    create_invite(event, actor) {
      return createInvite(event, actor, false)
    },

    create_invite_qr(event, actor) {
      return createInvite(event, actor, true)
    },

    async inspect_invite(event) {
      const invite = await getActiveInvite(repository, event && event.token, now())
      const inviter = await findUserById(repository, invite.inviterId)
      return { inviter: await publicUserDto(inviter, avatarUrl), expiresAt: invite.expiresAt }
    },

    async send_friend_request(event, actor) {
      const requester = await findActorUser(repository, actor)
      return runIdempotent(repository, requester._id, 'send_friend_request', event, async store => {
        const at = now()
        const invite = await getActiveInvite(store, event && event.token, at)
        if (invite.inviterId === requester._id) throw socialError('INVALID_FRIENDSHIP', 'invalid friendship')
        const pairId = getPairId(requester._id, invite.inviterId)
        const existing = await store.get(FRIENDSHIP_COLLECTION, pairId)
        transition(existing, 'request', at)
        if (existing && existing.status !== 'rejected' && existing.status !== 'removed') return friendshipResult(existing)
        const record = buildFriendshipRecord(requester._id, invite.inviterId, requester._id, at)
        record.profileSnapshots = {}
        if (existing) {
          record._id = existing._id
          record.userIds = existing.userIds
        }
        await store.set(FRIENDSHIP_COLLECTION, pairId, record)
        await store.set(INVITE_COLLECTION, invite._id, Object.assign({}, invite, { usedCount: (Number(invite.usedCount) || 0) + 1, updatedAt: at }))
        return friendshipResult(record)
      })
    },

    async accept_friend_request(event, actor) {
      const actorUser = await findActorUser(repository, actor)
      return runIdempotent(repository, actorUser._id, 'accept_friend_request', event, async store => {
        const record = await store.get(FRIENDSHIP_COLLECTION, String(event && event.friendshipId || ''))
        if (!record) throw socialError('FRIENDSHIP_NOT_FOUND', 'friendship not found')
        if ((record.userA !== actorUser._id && record.userB !== actorUser._id) || record.receiverId !== actorUser._id) throw socialError('FORBIDDEN', 'not allowed')
        if (record.status !== 'pending' && record.status !== 'accepted') throw socialError('INVALID_FRIENDSHIP_STATE', 'invalid friendship state')
        const next = transition(record, 'accept', now())
        if (next.status === 'accepted' && record.status === 'pending') {
          const userA = await findUserById(store, next.userA)
          const userB = await findUserById(store, next.userB)
          next.profileSnapshots = {
            [next.userA]: profileSnapshot(userA),
            [next.userB]: profileSnapshot(userB)
          }
        }
        if (next !== record) await store.set(FRIENDSHIP_COLLECTION, next._id, next)
        return friendshipResult(next)
      })
    },

    async reject_friend_request(event, actor) {
      const actorUser = await findActorUser(repository, actor)
      return runIdempotent(repository, actorUser._id, 'reject_friend_request', event, async store => {
        const record = await store.get(FRIENDSHIP_COLLECTION, String(event && event.friendshipId || ''))
        if (!record) throw socialError('FRIENDSHIP_NOT_FOUND', 'friendship not found')
        if ((record.userA !== actorUser._id && record.userB !== actorUser._id) || record.receiverId !== actorUser._id) throw socialError('FORBIDDEN', 'not allowed')
        if (record.status !== 'pending' && record.status !== 'rejected') throw socialError('INVALID_FRIENDSHIP_STATE', 'invalid friendship state')
        const next = transition(record, 'reject', now())
        if (next !== record) await store.set(FRIENDSHIP_COLLECTION, next._id, next)
        return friendshipResult(next)
      })
    },

    async remove_friend(event, actor) {
      const actorUser = await findActorUser(repository, actor)
      return runIdempotent(repository, actorUser._id, 'remove_friend', event, async store => {
        const record = await store.get(FRIENDSHIP_COLLECTION, String(event && event.friendshipId || ''))
        if (!record) throw socialError('FRIENDSHIP_NOT_FOUND', 'friendship not found')
        if (record.userA !== actorUser._id && record.userB !== actorUser._id) throw socialError('FORBIDDEN', 'not allowed')
        if (record.status !== 'accepted' && record.status !== 'removed') throw socialError('INVALID_FRIENDSHIP_STATE', 'invalid friendship state')
        const next = transition(record, 'remove', now())
        if (next !== record) await store.set(FRIENDSHIP_COLLECTION, next._id, next)
        return friendshipResult(next)
      })
    },

    async list_friends(event, actor) {
      const actorUser = await findActorUser(repository, actor)
      const offset = Math.max(0, Number(event && event.offset) || 0)
      const limit = Math.min(50, Math.max(1, Number(event && event.limit) || 20))
      const page = typeof repository.listAcceptedFriendships === 'function'
        ? await repository.listAcceptedFriendships(actorUser._id, { offset, limit })
        : (() => {
            const all = repository.where(FRIENDSHIP_COLLECTION, row => row.status === 'accepted' && (row.userA === actorUser._id || row.userB === actorUser._id))
            return { items: all.slice(offset, offset + limit), nextOffset: all.length > offset + limit ? offset + limit : null }
          })()
      const items = []
      for (const relationship of page.items) {
        const friendId = relationship.userA === actorUser._id ? relationship.userB : relationship.userA
        const friend = await findUserById(repository, friendId)
        const dto = await friendDto(relationship, friendId, friend, avatarUrl)
        items.push(Object.assign({ friendshipId: relationship._id }, dto))
      }
      return { items, nextOffset: page.nextOffset }
    }
  }
}

module.exports = { COOLDOWN_MS, getPairId, transition, buildFriendshipRecord, createFriendshipHandlers }
