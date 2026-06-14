const test = require('node:test')
const assert = require('node:assert/strict')

const store = require('../utils/store')

test('initial store data does not prefill personal WeChat profile fields', () => {
  const first = store.__test.buildInitialStoreData()
  const second = store.__test.buildInitialStoreData()

  assert.equal(first.initialDataVersion, 2)
  assert.equal(first.profile.name, '玩家')
  assert.equal(first.profile.title, '怪盗团新兵')
  assert.equal(first.profile.avatarText, 'PL')
  assert.equal(first.profile.avatarUrl, '')
  assert.match(first.profile.playerId, /^PLR-/)
  assert.notEqual(first.profile.playerId, second.profile.playerId)
})

test('initial store data shares the configured poker presets for every new user', () => {
  const first = store.__test.buildInitialStoreData()

  assert.equal(first.settings.chipUnit, 'HKD')
  assert.deepEqual(first.settings.venues, ['MGM', '威尼斯人', 'Home Game'])
  assert.deepEqual(first.settings.blindPresets, ['100/200', '200/400', '300/600', '500/1000'])
  assert.equal(first.settings.lastBlindPreset, '200/400')
  assert.deepEqual(first.settings.positions, ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB', 'STR'])
  assert.deepEqual(first.settings.opponentTypes, ['紧弱', '松弱', '激进', '跟注站'])
  assert.equal(Object.prototype.hasOwnProperty.call(first.settings, '_openid'), false)
})

test('initial store data starts each new user with empty personal business records', () => {
  const initial = store.__test.buildInitialStoreData()

  assert.equal(initial.sessions.length, 0)
  assert.equal(initial.hands.length, 0)
  assert.equal(initial.handActions.length, 0)
  assert.equal(initial.bankrollLogs.length, 0)
})

test('store migration removes only legacy demo business records', () => {
  const legacySessionId = 'session_legacy_demo'
  const legacyHandId = 'hand_legacy_demo'
  const migrated = store.__test.ensureStoreShape({
    initialDataVersion: 1,
    sessions: [
      {
        _id: legacySessionId,
        title: '永利 5/10 晚场',
        venue: '永利',
        smallBlind: 5,
        bigBlind: 10,
        notes: '样例牌局，可直接体验流程。'
      },
      {
        _id: 'session_real',
        title: 'MGM 200/400',
        venue: 'MGM',
        smallBlind: 200,
        bigBlind: 400
      }
    ],
    hands: [
      {
        _id: legacyHandId,
        sessionId: legacySessionId,
        heroCardsInput: 'AhKd',
        notes: '翻牌持续下注，对手跟注到河牌。'
      },
      {
        _id: 'hand_real',
        sessionId: 'session_real',
        heroCardsInput: '7c8c'
      }
    ],
    handActions: [
      { _id: 'action_legacy', handId: legacyHandId },
      { _id: 'action_real', handId: 'hand_real' }
    ],
    bankrollLogs: [
      { _id: 'bankroll_legacy', sessionId: legacySessionId, note: '样例结算' },
      { _id: 'bankroll_real', sessionId: 'session_real' }
    ]
  })

  assert.equal(migrated.initialDataVersion, 2)
  assert.deepEqual(migrated.sessions.map(item => item._id), ['session_real'])
  assert.deepEqual(migrated.hands.map(item => item._id), ['hand_real'])
  assert.deepEqual(migrated.handActions.map(item => item._id), ['action_real'])
  assert.deepEqual(migrated.bankrollLogs.map(item => item._id), ['bankroll_real'])
})
