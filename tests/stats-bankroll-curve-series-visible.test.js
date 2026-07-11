const test = require('node:test')
const assert = require('node:assert/strict')

const statsAnalytics = require('../utils/stats-analytics')

test('bankroll graph shows total, showdown, non-showdown and all-in EV lines with legends', () => {
  const graph = statsAnalytics.__test.buildBankrollGraph([
    {
      playedDate: '2026-06-01',
      currentProfit: 1000,
      showdownType: 'showdown'
    },
    {
      playedDate: '2026-06-02',
      currentProfit: 500,
      showdownType: 'non_showdown'
    },
    {
      playedDate: '2026-06-03',
      currentProfit: -300,
      isAllIn: true,
      allInStreet: 'preflop',
      opponentCards: 'AsKs',
      allInPot: 1000,
      heroInvested: 500,
      heroEquityPct: 40
    }
  ], 'HKD')

  assert.deepEqual(graph.series.map(item => item.key), [
    'total',
    'showdown',
    'nonShowdown',
    'allInEv'
  ])
  graph.series.forEach(item => {
    assert.equal(item.showInChart, true, item.key + ' should be drawn')
    assert.equal(item.showInLegend, true, item.key + ' should be shown in legend')
  })
})
