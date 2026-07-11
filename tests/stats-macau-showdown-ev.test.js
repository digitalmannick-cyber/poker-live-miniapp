const test = require('node:test')
const assert = require('node:assert/strict')

const stats = require('../utils/stats-analytics')
const {
  showdownClassification,
  allInEvProfit
} = stats.__test

test('river bet called and mucked is showdown profit', () => {
  assert.equal(showdownClassification({
    currentProfit: 10000,
    streetSummary: 'River: Hero bet 10000, Villain call and muck'
  }), 'showdown')
})

test('river bet called without shown cards is still showdown profit', () => {
  assert.equal(showdownClassification({
    currentProfit: 10000,
    streetSummary: 'River: Hero bet 10000, Villain call'
  }), 'showdown')
})

test('hero aggression that makes opponent fold is non-showdown profit', () => {
  assert.equal(showdownClassification({
    currentProfit: 12000,
    streetSummary: 'Turn: Hero check-raise 30000, Villain fold'
  }), 'non_showdown')
  assert.equal(showdownClassification({
    currentProfit: 8000,
    streetSummary: 'River: Hero bet 10000, Villain fold'
  }), 'non_showdown')
})

test('all-in EV falls back to actual profit when opponent did not show real cards', () => {
  assert.equal(allInEvProfit({
    isAllIn: true,
    allInStreet: 'preflop',
    currentProfit: 100000,
    allInPot: 200000,
    heroInvested: 100000,
    heroEquityPct: 82,
    opponentCards: 'Villain muck'
  }), 100000)
})

test('all-in EV calculates only when opponent real cards are available', () => {
  assert.equal(allInEvProfit({
    isAllIn: true,
    allInStreet: 'preflop',
    currentProfit: 100000,
    allInPot: 200000,
    heroInvested: 100000,
    heroEquityPct: 82,
    opponentCards: 'KsKd'
  }), 64000)
})
