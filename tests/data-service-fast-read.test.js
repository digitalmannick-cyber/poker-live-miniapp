const test = require('node:test')
const assert = require('node:assert/strict')

const dataService = require('../services/data-service')

test('read flows should not wait for cloud bootstrap by default', () => {
  assert.equal(dataService.__test.shouldAwaitCloudBootstrap({ forceRefresh: false, waitForCloud: false }), false)
  assert.equal(dataService.__test.shouldAwaitCloudBootstrap({ forceRefresh: true, waitForCloud: false }), true)
  assert.equal(dataService.__test.shouldAwaitCloudBootstrap({ forceRefresh: false, waitForCloud: true }), true)
})

test('cloud timeout errors are recognized for background cooldown', () => {
  assert.equal(dataService.__test.isTimeoutError(new Error('timeout')), true)
  assert.equal(dataService.__test.isTimeoutError({ errMsg: 'request:fail timeout' }), true)
  assert.equal(dataService.__test.isTimeoutError(new Error('permission denied')), false)
})
