const test = require('node:test')
const assert = require('node:assert/strict')

const fields = require('../utils/hand-detail-fields')

test('canonical fields include agreed detail fields in order', () => {
  assert.deepEqual(
    fields.CANONICAL_FIELD_KEYS,
    [
      'playedDate',
      'stakeLevel',
      'playerCount',
      'hasStraddle',
      'heroPosition',
      'villainPosition',
      'villainType',
      'effectiveStack',
      'potSize',
      'currentProfit',
      'opponentName',
      'showdown',
      'heroCardsInput',
      'streetSummary',
      'mindJourney',
      'heroQuestion',
      'streetDetails',
      'tags',
      'aiReview'
    ]
  )
})

test('straddle gates STR position and computes fixed 2x big blind amount', () => {
  const positions = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB', 'STR']

  assert.deepEqual(fields.getPositionOptions(positions, false), ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'])
  assert.deepEqual(fields.getPositionOptions(positions, true), positions)
  assert.equal(fields.getBigBlindFromLevel('300/600'), 600)
  assert.equal(fields.getStraddleAmount('300/600'), 1200)
})

test('read-only rows show all canonical fields and use dash for empty values after backfill', () => {
  const view = fields.buildHandDetailViewModel({
    playedDate: '2026/06/06',
    stakeLevel: '300/600',
    hasStraddle: true,
    heroCardsInput: '7h8h',
    currentProfit: -67000,
    streetInputs: {
      preflop: { pot: '42300', actionLine: 'STR open1800 -> Hero call' },
      flop: { pot: '42300', actionLine: 'Hero fold' },
      turn: { pot: '', actionLine: '' },
      river: { pot: '', actionLine: '' }
    },
    board: { flop: 'Js8d3d', turn: '6s', river: '' }
  }, {
    mode: 'readonly',
    backfilled: true,
    positions: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB', 'STR']
  })

  assert.equal(view.shouldShowFullDetails, true)
  assert.equal(view.rows.find(item => item.key === 'showdown').displayValue, '-')
  assert.equal(view.rows.find(item => item.key === 'heroQuestion').displayValue, '-')
  assert.deepEqual(
    view.streetItems.map(item => item.label),
    ['翻前', '翻牌', '转牌', '河牌']
  )
})

test('quick-entry-only hands hide full details before AI confirmation', () => {
  const view = fields.buildHandDetailViewModel({
    heroCardsInput: 'AhAd',
    currentProfit: 80000
  }, {
    mode: 'readonly',
    backfilled: false,
    positions: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']
  })

  assert.equal(view.hasOnlyQuickEntryDetails, true)
  assert.equal(view.shouldShowFullDetails, false)
})
