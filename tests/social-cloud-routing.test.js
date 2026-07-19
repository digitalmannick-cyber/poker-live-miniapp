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

  assert.deepEqual(result, { code: 'FORBIDDEN', message: 'not allowed', requestId: 'request-3' })
})

test('memory social repository isolates seed data and supports get, set, where, and transactions', async () => {
  const { createMemorySocialRepository } = require('./helpers/social-fixture')
  const repository = createMemorySocialRepository({ profiles: [{ _id: 'profile-1', label: 'original' }] })

  assert.deepEqual(repository.get('profiles', 'profile-1'), { _id: 'profile-1', label: 'original' })
  repository.set('profiles', 'profile-1', { label: 'updated' })
  repository.set('profiles', 'profile-2', { label: 'another' })
  const fromTransaction = await repository.runTransaction(store => store.where('profiles', row => row.label === 'updated'))

  assert.deepEqual(fromTransaction, [{ _id: 'profile-1', label: 'updated' }])
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
    message: 'unknown social action',
    requestId: result.requestId
  })
  assert.match(result.requestId, /^social_\d+_[0-9a-z]{8}$/)
  assert.doesNotMatch(JSON.stringify(result), /ownerOpenId|_openid|openid-private/)
})
