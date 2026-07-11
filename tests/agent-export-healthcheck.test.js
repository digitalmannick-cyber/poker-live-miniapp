const test = require('node:test')
const assert = require('node:assert/strict')

const healthcheck = require('../tools/agent-export-healthcheck')

test('healthcheck reports missing required configuration', () => {
  const result = healthcheck.validateConfig({})

  assert.equal(result.ok, false)
  assert.deepEqual(result.missing, [
    'POKER_DATA_HTTP_URL',
    'AGENT_EXPORT_TOKEN',
    'POKER_AGENT_PLAYER_ID'
  ])
})

test('healthcheck accepts complete configuration', () => {
  const result = healthcheck.validateConfig({
    POKER_DATA_HTTP_URL: 'https://example.com/poker_data',
    AGENT_EXPORT_TOKEN: 'secret',
    POKER_AGENT_PLAYER_ID: 'WX-AGENT01'
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.missing, [])
})

test('healthcheck validates agent export response essentials', () => {
  const result = healthcheck.validateAgentExportData({
    summary: {
      totalProfit: 1000,
      handCount: 2
    },
    extremes: {
      biggestWinningHand: { id: 'win', profit: 1200 },
      biggestLosingHand: { id: 'loss', profit: -200 }
    },
    hands: [{ id: 'win' }, { id: 'loss' }]
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
})

test('healthcheck rejects incomplete agent export response', () => {
  const result = healthcheck.validateAgentExportData({
    summary: {},
    extremes: {},
    hands: []
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.errors, [
    'summary.totalProfit must be a number',
    'summary.handCount must be a number',
    'extremes.biggestWinningHand missing',
    'extremes.biggestLosingHand missing'
  ])
})
