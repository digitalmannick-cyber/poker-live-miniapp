const test = require('node:test')
const assert = require('node:assert/strict')

const { createMemorySocialRepository } = require('./helpers/social-fixture')
const { getPairId } = require('../cloudfunctions/poker_social/lib/friendship')

function createRepository(overrides) {
  const repository = createMemorySocialRepository(Object.assign({
    social_users: [
      { _id: 'su_a', ownerOpenId: 'openid-a', privatePlayerId: 'PLAYER-A', profile: { nickname: 'Alice', avatarFileId: 'cloud://sender-avatar' } },
      { _id: 'su_b', ownerOpenId: 'openid-b', privatePlayerId: 'PLAYER-B', profile: { nickname: 'Bob' } },
      { _id: 'su_c', ownerOpenId: 'openid-c', privatePlayerId: 'PLAYER-C', profile: { nickname: 'Carol' } }
    ],
    social_friendships: [{
      _id: getPairId('su_a', 'su_b'), userA: 'su_a', userB: 'su_b', status: 'accepted', acceptedAt: 1
    }],
    player_notes: [{
      _id: 'note-a', ownerOpenId: 'openid-a', playerId: 'PLAYER-A', sourceKind: 'library', archived: false,
      name: ' 老张 ', alias: ['张总'], avatarFileId: 'cloud://player-avatar', type: ' 激进 ',
      leakTags: ['河牌过度诈唬', '', '河牌过度诈唬', '跟注过宽'], note: ' 完整记录 ',
      battleHandIds: ['h1'], linkedFriendUserId: 'su_x', profit: 999, updatedAt: 10
    }]
  }, overrides || {}))
  repository.find = async (collection, query) => repository.where(
    collection,
    row => Object.keys(query || {}).every(key => row[key] === query[key])
  )[0] || null
  return repository
}

function createHandlers(repository, nowRef) {
  const { createPlayerCardHandlers } = require('../cloudfunctions/poker_social/lib/player-card')
  return createPlayerCardHandlers(repository, {
    now: () => nowRef.value,
    avatarUrl: async fileId => fileId.startsWith('cloud://') ? 'https://temp.example/' + fileId.slice(8) : ''
  })
}

test('player card snapshot is a normalized five-field whitelist and target validation is singular', () => {
  const playerCard = require('../cloudfunctions/poker_social/lib/player-card')
  const snapshot = playerCard.buildSnapshot({
    _id: 'player_1', name: ' 老张 ', alias: ['张总'], avatarFileId: 'cloud://a',
    type: ' 激进 ', leakTags: ['河牌过度诈唬', '', '河牌过度诈唬', ' 跟注过宽 '],
    note: ' 完整记录 ', battleHandIds: ['h1'], updatedAt: 10
  })

  assert.deepEqual(Object.keys(snapshot).sort(), ['avatarAsset', 'leakTags', 'name', 'note', 'type'])
  assert.deepEqual(snapshot, {
    avatarAsset: 'cloud://a', name: '老张', type: '激进',
    leakTags: ['河牌过度诈唬', '跟注过宽'], note: '完整记录'
  })
  assert.doesNotMatch(JSON.stringify(snapshot), /alias|player_1|battleHandIds|updatedAt/)
  assert.equal(playerCard.validateTarget('su_b'), 'su_b')
  assert.throws(() => playerCard.validateTargets(['su_a', 'su_b']), error => error.code === 'INVALID_CARD_TARGET')
  assert.throws(() => playerCard.validateTarget(''), error => error.code === 'INVALID_CARD_TARGET')

  const bounded = playerCard.buildSnapshot({
    name: '名'.repeat(60), type: '类'.repeat(40), note: '注'.repeat(6_000),
    leakTags: Array.from({ length: 30 }, (_, index) => '标签' + index + 'x'.repeat(50))
  })
  assert.equal(bounded.name.length, 40)
  assert.equal(bounded.type.length, 24)
  assert.equal(bounded.note.length, 5_000)
  assert.equal(bounded.leakTags.length, 20)
  assert.ok(bounded.leakTags.every(tag => tag.length <= 40))
})

test('sharing reads the authoritative library note by owner player and note, ignoring client snapshot injection', async () => {
  const nowRef = { value: 1_000 }
  const repository = createRepository()
  const handlers = createHandlers(repository, nowRef)
  const result = await handlers.share_player_card({
    playerNoteId: 'note-a', targetUserId: 'su_b', clientMutationId: 'share-1',
    card: { name: 'injected', note: 'stolen' }, snapshot: { name: 'injected' }, name: 'injected', note: 'injected'
  }, { ownerOpenId: 'openid-a' })

  assert.equal(result.card.name, '老张')
  assert.equal(result.card.note, '完整记录')
  assert.equal(result.card.avatarUrl, 'https://temp.example/player-avatar')
  assert.equal(result.expiresAt, 1_000 + 7 * 24 * 60 * 60 * 1000)
  assert.equal(result.imported, false)
  assert.deepEqual(result.sender, {
    socialUserId: 'su_a', nickname: 'Alice', avatarUrl: 'https://temp.example/sender-avatar', avatarText: 'A'
  })
  assert.doesNotMatch(JSON.stringify(result), /cloud:\/\/|playerNoteId|ownerOpenId|privatePlayerId|targetUserId|alias|battleHandIds/)

  const stored = repository.where('social_player_card_shares', () => true)[0]
  assert.equal(stored.senderUserId, 'su_a')
  assert.equal(stored.targetUserId, 'su_b')
  assert.equal(stored.snapshot.avatarAsset, 'cloud://player-avatar')
  assert.doesNotMatch(stored._id, /note-a|openid-a|PLAYER-A|su_a|su_b/)
})

test('source note access enforces owner player note and library-only boundaries', async () => {
  const nowRef = { value: 1_000 }
  const cases = [
    { ownerOpenId: 'openid-other' },
    { playerId: 'PLAYER-OTHER' },
    { _id: 'other-note' },
    { archived: true },
    { sourceKind: 'friend' }
  ]
  for (const patch of cases) {
    const repository = createRepository({
      player_notes: [Object.assign({
        _id: 'note-a', ownerOpenId: 'openid-a', playerId: 'PLAYER-A', sourceKind: 'library', archived: false, name: 'A'
      }, patch)]
    })
    await assert.rejects(
      createHandlers(repository, nowRef).share_player_card({ playerNoteId: 'note-a', targetUserId: 'su_b', clientMutationId: 'private-' + JSON.stringify(patch) }, { ownerOpenId: 'openid-a' }),
      error => error.code === 'PLAYER_CARD_SOURCE_NOT_FOUND'
    )
  }
})

test('only an accepted single target may receive, read, or confirm a card and relationship changes revoke access', async () => {
  const nowRef = { value: 1_000 }
  const repository = createRepository()
  const handlers = createHandlers(repository, nowRef)
  const shared = await handlers.share_player_card({ playerNoteId: 'note-a', targetUserId: 'su_b', clientMutationId: 'access-share' }, { ownerOpenId: 'openid-a' })

  await assert.rejects(handlers.get_player_card_share({ shareId: shared.shareId }, { ownerOpenId: 'openid-a' }), error => error.code === 'FORBIDDEN')
  await assert.rejects(handlers.get_player_card_share({ shareId: shared.shareId }, { ownerOpenId: 'openid-c' }), error => error.code === 'FORBIDDEN')
  const read = await handlers.get_player_card_share({ shareId: shared.shareId }, { ownerOpenId: 'openid-b' })
  assert.equal(read.shareId, shared.shareId)

  for (const status of ['pending', 'rejected', 'removed']) {
    repository.set('social_friendships', getPairId('su_a', 'su_b'), {
      _id: getPairId('su_a', 'su_b'), userA: 'su_a', userB: 'su_b', status
    })
    await assert.rejects(handlers.get_player_card_share({ shareId: shared.shareId }, { ownerOpenId: 'openid-b' }), error => error.code === 'FORBIDDEN')
    await assert.rejects(handlers.confirm_player_card_import({ shareId: shared.shareId, clientMutationId: status + '-import' }, { ownerOpenId: 'openid-b' }), error => error.code === 'FORBIDDEN')
  }

  await assert.rejects(
    handlers.share_player_card({ playerNoteId: 'note-a', targetUserId: 'su_c', clientMutationId: 'stranger-share' }, { ownerOpenId: 'openid-a' }),
    error => error.code === 'FORBIDDEN'
  )
})

test('expiry withdrawal and import confirmation follow the seven-day and ownership contract with idempotent writes', async () => {
  const nowRef = { value: 1_000 }
  const repository = createRepository()
  const handlers = createHandlers(repository, nowRef)
  const shared = await handlers.share_player_card({ playerNoteId: 'note-a', targetUserId: 'su_b', clientMutationId: 'life-share' }, { ownerOpenId: 'openid-a' })
  const retriedShare = await handlers.share_player_card({ playerNoteId: 'note-a', targetUserId: 'su_b', clientMutationId: 'life-share' }, { ownerOpenId: 'openid-a' })
  assert.deepEqual(retriedShare, shared)
  assert.equal(repository.where('social_player_card_shares', () => true).length, 1)

  const imported = await handlers.confirm_player_card_import({ shareId: shared.shareId, clientMutationId: 'life-import' }, { ownerOpenId: 'openid-b' })
  const importedAgain = await handlers.confirm_player_card_import({ shareId: shared.shareId, clientMutationId: 'life-import' }, { ownerOpenId: 'openid-b' })
  assert.deepEqual(importedAgain, imported)
  assert.equal(imported.imported, true)
  nowRef.value = shared.expiresAt + 1
  assert.equal((await handlers.get_player_card_share({ shareId: shared.shareId }, { ownerOpenId: 'openid-b' })).imported, true)

  repository.set('social_friendships', getPairId('su_a', 'su_b'), {
    _id: getPairId('su_a', 'su_b'), userA: 'su_a', userB: 'su_b', status: 'removed'
  })
  await assert.rejects(handlers.get_player_card_share({ shareId: shared.shareId }, { ownerOpenId: 'openid-b' }), error => error.code === 'FORBIDDEN')
  assert.ok(repository.get('social_player_card_shares', shared.shareId).importedAt, 'relationship changes must not erase an imported copy marker')
  repository.set('social_friendships', getPairId('su_a', 'su_b'), {
    _id: getPairId('su_a', 'su_b'), userA: 'su_a', userB: 'su_b', status: 'accepted'
  })

  const second = await handlers.share_player_card({ playerNoteId: 'note-a', targetUserId: 'su_b', clientMutationId: 'life-share-2' }, { ownerOpenId: 'openid-a' })
  nowRef.value = second.expiresAt + 1
  await assert.rejects(handlers.get_player_card_share({ shareId: second.shareId }, { ownerOpenId: 'openid-b' }), error => error.code === 'PLAYER_CARD_UNAVAILABLE')
  await assert.rejects(handlers.confirm_player_card_import({ shareId: second.shareId, clientMutationId: 'expired-import' }, { ownerOpenId: 'openid-b' }), error => error.code === 'PLAYER_CARD_UNAVAILABLE')

  nowRef.value = 2_000
  const third = await handlers.share_player_card({ playerNoteId: 'note-a', targetUserId: 'su_b', clientMutationId: 'life-share-3' }, { ownerOpenId: 'openid-a' })
  await assert.rejects(handlers.withdraw_player_card_share({ shareId: third.shareId, clientMutationId: 'wrong-withdraw' }, { ownerOpenId: 'openid-b' }), error => error.code === 'FORBIDDEN')
  const withdrawn = await handlers.withdraw_player_card_share({ shareId: third.shareId, clientMutationId: 'owner-withdraw' }, { ownerOpenId: 'openid-a' })
  assert.equal(withdrawn.withdrawn, true)
  assert.deepEqual(await handlers.withdraw_player_card_share({ shareId: third.shareId, clientMutationId: 'owner-withdraw' }, { ownerOpenId: 'openid-a' }), withdrawn)
  await assert.rejects(handlers.get_player_card_share({ shareId: third.shareId }, { ownerOpenId: 'openid-b' }), error => error.code === 'PLAYER_CARD_UNAVAILABLE')
})

test('unsafe player card avatar resources never reach DTOs while HTTPS resources remain usable', async () => {
  const { buildSnapshot, toCardShareDto } = require('../cloudfunctions/poker_social/lib/player-card')
  assert.equal(buildSnapshot({ name: 'A', avatarUrl: 'wxfile://private/path' }).avatarAsset, '')
  assert.equal(buildSnapshot({ name: 'A', avatarUrl: 'data:image/png;base64,secret' }).avatarAsset, '')
  const https = buildSnapshot({ name: 'A', avatarUrl: 'https://cdn.example/a.png' })
  const dto = await toCardShareDto({
    _id: 'pcs_safe', snapshot: https, expiresAt: 100, importedAt: 0,
    sender: { socialUserId: 'su_a', nickname: 'A' }
  }, { avatarUrl: async () => 'https://should-not-sign.example/' })
  assert.equal(dto.card.avatarUrl, 'https://cdn.example/a.png')
  assert.doesNotMatch(JSON.stringify(dto), /avatarAsset|wxfile|data:image|cloud:\/\//)
  const rejectedSigner = await toCardShareDto({ _id: 'pcs_bad', snapshot: { name: 'A', avatarAsset: 'cloud://private' } }, {
    avatarUrl: async () => 'http://unsafe.example/private.png'
  })
  assert.equal(rejectedSigner.card.avatarUrl, '')
})

test('real social app routes card actions, write actions require mutation IDs, and client service exposes the four calls', async () => {
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const nowRef = { value: 1_000 }
  const repository = createRepository()
  const app = createSocialApp({
    repository,
    identity: { resolve: openId => ({ ownerOpenId: openId }) },
    requestId: () => 'card-route',
    playerCard: { now: () => nowRef.value, avatarUrl: async id => 'https://temp.example/' + id.slice(8) },
    avatarUrl: async id => 'https://temp.example/' + id.slice(8)
  })
  const missingMutation = await app.handle({ action: 'share_player_card', playerNoteId: 'note-a', targetUserId: 'su_b' }, { openId: 'openid-a' })
  assert.equal(missingMutation.code, 'INVALID_MUTATION')
  const shared = await app.handle({ action: 'share_player_card', playerNoteId: 'note-a', targetUserId: 'su_b', clientMutationId: 'route-share' }, { openId: 'openid-a' })
  assert.equal(shared.code, 0)
  assert.equal((await app.handle({ action: 'get_player_card_share', shareId: shared.data.shareId }, { openId: 'openid-b' })).code, 0)
  assert.equal((await app.handle({ action: 'confirm_player_card_import', shareId: shared.data.shareId }, { openId: 'openid-b' })).code, 'INVALID_MUTATION')
  assert.equal((await app.handle({ action: 'withdraw_player_card_share', shareId: shared.data.shareId }, { openId: 'openid-a' })).code, 'INVALID_MUTATION')

  const apiPath = require.resolve('../services/social-api')
  const servicePath = require.resolve('../services/social-service')
  const api = require(apiPath)
  const original = api.callSocialFunction
  const calls = []
  api.callSocialFunction = async (action, payload) => { calls.push({ action, payload }); return { ok: true } }
  delete require.cache[servicePath]
  try {
    const service = require('../services/social-service')
    await service.getPlayerCardShare('pcs_1')
    await service.sharePlayerCard({ playerNoteId: 'note-a', targetUserId: 'su_b', clientMutationId: 'service-share' })
    assert.throws(() => service.withdrawPlayerCardShare({ shareId: 'pcs_1' }), error => error.code === 'INVALID_MUTATION')
    await service.confirmPlayerCardImport({ shareId: 'pcs_1', clientMutationId: 'service-import' })
    assert.deepEqual(calls.map(item => item.action), [
      'get_player_card_share', 'share_player_card', 'confirm_player_card_import'
    ])
  } finally {
    api.callSocialFunction = original
    delete require.cache[servicePath]
  }
})

test('CloudBase repository exposes the card collection and performs precise private note lookups', async () => {
  const { SOCIAL_COLLECTIONS, createCloudSocialRepository } = require('../cloudfunctions/poker_social/lib/repository')
  assert.equal(SOCIAL_COLLECTIONS.SOCIAL_PLAYER_CARD_SHARES, 'social_player_card_shares')
  const calls = []
  const database = {
    collection(name) {
      return {
        where(query) {
          calls.push({ name, query })
          return { limit() { return this }, async get() { return { data: [] } } }
        }
      }
    }
  }
  const repository = createCloudSocialRepository(database)
  await repository.find('player_notes', { _id: 'note-a', ownerOpenId: 'openid-a', playerId: 'PLAYER-A', sourceKind: 'library', archived: false })
  assert.deepEqual(calls, [{
    name: 'player_notes',
    query: { _id: 'note-a', ownerOpenId: 'openid-a', playerId: 'PLAYER-A', sourceKind: 'library', archived: false }
  }])
})
