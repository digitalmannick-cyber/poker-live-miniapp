const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')

test('social app resolves identity, routes an action, and removes private identifiers from data', async () => {
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const received = []
  const app = createSocialApp({
    identity: {
      resolve(openId) {
        received.push(openId)
        return { ownerOpenId: openId }
      }
    },
    handlers: {
      get_me(event, identity) {
        assert.equal(event.action, 'get_me')
        assert.equal(identity.ownerOpenId, 'openid-private')
        return {
          displayName: 'Poker Friend',
          ownerOpenId: 'openid-private',
          _openid: 'openid-private',
          nested: { ownerOpenId: 'nested-private', _openid: 'nested-private', visible: true }
        }
      }
    },
    requestId: () => 'request-1'
  })

  const result = await app.handle({ action: 'get_me' }, { openId: 'openid-private' })

  assert.deepEqual(received, ['openid-private'])
  assert.deepEqual(result, {
    code: 0,
    data: { displayName: 'Poker Friend', nested: { visible: true } },
    requestId: 'request-1'
  })
})

test('social app returns a request-scoped unknown action error without private identifiers', async () => {
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const app = createSocialApp({
    identity: { resolve: () => ({ ownerOpenId: 'openid-private' }) },
    handlers: {},
    requestId: () => 'request-2'
  })

  const result = await app.handle({ action: 'not_real' }, { openId: 'openid-private' })

  assert.deepEqual(result, {
    code: 'UNKNOWN_ACTION',
    data: null,
    message: 'unknown social action',
    requestId: 'request-2'
  })
  assert.doesNotMatch(JSON.stringify(result), /ownerOpenId|_openid/)
})

test('social app maps typed errors to the public response contract', async () => {
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const { socialError } = require('../cloudfunctions/poker_social/lib/social-error')
  const app = createSocialApp({
    identity: { resolve: () => ({ ownerOpenId: 'openid-private' }) },
    handlers: { fail: () => { throw socialError('FORBIDDEN', 'not allowed') } },
    requestId: () => 'request-3'
  })

  const result = await app.handle({ action: 'fail' }, { openId: 'openid-private' })

  assert.deepEqual(result, { code: 'FORBIDDEN', data: null, message: 'not allowed', requestId: 'request-3' })
})

test('social app treats inherited toString as an unknown action', async () => {
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const app = createSocialApp({
    identity: { resolve: () => ({ ownerOpenId: 'openid-private' }) },
    handlers: {},
    requestId: () => 'request-prototype-1'
  })

  const result = await app.handle({ action: 'toString' }, { openId: 'openid-private' })

  assert.deepEqual(result, {
    code: 'UNKNOWN_ACTION',
    data: null,
    message: 'unknown social action',
    requestId: 'request-prototype-1'
  })
})

test('social app treats inherited constructor as an unknown action', async () => {
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const app = createSocialApp({
    identity: { resolve: () => ({ ownerOpenId: 'openid-private' }) },
    handlers: {},
    requestId: () => 'request-prototype-2'
  })

  const result = await app.handle({ action: 'constructor' }, { openId: 'openid-private' })

  assert.deepEqual(result, {
    code: 'UNKNOWN_ACTION',
    data: null,
    message: 'unknown social action',
    requestId: 'request-prototype-2'
  })
})

test('repository-backed social app registers get_hand_share as a canonical action', async () => {
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const { createMemorySocialRepository } = require('./helpers/social-fixture')
  const repository = createMemorySocialRepository({
    social_users: [{
      _id: 'su-viewer',
      ownerOpenId: 'openid-viewer',
      privatePlayerId: 'P5-VIEWER',
      profile: { nickname: '夜鸦', avatarText: '鸦', avatarFileId: '' }
    }]
  })
  const app = createSocialApp({
    repository,
    identity: { resolve: openId => ({ ownerOpenId: openId }) },
    requestId: () => 'request-hand-detail'
  })

  const result = await app.handle({ action: 'get_hand_share', shareId: 'missing-share' }, { openId: 'openid-viewer' })

  assert.deepEqual(result, {
    code: 'CONTENT_UNAVAILABLE',
    data: null,
    message: 'content unavailable',
    requestId: 'request-hand-detail'
  })
})

test('social app maps public error messages by code and never returns an internal identifier', async () => {
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const internalOpenId = 'openid-real-value-should-not-leak'
  const app = createSocialApp({
    identity: { resolve: () => ({ ownerOpenId: internalOpenId }) },
    handlers: {
      fail() {
        const error = new Error('access rejected for ' + internalOpenId)
        error.code = 'FORBIDDEN'
        throw error
      }
    },
    requestId: () => 'request-private-message'
  })

  const result = await app.handle({ action: 'fail' }, { openId: internalOpenId })

  assert.deepEqual(result, {
    code: 'FORBIDDEN',
    data: null,
    message: 'not allowed',
    requestId: 'request-private-message'
  })
  assert.doesNotMatch(JSON.stringify(result), new RegExp(internalOpenId))
})

test('social app maps unknown errors to the fixed public failure response', async () => {
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const app = createSocialApp({
    identity: { resolve: () => ({ ownerOpenId: 'openid-private' }) },
    handlers: {
      fail() {
        const error = new Error('internal database failure')
        error.code = 'DATABASE_INTERNAL'
        throw error
      }
    },
    requestId: () => 'request-unknown-error'
  })

  const result = await app.handle({ action: 'fail' }, { openId: 'openid-private' })

  assert.deepEqual(result, {
    code: 'SOCIAL_ERROR',
    data: null,
    message: 'social function failed',
    requestId: 'request-unknown-error'
  })
})

test('memory social repository isolates seed data and limits transactions to point operations', async () => {
  const { createMemorySocialRepository } = require('./helpers/social-fixture')
  const repository = createMemorySocialRepository({ profiles: [{ _id: 'profile-1', label: 'original' }] })

  assert.deepEqual(repository.get('profiles', 'profile-1'), { _id: 'profile-1', label: 'original' })
  repository.set('profiles', 'profile-1', { label: 'updated' })
  repository.set('profiles', 'profile-2', { label: 'another' })
  const fromTransaction = await repository.runTransaction(store => store.get('profiles', 'profile-1'))

  assert.deepEqual(fromTransaction, { _id: 'profile-1', label: 'updated' })
  assert.deepEqual(repository.where('profiles', row => row.label === 'another'), [{ _id: 'profile-2', label: 'another' }])
  assert.deepEqual(repository.dump(), {
    profiles: [
      { _id: 'profile-1', label: 'updated' },
      { _id: 'profile-2', label: 'another' }
    ]
  })
})

test('createMutationId uses its prefix and creates distinct identifiers', () => {
  const { createMutationId } = require('../utils/social-mutation')
  const first = createMutationId('friend')
  const second = createMutationId('friend')

  assert.match(first, /^friend_\d+_[0-9a-z]{8}$/)
  assert.notEqual(first, second)
})

test('social identity keeps the authenticated identifier internal to the cloud app', () => {
  const identity = require('../cloudfunctions/poker_social/lib/identity')

  assert.deepEqual(identity.resolve('openid-private'), { ownerOpenId: 'openid-private' })
})

test('cloud entrypoint supplies WXContext OPENID to the social app without exposing it', async () => {
  const entryPath = path.join(__dirname, '..', 'cloudfunctions', 'poker_social', 'index.js')
  const originalLoad = Module._load
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'dynamic',
    init(options) {
      assert.deepEqual(options, { env: 'dynamic' })
    },
    getWXContext() {
      return { OPENID: 'openid-private' }
    }
  }

  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloud
    return originalLoad.call(this, request, parent, isMain)
  }
  let entry
  try {
    delete require.cache[entryPath]
    entry = require(entryPath)
  } finally {
    Module._load = originalLoad
  }

  const result = await entry.main({ action: 'not_real' })

  assert.deepEqual(result, {
    code: 'UNKNOWN_ACTION',
    data: null,
    message: 'unknown social action',
    requestId: result.requestId
  })
  assert.match(result.requestId, /^social_\d+_[0-9a-z]{8}$/)
  assert.doesNotMatch(JSON.stringify(result), /ownerOpenId|_openid|openid-private/)
})
