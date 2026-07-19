const test = require('node:test')
const assert = require('node:assert/strict')

const { createSocialApp } = require('../cloudfunctions/poker_social/app')
const { deriveInviteToken, buildInviteRecord } = require('../cloudfunctions/poker_social/lib/invite')
const { createMemorySocialRepository } = require('./helpers/social-fixture')

const FORBIDDEN_RESPONSE_FIELDS = [
  'ownerOpenId', '_openid', 'profit', 'currentProfit', 'buyIn', 'cashOut',
  'hourlyRate', 'winRate', 'venue', 'sessionId', 'sourceHandId', 'playerNoteId',
  'leakTags', 'note', 'battleHandIds', 'privatePlayerId', 'avatarFileId'
]

const FORBIDDEN_RESPONSE_VALUES = [
  'openid-a-private', 'openid-b-private', 'shadow-openid', 'profit-secret',
  'current-profit-secret', 'buyin-secret', 'cashout-secret', 'hourly-secret',
  'winrate-secret', 'venue-secret', 'session-secret', 'source-hand-secret',
  'player-note-secret', 'leak-secret', 'note-secret', 'battle-hand-secret'
]

function assertPublicSocialResponse(response) {
  const serialized = JSON.stringify(response)
  for (const field of FORBIDDEN_RESPONSE_FIELDS) assert.equal(serialized.includes('"' + field + '"'), false, field + ' leaked')
  for (const value of FORBIDDEN_RESPONSE_VALUES) assert.equal(serialized.includes(value), false, value + ' leaked')
  assert.equal(serialized.includes('cloud://'), false, 'CloudBase file identifier leaked')
}

test('social response boundary excludes private identity fields and CloudBase file identifiers', async () => {
  const app = createSocialApp({
    identity: { resolve: () => ({ ownerOpenId: 'openid-private' }) },
    handlers: {
      get_security_probe() {
        return {
          ownerOpenId: 'openid-private',
          _openid: 'openid-private',
          privatePlayerId: 'PLAYER-1',
          avatarFileId: 'cloud://avatar-private',
          nested: {
            qrCodeFile: 'cloud://social-invites/secret.png',
            visible: true
          },
          attachments: [
            'cloud://social-invites/array-secret.png',
            { previewFile: 'cloud://social-invites/object-secret.png' },
            'https://temporary.example/avatar.png'
          ]
        }
      }
    },
    requestId: () => 'security-request'
  })

  const result = await app.handle({ action: 'get_security_probe' }, {})

  assert.equal(result.code, 0)
  assert.equal(JSON.stringify(result).includes('ownerOpenId'), false)
  assert.equal(JSON.stringify(result).includes('_openid'), false)
  assert.equal(JSON.stringify(result).includes('privatePlayerId'), false)
  assert.equal(JSON.stringify(result).includes('avatarFileId'), false)
  assert.equal(JSON.stringify(result).includes('cloud://'), false)
  assert.equal(JSON.stringify(result).includes('https://temporary.example/avatar.png'), true)
})

test('top-level CloudBase file identifier becomes a safe null response value', async () => {
  const app = createSocialApp({
    identity: { resolve: () => ({ ownerOpenId: 'openid-private' }) },
    handlers: { get_cloud_file_probe: () => 'cloud://social-invites/top-level-secret.png' },
    requestId: () => 'top-level-security-request'
  })

  assert.deepEqual(await app.handle({ action: 'get_cloud_file_probe' }, {}), {
    code: 0,
    data: null,
    requestId: 'top-level-security-request'
  })
})

test('social failure response never exposes CloudBase file identifiers from thrown errors', async () => {
  const app = createSocialApp({
    identity: { resolve: () => ({ ownerOpenId: 'openid-private' }) },
    handlers: {
      fail_security_probe() {
        throw new Error('failed to sign cloud://social-invites/error-secret.png')
      }
    },
    requestId: () => 'security-error-request'
  })

  const result = await app.handle({ action: 'fail_security_probe' }, {})

  assert.deepEqual(result, {
    code: 'SOCIAL_ERROR',
    data: null,
    message: 'social function failed',
    requestId: 'security-error-request'
  })
  assert.equal(JSON.stringify(result).includes('cloud://'), false)
})

test('production social actions return only explicit public DTOs from polluted records', async () => {
  const tokenSecret = '12345678901234567890123456789012'
  const now = 1_000
  const seededToken = deriveInviteToken(tokenSecret, 'su_a', 'create_invite', 'seed-invite')
  const polluted = {
    _openid: 'shadow-openid',
    profit: 'profit-secret',
    currentProfit: 'current-profit-secret',
    buyIn: 'buyin-secret',
    cashOut: 'cashout-secret',
    hourlyRate: 'hourly-secret',
    winRate: 'winrate-secret',
    venue: 'venue-secret',
    sessionId: 'session-secret',
    sourceHandId: 'source-hand-secret',
    playerNoteId: 'player-note-secret',
    leakTags: ['leak-secret'],
    note: 'note-secret',
    battleHandIds: ['battle-hand-secret'],
    avatarFileId: 'cloud://social/private-root-avatar.png',
    cloudPath: 'cloud://social/private-record.png'
  }
  const repository = createMemorySocialRepository({
    social_users: [
      Object.assign({
        _id: 'su_a',
        ownerOpenId: 'openid-a-private',
        privatePlayerId: 'PLAYER-A-PRIVATE',
        profile: { nickname: 'Alice', avatarFileId: 'cloud://social/private-alice-avatar.png' }
      }, polluted),
      Object.assign({
        _id: 'su_b',
        ownerOpenId: 'openid-b-private',
        privatePlayerId: 'PLAYER-B-PRIVATE',
        profile: { nickname: 'Bob', avatarFileId: 'cloud://social/private-bob-avatar.png' }
      }, polluted)
    ],
    social_invites: [Object.assign(buildInviteRecord(seededToken, 'su_a', now), polluted)],
    social_friendships: [Object.assign({
      _id: 'fr_seed',
      userA: 'su_a',
      userB: 'su_b',
      userIds: ['su_a', 'su_b'],
      status: 'accepted',
      requesterId: 'su_b',
      receiverId: 'su_a',
      acceptedAt: now,
      profileSnapshots: {
        su_b: { nickname: 'Bob', avatarFileId: 'cloud://social/private-snapshot-avatar.png' }
      }
    }, polluted)]
  })
  repository.find = async (collection, query) => repository.where(collection, row => Object.keys(query).every(key => row[key] === query[key]))[0] || null
  const app = createSocialApp({
    repository,
    identity: { resolve: openId => ({ ownerOpenId: openId }) },
    requestId: () => 'production-dto-security-request',
    avatarUrl: async () => 'https://temporary.example/signed-avatar.png',
    friendship: { now: () => now, tokenSecret }
  })

  const initialized = await app.handle({
    action: 'initialize_social_profile',
    playerId: 'player-c',
    nickname: 'Carol',
    avatarMode: 'custom',
    avatarFileId: 'cloud://social/private-carol-avatar.png'
  }, { openId: 'openid-c-private' })
  const createdInvite = await app.handle({ action: 'create_invite', clientMutationId: 'matrix-create-invite' }, { openId: 'openid-a-private' })
  const inspected = await app.handle({ action: 'inspect_invite', token: seededToken }, { openId: 'openid-c-private' })
  const listed = await app.handle({ action: 'list_friends' }, { openId: 'openid-a-private' })
  const requested = await app.handle({ action: 'send_friend_request', token: seededToken, clientMutationId: 'matrix-send-request' }, { openId: 'openid-c-private' })
  assert.equal(requested.code, 0)
  const accepted = await app.handle({ action: 'accept_friend_request', friendshipId: requested.data.friendshipId, clientMutationId: 'matrix-accept-request' }, { openId: 'openid-a-private' })
  const mine = await app.handle({ action: 'get_my_social_profile' }, { openId: 'openid-a-private' })

  for (const response of [initialized, createdInvite, inspected, listed, requested, accepted, mine]) {
    assert.equal(response.code, 0)
    assertPublicSocialResponse(response)
  }
  assert.equal(listed.data.items.length, 1)
  assert.equal(listed.data.items[0].socialUserId, 'su_b')
})

test('removed production friendship is absent from the next friend-list response', async () => {
  const tokenSecret = '12345678901234567890123456789012'
  const repository = createMemorySocialRepository({
    social_users: [
      { _id: 'su_a', ownerOpenId: 'openid-a', profile: { nickname: 'Alice' } },
      { _id: 'su_b', ownerOpenId: 'openid-b', profile: { nickname: 'Bob' } }
    ]
  })
  const app = createSocialApp({
    repository,
    identity: { resolve: openId => ({ ownerOpenId: openId }) },
    requestId: () => 'remove-list-security-request',
    friendship: { now: () => 1_000, tokenSecret }
  })

  const invite = await app.handle({ action: 'create_invite', clientMutationId: 'remove-list-invite' }, { openId: 'openid-a' })
  const requested = await app.handle({ action: 'send_friend_request', token: invite.data.token, clientMutationId: 'remove-list-request' }, { openId: 'openid-b' })
  const accepted = await app.handle({ action: 'accept_friend_request', friendshipId: requested.data.friendshipId, clientMutationId: 'remove-list-accept' }, { openId: 'openid-a' })
  const beforeRemoval = await app.handle({ action: 'list_friends' }, { openId: 'openid-a' })
  const removed = await app.handle({ action: 'remove_friend', friendshipId: accepted.data.friendshipId, clientMutationId: 'remove-list-remove' }, { openId: 'openid-a' })
  const afterRemoval = await app.handle({ action: 'list_friends' }, { openId: 'openid-a' })

  assert.equal(beforeRemoval.code, 0)
  assert.equal(beforeRemoval.data.items.length, 1)
  assert.equal(removed.code, 0)
  assert.equal(removed.data.status, 'removed')
  assert.deepEqual(afterRemoval, {
    code: 0,
    data: { items: [], nextOffset: null },
    requestId: 'remove-list-security-request'
  })
})
