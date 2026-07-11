const test = require('node:test')
const assert = require('node:assert/strict')

const migration = require('../tools/apply-macau-stats-rules-cloudbase')

test('migration marks river call without shown cards as showdown', () => {
  const patch = migration.buildHandPatch({
    _id: 'river-call',
    currentProfit: 10000,
    streetSummary: 'River: Hero bet 10000, Villain call',
    showdownType: ''
  })

  assert.equal(patch.showdownType, 'showdown')
  assert.equal(patch.showdownReason, 'river_called')
})

test('migration clears unverified all-in EV when opponent mucked', () => {
  const patch = migration.buildHandPatch({
    _id: 'mucked-allin',
    currentProfit: 100000,
    isAllIn: true,
    allInStreet: 'preflop',
    allInEv: 64000,
    allInEvStatus: 'calculated',
    allInEvSource: 'old',
    allInEvEligible: true,
    allInPot: 200000,
    heroInvested: 100000,
    heroEquityPct: 82,
    opponentCards: 'Villain muck'
  })

  assert.equal(patch.allInEv, '')
  assert.equal(patch.allInEvStatus, 'unknown_opponent_cards')
  assert.equal(patch.allInEvEligible, false)
})

test('migration preserves verified all-in EV eligibility when opponent cards are real', () => {
  const patch = migration.buildHandPatch({
    _id: 'shown-allin',
    currentProfit: 100000,
    isAllIn: true,
    allInStreet: 'preflop',
    allInPot: 200000,
    heroInvested: 100000,
    heroEquityPct: 82,
    opponentCards: 'KsKd'
  })

  assert.equal(patch.allInEv, 64000)
  assert.equal(patch.allInEvStatus, 'calculated')
  assert.equal(patch.allInEvEligible, true)
})

test('migration treats river all-in with shown cards as actual profit when street is only in text', () => {
  const patch = migration.buildHandPatch({
    _id: 'river-shown-allin',
    currentProfit: 80000,
    streetSummary: '河牌: Villain AI, Hero call',
    allInPot: 160000,
    heroInvested: 80000,
    heroEquityPct: 25,
    opponentCards: 'KsKd'
  })

  assert.equal(patch.showdownType, 'showdown')
  assert.equal(patch.allInEv, 80000)
  assert.equal(patch.allInEvStatus, 'river_actual')
  assert.equal(patch.allInEvEligible, false)
})
