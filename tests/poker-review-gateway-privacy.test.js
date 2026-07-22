const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createGateway,
  pseudonymousAgentUserId
} = require('../cloudfunctions/poker_review/gateway')

test('poker review sends a stable pseudonymous user id instead of raw WeChat OpenID', async () => {
  const payloads = []
  const gateway = createGateway({
    requestIdFactory: () => 'request-1',
    async requestAgent(payload) {
      payloads.push(payload)
      return { status: 200, body: { code: 0, data: { answer: 'ok' } } }
    }
  })

  const openid = 'oRawWechatOpenIdMustNotLeaveGateway'
  const result = await gateway.handle({ mode: 'chat', question: '这手牌怎么打？' }, { OPENID: openid })
  assert.equal(result.ok, true)
  assert.equal(payloads.length, 1)
  assert.match(payloads[0].user_id, /^u_[0-9a-f]{32}$/)
  assert.equal(payloads[0].user_id, pseudonymousAgentUserId(openid))
  assert.doesNotMatch(JSON.stringify(payloads[0]), new RegExp(openid))
})

test('pseudonymous poker-review identity is domain separated and stable', () => {
  assert.equal(pseudonymousAgentUserId('openid-a'), pseudonymousAgentUserId('openid-a'))
  assert.notEqual(pseudonymousAgentUserId('openid-a'), pseudonymousAgentUserId('openid-b'))
  assert.notEqual(pseudonymousAgentUserId('openid-a'), 'openid-a')
})
