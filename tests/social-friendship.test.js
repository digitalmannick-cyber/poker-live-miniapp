const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')

const { createMemorySocialRepository } = require('./helpers/social-fixture')

test('friend pair is canonical and rejected pairs cool down for seven days', () => {
  const friendship = require('../cloudfunctions/poker_social/lib/friendship')
  assert.equal(friendship.getPairId('su_b', 'su_a'), friendship.getPairId('su_a', 'su_b'))
  const rejected = friendship.transition({ status: 'pending' }, 'reject', 1_000)
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.cooldownUntil, 1_000 + 7 * 24 * 60 * 60 * 1000)
  assert.throws(() => friendship.transition(rejected, 'request', 2_000), error => error.code === 'FRIEND_REQUEST_COOLDOWN')
})

test('invite tokens have 22 characters, store only their sha256 digest, and expire after seven days', () => {
  const invite = require('../cloudfunctions/poker_social/lib/invite')
  const token = invite.deriveInviteToken('12345678901234567890123456789012', 'su_owner', 'create_invite', 'mutation-1')
  const record = invite.buildInviteRecord(token, 'su_owner', 1_000)

  assert.match(token, /^[A-Za-z0-9_-]{22}$/)
  assert.equal(record._id, invite.digestToken(token))
  assert.equal(record._id, crypto.createHash('sha256').update(token).digest('hex'))
  assert.equal(Object.values(record).includes(token), false)
  assert.equal(record.expiresAt, 1_000 + 7 * 24 * 60 * 60 * 1000)
})

test('invite inspection and forwarded token do not create a friendship', async () => {
  const { createFriendshipHandlers } = require('../cloudfunctions/poker_social/lib/friendship')
  const repository = createMemorySocialRepository({
    social_users: [
      { _id: 'su_a', ownerOpenId: 'openid-a', profile: { nickname: 'A' } },
      { _id: 'su_b', ownerOpenId: 'openid-b', profile: { nickname: 'B' } }
    ]
  })
  const handlers = createFriendshipHandlers(repository, { now: () => 1_000, tokenSecret: '12345678901234567890123456789012' })
  const owner = { ownerOpenId: 'openid-a' }
  const viewer = { ownerOpenId: 'openid-b' }
  const invite = await handlers.create_invite({ clientMutationId: 'create-1' }, owner)
  const inspected = await handlers.inspect_invite({ token: invite.token }, viewer)

  assert.equal(inspected.inviter.socialUserId, 'su_a')
  assert.equal(inspected.requesterProfileReady, true)
  assert.deepEqual(repository.where('social_friendships', () => true), [])
  assert.equal(repository.where('social_invites', () => true).length, 1)
})

test('crossed requests merge into one pending pair and writes are idempotent', async () => {
  const { createFriendshipHandlers } = require('../cloudfunctions/poker_social/lib/friendship')
  const repository = createMemorySocialRepository({
    social_users: [
      { _id: 'su_a', ownerOpenId: 'openid-a', profile: { nickname: 'A' } },
      { _id: 'su_b', ownerOpenId: 'openid-b', profile: { nickname: 'B' } }
    ]
  })
  const handlers = createFriendshipHandlers(repository, { now: () => 1_000, tokenSecret: '12345678901234567890123456789012' })
  const a = { ownerOpenId: 'openid-a' }
  const b = { ownerOpenId: 'openid-b' }
  const invite = await handlers.create_invite({ clientMutationId: 'invite-a' }, a)
  const reverseInvite = await handlers.create_invite({ clientMutationId: 'invite-b' }, b)

  const first = await handlers.send_friend_request({ token: invite.token, clientMutationId: 'request-b' }, b)
  const retry = await handlers.send_friend_request({ token: invite.token, clientMutationId: 'request-b' }, b)
  const crossed = await handlers.send_friend_request({ token: reverseInvite.token, clientMutationId: 'request-a' }, a)

  assert.deepEqual(retry, first)
  assert.equal(first.status, 'pending')
  assert.equal(crossed.status, 'pending')
  const pairs = repository.where('social_friendships', () => true)
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].requesterId, 'su_b')
  assert.equal(pairs[0].receiverId, 'su_a')
  assert.deepEqual(pairs[0].profileSnapshots, {})
})

test('only receiver can accept, accept is repeatable, reject/remove apply cooldown, and friend list uses public DTOs', async () => {
  let now = 1_000
  const { createFriendshipHandlers } = require('../cloudfunctions/poker_social/lib/friendship')
  const repository = createMemorySocialRepository({
    social_users: [
      { _id: 'su_a', ownerOpenId: 'openid-a', privatePlayerId: 'A', profile: { nickname: 'A', avatarFileId: 'private-a' } },
      { _id: 'su_b', ownerOpenId: 'openid-b', privatePlayerId: 'B', profile: { nickname: 'B', avatarFileId: 'private-b' } }
    ]
  })
  const handlers = createFriendshipHandlers(repository, { now: () => now, tokenSecret: '12345678901234567890123456789012', avatarUrl: async id => 'https://temp/' + id })
  const a = { ownerOpenId: 'openid-a' }
  const b = { ownerOpenId: 'openid-b' }
  const invite = await handlers.create_invite({ clientMutationId: 'invite-a' }, a)
  const pending = await handlers.send_friend_request({ token: invite.token, clientMutationId: 'request-b' }, b)

  await assert.rejects(
    handlers.accept_friend_request({ friendshipId: pending.friendshipId, clientMutationId: 'accept-b' }, b),
    error => error.code === 'FORBIDDEN'
  )
  const accepted = await handlers.accept_friend_request({ friendshipId: pending.friendshipId, clientMutationId: 'accept-a' }, a)
  const acceptedAgain = await handlers.accept_friend_request({ friendshipId: pending.friendshipId, clientMutationId: 'accept-a-again' }, a)
  assert.equal(accepted.status, 'accepted')
  assert.deepEqual(acceptedAgain, accepted)

  const listed = await handlers.list_friends({ limit: 10 }, a)
  assert.deepEqual(listed.items, [{
    friendshipId: pending.friendshipId,
    socialUserId: 'su_b',
    nickname: 'B',
    avatarUrl: 'https://temp/private-b',
    avatarText: 'B',
    title: '初来乍到',
    statsVisible: true
  }])
  assert.doesNotMatch(JSON.stringify(listed), /ownerOpenId|privatePlayerId|avatarFileId/)

  now += 1
  const removed = await handlers.remove_friend({ friendshipId: pending.friendshipId, clientMutationId: 'remove-a' }, a)
  assert.equal(removed.status, 'removed')
  const retryInvite = await handlers.create_invite({ clientMutationId: 'invite-b-2' }, b)
  await assert.rejects(
    handlers.send_friend_request({ token: retryInvite.token, clientMutationId: 'cooldown-a' }, a),
    error => error.code === 'FRIEND_REQUEST_COOLDOWN'
  )
})

test('receiver can reject once, repeat rejection is idempotent, and the pair enters cooldown', async () => {
  const repository = createMemorySocialRepository({
    social_users: [
      { _id: 'su_a', ownerOpenId: 'openid-a', profile: { nickname: 'A' } },
      { _id: 'su_b', ownerOpenId: 'openid-b', profile: { nickname: 'B' } }
    ]
  })
  const { createFriendshipHandlers } = require('../cloudfunctions/poker_social/lib/friendship')
  const handlers = createFriendshipHandlers(repository, { now: () => 1_000, tokenSecret: '12345678901234567890123456789012' })
  const a = { ownerOpenId: 'openid-a' }
  const b = { ownerOpenId: 'openid-b' }
  const invite = await handlers.create_invite({ clientMutationId: 'reject-invite' }, a)
  const pending = await handlers.send_friend_request({ token: invite.token, clientMutationId: 'reject-request' }, b)

  const rejected = await handlers.reject_friend_request({ friendshipId: pending.friendshipId, clientMutationId: 'reject-a' }, a)
  const repeated = await handlers.reject_friend_request({ friendshipId: pending.friendshipId, clientMutationId: 'reject-a-again' }, a)

  assert.equal(rejected.status, 'rejected')
  assert.deepEqual(repeated, rejected)
  assert.equal(rejected.cooldownUntil, 1_000 + 7 * 24 * 60 * 60 * 1000)
})

test('repository paginates accepted friendships with directed userA/userB queries', async () => {
  const calls = []
  const { createCloudSocialRepository } = require('../cloudfunctions/poker_social/lib/repository')
  const database = {
    collection(name) {
      return {
        where(query) {
          calls.push({ name, query })
          return {
            skip() { return this },
            limit() { return this },
            async get() { return { data: [] } }
          }
        }
      }
    }
  }
  const repository = createCloudSocialRepository(database)
  const result = await repository.listAcceptedFriendships('su_me', { offset: 0, limit: 10 })

  assert.deepEqual(result, { items: [], nextOffset: null })
  assert.deepEqual(calls, [
    { name: 'social_friendships', query: { userA: 'su_me', status: 'accepted' } },
    { name: 'social_friendships', query: { userB: 'su_me', status: 'accepted' } }
  ])
})

test('create invite QR encodes the existing share token and persists no plaintext token', async () => {
  const { createFriendshipHandlers } = require('../cloudfunctions/poker_social/lib/friendship')
  const { getInviteId } = require('../cloudfunctions/poker_social/lib/invite')
  const repository = createMemorySocialRepository({
    social_users: [
      { _id: 'su_a', ownerOpenId: 'openid-a', profile: { nickname: 'A' } },
      { _id: 'su_b', ownerOpenId: 'openid-b', profile: { nickname: 'B' } }
    ]
  })
  const calls = []
  const uploads = []
  const handlers = createFriendshipHandlers(repository, {
    now: () => 1_000,
    tokenSecret: '12345678901234567890123456789012',
    qrCode: { getUnlimited: async input => { calls.push(input); return Buffer.from('png') } },
    uploadTempFile: async payload => { uploads.push(payload); return { url: 'https://temp/qrcode.png' } }
  })

  const share = await handlers.create_invite({ clientMutationId: 'share-1' }, { ownerOpenId: 'openid-a' })
  const result = await handlers.create_invite_qr({ token: share.token, clientMutationId: 'qr-1' }, { ownerOpenId: 'openid-a' })
  const retried = await handlers.create_invite_qr({ token: share.token, clientMutationId: 'qr-1' }, { ownerOpenId: 'openid-a' })
  assert.equal(result.qrCodeUrl, 'https://temp/qrcode.png')
  assert.equal(result.expiresAt, share.expiresAt)
  assert.deepEqual(retried, result)
  assert.equal(calls[0].scene, share.token)
  assert.equal(calls[1].scene, share.token)
  assert.equal(calls[0].page, 'pages/social-invite/social-invite')
  assert.equal(calls[0].checkPath, false)
  assert.equal(calls[0].envVersion, 'trial')
  assert.equal(uploads[0].cloudPath, uploads[1].cloudPath)
  const mutation = repository.where('social_mutations', row => row.action === 'create_invite_qr')[0]
  assert.deepEqual(mutation.result, { inviteId: getInviteId(share.token), expiresAt: share.expiresAt })
  assert.equal(JSON.stringify(repository.dump()).includes(share.token), false)
  await assert.rejects(
    handlers.create_invite_qr({ token: share.token, clientMutationId: 'qr-other' }, { ownerOpenId: 'openid-b' }),
    error => error.code === 'FORBIDDEN'
  )
  await assert.rejects(
    handlers.create_invite_qr({ token: 'not-a-real-token', clientMutationId: 'qr-missing' }, { ownerOpenId: 'openid-a' }),
    error => error.code === 'INVITE_UNAVAILABLE'
  )
  const differentShare = await handlers.create_invite({ clientMutationId: 'share-2' }, { ownerOpenId: 'openid-a' })
  await assert.rejects(
    handlers.create_invite_qr({ token: differentShare.token, clientMutationId: 'qr-1' }, { ownerOpenId: 'openid-a' }),
    error => error.code === 'MUTATION_CONFLICT'
  )
  assert.doesNotMatch(JSON.stringify(result), /ownerOpenId|avatarFileId|digest/)
})

test('invite inspection tells a first-time visitor to initialize a profile without creating friendship state', async () => {
  const { createFriendshipHandlers } = require('../cloudfunctions/poker_social/lib/friendship')
  const repository = createMemorySocialRepository({
    social_users: [{ _id: 'su_a', ownerOpenId: 'openid-a', profile: { nickname: 'A' } }]
  })
  const handlers = createFriendshipHandlers(repository, {
    now: () => 1_000,
    tokenSecret: '12345678901234567890123456789012'
  })
  const invite = await handlers.create_invite({ clientMutationId: 'first-time-invite' }, { ownerOpenId: 'openid-a' })
  const inspected = await handlers.inspect_invite({ token: invite.token }, { ownerOpenId: 'openid-new' })

  assert.equal(inspected.requesterProfileReady, false)
  assert.deepEqual(repository.where('social_friendships', () => true), [])
})

test('nickname search returns public matches and direct add creates the same pending notification flow', async () => {
  const { createFriendshipHandlers } = require('../cloudfunctions/poker_social/lib/friendship')
  const repository = createMemorySocialRepository({
    social_users: [
      { _id: 'su_a', ownerOpenId: 'openid-a', profile: { nickname: '搜索者' } },
      { _id: 'su_b', ownerOpenId: 'openid-b', profile: { nickname: '银狼玩家', avatarFileId: 'avatar-b' }, title: '牌桌常客' },
      { _id: 'su_c', ownerOpenId: 'openid-c', profile: { nickname: '其他玩家' } }
    ]
  })
  const handlers = createFriendshipHandlers(repository, { now: () => 2_000, avatarUrl: async id => 'https://temp/' + id })
  const search = await handlers.search_social_users({ keyword: '银狼' }, { ownerOpenId: 'openid-a' })
  assert.deepEqual(search.items, [{
    socialUserId: 'su_b', nickname: '银狼玩家', avatarUrl: 'https://temp/avatar-b', avatarText: '银', title: '牌桌常客',
    relationshipStatus: 'none', canRequest: true
  }])
  assert.doesNotMatch(JSON.stringify(search), /ownerOpenId|avatarFileId|privatePlayerId/)

  const requested = await handlers.send_friend_request_by_user({ targetUserId: 'su_b', clientMutationId: 'search-add-1' }, { ownerOpenId: 'openid-a' })
  assert.equal(requested.status, 'pending')
  const notification = repository.where('social_notifications', row => row.kind === 'friend_request')[0]
  assert.equal(notification.recipientId, 'su_b')
  assert.equal(notification.actorSnapshot.socialUserId, 'su_a')
  const after = await handlers.search_social_users({ keyword: '银狼' }, { ownerOpenId: 'openid-a' })
  assert.equal(after.items[0].relationshipStatus, 'pending')
  assert.equal(after.items[0].canRequest, false)
})

test('nickname search requires two characters and direct add rejects self', async () => {
  const { createFriendshipHandlers } = require('../cloudfunctions/poker_social/lib/friendship')
  const repository = createMemorySocialRepository({ social_users: [{ _id: 'su_a', ownerOpenId: 'openid-a', profile: { nickname: '玩家甲' } }] })
  const handlers = createFriendshipHandlers(repository, { now: () => 2_000 })
  await assert.rejects(handlers.search_social_users({ keyword: '甲' }, { ownerOpenId: 'openid-a' }), error => error.code === 'INVALID_USER_SEARCH')
  await assert.rejects(
    handlers.send_friend_request_by_user({ targetUserId: 'su_a', clientMutationId: 'self-add' }, { ownerOpenId: 'openid-a' }),
    error => error.code === 'INVALID_FRIENDSHIP'
  )
})

test('social app routes friendship actions and social service requires client mutation identifiers for writes', async () => {
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const repository = createMemorySocialRepository({ social_users: [{ _id: 'su_a', ownerOpenId: 'openid-a', profile: { nickname: 'A' } }] })
  const app = createSocialApp({
    repository,
    identity: { resolve: () => ({ ownerOpenId: 'openid-a' }) },
    requestId: () => 'route-friendship',
    friendship: { now: () => 1_000, tokenSecret: '12345678901234567890123456789012' }
  })
  const routed = await app.handle({ action: 'create_invite', clientMutationId: 'route-create' }, {})
  assert.equal(routed.code, 0)
  assert.match(routed.data.token, /^[A-Za-z0-9_-]{22}$/)

  const apiPath = require.resolve('../services/social-api')
  const servicePath = require.resolve('../services/social-service')
  const api = require(apiPath)
  const original = api.callSocialFunction
  const calls = []
  api.callSocialFunction = async (action, payload) => { calls.push({ action, payload }); return { ok: true } }
  delete require.cache[servicePath]
  try {
    const service = require('../services/social-service')
    assert.throws(() => service.createInvite({}), error => error.code === 'INVALID_MUTATION')
    assert.deepEqual(await service.createInvite({ clientMutationId: 'service-create' }), { ok: true })
    assert.deepEqual(calls, [{ action: 'create_invite', payload: { clientMutationId: 'service-create' } }])
  } finally {
    api.callSocialFunction = original
    delete require.cache[servicePath]
  }
})

test('invite retry reconstructs the same token without persisting it and fails closed without a server secret', async () => {
  const { createFriendshipHandlers } = require('../cloudfunctions/poker_social/lib/friendship')
  const repository = createMemorySocialRepository({ social_users: [{ _id: 'su_a', ownerOpenId: 'openid-a', profile: { nickname: 'A' } }] })
  const secured = createFriendshipHandlers(repository, { now: () => 1_000, tokenSecret: 'server-secret-for-tests-1234567890' })
  const first = await secured.create_invite({ clientMutationId: 'same-create' }, { ownerOpenId: 'openid-a' })
  const retry = await secured.create_invite({ clientMutationId: 'same-create' }, { ownerOpenId: 'openid-a' })

  assert.deepEqual(retry, first)
  assert.equal(JSON.stringify(repository.dump()).includes(first.token), false)
  await assert.rejects(
    createFriendshipHandlers(repository, { now: () => 1_000 }).create_invite({ clientMutationId: 'missing-secret' }, { ownerOpenId: 'openid-a' }),
    error => error.code === 'INVITE_SECRET_UNAVAILABLE'
  )
})

test('expired rejected and removed pairs become a fresh pending request with refreshed direction and snapshots', async () => {
  let now = 1_000
  const { createFriendshipHandlers } = require('../cloudfunctions/poker_social/lib/friendship')
  const repository = createMemorySocialRepository({
    social_users: [
      { _id: 'su_a', ownerOpenId: 'openid-a', profile: { nickname: 'A', avatarFileId: 'a-old' } },
      { _id: 'su_b', ownerOpenId: 'openid-b', profile: { nickname: 'B', avatarFileId: 'b-old' } }
    ]
  })
  const handlers = createFriendshipHandlers(repository, { now: () => now, tokenSecret: '12345678901234567890123456789012' })
  const a = { ownerOpenId: 'openid-a' }
  const b = { ownerOpenId: 'openid-b' }
  const firstInvite = await handlers.create_invite({ clientMutationId: 'reopen-invite-1' }, a)
  const pending = await handlers.send_friend_request({ token: firstInvite.token, clientMutationId: 'reopen-request-1' }, b)
  const rejected = await handlers.reject_friend_request({ friendshipId: pending.friendshipId, clientMutationId: 'reopen-reject' }, a)
  await assert.rejects(
    handlers.send_friend_request({ token: firstInvite.token, clientMutationId: 'reopen-too-early' }, b),
    error => error.code === 'FRIEND_REQUEST_COOLDOWN'
  )

  now = rejected.cooldownUntil + 1
  repository.set('social_users', 'su_b', { _id: 'su_b', ownerOpenId: 'openid-b', profile: { nickname: 'B refreshed', avatarFileId: 'b-new' } })
  const reopenedInvite = await handlers.create_invite({ clientMutationId: 'reopen-invite-2' }, a)
  const reopened = await handlers.send_friend_request({ token: reopenedInvite.token, clientMutationId: 'reopen-request-2' }, b)
  const record = repository.get('social_friendships', pending.friendshipId)

  assert.equal(reopened.status, 'pending')
  assert.equal(record.requesterId, 'su_b')
  assert.equal(record.receiverId, 'su_a')
  assert.deepEqual(record.profileSnapshots, {})
  assert.equal(record.createdAt, now)

  await handlers.accept_friend_request({ friendshipId: pending.friendshipId, clientMutationId: 'reopen-accept' }, a)
  const removed = await handlers.remove_friend({ friendshipId: pending.friendshipId, clientMutationId: 'reopen-remove' }, a)
  now = removed.cooldownUntil + 1
  const afterRemovalInvite = await handlers.create_invite({ clientMutationId: 'reopen-invite-3' }, a)
  const afterRemoval = await handlers.send_friend_request({ token: afterRemovalInvite.token, clientMutationId: 'reopen-request-3' }, b)
  assert.equal(afterRemoval.status, 'pending')
})

test('only the original receiver may repeat accept or reject after status changes', async () => {
  const { createFriendshipHandlers } = require('../cloudfunctions/poker_social/lib/friendship')
  const repository = createMemorySocialRepository({
    social_users: [
      { _id: 'su_a', ownerOpenId: 'openid-a', profile: { nickname: 'A' } },
      { _id: 'su_b', ownerOpenId: 'openid-b', profile: { nickname: 'B' } },
      { _id: 'su_c', ownerOpenId: 'openid-c', profile: { nickname: 'C' } }
    ]
  })
  const handlers = createFriendshipHandlers(repository, { now: () => 1_000, tokenSecret: '12345678901234567890123456789012' })
  const a = { ownerOpenId: 'openid-a' }
  const b = { ownerOpenId: 'openid-b' }
  const c = { ownerOpenId: 'openid-c' }
  const invite = await handlers.create_invite({ clientMutationId: 'permission-invite' }, a)
  const pending = await handlers.send_friend_request({ token: invite.token, clientMutationId: 'permission-request' }, b)
  await handlers.accept_friend_request({ friendshipId: pending.friendshipId, clientMutationId: 'permission-accept' }, a)

  for (const actor of [b, c]) {
    await assert.rejects(
      handlers.accept_friend_request({ friendshipId: pending.friendshipId, clientMutationId: 'repeat-accept-' + actor.ownerOpenId }, actor),
      error => error.code === 'FORBIDDEN'
    )
    await assert.rejects(
      handlers.reject_friend_request({ friendshipId: pending.friendshipId, clientMutationId: 'repeat-reject-' + actor.ownerOpenId }, actor),
      error => error.code === 'FORBIDDEN'
    )
  }
})

test('friend list keeps the acceptance snapshot after a friend changes their profile', async () => {
  const { createFriendshipHandlers } = require('../cloudfunctions/poker_social/lib/friendship')
  const repository = createMemorySocialRepository({
    social_users: [
      { _id: 'su_a', ownerOpenId: 'openid-a', profile: { nickname: 'A' } },
      { _id: 'su_b', ownerOpenId: 'openid-b', profile: { nickname: 'B at acceptance', avatarFileId: 'b-original' } }
    ]
  })
  const handlers = createFriendshipHandlers(repository, { now: () => 1_000, tokenSecret: '12345678901234567890123456789012', avatarUrl: async fileId => 'https://temp/' + fileId })
  const a = { ownerOpenId: 'openid-a' }
  const b = { ownerOpenId: 'openid-b' }
  const invite = await handlers.create_invite({ clientMutationId: 'snapshot-invite' }, a)
  const pending = await handlers.send_friend_request({ token: invite.token, clientMutationId: 'snapshot-request' }, b)
  await handlers.accept_friend_request({ friendshipId: pending.friendshipId, clientMutationId: 'snapshot-accept' }, a)
  repository.set('social_users', 'su_b', { _id: 'su_b', ownerOpenId: 'openid-b', title: 'New title', profile: { nickname: 'B now', avatarFileId: 'b-new' } })

  const listed = await handlers.list_friends({}, a)
  assert.equal(listed.items[0].nickname, 'B at acceptance')
  assert.equal(listed.items[0].avatarUrl, 'https://temp/b-original')
  assert.equal(listed.items[0].title, 'New title')
})

test('directed friendship pagination orders each side before limiting and has no cross-page gaps', async () => {
  const calls = []
  const records = [
    { _id: 'a-old', userA: 'su_me', userB: 'su_1', status: 'accepted', acceptedAt: 10 },
    { _id: 'a-new', userA: 'su_me', userB: 'su_2', status: 'accepted', acceptedAt: 90 },
    { _id: 'a-mid', userA: 'su_me', userB: 'su_3', status: 'accepted', acceptedAt: 50 },
    { _id: 'b-old', userA: 'su_4', userB: 'su_me', status: 'accepted', acceptedAt: 20 },
    { _id: 'b-new', userA: 'su_5', userB: 'su_me', status: 'accepted', acceptedAt: 80 },
    { _id: 'b-mid', userA: 'su_6', userB: 'su_me', status: 'accepted', acceptedAt: 60 }
  ]
  const { createCloudSocialRepository } = require('../cloudfunctions/poker_social/lib/repository')
  const database = {
    collection() {
      return {
        where(query) {
          const state = { query, orders: [], skip: 0, limit: 100 }
          const chain = {
            orderBy(field, direction) { state.orders.push({ field, direction }); return chain },
            skip(value) { state.skip = value; return chain },
            limit(value) { state.limit = value; return chain },
            async get() {
              calls.push(state)
              let rows = records.filter(row => Object.keys(query).every(key => row[key] === query[key]))
              for (const order of state.orders.slice().reverse()) {
                rows = rows.slice().sort((left, right) => {
                  const delta = left[order.field] > right[order.field] ? 1 : left[order.field] < right[order.field] ? -1 : 0
                  return order.direction === 'desc' ? -delta : delta
                })
              }
              return { data: rows.slice(state.skip, state.skip + state.limit) }
            }
          }
          return chain
        }
      }
    }
  }
  const repository = createCloudSocialRepository(database)
  const first = await repository.listAcceptedFriendships('su_me', { offset: 0, limit: 2 })
  const second = await repository.listAcceptedFriendships('su_me', { offset: first.nextOffset, limit: 2 })
  const third = await repository.listAcceptedFriendships('su_me', { offset: second.nextOffset, limit: 2 })

  assert.deepEqual(first.items.map(item => item._id), ['a-new', 'b-new'])
  assert.deepEqual(second.items.map(item => item._id), ['b-mid', 'a-mid'])
  assert.deepEqual(third.items.map(item => item._id), ['b-old', 'a-old'])
  assert.equal(new Set(first.items.concat(second.items, third.items).map(item => item._id)).size, 6)
  assert.ok(calls.every(call => call.orders.slice(0, 2).map(order => order.field).join(',') === 'acceptedAt,_id'))
})

test('invite derivation fails closed when the server secret is shorter than 32 bytes', () => {
  const { deriveInviteToken } = require('../cloudfunctions/poker_social/lib/invite')
  assert.throws(
    () => deriveInviteToken('too-short', 'su_a', 'create_invite', 'mutation-1'),
    error => error.code === 'INVITE_SECRET_UNAVAILABLE'
  )
})

test('list friends accepts offset 1000 but rejects offset 1001 with the public pagination error', async () => {
  const { createFriendshipHandlers } = require('../cloudfunctions/poker_social/lib/friendship')
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const repository = createMemorySocialRepository({ social_users: [{ _id: 'su_a', ownerOpenId: 'openid-a', profile: { nickname: 'A' } }] })
  const handlers = createFriendshipHandlers(repository, { tokenSecret: '12345678901234567890123456789012' })

  assert.deepEqual(await handlers.list_friends({ offset: 1000 }, { ownerOpenId: 'openid-a' }), { items: [], nextOffset: null })
  await assert.rejects(
    handlers.list_friends({ offset: 1001 }, { ownerOpenId: 'openid-a' }),
    error => error.code === 'INVALID_PAGINATION'
  )

  const app = createSocialApp({
    repository,
    identity: { resolve: () => ({ ownerOpenId: 'openid-a' }) },
    requestId: () => 'pagination-request',
    friendship: { tokenSecret: '12345678901234567890123456789012' }
  })
  assert.deepEqual(await app.handle({ action: 'list_friends', offset: 1001 }, {}), {
    code: 'INVALID_PAGINATION',
    data: null,
    message: 'invalid pagination',
    requestId: 'pagination-request'
  })
})
