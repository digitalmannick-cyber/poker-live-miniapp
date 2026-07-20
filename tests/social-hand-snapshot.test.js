const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildHandSnapshot,
  resolveBigBlind,
  toBb,
  assignAliases
} = require('../cloudfunctions/poker_social/lib/hand-snapshot')
const { createSocialApp } = require('../cloudfunctions/poker_social/app')
const { socialError } = require('../cloudfunctions/poker_social/lib/social-error')

const POSITION = value => value === 'UTG1' ? 'UTG+1' : value
const REAL_ACTIVE_SLOTS = {
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO']
}
const CANONICAL = value => value === 'UTG+1' ? 'UTG1' : value

function fullLedgerFixture(size, overrides) {
  const slots = REAL_ACTIVE_SLOTS[size]
  const hand = {
    _id: `hand_${size}`,
    sessionId: `session_${size}`,
    stakeLevel: '200/400',
    playerCount: size,
    heroSeat: 1,
    heroPosition: POSITION(slots[0]),
    heroCardsInput: 'AsKs',
    board: { flop: '', turn: '', river: '' },
    effectiveStack: 40000,
    potSize: 5000,
    allInPot: 0,
    playerSnapshots: slots.map((slot, index) => ({
      slot,
      position: POSITION(slot),
      stack: index === 0 ? 40000 : 32000 + index * 400,
      initialStack: index === 0 ? 40000 : 32000 + index * 400,
      cards: ''
    }))
  }
  const actions = [
    { _id: 'ha_2', street: 'Pre', actorSeat: 2, actorLabel: POSITION(slots[1]), actionType: 'fold', amount: 0, sequence: 2 },
    { _id: 'ha_1', street: 'Pre', actorSeat: 1, actorLabel: `Hero ${POSITION(slots[0])}`, actionType: 'raise', amount: 1200, sequence: 1 }
  ]
  const patch = overrides || {}
  return {
    hand: Object.assign(hand, patch.hand || {}),
    actions: patch.actions || actions,
    session: Object.assign({ _id: `session_${size}`, bigBlind: 400 }, patch.session || {})
  }
}

function expectCode(fn, code) {
  assert.throws(fn, error => error && error.code === code)
}

test('resolves the first present blind source and converts non-negative chips to rounded BB', () => {
  assert.equal(resolveBigBlind({ bigBlind: 800, stakeLevel: '300/600' }, { bigBlind: 400 }), 400)
  assert.equal(resolveBigBlind({ bigBlind: 800, stakeLevel: '300/600' }, {}), 800)
  assert.equal(resolveBigBlind({ stakeLevel: ' 200 / 400 ' }, {}), 400)
  assert.equal(toBb(1001, 400), 2.5)
  assert.equal(toBb(1, 3), 0.33)
  assert.equal(Object.is(toBb(0, 400), -0), false)

  for (const value of ['NL 200/400', '200/400/800', '200/a', '200/0', '', null]) {
    expectCode(() => resolveBigBlind({ stakeLevel: value }, {}), 'BLIND_REQUIRED')
  }
  expectCode(() => resolveBigBlind({ bigBlind: 400 }, { bigBlind: 'bad' }), 'BLIND_REQUIRED')
  for (const value of [-1, Infinity, NaN, '400']) {
    expectCode(() => toBb(value, 400), 'INVALID_HAND_SNAPSHOT')
  }
  expectCode(() => toBb(Number.MAX_VALUE, Number.MIN_VALUE), 'INVALID_HAND_SNAPSHOT')
})

test('assigns the fixed anonymous aliases by ascending numeric seat', () => {
  assert.deepEqual(assignAliases([8, 2, 5]), {
    2: '夜鸦',
    5: '赤狐',
    8: '黑猫'
  })
  assert.deepEqual(Object.values(assignAliases([9, 8, 7, 6, 5, 4, 3, 2])), [
    '夜鸦', '赤狐', '黑猫', '银狼', '幻蝶', '灰隼', '绿蛇', '白鲸'
  ])
  expectCode(() => assignAliases([1, 1]), 'INVALID_HAND_SNAPSHOT')
})

for (const size of [6, 8, 9]) {
  test(`builds a complete ${size}-handed full-ledger snapshot from persisted slots`, () => {
    const source = fullLedgerFixture(size)
    const snapshot = buildHandSnapshot(source)

    assert.equal(snapshot.version, 1)
    assert.deepEqual(snapshot.hero, {
      label: 'Hero', seat: 1, position: CANONICAL(REAL_ACTIVE_SLOTS[size][0]), cards: ['As', 'Ks'], stackBb: 100
    })
    assert.equal(snapshot.players.length, size - 1)
    assert.deepEqual(snapshot.players[0], {
      seat: 2,
      position: CANONICAL(REAL_ACTIVE_SLOTS[size][1]),
      label: '夜鸦',
      stackBb: (32400 / 400)
    })
    assert.deepEqual(snapshot.board, { flop: [], turn: [], river: [] })
    assert.deepEqual(snapshot.actions, [
      { street: 'preflop', actor: 'Hero', type: 'raise', amountBb: 3 },
      { street: 'preflop', actor: '夜鸦', type: 'fold', amountBb: 0 }
    ])
    assert.deepEqual(snapshot.showdown, [])
    assert.equal(snapshot.effectiveStackBb, 100)
    assert.equal(snapshot.potBb, 12.5)
    assert.equal(snapshot.allInPotBb, 0)
  })
}

test('uses same-seat snapshot cards as structured multi-show evidence', () => {
  const source = fullLedgerFixture(6)
  source.hand.board = { flop: '2s3h4d', turn: '5c', river: '9s' }
  source.hand.playerSnapshots[1].cards = 'QhQs'
  source.hand.playerSnapshots[2].cards = 'JhJs'
  source.actions = [
    { street: 'River', actorSeat: 2, actorLabel: 'SB', actionType: 'show', amount: 0, sequence: 2 },
    { street: 'River', actorSeat: 3, actorLabel: 'BB', actionType: 'show', amount: 0, sequence: 3 },
    { street: 'Pre', actorSeat: 1, actorLabel: 'Hero BTN', actionType: 'raise', amount: 1200, sequence: 1 }
  ]

  const snapshot = buildHandSnapshot(source)
  assert.deepEqual(snapshot.board, { flop: ['2s', '3h', '4d'], turn: ['5c'], river: ['9s'] })
  assert.deepEqual(snapshot.showdown, [
    { actor: '夜鸦', cards: ['Qh', 'Qs'] },
    { actor: '赤狐', cards: ['Jh', 'Js'] }
  ])
})

test('normalizes approved showdown street casing and preserves structured show evidence', () => {
  const source = fullLedgerFixture(6)
  source.hand.playerSnapshots[1].cards = 'QhQs'
  source.actions = [
    { street: 'Pre', actorSeat: 1, actorLabel: 'Hero BTN', actionType: 'raise', amount: 1200, sequence: 1 },
    { street: 'Showdown', actorSeat: 2, actorLabel: 'SB', actionType: 'show', amount: 0, sequence: 2 }
  ]
  assert.equal(buildHandSnapshot(source).actions[1].street, 'showdown')
  source.actions[1].street = 'showdown'
  assert.equal(buildHandSnapshot(source).actions[1].street, 'showdown')
})

test('keeps full-ledger Hero CO labels valid after seat-position cross-checking', () => {
  const source = fullLedgerFixture(6)
  const positions = ['CO', 'BTN', 'SB', 'BB', 'UTG', 'HJ']
  source.hand.playerSnapshots.forEach((snapshot, index) => { snapshot.position = positions[index] })
  source.hand.heroPosition = 'CO'
  source.actions = [
    { street: 'Pre', actorSeat: 1, actorLabel: 'Hero CO', actionType: 'raise', amount: 1200, sequence: 1 },
    { street: 'Pre', actorSeat: 2, actorLabel: 'BTN', actionType: 'fold', amount: 0, sequence: 2 }
  ]
  assert.equal(buildHandSnapshot(source).actions[0].actor, 'Hero')
})

test('uses initialStack before stack and falls back to the persisted stack field', () => {
  const source = fullLedgerFixture(6)
  source.hand.playerSnapshots[1].initialStack = 20000
  source.hand.playerSnapshots[1].stack = 12000
  source.hand.playerSnapshots[2].initialStack = ''
  source.hand.playerSnapshots[2].stack = 16000

  const snapshot = buildHandSnapshot(source)
  assert.equal(snapshot.players.find(player => player.seat === 2).stackBb, 50)
  assert.equal(snapshot.players.find(player => player.seat === 3).stackBb, 40)
})

test('legacy quick record constructs only seats actually seen in Hero and actions', () => {
  const snapshot = buildHandSnapshot({
    hand: {
      _id: 'legacy_quick', sessionId: 'session_quick', playerCount: 4,
      heroSeat: 2, heroPosition: 'BB', heroCardsInput: 'AhAd', stakeLevel: '100/200',
      board: { flop: '2s3s4s', turn: '', river: '' },
      opponentCards: 'KcKd', opponentCardsSource: 'manual',
      villainPosition: 'BTN',
      players: [{ seat: 1, playerName: 'must-not-be-read' }]
    },
    session: { _id: 'session_quick' },
    actions: [
      { street: 'Pre', actorSeat: 2, actorLabel: 'Hero BB', actionType: 'raise', amount: 600, sequence: 1 },
      { street: 'Pre', actorSeat: 4, actorLabel: 'BTN', actionType: 'call', amount: 600, sequence: 2 },
      { street: 'Flop', actorSeat: 4, actorLabel: 'BTN', actionType: 'show', amount: 0, sequence: 3 }
    ]
  })

  assert.deepEqual(snapshot.hero, { label: 'Hero', seat: 2, position: 'BB', cards: ['Ah', 'Ad'] })
  assert.deepEqual(snapshot.players, [{ seat: 4, position: 'BTN', label: '夜鸦' }])
  assert.deepEqual(snapshot.showdown, [{ actor: '夜鸦', cards: ['Kc', 'Kd'] }])
})

test('legacy quick record accepts strict decimal playerCount strings and bare Hero labels', () => {
  for (const playerCount of ['2', '8', '9']) {
    const snapshot = buildHandSnapshot({
      hand: {
        playerCount, heroSeat: 1, heroPosition: 'BTN', heroCardsInput: 'AhAd',
        stakeLevel: '100/200', board: { flop: '', turn: '', river: '' }
      },
      session: {},
      actions: [{ street: 'Pre', actorSeat: 1, actorLabel: 'Hero', actionType: 'raise', amount: 600, sequence: 1 }]
    })
    assert.equal(snapshot.hero.position, 'BTN')
  }
  for (const playerCount of ['', ' ', '2.0', '8x', '10', '01']) {
    expectCode(() => buildHandSnapshot({
      hand: {
        playerCount, heroSeat: 1, heroPosition: 'BTN', heroCardsInput: 'AhAd',
        stakeLevel: '100/200', board: { flop: '', turn: '', river: '' }
      },
      session: {},
      actions: [{ street: 'Pre', actorSeat: 1, actorLabel: 'Hero', actionType: 'raise', amount: 600, sequence: 1 }]
    }), 'INVALID_HAND_SNAPSHOT')
  }
})

test('public app keeps snapshot validation errors typed with fixed messages', async () => {
  const app = createSocialApp({
    identity: { resolve: async () => ({ ownerOpenId: 'private' }) },
    handlers: {
      blind: async () => { throw socialError('BLIND_REQUIRED', 'raw blind and hand id') },
      snapshot: async () => { throw socialError('INVALID_HAND_SNAPSHOT', 'raw snapshot and player') },
      actions: async () => { throw socialError('HAND_ACTIONS_REQUIRED', 'raw actions and owner') }
    },
    requestId: () => 'snapshot-request'
  })

  assert.deepEqual(await app.handle({ action: 'blind' }, {}), {
    code: 'BLIND_REQUIRED', data: null, message: 'big blind required', requestId: 'snapshot-request'
  })
  assert.deepEqual(await app.handle({ action: 'snapshot' }, {}), {
    code: 'INVALID_HAND_SNAPSHOT', data: null, message: 'invalid hand snapshot', requestId: 'snapshot-request'
  })
  assert.deepEqual(await app.handle({ action: 'actions' }, {}), {
    code: 'HAND_ACTIONS_REQUIRED', data: null, message: 'hand actions required', requestId: 'snapshot-request'
  })
})
