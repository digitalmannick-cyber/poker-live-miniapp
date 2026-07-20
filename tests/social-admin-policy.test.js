const test = require('node:test')
const assert = require('node:assert/strict')

const { parseAdminOpenIds, createAdminPolicy } = require('../cloudfunctions/poker_social/lib/admin-policy')

test('admin OpenID policy trims, removes empty values, deduplicates and matches exactly', () => {
  assert.deepEqual(parseAdminOpenIds(' openid-a,openid-b,,openid-a '), ['openid-a', 'openid-b'])
  const policy = createAdminPolicy(' openid-a,openid-b,,openid-a ')
  assert.equal(policy.isAdminActor({ ownerOpenId: 'openid-a' }), true)
  assert.equal(policy.isAdminActor({ ownerOpenId: 'openid' }), false)
  assert.equal(policy.isAdminActor({ ownerOpenId: 'openid-a-suffix' }), false)
  assert.equal(policy.isAdminActor({ ownerOpenId: ' openid-a ' }), false)
})

test('missing, empty or malformed admin configuration fails closed', () => {
  for (const raw of [undefined, null, '', ' , ', 'openid-good, bad token', 'openid-good,\nopenid-bad', 123, {}]) {
    const policy = createAdminPolicy(raw)
    assert.deepEqual(parseAdminOpenIds(raw), [])
    assert.equal(policy.isAdminActor({ ownerOpenId: 'openid-good' }), false)
    assert.equal(policy.isAdminActor({ ownerOpenId: 'bad token' }), false)
  }
})

test('admin policy ignores every client-style authority field', () => {
  const policy = createAdminPolicy('openid-admin')
  assert.equal(policy.isAdminActor({
    ownerOpenId: 'openid-user',
    openId: 'openid-admin',
    isAdmin: true,
    socialUserId: 'openid-admin'
  }), false)
})
