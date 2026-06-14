const test = require('node:test')
const assert = require('node:assert/strict')

const cloudRepo = require('../services/cloud-repo')

test('cloud business docs are stamped with normalized player id', () => {
  const doc = cloudRepo.__test.withPlayerScope({ title: 'Session' }, ' plr-abc-123 ')

  assert.equal(doc.playerId, 'PLR-ABC-123')
  assert.equal(doc.title, 'Session')
})

test('cloud business reads reject documents owned by another player', () => {
  assert.equal(
    cloudRepo.__test.isOwnedByCurrentPlayer({ playerId: 'PLR-ONE' }, 'PLR-TWO'),
    false
  )
  assert.equal(
    cloudRepo.__test.isOwnedByCurrentPlayer({ playerId: 'PLR-ONE' }, 'plr-one'),
    true
  )
})
