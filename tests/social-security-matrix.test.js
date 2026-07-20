const test = require('node:test')
const assert = require('node:assert/strict')

const { createMemorySocialRepository } = require('./helpers/social-fixture')
const { createHandFeedHandlers } = require('../cloudfunctions/poker_social/lib/hand-feed')
const { createInteractionHandlers } = require('../cloudfunctions/poker_social/lib/interaction')
const { getPairId } = require('../cloudfunctions/poker_social/lib/friendship')
const { createSocialApp } = require('../cloudfunctions/poker_social/app')
const { toProfileDto } = require('../cloudfunctions/poker_social/lib/profile')
const { createFriendshipHandlers } = require('../cloudfunctions/poker_social/lib/friendship')
const { rankRows } = require('../cloudfunctions/poker_social/lib/ranking')
const { toCommentDto } = require('../cloudfunctions/poker_social/lib/interaction')
const { toNotificationDto } = require('../cloudfunctions/poker_social/lib/notification')
const { toCardShareDto } = require('../cloudfunctions/poker_social/lib/player-card')
const socialCache = require('../utils/social-cache')

const PUBLISHER = { _id: 'su_publisher', ownerOpenId: 'open-publisher', privatePlayerId: 'PUBLISHER-P5', profile: { nickname: 'Publisher', avatarText: 'P' } }
const FRIEND = { _id: 'su_friend', ownerOpenId: 'open-friend', privatePlayerId: 'FRIEND-P5', profile: { nickname: 'Friend', avatarText: 'F' } }
const SELECTED_FRIEND = { _id: 'su_selected', ownerOpenId: 'open-selected', privatePlayerId: 'SELECTED-P5', profile: { nickname: 'Selected', avatarText: 'S' } }
const STRANGER = { _id: 'su_stranger', ownerOpenId: 'open-stranger', privatePlayerId: 'STRANGER-P5', profile: { nickname: 'Stranger', avatarText: 'S' } }
const REMOVED_FRIEND = { _id: 'su_removed', ownerOpenId: 'open-removed', privatePlayerId: 'REMOVED-P5', profile: { nickname: 'Removed', avatarText: 'R' } }
const PRIVATE_CANARY = 'PRIVATE_MATRIX_CANARY'
const NON_CARD_FORBIDDEN_KEYS = new Set([
  'ownerOpenId', '_openid', 'ownerHash', 'privatePlayerId', 'playerId', 'source', 'targetUserIds',
  'handId', 'sourceHandId', 'sessionId', 'avatarFileId', 'rawHand',
  'note', 'notePreview', 'leakTags', 'battleHandIds', 'profit', 'currentProfit', 'resultBB',
  'allInEvProfit', 'buyIn', 'cashOut', 'venue', 'lastVenue', 'voiceExtract', 'aiReview'
])

function assertPublicTree(value, path = '$') {
  if (typeof value === 'string') {
    assert.equal(value.includes(PRIVATE_CANARY), false, `${path} leaked canary`)
    assert.equal(value.includes('cloud://'), false, `${path} leaked cloud file id`)
    return
  }
  if (Array.isArray(value)) return value.forEach((item, index) => assertPublicTree(item, `${path}[${index}]`))
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    assert.equal(NON_CARD_FORBIDDEN_KEYS.has(key), false, `${path}.${key} leaked`)
    assertPublicTree(child, `${path}.${key}`)
  }
}

function assertExactKeys(value, expected, label) {
  assert.deepEqual(Object.keys(value || {}).sort(), expected.slice().sort(), label)
}

function assertCardDto(value) {
  assertExactKeys(value, ['shareId', 'sender', 'card', 'expiresAt', 'imported'], 'card envelope whitelist')
  assertExactKeys(value.sender, ['socialUserId', 'nickname', 'avatarUrl', 'avatarText'], 'card sender whitelist')
  assertExactKeys(value.card, ['avatarUrl', 'name', 'type', 'leakTags', 'note'], 'card snapshot five-field whitelist')
  assertPublicTree({ shareId: value.shareId, sender: value.sender, expiresAt: value.expiresAt, imported: value.imported }, 'card public envelope')
  assert.equal(typeof value.card.avatarUrl, 'string')
  assert.equal(typeof value.card.name, 'string')
  assert.equal(typeof value.card.type, 'string')
  assert.equal(Array.isArray(value.card.leakTags), true)
  assert.equal(typeof value.card.note, 'string')
  for (const [key, child] of Object.entries(value.card)) {
    assert.equal(JSON.stringify(child).includes(PRIVATE_CANARY), false, `card.${key} leaked private canary`)
    assert.equal(JSON.stringify(child).includes('cloud://'), false, `card.${key} leaked cloud file id`)
  }
}

function accepted(left, right, status = 'accepted') {
  const pair = [left, right].sort()
  return { _id: getPairId(left, right), userA: pair[0], userB: pair[1], status, acceptedAt: 100 }
}

function snapshot() {
  return {
    version: 1,
    hero: { label: 'Hero', position: 'BTN', seat: 1, cards: ['As', 'Ks'], stackBb: 100 },
    players: [
      { label: 'Hero', position: 'BTN', seat: 1, stackBb: 100 },
      { label: 'V1', position: 'BB', seat: 2, stackBb: 90 }
    ],
    board: { flop: ['Ah', '9s', '4d'], turn: ['Kc'], river: ['2h'] },
    actions: [{ street: 'preflop', actor: 'Hero', type: 'raise', amountBb: 2.5 }],
    effectiveStackBb: 90,
    potBb: 12.5,
    showdown: []
  }
}

function share(scope, patch = {}) {
  return Object.assign({
    _id: 'sh_matrix', publisherId: PUBLISHER._id,
    source: { ownerOpenId: PUBLISHER.ownerOpenId, privatePlayerId: PUBLISHER.privatePlayerId, handId: 'hand-matrix', sessionId: 'session-matrix' },
    snapshot: snapshot(), status: 'active', scope,
    targetUserIds: scope === 'selected' ? [SELECTED_FRIEND._id] : [],
    likeCount: 0, commentCount: 0, createdAt: 100,
    ownerHash: PRIVATE_CANARY, profit: PRIVATE_CANARY, venue: PRIVATE_CANARY,
    nested: { note: PRIVATE_CANARY, leakTags: [PRIVATE_CANARY] }
  }, patch)
}

function publicAuthor(user) {
  return {
    socialUserId: user._id,
    nickname: user.profile.nickname,
    avatarUrl: '',
    avatarText: user.profile.avatarText
  }
}

function comment(id, author, parentCommentId = '') {
  return {
    _id: id,
    shareId: 'sh_matrix',
    parentCommentId,
    authorId: author._id,
    authorSnapshot: publicAuthor(author),
    kind: 'text',
    text: parentCommentId ? 'reply' : 'comment',
    stickerId: '',
    deleted: false,
    createdAt: parentCommentId ? 102 : 101,
    updatedAt: parentCommentId ? 102 : 101
  }
}

function afterCursor(row, cursor) {
  return !cursor || Number(row.createdAt) < Number(cursor.createdAt) ||
    (Number(row.createdAt) === Number(cursor.createdAt) && String(row._id) < String(cursor.id))
}

function attachListQueries(repository) {
  function candidates(predicate, page) {
    const limit = Math.max(1, Number(page && page.limit) || 20)
    return repository.dump().social_hand_shares
      .filter(predicate)
      .filter(row => afterCursor(row, page && page.cursor))
      .sort((left, right) => Number(right.createdAt) - Number(left.createdAt) || String(right._id).localeCompare(String(left._id)))
      .slice(0, limit)
  }
  repository.listAcceptedFriendshipsBySideKeyset = async (viewerId, side, page) => {
    const limit = Math.max(1, Number(page && page.limit) || 100)
    return repository.dump().social_friendships
      .filter(row => row.status === 'accepted' && row[side] === viewerId)
      .filter(row => !page.cursor || Number(row.acceptedAt) < Number(page.cursor.acceptedAt) ||
        (Number(row.acceptedAt) === Number(page.cursor.acceptedAt) && String(row._id) > String(page.cursor.id)))
      .sort((left, right) => Number(right.acceptedAt) - Number(left.acceptedAt) || String(left._id).localeCompare(String(right._id)))
      .slice(0, limit)
  }
  repository.listSquareShareCandidates = page => candidates(row => row.status === 'active' && row.scope === 'square', page)
  repository.listSelfShareCandidates = (viewerId, page) => candidates(row => row.status === 'active' && row.publisherId === viewerId, page)
  repository.listSelectedShareCandidates = (viewerId, page) => candidates(row => row.status === 'active' && row.targetUserIds.includes(viewerId), page)
  repository.listFriendShareCandidates = (publisherIds, page) => candidates(row => row.status === 'active' && publisherIds.includes(row.publisherId), page)
  repository.listComments = async (shareId, page) => {
    const limit = Math.max(1, Number(page && page.limit) || 20)
    return repository.dump().social_comments
      .filter(row => row.shareId === shareId)
      .filter(row => afterCursor(row, page && page.cursor))
      .sort((left, right) => Number(right.createdAt) - Number(left.createdAt) || String(right._id).localeCompare(String(left._id)))
      .slice(0, limit)
  }
}

function setup(scope, state = 'active', deleteAuthor = FRIEND) {
  const row = share(scope, { status: state === 'withdrawn' ? 'withdrawn' : 'active', commentCount: 2 })
  const sourceHands = state === 'source-missing'
    ? []
    : [{ _id: row.source.handId, ownerOpenId: row.source.ownerOpenId, privatePlayerId: row.source.privatePlayerId }]
  const repository = createMemorySocialRepository({
    social_users: [Object.assign({}, PUBLISHER, {
      ownerHash: PRIVATE_CANARY, profit: PRIVATE_CANARY,
      profile: Object.assign({}, PUBLISHER.profile, { avatarFileId: 'cloud://private-avatar', venue: PRIVATE_CANARY })
    }), FRIEND, SELECTED_FRIEND, STRANGER, REMOVED_FRIEND],
    social_friendships: [
      accepted(PUBLISHER._id, FRIEND._id),
      accepted(PUBLISHER._id, SELECTED_FRIEND._id),
      accepted(PUBLISHER._id, REMOVED_FRIEND._id, 'removed')
    ],
    social_hand_shares: [row],
    social_comments: [comment('sc_parent', PUBLISHER), comment('sc_delete', deleteAuthor)],
    social_likes: [],
    hands: sourceHands
  })
  attachListQueries(repository)
  return {
    row,
    repository,
    feed: createHandFeedHandlers(repository),
    interactions: createInteractionHandlers(repository, {
      now: () => 1_000,
      randomCommentId: (() => { let sequence = 0; return () => `sc_matrix_${++sequence}` })()
    })
  }
}

async function unavailable(promise) {
  await assert.rejects(promise, error => error && error.code === 'CONTENT_UNAVAILABLE')
}

const ROLES = Object.freeze({
  publisher: PUBLISHER,
  friend: FRIEND,
  selectedFriend: SELECTED_FRIEND,
  stranger: STRANGER,
  removedFriend: REMOVED_FRIEND
})

function rowReadable(state, scope, role) {
  if (state !== 'active') return false
  if (scope === 'square') return true
  if (role === 'publisher') return true
  if (scope === 'friends') return role === 'friend' || role === 'selectedFriend'
  return role === 'selectedFriend'
}

async function assertReadAction(promise, readable, label) {
  if (!readable) return unavailable(promise)
  const result = await promise
  assertPublicTree(result, label)
  return result
}

test('all 45 visibility rows enforce feed/detail/comments/reply/delete-own/like at handler level', async t => {
  for (const state of ['active', 'withdrawn', 'source-missing']) {
    for (const scope of ['square', 'friends', 'selected']) {
      for (const [role, actor] of Object.entries(ROLES)) {
        await t.test(`${state}/${scope}/${role}`, async () => {
          const readable = rowReadable(state, scope, role)

          const feedCtx = setup(scope, state, actor)
          const feed = await feedCtx.feed.list_feed({ limit: 20 }, { ownerOpenId: actor.ownerOpenId })
          assert.equal(feed.items.some(item => item.shareId === feedCtx.row._id), readable, 'feed visibility')
          assertPublicTree(feed, 'feed')

          const detailCtx = setup(scope, state, actor)
          await assertReadAction(detailCtx.feed.get_hand_share({
            shareId: detailCtx.row._id,
            viewerId: STRANGER._id,
            publisherId: STRANGER._id,
            friendIds: [STRANGER._id],
            targetUserIds: [STRANGER._id]
          }, { ownerOpenId: actor.ownerOpenId }), readable, 'detail')

          const listCtx = setup(scope, state, actor)
          await assertReadAction(listCtx.interactions.list_comments({ shareId: listCtx.row._id, limit: 20 }, {
            ownerOpenId: actor.ownerOpenId
          }), readable, 'comments')

          const createCtx = setup(scope, state, actor)
          await assertReadAction(createCtx.interactions.create_comment({
            shareId: createCtx.row._id, parentCommentId: '', kind: 'text', text: 'matrix', stickerId: '',
            clientMutationId: `create-${state}-${scope}-${role}`
          }, { ownerOpenId: actor.ownerOpenId }), readable, 'createComment')

          const replyCtx = setup(scope, state, actor)
          await assertReadAction(replyCtx.interactions.create_comment({
            shareId: replyCtx.row._id, parentCommentId: 'sc_parent', kind: 'text', text: 'reply', stickerId: '',
            clientMutationId: `reply-${state}-${scope}-${role}`
          }, { ownerOpenId: actor.ownerOpenId }), readable, 'reply')

          const likeCtx = setup(scope, state, actor)
          await assertReadAction(likeCtx.interactions.set_like({
            shareId: likeCtx.row._id, liked: true, clientMutationId: `like-${state}-${scope}-${role}`
          }, { ownerOpenId: actor.ownerOpenId }), readable, 'setLike')

          const deleteCtx = setup(scope, state, actor)
          const deleted = await deleteCtx.interactions.delete_comment({
            commentId: 'sc_delete', clientMutationId: `delete-${state}-${scope}-${role}`
          }, { ownerOpenId: actor.ownerOpenId })
          assert.equal(deleted.comment.deleted, true, 'deleteOwn remains available for privacy cleanup')
          assert.equal(Object.prototype.hasOwnProperty.call(deleted, 'commentCount'), readable)
          assertPublicTree(deleted, 'deleteOwn')
        })
      }
    }
  }
})

test('clearing publisher fails closed for detail, feed and interaction writes', async () => {
  const clearing = setup('square')
  clearing.repository.set('social_users', PUBLISHER._id, Object.assign({}, PUBLISHER, { deleted: true, socialLifecycle: 'clearing', accountClear: { stage: 'invites' } }))
  await unavailable(clearing.feed.get_hand_share({ shareId: clearing.row._id }, { ownerOpenId: STRANGER.ownerOpenId }))
  assert.deepEqual(await clearing.feed.list_feed({ limit: 20 }, { ownerOpenId: STRANGER.ownerOpenId }), { items: [], nextCursor: null })
  const interactions = createInteractionHandlers(clearing.repository, { now: () => 200, randomCommentId: () => 'sc_blocked' })
  await unavailable(interactions.create_comment({
    shareId: clearing.row._id, parentCommentId: '', kind: 'text', text: 'blocked', stickerId: '', clientMutationId: 'blocked-comment'
  }, { ownerOpenId: STRANGER.ownerOpenId }))
})

test('profile, friends, ranking, feed, detail, comments, notifications and card DTOs enforce recursive field policy', async () => {
  const internalUser = Object.assign({}, FRIEND, {
    ownerOpenId: PRIVATE_CANARY,
    ownerHash: PRIVATE_CANARY,
    privatePlayerId: PRIVATE_CANARY,
    playerId: PRIVATE_CANARY,
    profit: PRIVATE_CANARY,
    currentProfit: PRIVATE_CANARY,
    note: PRIVATE_CANARY,
    leakTags: [PRIVATE_CANARY],
    profile: Object.assign({}, FRIEND.profile, { avatarFileId: 'cloud://private-profile', venue: PRIVATE_CANARY }),
    publicStats: { durationMinutes: 90, recordedHandCount: 3 }
  })

  const profile = toProfileDto(internalUser, { avatarUrl: 'https://cdn.example/profile.png' })
  assertPublicTree(profile, 'profile')

  const friendRepository = createMemorySocialRepository({
    social_users: [PUBLISHER, internalUser],
    social_friendships: [accepted(PUBLISHER._id, FRIEND._id)]
  })
  friendRepository.listAcceptedFriendships = async () => ({
    items: friendRepository.dump().social_friendships,
    nextOffset: null
  })
  const friendHandlers = createFriendshipHandlers(friendRepository, {
    avatarUrl: async () => 'https://cdn.example/friend.png'
  })
  const friends = await friendHandlers.list_friends({ offset: 0, limit: 20 }, { ownerOpenId: PUBLISHER.ownerOpenId })
  assertPublicTree(friends, 'friends')

  const ranking = rankRows([Object.assign({}, internalUser, {
    socialUserId: FRIEND._id,
    nickname: FRIEND.profile.nickname,
    avatarUrl: 'https://cdn.example/ranking.png',
    avatarText: 'F',
    title: '常客',
    durationMinutes: 90,
    recordedHandCount: 3
  })], PUBLISHER._id)
  assertPublicTree(ranking, 'ranking')

  const feedCtx = setup('square', 'active', FRIEND)
  const feed = await feedCtx.feed.list_feed({ limit: 20 }, { ownerOpenId: FRIEND.ownerOpenId })
  const detail = await feedCtx.feed.get_hand_share({ shareId: feedCtx.row._id }, { ownerOpenId: FRIEND.ownerOpenId })
  assertPublicTree(feed, 'feed')
  assertPublicTree(detail, 'detail')

  const commentDto = toCommentDto(Object.assign(comment('sc_dto', FRIEND), {
    ownerOpenId: PRIVATE_CANARY,
    source: { handId: PRIVATE_CANARY },
    note: PRIVATE_CANARY,
    leakTags: [PRIVATE_CANARY]
  }))
  assertPublicTree(commentDto, 'comments')

  const notificationDto = await toNotificationDto({
    _id: 'sn_dto',
    recipientId: PUBLISHER._id,
    kind: 'comment',
    actorSnapshot: Object.assign(publicAuthor(FRIEND), { avatarFileId: 'cloud://private-notification', ownerOpenId: PRIVATE_CANARY }),
    targetType: 'hand_share',
    targetId: 'sh_matrix',
    actionState: '',
    aggregateCount: 1,
    readAt: 0,
    createdAt: 100,
    sourceEventId: PRIVATE_CANARY,
    ownerHash: PRIVATE_CANARY
  }, null, { avatarUrl: async () => 'https://cdn.example/notification.png' })
  assertPublicTree(notificationDto, 'notifications')

  const cardDto = await toCardShareDto({
    _id: 'pcs_dto',
    senderUserId: PUBLISHER._id,
    targetUserId: FRIEND._id,
    senderSnapshot: {
      socialUserId: PUBLISHER._id,
      nickname: PUBLISHER.profile.nickname,
      avatarFileId: 'cloud://private-card-sender',
      avatarText: 'P',
      ownerOpenId: PRIVATE_CANARY
    },
    snapshot: {
      avatarAsset: 'cloud://private-card-avatar',
      name: '老王',
      type: '紧凶',
      leakTags: ['过度跟注'],
      note: '河牌容易弃牌',
      ownerOpenId: PRIVATE_CANARY,
      privatePlayerId: PRIVATE_CANARY,
      battleHandIds: [PRIVATE_CANARY]
    },
    expiresAt: 999,
    importedAt: 0,
    ownerHash: PRIVATE_CANARY
  }, { avatarUrl: async () => 'https://cdn.example/card.png' })
  assertCardDto(cardDto)
})

test('scoped cache recursively rejects private identity, note, economic and venue canaries', () => {
  const previousWx = global.wx
  const writes = []
  global.wx = { setStorageSync(key, value) { writes.push({ key, value }) } }
  try {
    const forbiddenFields = [
      'ownerOpenId', 'ownerHash', 'privatePlayerId', 'playerId', 'sourceHandId', 'handId',
      'sessionId', 'note', 'notePreview', 'leakTags', 'battleHandIds',
      'profit', 'currentProfit', 'resultBB', 'allInEvProfit', 'buyIn', 'cashOut',
      'venue', 'lastVenue', 'voiceExtract', 'aiReview'
    ]
    for (const field of forbiddenFields) {
      const data = { items: [{ socialUserId: 'su_public', nested: [{ [field]: 'PRIVATE_CANARY' }] }], nextOffset: null }
      assert.equal(socialCache.writeScopedFirstPage({ namespace: 'friends', accountKey: 'WX-A', schemaVersion: 1, data }, 1000), false, field)
    }
    assert.equal(writes.length, 0)

    const publicDto = { items: [{ socialUserId: 'su_public', nickname: 'Public', title: 'Regular', statsVisible: true, durationMinutes: 60, recordedHandCount: 2 }], nextOffset: null }
    assert.equal(socialCache.writeScopedFirstPage({ namespace: 'friends', accountKey: 'WX-A', schemaVersion: 1, data: publicDto }, 1000), true)
    assert.equal(writes.length, 1)
    assertPublicTree(writes[0], 'cache envelope')
  } finally {
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
})

test('public error envelope ignores private client identity and thrown diagnostic canaries', async () => {
  let observedActor = null
  const app = createSocialApp({
    identity: { resolve: openId => ({ ownerOpenId: openId }) },
    handlers: {
      security_error_probe(event, actor) {
        observedActor = actor
        const error = new Error(`database ${PRIVATE_CANARY} cloud://private-error`)
        error.code = 'CONTENT_UNAVAILABLE'
        error.data = event
        throw error
      }
    },
    requestId: () => 'security-matrix-request'
  })
  const response = await app.handle({
    action: 'security_error_probe', viewerId: FRIEND._id, ownerOpenId: 'client-owner',
    publisherId: PUBLISHER._id, privatePlayerId: PRIVATE_CANARY, note: PRIVATE_CANARY
  }, { openId: STRANGER.ownerOpenId })

  assert.deepEqual(observedActor, { ownerOpenId: STRANGER.ownerOpenId })
  assert.deepEqual(response, {
    code: 'CONTENT_UNAVAILABLE', data: null, message: 'content unavailable', requestId: 'security-matrix-request'
  })
  assertPublicTree(response)
})
