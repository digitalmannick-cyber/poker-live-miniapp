const assert = require('assert')

const tabState = require('../utils/tab-state')

function activePath(items) {
  const active = items.filter(item => item.active)
  assert.strictEqual(active.length, 1, 'exactly one tab should be active')
  return active[0].pagePath
}

assert.strictEqual(
  tabState.normalizePagePath('pages/review-list/review-list'),
  '/pages/review-list/review-list'
)

assert.strictEqual(
  tabState.getSelectedTabPath('pages/review-list/review-list'),
  '/pages/review-list/review-list'
)

assert.strictEqual(
  activePath(tabState.buildTabItems('/pages/review-list/review-list')),
  '/pages/review-list/review-list',
  'review route must highlight review tab'
)

assert.strictEqual(
  activePath(tabState.buildTabItems('/pages/profile/profile')),
  '/pages/profile/profile',
  'profile route must highlight profile tab'
)

assert.strictEqual(
  activePath(tabState.buildTabItems('/pages/hand-record/hand-record')),
  '/pages/hand-record/hand-record',
  'record route must highlight record tab only'
)

console.log('tab-state tests passed')
