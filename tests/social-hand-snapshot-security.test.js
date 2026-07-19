const test = require('node:test')
const assert = require('node:assert/strict')

const { ACTIVE_SLOTS, buildHandSnapshot } = require('../cloudfunctions/poker_social/lib/hand-snapshot')

function fullLedgerFixture(size) {
  const slots = ACTIVE_SLOTS[size]
  return {
    hand: {
      _id: `hand_security_${size}`,
      sessionId: `session_security_${size}`,
      stakeLevel: '200/400',
      playerCount: size,
      heroSeat: 1,
      heroPosition: slots[0],
      heroCardsInput: 'AsKs',
      board: { flop: '', turn: '', river: '' },
      effectiveStack: 40000,
      potSize: 5000,
      allInPot: 0,
      playerSnapshots: slots.map((slot, index) => ({
        slot,
        position: slot === 'UTG1' ? 'UTG+1' : slot,
        stack: 40000 - index * 400,
        initialStack: 40000 - index * 400,
        cards: ''
      }))
    },
    actions: [
      { street: 'Pre', actorSeat: 2, actorLabel: slots[1], actionType: 'fold', amount: 0, sequence: 2 },
      { street: 'Pre', actorSeat: 1, actorLabel: `Hero ${slots[0]}`, actionType: 'raise', amount: 1200, sequence: 1 }
    ],
    session: { _id: `session_security_${size}`, bigBlind: 400 }
  }
}

function expectCode(fn, code) {
  assert.throws(fn, error => error && error.code === code)
}

const FORBIDDEN = new Set([
  'ownerOpenId', '_openid', 'privatePlayerId', 'sessionId', 'sourceHandId', 'playerId', 'playerNoteId',
  'playerName', 'linkedFriendUserId', 'avatarFileId', 'avatarUrl', 'venue', 'title', 'notes', 'note',
  'mindJourney', 'leakTags', 'tags', 'battleHandIds', 'profit', 'currentProfit', 'resultBB', 'allInEv',
  'allInEvProfit', 'allInEvAdjustedProfit', 'buyIn', 'cashOut', 'voiceNote', 'voiceExtract', 'aiReview',
  'ledgerState', 'streetInputs', 'streetSummary'
])

function scanKeys(value, path = '$') {
  if (Array.isArray(value)) return value.forEach((item, index) => scanKeys(item, `${path}[${index}]`))
  if (!value || typeof value !== 'object') return
  Object.entries(value).forEach(([key, child]) => {
    assert.equal(FORBIDDEN.has(key), false, `${path}.${key} leaked`)
    scanKeys(child, `${path}.${key}`)
  })
}

test('rejects missing actions instead of parsing hand text or hand.players fallback', () => {
  const source = fullLedgerFixture(6)
  source.actions = []
  source.hand.players = [{ seat: 1, position: 'BTN', stack: 40000 }]
  source.hand.streetInputs = { preflop: { actionLine: 'Hero BTN raise 1200, SB call' } }
  source.hand.streetSummary = 'Preflop: Hero BTN raise 1200'
  expectCode(() => buildHandSnapshot(source), 'HAND_ACTIONS_REQUIRED')
})

test('rejects unknown street, action, seats, sequences and full-ledger position mismatches', () => {
  const mutations = [
    actions => { actions[0].street = 'Showdown' },
    actions => { actions[0].actionType = 'squeeze' },
    actions => { actions[0].actorSeat = 0 },
    actions => { actions[0].actorSeat = 7 },
    actions => { actions[0].sequence = actions[1].sequence },
    actions => { actions[0].actorLabel = 'BB' }
  ]
  mutations.forEach(mutate => {
    const source = fullLedgerFixture(6)
    mutate(source.actions)
    expectCode(() => buildHandSnapshot(source), 'INVALID_HAND_SNAPSHOT')
  })
})

test('requires complete unique full-ledger slots and matching Hero seat position', () => {
  const missing = fullLedgerFixture(8)
  missing.hand.playerSnapshots.pop()
  expectCode(() => buildHandSnapshot(missing), 'INVALID_HAND_SNAPSHOT')

  const duplicate = fullLedgerFixture(8)
  duplicate.hand.playerSnapshots[7].slot = duplicate.hand.playerSnapshots[6].slot
  expectCode(() => buildHandSnapshot(duplicate), 'INVALID_HAND_SNAPSHOT')

  const heroMismatch = fullLedgerFixture(8)
  heroMismatch.hand.heroPosition = 'CO'
  expectCode(() => buildHandSnapshot(heroMismatch), 'INVALID_HAND_SNAPSHOT')

  const wrongPositionSet = fullLedgerFixture(6)
  wrongPositionSet.hand.playerSnapshots[5].position = 'MP'
  expectCode(() => buildHandSnapshot(wrongPositionSet), 'INVALID_HAND_SNAPSHOT')

  const unsupported = fullLedgerFixture(6)
  unsupported.hand.playerCount = 7
  expectCode(() => buildHandSnapshot(unsupported), 'INVALID_HAND_SNAPSHOT')
})

test('rejects malformed persisted board and playerSnapshots containers', () => {
  const malformedBoard = fullLedgerFixture(6)
  malformedBoard.hand.board = '2s3h4d'
  expectCode(() => buildHandSnapshot(malformedBoard), 'INVALID_HAND_SNAPSHOT')

  const malformedPlayers = fullLedgerFixture(6)
  malformedPlayers.hand.playerSnapshots = { BTN: { position: 'BTN' } }
  expectCode(() => buildHandSnapshot(malformedPlayers), 'INVALID_HAND_SNAPSHOT')
})

test('rejects illegal, incomplete, skipped and duplicate cards across every public zone', () => {
  const mutations = [
    source => { source.hand.heroCardsInput = 'As' },
    source => { source.hand.heroCardsInput = 'asKs' },
    source => { source.hand.heroCardsInput = 'AsAs' },
    source => { source.hand.board.flop = '2s3h' },
    source => { source.hand.board.turn = '5c' },
    source => { source.hand.board.flop = '2s3h4d'; source.hand.board.river = '9s' },
    source => { source.hand.board.flop = 'As3h4d' },
    source => { source.hand.board.flop = '2s3h4d'; source.hand.board.turn = '5x' }
  ]
  mutations.forEach(mutate => {
    const source = fullLedgerFixture(6)
    mutate(source)
    expectCode(() => buildHandSnapshot(source), 'INVALID_HAND_SNAPSHOT')
  })

  const duplicateShow = fullLedgerFixture(6)
  duplicateShow.hand.playerSnapshots[1].cards = 'AsQh'
  duplicateShow.actions.push({ street: 'River', actorSeat: 2, actorLabel: 'SB', actionType: 'show', amount: 0, sequence: 3 })
  expectCode(() => buildHandSnapshot(duplicateShow), 'INVALID_HAND_SNAPSHOT')
})

test('uses only structured show evidence and fails closed for missing or ambiguous show cards', () => {
  const noShow = fullLedgerFixture(6)
  noShow.hand.opponentCards = 'QhQs'
  noShow.hand.opponentCardsSource = 'manual'
  noShow.actions.push({ street: 'River', actorSeat: 2, actorLabel: 'SB', actionType: 'muck', amount: 0, sequence: 3 })
  assert.deepEqual(buildHandSnapshot(noShow).showdown, [])

  const missingCards = fullLedgerFixture(6)
  missingCards.actions.push({ street: 'River', actorSeat: 2, actorLabel: 'SB', actionType: 'show', amount: 0, sequence: 3 })
  expectCode(() => buildHandSnapshot(missingCards), 'INVALID_HAND_SNAPSHOT')

  const ambiguousLegacy = {
    hand: {
      playerCount: 4, heroSeat: 1, heroPosition: 'BTN', heroCardsInput: 'AsKs',
      stakeLevel: '100/200', board: { flop: '', turn: '', river: '' },
      opponentCards: 'QhQs', opponentCardsSource: 'manual'
    },
    session: {},
    actions: [
      { street: 'Pre', actorSeat: 1, actorLabel: 'Hero BTN', actionType: 'raise', amount: 600, sequence: 1 },
      { street: 'River', actorSeat: 2, actorLabel: 'SB', actionType: 'show', amount: 0, sequence: 2 },
      { street: 'River', actorSeat: 3, actorLabel: 'BB', actionType: 'show', amount: 0, sequence: 3 }
    ]
  }
  expectCode(() => buildHandSnapshot(ambiguousLegacy), 'INVALID_HAND_SNAPSHOT')
})

test('constructs an exact whitelist snapshot and drops recursive private keys and canary values', () => {
  const source = fullLedgerFixture(6)
  source.hand.board = { flop: '2s3h4d', turn: '5c', river: '9s', ownerOpenId: 'CANARY-board' }
  source.hand.playerSnapshots[1].cards = 'QhQs'
  source.actions.push({
    street: 'River', actorSeat: 2, actorLabel: 'SB', actionType: 'show', amount: 0, sequence: 3,
    potAfter: 99999, privatePlayerId: 'CANARY-action'
  })

  for (const key of FORBIDDEN) {
    source.hand[key] = `CANARY-hand-${key}`
    source.session[key] = `CANARY-session-${key}`
    source.hand.playerSnapshots[0][key] = `CANARY-player-${key}`
  }
  source.hand.heroCardsInput = 'AsKs'
  source.hand.sessionId = 'CANARY-hand-sessionId'
  source.session.bigBlind = 400

  const snapshot = buildHandSnapshot(source)
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'actions', 'allInPotBb', 'board', 'effectiveStackBb', 'hero', 'players', 'potBb', 'showdown', 'version'
  ])
  assert.deepEqual(Object.keys(snapshot.hero).sort(), ['cards', 'label', 'position', 'seat', 'stackBb'])
  snapshot.players.forEach(player => assert.deepEqual(Object.keys(player).sort(), ['label', 'position', 'seat', 'stackBb']))
  assert.deepEqual(Object.keys(snapshot.board).sort(), ['flop', 'river', 'turn'])
  snapshot.actions.forEach(action => assert.deepEqual(Object.keys(action).sort(), ['actor', 'amountBb', 'street', 'type']))
  snapshot.showdown.forEach(item => assert.deepEqual(Object.keys(item).sort(), ['actor', 'cards']))
  scanKeys(snapshot)

  const serialized = JSON.stringify(snapshot)
  assert.equal(serialized.includes('CANARY-'), false)
  assert.equal(serialized.includes('99999'), false)
})
