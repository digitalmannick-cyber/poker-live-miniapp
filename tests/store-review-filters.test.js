const test = require('node:test')
const assert = require('node:assert/strict')

const store = require('../utils/store')

const hands = [
  {
    _id: 'h1',
    sessionId: 's1',
    playedDate: '2026-05-29',
    stakeLevel: '100/200',
    currentProfit: 24000,
    potSize: 80000,
    tags: ['Hero Call'],
    updatedAt: 300
  },
  {
    _id: 'h2',
    sessionId: 's1',
    playedDate: '2026-05-23',
    stakeLevel: '200/400',
    currentProfit: -42000,
    potSize: 160000,
    tags: ['river_overfold'],
    updatedAt: 200
  },
  {
    _id: 'h3',
    sessionId: 's2',
    playedDate: '2026-04-20',
    stakeLevel: '100/200',
    currentProfit: -8000,
    potSize: 40000,
    tags: ['价值下注'],
    updatedAt: 100
  }
]

test('review filters combine session, date range, and BB result threshold', () => {
  const result = store.__test.filterReviewHands(hands, {
    sessionId: 's1',
    dateRange: 'last7d',
    resultFilter: 'win50'
  }, new Date('2026-05-29T12:00:00').getTime())

  assert.deepEqual(result.map(item => item._id), ['h1'])
})

test('review filters support losing BB thresholds and manual sorting', () => {
  const result = store.__test.filterReviewHands(hands, {
    resultFilter: 'lose50',
    sortBy: 'resultBbAsc'
  }, new Date('2026-05-29T12:00:00').getTime())

  assert.deepEqual(result.map(item => item._id), ['h2'])
})

test('review filters support custom date ranges and pot sorting', () => {
  const result = store.__test.filterReviewHands(hands, {
    dateRange: 'custom',
    startDate: '2026-05-01',
    endDate: '2026-05-29',
    sortBy: 'potAsc'
  }, new Date('2026-05-29T12:00:00').getTime())

  assert.deepEqual(result.map(item => item._id), ['h1', 'h2'])
})

test('review filters support fixed review tags including legacy aliases', () => {
  const result = store.__test.filterReviewHands(hands, {
    tagFilter: 'overfold',
    sortBy: 'updatedDesc'
  }, new Date('2026-05-29T12:00:00').getTime())

  assert.deepEqual(result.map(item => item._id), ['h2'])
})
