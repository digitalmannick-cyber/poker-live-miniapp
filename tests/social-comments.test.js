const test = require('node:test')
const assert = require('node:assert/strict')

const { createMemorySocialRepository } = require('./helpers/social-fixture')
const { createInteractionHandlers, toCommentDto } = require('../cloudfunctions/poker_social/lib/interaction')
const { POKER_STICKER_IDS } = require('../cloudfunctions/poker_social/lib/poker-stickers')
const { POKER_STICKER_IDS: CLIENT_POKER_STICKER_IDS } = require('../utils/poker-stickers')
const { RATE_LIMITS } = require('../cloudfunctions/poker_social/lib/validation')
const { getPairId } = require('../cloudfunctions/poker_social/lib/friendship')
const { createCloudSocialRepository } = require('../cloudfunctions/poker_social/lib/repository')

const VIEWER = { _id: 'su_viewer', ownerOpenId: 'openid-viewer', privatePlayerId: 'P-viewer', profile: { nickname: 'Viewer', avatarText: 'V' } }
const PUBLISHER = { _id: 'su_publisher', ownerOpenId: 'openid-publisher', privatePlayerId: 'P-publisher', profile: { nickname: 'Publisher', avatarText: 'P' } }
const OTHER = { _id: 'su_other', ownerOpenId: 'openid-other', privatePlayerId: 'P-other', profile: { nickname: 'Other', avatarText: 'O' } }

function share(id = 'sh_square', scope = 'square', patch = {}) {
  return Object.assign({
    _id: id,
    publisherId: PUBLISHER._id,
    source: { ownerOpenId: PUBLISHER.ownerOpenId, privatePlayerId: PUBLISHER.privatePlayerId, handId: `hand-${id}` },
    status: 'active', scope, targetUserIds: scope === 'selected' ? [VIEWER._id] : [],
    likeCount: 0, commentCount: 0, createdAt: 100
  }, patch)
}

function hand(row) {
  return { _id: row.source.handId, ownerOpenId: row.source.ownerOpenId, privatePlayerId: row.source.privatePlayerId }
}

function accepted(left, right, status = 'accepted') {
  const pair = [left, right].sort()
  return { _id: getPairId(left, right), userA: pair[0], userB: pair[1], status, acceptedAt: 100 }
}

function repository(seed = {}) {
  const repo = createMemorySocialRepository(Object.assign({
    social_users: [VIEWER, PUBLISHER, OTHER], social_friendships: [], social_hand_shares: [], hands: [],
    social_comments: [], social_likes: [], social_rate_limits: [], social_mutations: [],
    social_notifications: [], social_notification_state: [], social_notification_heads: [], social_notification_actors: []
  }, seed))
  repo.listComments = async (shareId, page) => {
    const cursor = page && page.cursor
    const limit = page && page.limit
    return repo.where('social_comments', row => row.shareId === shareId)
      .sort((left, right) => right.createdAt - left.createdAt || String(right._id).localeCompare(String(left._id)))
      .filter(row => !cursor || row.createdAt < cursor.createdAt || (row.createdAt === cursor.createdAt && row._id < cursor.id))
      .slice(0, limit)
  }
  return repo
}

function setup(seed, options = {}) {
  const repo = repository(seed)
  let sequence = 0
  const handlers = createInteractionHandlers(repo, Object.assign({
    now: () => 1_000,
    randomCommentId: () => `sc_${++sequence}`,
    avatarUrl: async () => 'https://avatar.example/image.png'
  }, options))
  return { repo, handlers }
}

function code(promise, expected) {
  return assert.rejects(promise, error => error && error.code === expected)
}

test('server sticker ids are immutable and exactly match the frozen UI order', () => {
  assert.deepEqual(POKER_STICKER_IDS, ['all_in', 'nice_hand', 'hero_call', 'bad_beat', 'good_fold', 'thinking'])
  assert.deepEqual(POKER_STICKER_IDS, CLIENT_POKER_STICKER_IDS)
  assert.equal(Object.isFrozen(POKER_STICKER_IDS), true)
})

test('comments and one-level replies validate Unicode content and preserve replies after a parent soft delete', async () => {
  const row = share()
  const ctx = setup({ social_hand_shares: [row], hands: [hand(row)] })
  const top = await ctx.handlers.create_comment({
    shareId: row._id, parentCommentId: '', kind: 'text', text: '  好牌😀  ', stickerId: '', clientMutationId: 'comment-top'
  }, { ownerOpenId: VIEWER.ownerOpenId })
  assert.equal(top.comment.text, '好牌😀')
  assert.equal(top.commentCount, 1)
  const reply = await ctx.handlers.create_comment({
    shareId: row._id, parentCommentId: top.comment.commentId, kind: 'sticker', text: '', stickerId: 'hero_call', clientMutationId: 'comment-reply'
  }, { ownerOpenId: OTHER.ownerOpenId })
  assert.equal(reply.comment.parentCommentId, top.comment.commentId)
  assert.equal(reply.commentCount, 2)

  await code(ctx.handlers.create_comment({ shareId: row._id, parentCommentId: reply.comment.commentId, kind: 'text', text: 'nested', stickerId: '', clientMutationId: 'nested' }, { ownerOpenId: VIEWER.ownerOpenId }), 'INVALID_COMMENT')
  await code(ctx.handlers.create_comment({ shareId: row._id, parentCommentId: { commentId: top.comment.commentId }, kind: 'text', text: 'coerced', stickerId: '', clientMutationId: 'object-parent' }, { ownerOpenId: VIEWER.ownerOpenId }), 'INVALID_COMMENT')
  await code(ctx.handlers.create_comment({ shareId: row._id, parentCommentId: top.comment.commentId, kind: 'sticker', text: 'mixed', stickerId: 'hero_call', clientMutationId: 'mixed' }, { ownerOpenId: VIEWER.ownerOpenId }), 'INVALID_COMMENT')
  await code(ctx.handlers.create_comment({ shareId: row._id, parentCommentId: '', kind: 'sticker', text: '', stickerId: 'unknown', clientMutationId: 'unknown-sticker' }, { ownerOpenId: VIEWER.ownerOpenId }), 'INVALID_COMMENT')
  for (const [length, valid] of [[1, true], [300, true], [301, false]]) {
    const event = { shareId: row._id, parentCommentId: '', kind: 'text', text: '😀'.repeat(length), stickerId: '', clientMutationId: `unicode-${length}` }
    if (valid) assert.equal((await ctx.handlers.create_comment(event, { ownerOpenId: VIEWER.ownerOpenId })).comment.text.length > 0, true)
    else await code(ctx.handlers.create_comment(event, { ownerOpenId: VIEWER.ownerOpenId }), 'INVALID_COMMENT')
  }

  await code(ctx.handlers.delete_comment({ commentId: top.comment.commentId, clientMutationId: 'publisher-cannot-delete' }, { ownerOpenId: PUBLISHER.ownerOpenId }), 'FORBIDDEN')
  const removed = await ctx.handlers.delete_comment({ commentId: top.comment.commentId, clientMutationId: 'author-delete' }, { ownerOpenId: VIEWER.ownerOpenId })
  assert.deepEqual(removed.comment, Object.assign({}, top.comment, { kind: 'text', text: '该评论已删除', stickerId: '', deleted: true }))
  assert.equal(removed.commentCount, 3)
  const listed = await ctx.handlers.list_comments({ shareId: row._id, limit: 20 }, { ownerOpenId: VIEWER.ownerOpenId })
  assert.equal(listed.items.find(item => item.commentId === reply.comment.commentId).parentCommentId, top.comment.commentId)
  await code(ctx.handlers.create_comment({ shareId: row._id, parentCommentId: top.comment.commentId, kind: 'text', text: 'too late', stickerId: '', clientMutationId: 'deleted-parent' }, { ownerOpenId: OTHER.ownerOpenId }), 'INVALID_COMMENT')
})

test('comment visibility and source checks fail closed while an author may privacy-delete after withdrawal', async () => {
  const square = share('sh_square', 'square')
  const friends = share('sh_friends', 'friends')
  const selected = share('sh_selected', 'selected')
  const ctx = setup({
    social_friendships: [accepted(VIEWER._id, PUBLISHER._id)],
    social_hand_shares: [square, friends, selected], hands: [hand(square), hand(friends), hand(selected)]
  })
  for (const row of [square, friends, selected]) {
    const created = await ctx.handlers.create_comment({ shareId: row._id, parentCommentId: '', kind: 'text', text: row._id, stickerId: '', clientMutationId: `create-${row._id}` }, { ownerOpenId: VIEWER.ownerOpenId })
    assert.equal(created.comment.shareId, row._id)
  }
  ctx.repo.set('social_friendships', getPairId(VIEWER._id, PUBLISHER._id), accepted(VIEWER._id, PUBLISHER._id, 'removed'))
  await code(ctx.handlers.list_comments({ shareId: friends._id, limit: 20 }, { ownerOpenId: VIEWER.ownerOpenId }), 'CONTENT_UNAVAILABLE')
  await code(ctx.handlers.create_comment({ shareId: selected._id, parentCommentId: '', kind: 'text', text: 'no', stickerId: '', clientMutationId: 'removed-create' }, { ownerOpenId: VIEWER.ownerOpenId }), 'CONTENT_UNAVAILABLE')

  const own = ctx.repo.where('social_comments', item => item.shareId === friends._id)[0]
  ctx.repo.set('social_hand_shares', friends._id, Object.assign({}, friends, { status: 'withdrawn' }))
  const cleanup = await ctx.handlers.delete_comment({ commentId: own._id, clientMutationId: 'privacy-cleanup' }, { ownerOpenId: VIEWER.ownerOpenId })
  assert.deepEqual(Object.keys(cleanup), ['comment'])
  assert.equal(cleanup.comment.deleted, true)
  ctx.repo.set('social_hand_shares', square._id, square)
  ctx.repo.set('hands', square.source.handId, Object.assign({}, hand(square), { ownerOpenId: 'wrong' }))
  await code(ctx.handlers.list_comments({ shareId: square._id, limit: 20 }, { ownerOpenId: VIEWER.ownerOpenId }), 'CONTENT_UNAVAILABLE')
})

test('delete_comment restore reshapes from current visibility and never leaks an old commentCount', async () => {
  const cases = [
    {
      name: 'withdrawn',
      row: share('sh_delete_retry_withdrawn'),
      seed: {},
      invalidate(ctx, row) {
        ctx.repo.set('social_hand_shares', row._id, Object.assign({}, row, { status: 'withdrawn', commentCount: 999 }))
      }
    },
    {
      name: 'removed-friendship',
      row: share('sh_delete_retry_friends', 'friends'),
      seed: { social_friendships: [accepted(VIEWER._id, PUBLISHER._id)] },
      invalidate(ctx, row) {
        ctx.repo.set('social_friendships', getPairId(VIEWER._id, PUBLISHER._id), accepted(VIEWER._id, PUBLISHER._id, 'removed'))
        ctx.repo.set('social_hand_shares', row._id, Object.assign({}, row, { commentCount: 999 }))
      }
    },
    {
      name: 'missing-source',
      row: share('sh_delete_retry_source'),
      seed: {},
      invalidate(ctx, row) {
        ctx.repo.set('hands', row.source.handId, { _id: row.source.handId })
        ctx.repo.set('social_hand_shares', row._id, Object.assign({}, row, { commentCount: 999 }))
      }
    }
  ]

  for (const scenario of cases) {
    const ctx = setup(Object.assign({}, scenario.seed, {
      social_hand_shares: [scenario.row],
      hands: [hand(scenario.row)]
    }))
    const created = await ctx.handlers.create_comment({
      shareId: scenario.row._id, parentCommentId: '', kind: 'text', text: scenario.name, stickerId: '', clientMutationId: `create-${scenario.name}`
    }, { ownerOpenId: VIEWER.ownerOpenId })
    const deletion = { commentId: created.comment.commentId, clientMutationId: `delete-${scenario.name}` }
    const first = await ctx.handlers.delete_comment(deletion, { ownerOpenId: VIEWER.ownerOpenId })
    assert.equal(first.commentCount, 0)
    scenario.invalidate(ctx, scenario.row)
    const restored = await ctx.handlers.delete_comment(deletion, { ownerOpenId: VIEWER.ownerOpenId })
    assert.deepEqual(Object.keys(restored), ['comment'])
    assert.equal(restored.comment.commentId, created.comment.commentId)
    assert.equal(restored.comment.deleted, true)
  }
})

test('reply creation fails closed for malformed persisted parent state and author snapshots', async () => {
  const row = share('sh_parent_shape')
  const base = {
    _id: 'sc_parent', shareId: row._id, parentCommentId: '', authorId: OTHER._id,
    authorSnapshot: { socialUserId: OTHER._id, nickname: 'Other', avatarUrl: '', avatarText: 'O' },
    kind: 'text', text: 'parent', stickerId: '', deleted: false, createdAt: 100, updatedAt: 100
  }
  for (const [name, patch] of [
    ['non-boolean-deleted', { deleted: 'false' }],
    ['missing-author', { authorId: '' }],
    ['missing-author-snapshot', { authorSnapshot: null }]
  ]) {
    const ctx = setup({ social_hand_shares: [row], hands: [hand(row)], social_comments: [Object.assign({}, base, patch)] })
    await code(ctx.handlers.create_comment({
      shareId: row._id, parentCommentId: base._id, kind: 'text', text: name, stickerId: '', clientMutationId: `reply-${name}`
    }, { ownerOpenId: VIEWER.ownerOpenId }), 'INVALID_COMMENT')
  }
})

test('comments use strict flat keyset DTOs and recursive public responses contain no private fields', async () => {
  const row = share()
  const comments = [300, 200, 100].map((createdAt, index) => ({
    _id: `sc_${3 - index}`, shareId: row._id, parentCommentId: '', authorId: VIEWER._id,
    authorSnapshot: { socialUserId: VIEWER._id, nickname: 'Viewer', avatarUrl: '', avatarText: 'V', ownerOpenId: 'CANARY' },
    kind: 'text', text: `c${index}`, stickerId: '', deleted: false, createdAt,
    ownerOpenId: 'CANARY', clientMutationId: 'CANARY'
  }))
  const ctx = setup({ social_hand_shares: [row], hands: [hand(row)], social_comments: comments })
  const first = await ctx.handlers.list_comments({ shareId: row._id, cursor: '', limit: 2 }, { ownerOpenId: VIEWER.ownerOpenId })
  assert.deepEqual(first.items.map(item => item.commentId), ['sc_3', 'sc_2'])
  assert.equal(typeof first.nextCursor, 'string')
  const second = await ctx.handlers.list_comments({ shareId: row._id, cursor: first.nextCursor, limit: 2 }, { ownerOpenId: VIEWER.ownerOpenId })
  assert.deepEqual(second.items.map(item => item.commentId), ['sc_1'])
  assert.equal(second.nextCursor, null)
  const allowed = ['commentId', 'shareId', 'parentCommentId', 'author', 'kind', 'text', 'stickerId', 'deleted', 'createdAt'].sort()
  for (const item of first.items.concat(second.items)) assert.deepEqual(Object.keys(item).sort(), allowed)
  assert.doesNotMatch(JSON.stringify({ first, second }), /authorId|ownerOpenId|privatePlayerId|clientMutationId|CANARY/)
  for (const cursor of [null, 1, {}, 'bad+cursor']) await code(ctx.handlers.list_comments({ shareId: row._id, cursor, limit: 2 }, { ownerOpenId: VIEWER.ownerOpenId }), 'INVALID_PAGINATION')
})

test('CommentDto fails closed for malformed persisted content and author leaves', () => {
  const base = {
    _id: 'sc_bad', shareId: 'sh_bad', parentCommentId: '', authorId: VIEWER._id,
    authorSnapshot: { socialUserId: VIEWER._id, nickname: 'Viewer', avatarUrl: '', avatarText: 'V' },
    kind: 'text', text: 'valid', stickerId: '', deleted: false, createdAt: 100
  }
  for (const patch of [
    { kind: 'sticker', text: 'mixed', stickerId: 'hero_call' },
    { kind: 'sticker', text: '', stickerId: 'unknown' },
    { authorSnapshot: Object.assign({}, base.authorSnapshot, { socialUserId: 123 }) }
  ]) {
    assert.throws(() => toCommentDto(Object.assign({}, base, patch)), error => error && error.code === 'CONTENT_UNAVAILABLE')
  }
})

test('comment mutation, count, rate, notification and rollback share one transaction', async () => {
  let now = 1_000
  const row = share()
  const ctx = setup({ social_hand_shares: [row], hands: [hand(row)] }, { now: () => now })
  const input = { shareId: row._id, parentCommentId: '', kind: 'text', text: 'once', stickerId: '', clientMutationId: 'same-comment' }
  const first = await ctx.handlers.create_comment(input, { ownerOpenId: VIEWER.ownerOpenId })
  assert.deepEqual(await ctx.handlers.create_comment(input, { ownerOpenId: VIEWER.ownerOpenId }), first)
  await code(ctx.handlers.create_comment(Object.assign({}, input, { text: 'changed' }), { ownerOpenId: VIEWER.ownerOpenId }), 'MUTATION_CONFLICT')
  assert.equal(ctx.repo.get('social_hand_shares', row._id).commentCount, 1)
  const note = ctx.repo.where('social_notifications', item => item.kind === 'comment')[0]
  assert.equal(note.recipientId, PUBLISHER._id)
  assert.equal(note.sourceEventId, `comment:${first.comment.commentId}`)

  for (let index = 1; index < RATE_LIMITS.comment.max; index += 1) {
    await ctx.handlers.create_comment({ shareId: row._id, parentCommentId: '', kind: 'text', text: `c${index}`, stickerId: '', clientMutationId: `rate-${index}` }, { ownerOpenId: VIEWER.ownerOpenId })
  }
  await code(ctx.handlers.create_comment({ shareId: row._id, parentCommentId: '', kind: 'text', text: 'over', stickerId: '', clientMutationId: 'rate-over' }, { ownerOpenId: VIEWER.ownerOpenId }), 'RATE_LIMITED')
  now = 61_000
  await ctx.handlers.create_comment({ shareId: row._id, parentCommentId: '', kind: 'text', text: 'boundary', stickerId: '', clientMutationId: 'rate-boundary' }, { ownerOpenId: VIEWER.ownerOpenId })

  const failing = setup({ social_hand_shares: [row], hands: [hand(row)] }, {
    notificationWriter: { write: async () => { throw new Error('notification failed') }, writeLikeAggregate: async () => {} }
  })
  await assert.rejects(failing.handlers.create_comment({ shareId: row._id, parentCommentId: '', kind: 'text', text: 'rollback', stickerId: '', clientMutationId: 'rollback' }, { ownerOpenId: VIEWER.ownerOpenId }), /notification failed/)
  assert.equal(failing.repo.where('social_comments', () => true).length, 0)
  assert.equal(failing.repo.get('social_hand_shares', row._id).commentCount, 0)
  assert.equal(failing.repo.where('social_mutations', () => true).length, 0)
})

test('exact comment mutation restore does not repeat avatar resolution', async () => {
  let avatarAvailable = true
  const row = share()
  const ctx = setup({ social_hand_shares: [row], hands: [hand(row)] }, {
    avatarUrl: async () => {
      if (!avatarAvailable) throw new Error('avatar resolver offline')
      return 'https://avatar.example/image.png'
    }
  })
  ctx.repo.set('social_users', VIEWER._id, Object.assign({}, VIEWER, { profile: Object.assign({}, VIEWER.profile, { avatarFileId: 'cloud://avatar-viewer' }) }))
  const event = { shareId: row._id, parentCommentId: '', kind: 'text', text: 'restore', stickerId: '', clientMutationId: 'restore-avatar' }
  const first = await ctx.handlers.create_comment(event, { ownerOpenId: VIEWER.ownerOpenId })
  avatarAvailable = false
  assert.deepEqual(await ctx.handlers.create_comment(event, { ownerOpenId: VIEWER.ownerOpenId }), first)
})

test('exact create_comment retry rechecks withdrawn, friendship and source visibility before restoring', async () => {
  const cases = [
    {
      name: 'withdrawn',
      row: share('sh_retry_withdrawn'),
      seed: {},
      invalidate(ctx, row) {
        ctx.repo.set('social_hand_shares', row._id, Object.assign({}, row, { status: 'withdrawn' }))
      }
    },
    {
      name: 'removed-friendship',
      row: share('sh_retry_friends', 'friends'),
      seed: { social_friendships: [accepted(VIEWER._id, PUBLISHER._id)] },
      invalidate(ctx) {
        ctx.repo.set('social_friendships', getPairId(VIEWER._id, PUBLISHER._id), accepted(VIEWER._id, PUBLISHER._id, 'removed'))
      }
    },
    {
      name: 'missing-source',
      row: share('sh_retry_source'),
      seed: {},
      invalidate(ctx, row) {
        ctx.repo.set('hands', row.source.handId, { _id: row.source.handId })
      }
    }
  ]

  for (const scenario of cases) {
    const ctx = setup(Object.assign({}, scenario.seed, {
      social_hand_shares: [scenario.row],
      hands: [hand(scenario.row)]
    }))
    const event = {
      shareId: scenario.row._id,
      parentCommentId: '',
      kind: 'text',
      text: scenario.name,
      stickerId: '',
      clientMutationId: `retry-${scenario.name}`
    }
    await ctx.handlers.create_comment(event, { ownerOpenId: VIEWER.ownerOpenId })
    scenario.invalidate(ctx, scenario.row)
    await code(ctx.handlers.create_comment(event, { ownerOpenId: VIEWER.ownerOpenId }), 'CONTENT_UNAVAILABLE')
  }
})

test('social app routes interaction actions and preserves fixed public validation errors', async () => {
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const row = share()
  const repo = repository({ social_hand_shares: [row], hands: [hand(row)] })
  const app = createSocialApp({
    repository: repo,
    identity: { resolve: openId => ({ ownerOpenId: openId }) },
    interaction: { now: () => 1_000, randomCommentId: () => 'sc_app' },
    requestId: () => 'interaction-route'
  })
  const created = await app.handle({
    action: 'create_comment', shareId: row._id, parentCommentId: '', kind: 'text', text: 'hello', stickerId: '', clientMutationId: 'app-comment'
  }, { openId: VIEWER.ownerOpenId })
  assert.equal(created.code, 0)
  assert.equal(created.data.comment.commentId, 'sc_app')
  const invalid = await app.handle({
    action: 'create_comment', shareId: row._id, parentCommentId: '', kind: 'text', text: '', stickerId: '', clientMutationId: 'app-invalid'
  }, { openId: VIEWER.ownerOpenId })
  assert.deepEqual(invalid, { code: 'INVALID_COMMENT', data: null, message: 'invalid comment', requestId: 'interaction-route' })
})

test('CloudBase repository exposes a share-scoped descending comment keyset query without skip', async () => {
  const calls = []
  const command = {
    lt: value => ({ op: 'lt', value }),
    eq: value => ({ op: 'eq', value }),
    and: values => ({ op: 'and', values }),
    or: values => ({ op: 'or', values })
  }
  const database = {
    command,
    collection(name) {
      return {
        where(filters) {
          const state = { name, filters, orders: [], limit: 0 }
          return {
            orderBy(field, direction) { state.orders.push([field, direction]); return this },
            limit(value) { state.limit = value; return this },
            skip() { throw new Error('skip forbidden') },
            async get() { calls.push(state); return { data: [] } }
          }
        },
        doc() { return { async get() { return { data: null } } } }
      }
    },
    runTransaction() { throw new Error('not used') }
  }
  const repo = createCloudSocialRepository(database)
  assert.equal(typeof repo.listComments, 'function')
  await repo.listComments('sh_query', { cursor: { createdAt: 100, id: 'sc_cursor' }, limit: 21 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'social_comments')
  assert.equal(calls[0].limit, 21)
  assert.deepEqual(calls[0].orders, [['createdAt', 'desc'], ['_id', 'desc']])
  assert.match(JSON.stringify(calls[0].filters), /sh_query|createdAt|sc_cursor/)
})
