const test = require('node:test')
const assert = require('node:assert/strict')

test('callSocialFunction sends action to poker_social and returns cloud data', async () => {
  global.wx = {
    cloud: {
      callFunction: async input => ({ result: { code: 0, data: input.data } })
    }
  }
  const api = require('../services/social-api')

  const result = await api.callSocialFunction('get_me', { value: 1 })

  assert.equal(result.action, 'get_me')
  assert.equal(result.value, 1)
})

test('callSocialFunction maps cloud errors without returning raw response data', async () => {
  global.wx = {
    cloud: {
      callFunction: async () => ({ result: { code: 'FORBIDDEN', message: 'not allowed', ownerOpenId: 'private' } })
    }
  }
  const api = require('../services/social-api')

  await assert.rejects(
    api.callSocialFunction('get_me'),
    error => error.code === 'FORBIDDEN' && error.message === 'not allowed' && !Object.hasOwn(error, 'raw')
  )
})

test('callSocialFunction reports an unavailable cloud function as a network error', async () => {
  global.wx = {}
  const api = require('../services/social-api')

  await assert.rejects(
    api.callSocialFunction('get_me'),
    error => error.code === 'NETWORK_ERROR' && error.message === 'social function unavailable'
  )
})
