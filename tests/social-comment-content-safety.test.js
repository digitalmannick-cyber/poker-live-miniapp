const test = require('node:test')
const assert = require('node:assert/strict')

const { createMemorySocialRepository } = require('./helpers/social-fixture')
const { createInteractionHandlers } = require('../cloudfunctions/poker_social/lib/interaction')
const { createCommentTextSafety } = require('../cloudfunctions/poker_social/lib/comment-safety')
const { getPairId } = require('../cloudfunctions/poker_social/lib/friendship')

const VIEWER = { _id: 'su_viewer', ownerOpenId: 'openid-viewer', privatePlayerId: 'P-viewer', profile: { nickname: 'Viewer', avatarText: 'V' } }
const PUBLISHER = { _id: 'su_publisher', ownerOpenId: 'openid-publisher', privatePlayerId: 'P-publisher', profile: { nickname: 'Publisher', avatarText: 'P' } }

function seed() {
  return {
    social_users: [VIEWER, PUBLISHER],
    social_friendships: [],
    social_hand_shares: [{
      _id: 'sh_square', publisherId: PUBLISHER._id,
      source: { ownerOpenId: PUBLISHER.ownerOpenId, privatePlayerId: PUBLISHER.privatePlayerId, handId: 'hand-1' },
      status: 'active', scope: 'square', targetUserIds: [], likeCount: 0, commentCount: 0, createdAt: 100
    }],
    hands: [{ _id: 'hand-1', ownerOpenId: PUBLISHER.ownerOpenId, privatePlayerId: PUBLISHER.privatePlayerId }],
    social_comments: [], social_likes: [], social_rate_limits: [], social_mutations: [],
    social_notifications: [], social_notification_state: [], social_notification_heads: [], social_notification_actors: []
  }
}

function setup(checkCommentText) {
  const repository = createMemorySocialRepository(seed())
  const handlers = createInteractionHandlers(repository, {
    now: () => 1_000,
    randomCommentId: () => 'sc_safe',
    avatarUrl: async () => '',
    checkCommentText
  })
  return { repository, handlers }
}

function create(handlers, patch = {}) {
  return handlers.create_comment(Object.assign({
    shareId: 'sh_square', parentCommentId: '', kind: 'text', text: '  好牌  ', stickerId: '', clientMutationId: 'comment-safe'
  }, patch), { ownerOpenId: VIEWER.ownerOpenId })
}

test('square text comments are checked with normalized text and server-resolved openid before persistence', async () => {
  const calls = []
  const ctx = setup(async input => { calls.push(input) })
  const result = await create(ctx.handlers)
  assert.deepEqual(calls, [{ content: '好牌', openId: VIEWER.ownerOpenId }])
  assert.equal(result.comment.text, '好牌')
  assert.equal(ctx.repository.where('social_comments', () => true).length, 1)
})

test('built-in poker sticker comments do not call text safety', async () => {
  let calls = 0
  const ctx = setup(async () => { calls += 1 })
  await create(ctx.handlers, { kind: 'sticker', text: '', stickerId: 'nice_hand' })
  assert.equal(calls, 0)
  assert.equal(ctx.repository.where('social_comments', () => true).length, 1)
})

test('friend-only text comments stay outside public comment safety', async () => {
  let calls = 0
  const ctx = setup(async () => { calls += 1 })
  ctx.repository.set('social_hand_shares', 'sh_square', Object.assign(
    {},
    ctx.repository.get('social_hand_shares', 'sh_square'),
    { scope: 'selected', targetUserIds: [VIEWER._id] }
  ))
  const friendshipId = getPairId(VIEWER._id, PUBLISHER._id)
  const pair = [VIEWER._id, PUBLISHER._id].sort()
  ctx.repository.set('social_friendships', friendshipId, {
    _id: friendshipId, userA: pair[0], userB: pair[1], status: 'accepted', acceptedAt: 100
  })
  await create(ctx.handlers)
  assert.equal(calls, 0)
  assert.equal(ctx.repository.where('social_comments', () => true).length, 1)
})

test('blocked and unavailable checks fail closed without persisting a comment', async () => {
  for (const code of ['COMMENT_CONTENT_BLOCKED', 'COMMENT_CHECK_UNAVAILABLE']) {
    const error = new Error(code)
    error.code = code
    const ctx = setup(async () => { throw error })
    await assert.rejects(create(ctx.handlers, { clientMutationId: `comment-${code}` }), current => current && current.code === code)
    assert.equal(ctx.repository.where('social_comments', () => true).length, 0)
    assert.equal(ctx.repository.where('social_rate_limits', () => true).length, 0)
  }
})

test('WeChat msgSecCheck adapter accepts pass and blocks risky or review results', async () => {
  const calls = []
  const pass = createCommentTextSafety({ security: { msgSecCheck: async input => {
    calls.push(input)
    return { errCode: 0, result: { suggest: 'pass', label: 100 } }
  } } })
  await pass({ content: '好牌', openId: 'openid-viewer' })
  assert.deepEqual(calls, [{ content: '好牌', version: 2, scene: 2, openid: 'openid-viewer' }])

  for (const suggest of ['risky', 'review']) {
    const check = createCommentTextSafety({ security: { msgSecCheck: async () => ({ result: { suggest } }) } })
    await assert.rejects(check({ content: 'bad', openId: 'openid-viewer' }), error => error && error.code === 'COMMENT_CONTENT_BLOCKED')
  }
})

test('WeChat msgSecCheck adapter treats missing API, malformed responses and API failures as unavailable', async () => {
  const checks = [
    createCommentTextSafety(null),
    createCommentTextSafety({ security: { msgSecCheck: async () => ({}) } }),
    createCommentTextSafety({ security: { msgSecCheck: async () => { throw new Error('network') } } })
  ]
  for (const check of checks) {
    await assert.rejects(check({ content: 'hello', openId: 'openid-viewer' }), error => error && error.code === 'COMMENT_CHECK_UNAVAILABLE')
  }
})

test('legacy risky error 87014 is blocked rather than reported as an outage', async () => {
  const check = createCommentTextSafety({ security: { msgSecCheck: async () => {
    const error = new Error('risky')
    error.errCode = 87014
    throw error
  } } })
  await assert.rejects(check({ content: 'bad', openId: 'openid-viewer' }), error => error && error.code === 'COMMENT_CONTENT_BLOCKED')
})

test('social app exposes fixed safe error codes without leaking checker details', async () => {
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  for (const code of ['COMMENT_CONTENT_BLOCKED', 'COMMENT_CHECK_UNAVAILABLE']) {
    const repository = createMemorySocialRepository(seed())
    const app = createSocialApp({
      repository,
      identity: { resolve: openId => ({ ownerOpenId: openId }) },
      interaction: {
        now: () => 1_000,
        randomCommentId: () => 'sc_app_safe',
        checkCommentText: async () => {
          const error = new Error('private checker diagnostics')
          error.code = code
          throw error
        }
      },
      requestId: () => 'comment-safety-route'
    })
    const result = await app.handle({
      action: 'create_comment', shareId: 'sh_square', parentCommentId: '', kind: 'text', text: 'hello', stickerId: '', clientMutationId: `app-${code}`
    }, { openId: VIEWER.ownerOpenId })
    assert.deepEqual(result, {
      code,
      data: null,
      message: code === 'COMMENT_CONTENT_BLOCKED' ? 'comment content blocked' : 'comment check unavailable',
      requestId: 'comment-safety-route'
    })
  }
})
