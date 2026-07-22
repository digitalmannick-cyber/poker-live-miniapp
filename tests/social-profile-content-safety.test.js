const test = require('node:test')
const assert = require('node:assert/strict')

const { createMemorySocialRepository } = require('./helpers/social-fixture')
const { createProfileHandlers } = require('../cloudfunctions/poker_social/lib/profile')
const { createProfileTextSafety } = require('../cloudfunctions/poker_social/lib/comment-safety')

const ACTOR = { ownerOpenId: 'openid-profile' }

function profileInput(patch) {
  return Object.assign({
    playerId: 'wx-profile',
    nickname: '安全昵称',
    avatarMode: 'custom',
    avatarFileId: 'cloud://avatar',
    statsVisible: true,
    defaultShareScope: 'friends'
  }, patch || {})
}

function existingProfile() {
  return {
    _id: 'su_profile',
    ownerOpenId: ACTOR.ownerOpenId,
    privatePlayerId: 'WX-PROFILE',
    profile: { nickname: '旧昵称', avatarFileId: 'cloud://old', avatarText: '旧' },
    avatarMode: 'custom',
    statsVisible: true,
    defaultShareScope: 'friends',
    createdAt: 100,
    updatedAt: 100
  }
}

function setup(seed, checkProfileText) {
  const repository = createMemorySocialRepository(seed || { social_users: [], social_user_owners: [] })
  const handlers = createProfileHandlers(repository, { checkProfileText })
  return { repository, handlers }
}

test('a new public nickname is checked with the server-resolved openid before profile persistence', async () => {
  const calls = []
  const ctx = setup(null, async input => { calls.push(input) })
  const result = await ctx.handlers.initialize_social_profile(profileInput(), ACTOR)

  assert.deepEqual(calls, [{ content: '安全昵称', openId: ACTOR.ownerOpenId }])
  assert.equal(result.nickname, '安全昵称')
  assert.equal(ctx.repository.where('social_users', () => true).length, 1)
  assert.equal(ctx.repository.where('social_user_owners', () => true).length, 1)
})

test('a blocked or unavailable new nickname fails closed without reserving or writing a social user', async () => {
  for (const code of ['PROFILE_CONTENT_BLOCKED', 'PROFILE_CHECK_UNAVAILABLE']) {
    const ctx = setup(null, async () => {
      const error = new Error(code)
      error.code = code
      throw error
    })
    await assert.rejects(
      ctx.handlers.initialize_social_profile(profileInput(), ACTOR),
      error => error && error.code === code
    )
    assert.equal(ctx.repository.where('social_users', () => true).length, 0)
    assert.equal(ctx.repository.where('social_user_owners', () => true).length, 0)
  }
})

test('avatar-only updates skip nickname checking while a rejected nickname change preserves the old profile', async () => {
  let checks = 0
  const ctx = setup({ social_users: [existingProfile()], social_user_owners: [] }, async input => {
    checks += 1
    if (input.content === '拒绝昵称') {
      const error = new Error('blocked')
      error.code = 'PROFILE_CONTENT_BLOCKED'
      throw error
    }
  })

  const avatarOnly = await ctx.handlers.initialize_social_profile(profileInput({
    nickname: '旧昵称',
    avatarFileId: 'cloud://new-avatar'
  }), ACTOR)
  assert.equal(checks, 0)
  assert.equal(avatarOnly.nickname, '旧昵称')

  await assert.rejects(
    ctx.handlers.initialize_social_profile(profileInput({ nickname: '拒绝昵称' }), ACTOR),
    error => error && error.code === 'PROFILE_CONTENT_BLOCKED'
  )
  assert.equal(checks, 1)
  assert.equal(ctx.repository.get('social_users', 'su_profile').profile.nickname, '旧昵称')
  assert.equal(ctx.repository.get('social_users', 'su_profile').profile.avatarFileId, 'cloud://new-avatar')
})

test('profile safety uses WeChat material scene and fails closed on risky, review, malformed or unavailable results', async () => {
  const calls = []
  const pass = createProfileTextSafety({ security: { msgSecCheck: async input => {
    calls.push(input)
    return { result: { suggest: 'pass' } }
  } } })
  await pass({ content: '安全昵称', openId: ACTOR.ownerOpenId })
  assert.deepEqual(calls, [{
    content: '安全昵称',
    version: 2,
    scene: 1,
    openid: ACTOR.ownerOpenId,
    nickname: '安全昵称'
  }])

  for (const suggest of ['risky', 'review']) {
    const check = createProfileTextSafety({ security: { msgSecCheck: async () => ({ result: { suggest } }) } })
    await assert.rejects(check({ content: '昵称', openId: ACTOR.ownerOpenId }), error => error && error.code === 'PROFILE_CONTENT_BLOCKED')
  }
  for (const openapi of [null, { security: { msgSecCheck: async () => ({}) } }, { security: { msgSecCheck: async () => { throw new Error('network') } } }]) {
    const check = createProfileTextSafety(openapi)
    await assert.rejects(check({ content: '昵称', openId: ACTOR.ownerOpenId }), error => error && error.code === 'PROFILE_CHECK_UNAVAILABLE')
  }
})

test('profile safety errors remain fixed public codes without checker diagnostics', async () => {
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  for (const code of ['PROFILE_CONTENT_BLOCKED', 'PROFILE_CHECK_UNAVAILABLE']) {
    const repository = createMemorySocialRepository({ social_users: [], social_user_owners: [] })
    const app = createSocialApp({
      repository,
      identity: { resolve: openId => ({ ownerOpenId: openId }) },
      profile: {
        checkProfileText: async () => {
          const error = new Error('private checker diagnostics')
          error.code = code
          throw error
        }
      },
      requestId: () => 'profile-safety-route'
    })
    const result = await app.handle(Object.assign({ action: 'initialize_social_profile' }, profileInput()), { openId: ACTOR.ownerOpenId })
    assert.deepEqual(result, {
      code,
      data: null,
      message: code === 'PROFILE_CONTENT_BLOCKED' ? 'profile content blocked' : 'profile check unavailable',
      requestId: 'profile-safety-route'
    })
  }
})
