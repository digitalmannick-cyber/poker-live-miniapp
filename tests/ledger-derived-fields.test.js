const test = require('node:test')
const assert = require('node:assert/strict')

const ledgerDerived = require('../utils/ledger-derived-fields')

test('derives effective heads-up preflop all-in fields from ledger state with dead money', () => {
  const hand = {
    _id: 'hand_effective_all_in',
    heroPosition: 'BB',
    heroCardsInput: 'KhKc',
    opponentCards: 'JhJc',
    showdown: 'JhJc',
    board: { flop: '8c9c6s', turn: '3h', river: '2h' },
    potSize: 262800,
    allInPot: 262800,
    heroInvested: 211000,
    allInEv: 2892.92,
    ledgerState: {
      heroSlot: 'BB',
      heroPosition: 'BB',
      heroCardsInput: 'KhKc',
      villainCards: 'JhJc',
      board: { flop: '8c9c6s', turn: '3h', river: '2h' },
      players: {
        SB: { initialStack: 40000, stack: 39800, live: false },
        BB: { initialStack: 219100, stack: 169100, live: true, paid: 50000 },
        UTG: { initialStack: 40000, stack: 40000, live: false },
        'UTG+1': { initialStack: 40000, stack: 40000, live: false },
        MP: { initialStack: 40000, stack: 40000, live: false },
        HJ: { initialStack: 50000, stack: 0, live: true, paid: 50000, cards: 'JhJc' },
        CO: { initialStack: 40000, stack: 40000, live: false },
        BTN: { initialStack: 40000, stack: 38400, live: false, paid: 1600 }
      },
      actions: [
        { street: 'Pre', pos: 'SB', position: 'SB', action: 'Post', amount: 200 },
        { street: 'Pre', pos: 'BB', position: 'BB', action: 'Post', amount: 400 },
        { street: 'Pre', pos: 'UTG', position: 'UTG', action: 'Fold' },
        { street: 'Pre', pos: 'UTG+1', position: 'UTG+1', action: 'Fold' },
        { street: 'Pre', pos: 'MP', position: 'MP', action: 'Fold' },
        { street: 'Pre', pos: 'HJ', position: 'HJ', action: 'Call', amount: 400 },
        { street: 'Pre', pos: 'CO', position: 'CO', action: 'Fold' },
        { street: 'Pre', pos: 'BTN', position: 'BTN', action: 'Raise', amount: 1600 },
        { street: 'Pre', pos: 'SB', position: 'SB', action: 'Fold' },
        { street: 'Pre', pos: 'BB', position: 'BB', action: 'Raise', amount: 8500 },
        { street: 'Pre', pos: 'HJ', position: 'HJ', action: 'Raise', amount: 22000 },
        { street: 'Pre', pos: 'BTN', position: 'BTN', action: 'Fold' },
        { street: 'Pre', pos: 'BB', position: 'BB', action: 'All-in', amount: 211000 },
        { street: 'Pre', pos: 'HJ', position: 'HJ', action: 'All-in', amount: 50000 },
        { street: 'Pre', pos: 'HJ', position: 'HJ', action: 'Show' }
      ]
    }
  }

  const result = ledgerDerived.deriveLedgerHandFields(hand)

  assert.equal(result.isAllIn, true)
  assert.equal(result.allInStreet, 'preflop')
  assert.equal(result.terminalStreet, 'preflop')
  assert.equal(result.postAllInRunoutOnly, true)
  assert.equal(result.effectiveStack, 50000)
  assert.equal(result.heroInvested, 50000)
  assert.equal(result.allInPot, 101800)
  assert.equal(result.potSize, 101800)
  assert.equal(result.rawHeroInvested, 211000)
  assert.equal(result.rawAllInPot, 262800)
  assert(result.heroEquityPct > 80 && result.heroEquityPct < 83)
  assert(result.allInEv > 25000)
  assert.equal(result.analysisFocus, 'preflop_all_in')
})

test('can derive list-safe all-in fields without running equity EV', () => {
  const hand = {
    heroPosition: 'BB',
    heroCardsInput: 'KhKc',
    opponentCards: 'JhJc',
    board: { flop: '8c9c6s', turn: '3h', river: '2h' },
    potSize: 262800,
    allInEv: 2892.92,
    ledgerState: {
      heroSlot: 'BB',
      heroPosition: 'BB',
      heroCardsInput: 'KhKc',
      villainCards: 'JhJc',
      board: { flop: '8c9c6s', turn: '3h', river: '2h' },
      players: {
        SB: { initialStack: 40000, stack: 39800, live: false },
        BB: { initialStack: 219100, stack: 169100, live: true, paid: 50000 },
        HJ: { initialStack: 50000, stack: 0, live: true, paid: 50000, cards: 'JhJc' },
        BTN: { initialStack: 40000, stack: 38400, live: false, paid: 1600 }
      },
      actions: [
        { street: 'Pre', pos: 'SB', position: 'SB', action: 'Post', amount: 200 },
        { street: 'Pre', pos: 'BB', position: 'BB', action: 'Post', amount: 400 },
        { street: 'Pre', pos: 'HJ', position: 'HJ', action: 'Call', amount: 400 },
        { street: 'Pre', pos: 'BTN', position: 'BTN', action: 'Raise', amount: 1600 },
        { street: 'Pre', pos: 'SB', position: 'SB', action: 'Fold' },
        { street: 'Pre', pos: 'BB', position: 'BB', action: 'Raise', amount: 8500 },
        { street: 'Pre', pos: 'HJ', position: 'HJ', action: 'Raise', amount: 22000 },
        { street: 'Pre', pos: 'BTN', position: 'BTN', action: 'Fold' },
        { street: 'Pre', pos: 'BB', position: 'BB', action: 'All-in', amount: 211000 },
        { street: 'Pre', pos: 'HJ', position: 'HJ', action: 'All-in', amount: 50000 }
      ]
    }
  }

  const result = ledgerDerived.withLedgerDerivedFields(hand, { includeEv: false })

  assert.equal(result.effectiveStack, 50000)
  assert.equal(result.potSize, 101800)
  assert.equal(result.heroInvested, 50000)
  assert.equal(result.allInEv, 2892.92, 'list-safe derivation should not run expensive equity EV calculation')
  assert.equal(result.allInEvStatus || '', '')
})

test('preflop all-in equity sampling stays fast and near AA versus QQ equity', () => {
  const heroCards = [
    { rank: 'A', suit: 'h' },
    { rank: 'A', suit: 'd' }
  ]
  const villainCards = [
    { rank: 'Q', suit: 'h' },
    { rank: 'Q', suit: 'c' }
  ]

  const startedAt = process.hrtime.bigint()
  const equity = ledgerDerived.__test.estimateHeroEquityPct(heroCards, villainCards, [])
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1000000

  assert(equity > 80 && equity < 84, 'AA versus QQ preflop equity should be roughly 81-82%')
  assert(elapsedMs < 450, 'preflop equity sampling must not enumerate every runout before opening hand detail')
})

test('reuses persisted finite hero equity without sampling again', () => {
  const hand = buildCacheablePreflopHand('cached_persisted')
  hand.heroEquityPct = 81.25
  let sampleCalls = 0

  const result = ledgerDerived.deriveLedgerHandFields(hand, {
    estimateHeroEquityPct() {
      sampleCalls += 1
      return 50
    }
  })

  assert.equal(sampleCalls, 0)
  assert.equal(result.heroEquityPct, 81.25)
})

test('samples missing equity once and reuses the in-memory hand cache', () => {
  const hand = buildCacheablePreflopHand('cached_computed')
  let sampleCalls = 0
  const options = {
    estimateHeroEquityPct() {
      sampleCalls += 1
      return 82.5
    }
  }

  const first = ledgerDerived.deriveLedgerHandFields(hand, options)
  const second = ledgerDerived.deriveLedgerHandFields(hand, options)

  assert.equal(sampleCalls, 1)
  assert.equal(first.heroEquityPct, 82.5)
  assert.equal(second.heroEquityPct, 82.5)
  assert.equal(hand.heroEquityPct, 82.5, 'newly calculated equity should be written back to the current hand document')
  assert.equal(first.allInEv, second.allInEv, 'cached equity must not change All-in EV')
})

function buildCacheablePreflopHand(id) {
  return {
    _id: id,
    heroPosition: 'BB',
    heroCardsInput: 'AhAd',
    opponentCards: 'QhQc',
    currentProfit: 50000,
    ledgerState: {
      heroSlot: 'BB',
      heroCardsInput: 'AhAd',
      villainCards: 'QhQc',
      players: {
        BB: { initialStack: 50000 },
        HJ: { initialStack: 50000, cards: 'QhQc' }
      },
      actions: [
        { street: 'Pre', pos: 'BB', action: 'All-in', amount: 50000 },
        { street: 'Pre', pos: 'HJ', action: 'All-in', amount: 50000 }
      ]
    }
  }
}
