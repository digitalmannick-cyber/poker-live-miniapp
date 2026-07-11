const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

process.env.AGENT_EXPORT_TOKEN = 'secret-token'
process.env.AGENT_EXPORT_OWNER_OPENID = 'openid-bound-to-owner'

const originalLoad = Module._load
Module._load = function load(request, parent, isMain) {
  if (request === 'wx-server-sdk') {
    return {
      DYNAMIC_CURRENT_ENV: 'test',
      init() {},
      database() {
        return {}
      },
      getWXContext() {
        return {}
      }
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

const pokerData = require('../cloudfunctions/poker_data/index')
Module._load = originalLoad

test('agent export http body merges into the event payload', () => {
  const parsed = pokerData.__test.parseIncomingEvent({
    body: JSON.stringify({ action: 'agent_export', playerId: 'wx-test001' }),
    headers: { authorization: 'Bearer secret-token' }
  })

  assert.equal(parsed.action, 'agent_export')
  assert.equal(parsed.playerId, 'wx-test001')
  assert.equal(parsed.headers.authorization, 'Bearer secret-token')
})

test('agent export http query parameters merge into the event payload', () => {
  const parsed = pokerData.__test.parseIncomingEvent({
    queryStringParameters: { playerId: 'wx-test001', days: '7' },
    headers: { authorization: 'Bearer secret-token' }
  })

  assert.equal(parsed.playerId, 'wx-test001')
  assert.equal(parsed.days, '7')
})

test('agent export accepts legacy export action alias', () => {
  assert.equal(pokerData.__test.normalizeAction({ action: 'export' }), 'agent_export')
  assert.equal(pokerData.__test.normalizeAction({ action: 'agentExport' }), 'agent_export')
})

test('agent export infers action for tokenized http query calls', () => {
  assert.equal(pokerData.__test.normalizeAction({
    headers: { authorization: 'Bearer secret-token' },
    playerId: 'WX-TEST001',
    days: '7'
  }), 'agent_export')
})

test('agent export resolves external owner from token-bound environment', () => {
  const result = pokerData.__test.resolveOwnerOpenId({
    action: 'agent_export',
    headers: { authorization: 'Bearer secret-token' }
  }, {})

  assert.equal(result.ownerOpenId, 'openid-bound-to-owner')
  assert.equal(result.externalAgent, true)
})

test('agent export rejects external calls with a bad token', () => {
  const result = pokerData.__test.resolveOwnerOpenId({
    action: 'agent_export',
    token: 'wrong'
  }, {})

  assert.equal(result.error.code, 'AGENT_EXPORT_UNAUTHORIZED')
})

test('non export actions still require WeChat OPENID', () => {
  const result = pokerData.__test.resolveOwnerOpenId({
    action: 'sync_stats',
    token: 'secret-token'
  }, {})

  assert.equal(result.error.code, 'MISSING_OPENID')
})
