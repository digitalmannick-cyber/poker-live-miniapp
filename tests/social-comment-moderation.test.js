const test = require('node:test')
const assert = require('node:assert/strict')

const { createMemorySocialRepository } = require('./helpers/social-fixture')
const { createInteractionHandlers, toCommentDto } = require('../cloudfunctions/poker_social/lib/interaction')

const ADMIN = { _id: 'su_admin', ownerOpenId: 'openid-admin', profile: { nickname: 'Admin', avatarText: 'A' } }
const AUTHOR = { _id: 'su_author', ownerOpenId: 'openid-author', profile: { nickname: 'Author', avatarText: 'U' } }
const PUBLISHER = { _id: 'su_publisher', ownerOpenId: 'openid-publisher', profile: { nickname: 'Publisher', avatarText: 'P' } }

function comment(patch = {}) {
  return Object.assign({
    _id: 'sc_target', shareId: 'sh_target', parentCommentId: '', authorId: AUTHOR._id,
    authorSnapshot: { socialUserId: AUTHOR._id, nickname: 'Author', avatarUrl: '', avatarText: 'U' },
    kind: 'text', text: '需要处置', stickerId: '', deleted: false, createdAt: 100, updatedAt: 100
  }, patch)
}

function share(patch = {}) {
  return Object.assign({
    _id: 'sh_target', publisherId: PUBLISHER._id,
    source: { ownerOpenId: PUBLISHER.ownerOpenId, privatePlayerId: 'P-PUBLISHER', handId: 'hand-target' },
    status: 'active', scope: 'square', targetUserIds: [], likeCount: 0, commentCount: 1,
    createdAt: 100, updatedAt: 100
  }, patch)
}

function setup(seed = {}, options = {}) {
  const repo = createMemorySocialRepository(Object.assign({
    social_users: [ADMIN, AUTHOR, PUBLISHER], social_comments: [comment()], social_hand_shares: [share()],
    hands: [{ _id: 'hand-target', ownerOpenId: PUBLISHER.ownerOpenId, privatePlayerId: 'P-PUBLISHER' }],
    social_mutations: [], social_moderation_audits: []
  }, seed))
  const handlers = createInteractionHandlers(repo, Object.assign({
    now: () => 1000,
    isAdminActor: actor => actor && actor.ownerOpenId === ADMIN.ownerOpenId
  }, options))
  return { repo, handlers }
}

function expectCode(promise, expected) {
  return assert.rejects(promise, error => error && error.code === expected)
}

test('admin soft-deletes another user comment and writes one private audit atomically', async () => {
  const ctx = setup()
  const event = { commentId: 'sc_target', reason: 'abuse', clientMutationId: 'moderate-once' }
  const first = await ctx.handlers.admin_delete_comment(event, { ownerOpenId: ADMIN.ownerOpenId })
  assert.equal(first.comment.text, '该评论已被管理员移除')
  assert.equal(first.comment.deleted, true)
  assert.equal(first.commentCount, 0)
  assert.equal(ctx.repo.get('social_hand_shares', 'sh_target').commentCount, 0)
  const stored = ctx.repo.get('social_comments', 'sc_target')
  assert.equal(stored.deletionKind, 'admin')
  assert.equal(stored.moderationReason, 'abuse')

  const audits = ctx.repo.where('social_moderation_audits', () => true)
  assert.equal(audits.length, 1)
  assert.deepEqual(Object.keys(audits[0]).sort(), [
    '_id', 'action', 'clientMutationId', 'commentId', 'createdAt', 'moderatorId', 'moderatorRedacted',
    'reason', 'shareId', 'targetAuthorId', 'targetRedacted', 'targetType'
  ].sort())
  assert.equal(audits[0].moderatorId, ADMIN._id)
  assert.equal(audits[0].targetAuthorId, AUTHOR._id)
  assert.equal(audits[0].action, 'admin_delete_comment')
  assert.doesNotMatch(JSON.stringify(audits[0]), /openid|privatePlayerId/)

  assert.deepEqual(await ctx.handlers.admin_delete_comment(event, { ownerOpenId: ADMIN.ownerOpenId }), first)
  assert.equal(ctx.repo.where('social_moderation_audits', () => true).length, 1)
  assert.equal(ctx.repo.get('social_hand_shares', 'sh_target').commentCount, 0)
})

test('admin moderation rejects forged authority, invalid reasons and mutation reuse', async () => {
  const ctx = setup()
  for (const actor of [
    { ownerOpenId: AUTHOR.ownerOpenId, isAdmin: true },
    { ownerOpenId: PUBLISHER.ownerOpenId },
    { ownerOpenId: '' }
  ]) {
    await expectCode(ctx.handlers.admin_delete_comment({
      commentId: 'sc_target', reason: 'spam', clientMutationId: `forbidden-${actor.ownerOpenId || 'empty'}`
    }, actor), 'FORBIDDEN')
  }
  for (const reason of [undefined, '', ' spam ', 'unknown', {}, 1]) {
    await expectCode(ctx.handlers.admin_delete_comment({
      commentId: 'sc_target', reason, clientMutationId: `bad-reason-${String(reason)}`
    }, { ownerOpenId: ADMIN.ownerOpenId }), 'INVALID_MODERATION_REASON')
  }
  const event = { commentId: 'sc_target', reason: 'spam', clientMutationId: 'same-mutation' }
  await ctx.handlers.admin_delete_comment(event, { ownerOpenId: ADMIN.ownerOpenId })
  await expectCode(ctx.handlers.admin_delete_comment(Object.assign({}, event, { reason: 'other' }), { ownerOpenId: ADMIN.ownerOpenId }), 'MUTATION_CONFLICT')
})

test('moderation rechecks transactional identity and rolls all writes back on audit failure', async () => {
  const identityChanged = setup()
  const originalFind = identityChanged.repo.findSocialUserByOpenId
  identityChanged.repo.findSocialUserByOpenId = async ownerOpenId => ownerOpenId === ADMIN.ownerOpenId ? ADMIN : originalFind(ownerOpenId)
  identityChanged.repo.set('social_users', ADMIN._id, Object.assign({}, ADMIN, { ownerOpenId: 'changed' }))
  await expectCode(identityChanged.handlers.admin_delete_comment({
    commentId: 'sc_target', reason: 'privacy', clientMutationId: 'identity-changed'
  }, { ownerOpenId: ADMIN.ownerOpenId }), 'FORBIDDEN')

  const failing = setup({}, { auditId: () => { throw new Error('audit failed') } })
  await assert.rejects(failing.handlers.admin_delete_comment({
    commentId: 'sc_target', reason: 'privacy', clientMutationId: 'audit-failure'
  }, { ownerOpenId: ADMIN.ownerOpenId }), /audit failed/)
  assert.equal(failing.repo.get('social_comments', 'sc_target').deleted, false)
  assert.equal(failing.repo.get('social_hand_shares', 'sh_target').commentCount, 1)
  assert.equal(failing.repo.where('social_moderation_audits', () => true).length, 0)
})

test('withdrawn share returns no count and cleared target is redacted in a new audit', async () => {
  const ctx = setup({
    social_users: [ADMIN, Object.assign({}, AUTHOR, { deleted: true, socialLifecycle: 'deleted' }), PUBLISHER],
    social_hand_shares: [share({ status: 'withdrawn' })]
  })
  const result = await ctx.handlers.admin_delete_comment({
    commentId: 'sc_target', reason: 'privacy', clientMutationId: 'withdrawn-redacted'
  }, { ownerOpenId: ADMIN.ownerOpenId })
  assert.deepEqual(Object.keys(result), ['comment'])
  const audit = ctx.repo.where('social_moderation_audits', () => true)[0]
  assert.equal(audit.targetAuthorId, '')
  assert.equal(audit.targetRedacted, true)
})

test('author deletion records author kind, legacy deleted rows stay compatible, and invalid kinds fail closed', () => {
  assert.equal(toCommentDto(comment({ deleted: true, deletionKind: 'author' })).text, '该评论已删除')
  assert.equal(toCommentDto(comment({ deleted: true, deletionKind: undefined })).text, '该评论已删除')
  assert.equal(toCommentDto(comment({ deleted: true, deletionKind: 'admin' })).text, '该评论已被管理员移除')
  assert.throws(() => toCommentDto(comment({ deleted: true, deletionKind: 'forged' })), error => error && error.code === 'CONTENT_UNAVAILABLE')
})

test('an author-deleted comment cannot be converted into an administrator action', async () => {
  const ctx = setup({ social_comments: [comment({ deleted: true, deletionKind: 'author', deletedAt: 500 })] })
  await expectCode(ctx.handlers.admin_delete_comment({
    commentId: 'sc_target', reason: 'other', clientMutationId: 'already-author-deleted'
  }, { ownerOpenId: ADMIN.ownerOpenId }), 'CONTENT_UNAVAILABLE')
  assert.equal(ctx.repo.where('social_moderation_audits', () => true).length, 0)
})

test('moderation fails closed for a corrupted share status without changing comment, count or audit', async () => {
  const ctx = setup({ social_hand_shares: [share({ status: 'corrupted' })] })
  await expectCode(ctx.handlers.admin_delete_comment({
    commentId: 'sc_target', reason: 'other', clientMutationId: 'bad-share-status'
  }, { ownerOpenId: ADMIN.ownerOpenId }), 'CONTENT_UNAVAILABLE')
  assert.equal(ctx.repo.get('social_comments', 'sc_target').deleted, false)
  assert.equal(ctx.repo.get('social_hand_shares', 'sh_target').commentCount, 1)
  assert.equal(ctx.repo.where('social_moderation_audits', () => true).length, 0)
})

test('an occupied deterministic audit id rolls the moderation transaction back without overwriting evidence', async () => {
  const occupiedId = 'sma_' + 'a'.repeat(64)
  const existing = { _id: occupiedId, action: 'admin_delete_comment', reason: 'spam', createdAt: 50 }
  const ctx = setup({ social_moderation_audits: [existing] }, { auditId: () => occupiedId })
  await assert.rejects(ctx.handlers.admin_delete_comment({
    commentId: 'sc_target', reason: 'other', clientMutationId: 'audit-collision'
  }, { ownerOpenId: ADMIN.ownerOpenId }), /moderation audit unavailable/)
  assert.equal(ctx.repo.get('social_comments', 'sc_target').deleted, false)
  assert.equal(ctx.repo.get('social_hand_shares', 'sh_target').commentCount, 1)
  assert.deepEqual(ctx.repo.get('social_moderation_audits', occupiedId), existing)
})
