const test = require('node:test')
const assert = require('node:assert/strict')

const agentExport = require('../cloudfunctions/poker_data/agent-export')

const monday = new Date('2026-06-29T12:00:00+08:00').getTime()

test('agent export summarizes last 7 days and exposes best and worst hands with actions', () => {
  const sessions = [
    {
      _id: 'session_recent',
      title: 'MGM 200/400',
      date: '2026-06-27',
      startTime: '2026-06-27 18:00',
      venue: 'MGM',
      smallBlind: 200,
      bigBlind: 400,
      buyIn: 100000,
      cashOut: 116000,
      totalProfit: 16000,
      durationMinutes: 240,
      handCount: 2,
      status: 'finished'
    },
    {
      _id: 'session_old',
      title: 'Old Room',
      date: '2026-05-01',
      startTime: '2026-05-01 18:00',
      venue: 'Old Room',
      buyIn: 1000,
      cashOut: 9000,
      totalProfit: 8000,
      durationMinutes: 120,
      handCount: 1,
      status: 'finished'
    }
  ]
  const hands = [
    {
      _id: 'hand_win',
      sessionId: 'session_recent',
      playedDate: '2026-06-27',
      heroCardsInput: 'AsAh',
      board: { flop: 'AdKd2c', turn: '7s', river: '2h' },
      heroPosition: 'BTN',
      villainPosition: 'BB',
      opponentType: 'loose',
      potSize: 42000,
      currentProfit: 24000,
      tags: ['value'],
      notes: 'thin value',
      aiReview: { summary: 'good value bet' },
      reviewStatus: 'reviewed',
      createdAt: monday - 2 * 24 * 60 * 60 * 1000
    },
    {
      _id: 'hand_loss',
      sessionId: 'session_recent',
      playedDate: '2026-06-28',
      heroCardsInput: 'QsQd',
      heroPosition: 'CO',
      villainPosition: 'SB',
      potSize: 66000,
      currentProfit: -8000,
      tags: ['overcall'],
      detailBackfilled: true,
      createdAt: monday - 24 * 60 * 60 * 1000
    },
    {
      _id: 'hand_old',
      sessionId: 'session_old',
      playedDate: '2026-05-01',
      heroCardsInput: '7c2d',
      currentProfit: 8000,
      createdAt: new Date('2026-05-01T12:00:00+08:00').getTime()
    }
  ]
  const handActions = [
    { _id: 'act_2', handId: 'hand_win', street: 'flop', actorLabel: 'Hero', actionType: 'bet', amount: 6000, potAfter: 18000, sequence: 2 },
    { _id: 'act_1', handId: 'hand_win', street: 'preflop', actorLabel: 'Hero', actionType: 'raise', amount: 1200, potAfter: 3000, sequence: 1 },
    { _id: 'act_3', handId: 'hand_loss', street: 'river', actorLabel: 'Hero', actionType: 'call', amount: 8000, potAfter: 66000, sequence: 1 }
  ]

  const result = agentExport.buildAgentExport({
    sessions,
    hands,
    handActions,
    bankrollLogs: [],
    settings: { chipUnit: 'HKD' },
    profile: { playerId: 'WX-TEST001', name: 'Hero' },
    rangeKey: 'last7',
    nowMs: monday
  })

  assert.equal(result.version, 1)
  assert.equal(result.range.key, 'last7')
  assert.equal(result.summary.totalProfit, 16000)
  assert.equal(result.summary.handProfit, 16000)
  assert.equal(result.summary.sessionCount, 1)
  assert.equal(result.summary.handCount, 2)
  assert.equal(result.extremes.biggestWinningHand.id, 'hand_win')
  assert.equal(result.extremes.biggestWinningHand.profit, 24000)
  assert.equal(result.extremes.biggestLosingHand.id, 'hand_loss')
  assert.equal(result.extremes.biggestLosingHand.profit, -8000)
  assert.deepEqual(result.hands.map(hand => hand.id), ['hand_loss', 'hand_win'])
  assert.deepEqual(result.hands.find(hand => hand.id === 'hand_win').actions.map(action => action.id), ['act_1', 'act_2'])
  assert.equal(result.hands.some(hand => hand.id === 'hand_old'), false)
})

test('agent export supports custom date ranges for weekly knowledge-base jobs', () => {
  const result = agentExport.buildAgentExport({
    sessions: [],
    hands: [
      { _id: 'inside', playedDate: '2026-06-20', currentProfit: 1000 },
      { _id: 'outside', playedDate: '2026-06-10', currentProfit: 9000 }
    ],
    handActions: [],
    range: { from: '2026-06-18', to: '2026-06-21' },
    nowMs: monday
  })

  assert.equal(result.range.key, 'custom')
  assert.equal(result.summary.handCount, 1)
  assert.equal(result.extremes.biggestWinningHand.id, 'inside')
})
