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
  const token = invite.createInviteToken()
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
  const handlers = createFriendshipHandlers(repository, { now: () => 1_000 })
  const owner = { ownerOpenId: 'openid-a' }
  const viewer = { ownerOpenId: 'openid-b' }
  const invite = await handlers.create_invite({ clientMutationId: 'create-1' }, owner)
  const inspected = await handlers.inspect_invite({ token: invite.token }, viewer)

  assert.equal(inspected.inviter.socialUserId, 'su_a')
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
  const handlers = createFriendshipHandlers(repository, { now: () => 1_000 })
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
  assert.deepEqual(pairs[0].profileSnapshots, {
    su_a: { nickname: 'A', avatarFileId: '' },
    su_b: { nickname: 'B', avatarFileId: '' }
  })
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
  const handlers = createFriendshipHandlers(repository, { now: () => now, avatarUrl: async id => 'https://temp/' + id })
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
  const handlers = createFriendshipHandlers(repository, { now: () => 1_000 })
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

test('create invite QR generates scene code through injected code client and returns only display URL', async () => {
  const { createFriendshipHandlers } = require('../cloudfunctions/poker_social/lib/friendship')
  const repository = createMemorySocialRepository({ social_users: [{ _id: 'su_a', ownerOpenId: 'openid-a', profile: { nickname: 'A' } }] })
  const calls = []
  const handlers = createFriendshipHandlers(repository, {
    now: () => 1_000,
    qrCode: { getUnlimited: async input => { calls.push(input); return Buffer.from('png') } },
    uploadTempFile: async payload => ({ url: 'https://temp/qrcode.png', uploaded: payload })
  })

  const result = await handlers.create_invite_qr({ clientMutationId: 'qr-1' }, { ownerOpenId: 'openid-a' })
  assert.equal(result.qrCodeUrl, 'https://temp/qrcode.png')
  assert.match(calls[0].scene, /^[A-Za-z0-9_-]{22}$/)
  assert.deepEqual(calls, [{ scene: calls[0].scene, page: 'pages/social-invite/social-invite' }])
  assert.doesNotMatch(JSON.stringify(result), /ownerOpenId|avatarFileId|digest/)
})

test('social app routes friendship actions and social service requires client mutation identifiers for writes', async () => {
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const repository = createMemorySocialRepository({ social_users: [{ _id: 'su_a', ownerOpenId: 'openid-a', profile: { nickname: 'A' } }] })
  const app = createSocialApp({
    repository,
    identity: { resolve: () => ({ ownerOpenId: 'openid-a' }) },
    requestId: () => 'route-friendship',
    friendship: { now: () => 1_000 }
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
