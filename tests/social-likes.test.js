const test = require('node:test')
const assert = require('node:assert/strict')

const { createMemorySocialRepository } = require('./helpers/social-fixture')
const { createInteractionHandlers } = require('../cloudfunctions/poker_social/lib/interaction')
const { RATE_LIMITS } = require('../cloudfunctions/poker_social/lib/validation')
const { getLikeId } = require('../cloudfunctions/poker_social/lib/hand-feed')
const { getPairId } = require('../cloudfunctions/poker_social/lib/friendship')

const ACTOR = { _id: 'su_actor', ownerOpenId: 'openid-actor', privatePlayerId: 'P-actor', profile: { nickname: 'Actor', avatarText: 'A' } }
const PUBLISHER = { _id: 'su_publisher', ownerOpenId: 'openid-publisher', privatePlayerId: 'P-publisher', profile: { nickname: 'Publisher', avatarText: 'P' } }

function share(patch = {}) {
  return Object.assign({
    _id: 'sh_like', publisherId: PUBLISHER._id,
    source: { ownerOpenId: PUBLISHER.ownerOpenId, privatePlayerId: PUBLISHER.privatePlayerId, handId: 'hand-like' },
    status: 'active', scope: 'square', targetUserIds: [], likeCount: 0, commentCount: 0, createdAt: 100
  }, patch)
}

function hand(row) { return { _id: row.source.handId, ownerOpenId: row.source.ownerOpenId, privatePlayerId: row.source.privatePlayerId } }

function setup(options = {}) {
  const row = options.share || share()
  const repo = createMemorySocialRepository({
    social_users: [ACTOR, PUBLISHER], social_friendships: options.friendships || [], social_hand_shares: [row], hands: options.noHand ? [] : [hand(row)],
    social_likes: [], social_comments: [], social_rate_limits: [], social_mutations: [],
    social_notifications: [], social_notification_state: [], social_notification_heads: [], social_notification_actors: []
  })
  const handlers = createInteractionHandlers(repo, {
    now: options.now || (() => 1_000),
    notificationWriter: options.notificationWriter,
    avatarUrl: async () => ''
  })
  return { repo, handlers, row }
}

function code(promise, expected) { return assert.rejects(promise, error => error && error.code === expected) }

test('set_like is a desired-state atomic transition using the shared deterministic like id', async () => {
  const ctx = setup()
  const likeId = getLikeId(ctx.row._id, ACTOR._id)
  const liked = await ctx.handlers.set_like({ shareId: ctx.row._id, liked: true, clientMutationId: 'like-on' }, { ownerOpenId: ACTOR.ownerOpenId })
  assert.deepEqual(liked, { shareId: ctx.row._id, likedByMe: true, likeCount: 1 })
  assert.deepEqual(Object.keys(ctx.repo.get('social_likes', likeId)).sort(), ['_id', 'active', 'actorId', 'createdAt', 'shareId', 'updatedAt'])
  const noOp = await ctx.handlers.set_like({ shareId: ctx.row._id, liked: true, clientMutationId: 'like-on-noop' }, { ownerOpenId: ACTOR.ownerOpenId })
  assert.deepEqual(noOp, liked)
  assert.equal(ctx.repo.get('social_hand_shares', ctx.row._id).likeCount, 1)
  const off = await ctx.handlers.set_like({ shareId: ctx.row._id, liked: false, clientMutationId: 'like-off' }, { ownerOpenId: ACTOR.ownerOpenId })
  assert.deepEqual(off, { shareId: ctx.row._id, likedByMe: false, likeCount: 0 })
  const offAgain = await ctx.handlers.set_like({ shareId: ctx.row._id, liked: false, clientMutationId: 'like-off-noop' }, { ownerOpenId: ACTOR.ownerOpenId })
  assert.deepEqual(offAgain, off)
  assert.equal(ctx.repo.get('social_hand_shares', ctx.row._id).likeCount, 0)
})

test('like fingerprint restore, conflict, concurrency and count floor are deterministic', async () => {
  const ctx = setup({ share: share({ likeCount: -9 }) })
  const event = { shareId: ctx.row._id, liked: true, clientMutationId: 'like-retry' }
  const [first, replay] = await Promise.all([
    ctx.handlers.set_like(event, { ownerOpenId: ACTOR.ownerOpenId }),
    ctx.handlers.set_like(event, { ownerOpenId: ACTOR.ownerOpenId })
  ])
  assert.deepEqual(replay, first)
  assert.equal(ctx.repo.get('social_hand_shares', ctx.row._id).likeCount, 1)
  await code(ctx.handlers.set_like({ shareId: ctx.row._id, liked: false, clientMutationId: 'like-retry' }, { ownerOpenId: ACTOR.ownerOpenId }), 'MUTATION_CONFLICT')
  await code(ctx.handlers.set_like({ shareId: ctx.row._id, liked: 'true', clientMutationId: 'invalid-like' }, { ownerOpenId: ACTOR.ownerOpenId }), 'INVALID_LIKE')
})

test('a poisoned deterministic like document fails closed instead of becoming a desired-state no-op', async () => {
  const ctx = setup()
  const likeId = getLikeId(ctx.row._id, ACTOR._id)
  ctx.repo.set('social_likes', likeId, {
    shareId: 'sh_other', actorId: ACTOR._id, active: true, createdAt: 100, updatedAt: 100
  })
  await code(ctx.handlers.set_like({ shareId: ctx.row._id, liked: true, clientMutationId: 'poisoned-like' }, { ownerOpenId: ACTOR.ownerOpenId }), 'CONTENT_UNAVAILABLE')
  assert.equal(ctx.repo.get('social_hand_shares', ctx.row._id).likeCount, 0)
})

test('exact set_like retry rechecks withdrawn, friendship and source visibility before restoring', async () => {
  const pairId = getPairId(ACTOR._id, PUBLISHER._id)
  const pair = [ACTOR._id, PUBLISHER._id].sort()
  const accepted = { _id: pairId, userA: pair[0], userB: pair[1], status: 'accepted', acceptedAt: 100 }
  const cases = [
    {
      name: 'withdrawn',
      row: share({ _id: 'sh_like_retry_withdrawn' }),
      setup: {},
      invalidate(ctx) {
        ctx.repo.set('social_hand_shares', ctx.row._id, Object.assign({}, ctx.row, { status: 'withdrawn' }))
      }
    },
    {
      name: 'removed-friendship',
      row: share({ _id: 'sh_like_retry_friends', scope: 'friends' }),
      setup: { friendships: [accepted] },
      invalidate(ctx) {
        ctx.repo.set('social_friendships', pairId, Object.assign({}, accepted, { status: 'removed' }))
      }
    },
    {
      name: 'missing-source',
      row: share({ _id: 'sh_like_retry_source' }),
      setup: {},
      invalidate(ctx) {
        ctx.repo.set('hands', ctx.row.source.handId, { _id: ctx.row.source.handId })
      }
    }
  ]

  for (const scenario of cases) {
    const ctx = setup(Object.assign({ share: scenario.row }, scenario.setup))
    const event = { shareId: ctx.row._id, liked: true, clientMutationId: `retry-${scenario.name}` }
    await ctx.handlers.set_like(event, { ownerOpenId: ACTOR.ownerOpenId })
    scenario.invalidate(ctx)
    await code(ctx.handlers.set_like(event, { ownerOpenId: ACTOR.ownerOpenId }), 'CONTENT_UNAVAILABLE')
  }
})

test('like visibility and source failures are CONTENT_UNAVAILABLE and never consume rate', async () => {
  const withdrawn = setup({ share: share({ status: 'withdrawn' }) })
  await code(withdrawn.handlers.set_like({ shareId: withdrawn.row._id, liked: true, clientMutationId: 'withdrawn' }, { ownerOpenId: ACTOR.ownerOpenId }), 'CONTENT_UNAVAILABLE')
  assert.equal(withdrawn.repo.where('social_rate_limits', () => true).length, 0)
  const orphan = setup({ noHand: true })
  await code(orphan.handlers.set_like({ shareId: orphan.row._id, liked: true, clientMutationId: 'orphan' }, { ownerOpenId: ACTOR.ownerOpenId }), 'CONTENT_UNAVAILABLE')
  assert.equal(orphan.repo.where('social_likes', () => true).length, 0)
})

test('like rate counts only successful state changes with exact rolling boundary', async () => {
  let now = 1_000
  const ctx = setup({ now: () => now })
  let desired = true
  for (let index = 0; index < RATE_LIMITS.like.max; index += 1) {
    await ctx.handlers.set_like({ shareId: ctx.row._id, liked: desired, clientMutationId: `transition-${index}` }, { ownerOpenId: ACTOR.ownerOpenId })
    desired = !desired
  }
  await code(ctx.handlers.set_like({ shareId: ctx.row._id, liked: desired, clientMutationId: 'transition-over' }, { ownerOpenId: ACTOR.ownerOpenId }), 'RATE_LIMITED')
  const current = ctx.repo.get('social_likes', getLikeId(ctx.row._id, ACTOR._id)).active
  const noOp = await ctx.handlers.set_like({ shareId: ctx.row._id, liked: current, clientMutationId: 'full-window-noop' }, { ownerOpenId: ACTOR.ownerOpenId })
  assert.equal(noOp.likedByMe, current)
  now = 61_000
  const boundary = await ctx.handlers.set_like({ shareId: ctx.row._id, liked: !current, clientMutationId: 'transition-boundary' }, { ownerOpenId: ACTOR.ownerOpenId })
  assert.equal(boundary.likedByMe, !current)
})

test('new likes notify only the publisher and notification failure rolls back every write', async () => {
  const ctx = setup()
  await ctx.handlers.set_like({ shareId: ctx.row._id, liked: true, clientMutationId: 'notify-like' }, { ownerOpenId: ACTOR.ownerOpenId })
  const notification = ctx.repo.where('social_notifications', item => item.kind === 'like_aggregate')[0]
  assert.equal(notification.recipientId, PUBLISHER._id)
  assert.equal(notification.targetId, ctx.row._id)
  await ctx.handlers.set_like({ shareId: ctx.row._id, liked: false, clientMutationId: 'unlike-no-notify' }, { ownerOpenId: ACTOR.ownerOpenId })
  assert.equal(ctx.repo.where('social_notifications', item => item.kind === 'like_aggregate').length, 1)

  const self = setup({ share: share({ publisherId: ACTOR._id }) })
  await self.handlers.set_like({ shareId: self.row._id, liked: true, clientMutationId: 'self-like' }, { ownerOpenId: ACTOR.ownerOpenId })
  assert.equal(self.repo.where('social_notifications', () => true).length, 0)

  const failing = setup({ notificationWriter: { write: async () => {}, writeLikeAggregate: async () => { throw new Error('aggregate failed') } } })
  await assert.rejects(failing.handlers.set_like({ shareId: failing.row._id, liked: true, clientMutationId: 'rollback-like' }, { ownerOpenId: ACTOR.ownerOpenId }), /aggregate failed/)
  assert.equal(failing.repo.where('social_likes', () => true).length, 0)
  assert.equal(failing.repo.get('social_hand_shares', failing.row._id).likeCount, 0)
  assert.equal(failing.repo.where('social_rate_limits', () => true).length, 0)
  assert.equal(failing.repo.where('social_mutations', () => true).length, 0)
})
