const assert = require('node:assert/strict')
const handExport = require('../utils/hand-export')

const hand = {
  _id: 'hand_1783653660611',
  playedAt: '2026-07-10T11:21:00+08:00',
  stakeLevel: '200/400',
  playerCount: 8,
  heroPosition: 'SB',
  villainPosition: 'BTN',
  heroCardsInput: 'KhQh',
  opponentCards: 'AdJh',
  currentProfit: -31208,
  potSize: 31208,
  effectiveStack: 40000,
  board: { flop: 'JdTs8c', turn: '6d', river: '5s' }
}

const actions = [
  { street: 'Pre', position: 'SB', action: 'Post', amount: 200 },
  { street: 'Pre', position: 'BB', action: 'Post', amount: 400 },
  { street: 'Pre', position: 'UTG', action: 'Fold' },
  { street: 'Pre', position: 'UTG+1', action: 'Fold' },
  { street: 'Pre', position: 'LJ', action: 'Fold' },
  { street: 'Pre', position: 'HJ', action: 'Fold' },
  { street: 'Pre', position: 'CO', action: 'Fold' },
  { street: 'Pre', position: 'BTN', action: 'Raise', amount: 1000 },
  { street: 'Pre', position: 'SB', action: 'Raise', amount: 4500 },
  { street: 'Pre', position: 'BB', action: 'Fold' },
  { street: 'Pre', position: 'BTN', action: 'Call', amount: 3500 },
  { street: 'Flop', position: 'SB', action: 'Bet', amount: 3102 },
  { street: 'Flop', position: 'BTN', action: 'Call', amount: 3102 },
  { street: 'Turn', position: 'SB', action: 'Bet', amount: 7802 },
  { street: 'Turn', position: 'BTN', action: 'Call', amount: 7802 },
  { street: 'River', position: 'SB', action: 'X' },
  { street: 'River', position: 'BTN', action: 'X' },
  { street: 'River', position: 'BTN', action: 'Show' }
]

const text = handExport.buildPokerStarsExport(hand, {
  session: { venue: 'Pokerscope' },
  actions
})

assert.match(text, /PokerStars Hand #1783653660611/)
assert.match(text, /Hold'em No Limit \(\$200\.00\/\$400\.00\)/)
assert.match(text, /Table 'Pokerscope' 8-max Seat #2 is the button/)
assert.match(text, /Dealt to Hero \[Kh Qh\]/)
assert.match(text, /BU: raises \$600 to \$1000/)
assert.match(text, /Hero: raises \$3500 to \$4500/)
assert.match(text, /\*\*\* FLOP \*\*\* \[Jd Ts 8c\]/)
assert.match(text, /Hero: bets \$3102/)
assert.match(text, /BU: shows \[Ad Jh\]/)
assert.match(text, /Total pot \$31208 \| Rake \$0/)
assert.match(text, /Board \[Jd Ts 8c 6d 5s\]/)

const persistedHand = {
  _id: 'hand_1783171699641_7012',
  playedAt: '2026-07-04T21:28:19+08:00',
  stakeLevel: '200/400',
  playerCount: 8,
  heroPosition: 'BB',
  villainPosition: 'BTN',
  heroCardsInput: '3h5h',
  currentProfit: 23600,
  potSize: 45800,
  effectiveStack: 40000,
  board: { flop: '6hJc3d', turn: '4c', river: '7d' },
  playerSnapshots: [
    { position: 'CO', initialStack: 40000 },
    { position: 'BTN', initialStack: 40000 },
    { position: 'SB', initialStack: 40000 },
    { position: 'BB', initialStack: 40000 },
    { position: 'UTG', initialStack: 40000 },
    { position: 'UTG+1', initialStack: 40000 },
    { position: 'MP', initialStack: 40000 },
    { position: 'HJ', initialStack: 40000 }
  ]
}

const persistedActions = [
  { street: 'Pre', actorLabel: 'UTG', actionType: 'raise', amount: 1200, sequence: 1 },
  { street: 'Pre', actorLabel: 'UTG+1', actionType: 'fold', amount: 0, sequence: 2 },
  { street: 'Pre', actorLabel: 'MP', actionType: 'fold', amount: 0, sequence: 3 },
  { street: 'Pre', actorLabel: 'HJ', actionType: 'fold', amount: 0, sequence: 4 },
  { street: 'Pre', actorLabel: 'CO', actionType: 'fold', amount: 0, sequence: 5 },
  { street: 'Pre', actorLabel: 'BTN', actionType: 'call', amount: 1200, sequence: 6 },
  { street: 'Pre', actorLabel: 'SB', actionType: 'fold', amount: 0, sequence: 7 },
  { street: 'Pre', actorLabel: 'Hero BB', actionType: 'call', amount: 800, sequence: 8 },
  { street: 'Flop', actorLabel: 'Hero BB', actionType: 'check', amount: 0, sequence: 9 },
  { street: 'Flop', actorLabel: 'UTG', actionType: 'check', amount: 0, sequence: 10 },
  { street: 'Flop', actorLabel: 'BTN', actionType: 'bet', amount: 1200, sequence: 11 },
  { street: 'Flop', actorLabel: 'Hero BB', actionType: 'raise', amount: 4500, sequence: 12 },
  { street: 'Flop', actorLabel: 'UTG', actionType: 'fold', amount: 0, sequence: 13 },
  { street: 'Flop', actorLabel: 'BTN', actionType: 'call', amount: 3300, sequence: 14 },
  { street: 'Turn', actorLabel: 'Hero BB', actionType: 'check', amount: 0, sequence: 15 },
  { street: 'Turn', actorLabel: 'BTN', actionType: 'bet', amount: 5500, sequence: 16 },
  { street: 'Turn', actorLabel: 'Hero BB', actionType: 'call', amount: 5500, sequence: 17 },
  { street: 'River', actorLabel: 'Hero BB', actionType: 'bet', amount: 11000, sequence: 18 },
  { street: 'River', actorLabel: 'BTN', actionType: 'call', amount: 11000, sequence: 19 },
  { street: 'River', actorLabel: 'BTN', actionType: 'muck', amount: 0, sequence: 20 }
]

const persistedText = handExport.buildPokerStarsExport(persistedHand, {
  session: { venue: 'MGM' },
  actions: persistedActions
})

assert.match(persistedText, /Seat 7: MP/)
assert.match(persistedText, /UTG: raises \$800 to \$1200/)
assert.match(persistedText, /BU: calls \$1200/)
assert.match(persistedText, /Hero: calls \$800/)
assert.match(persistedText, /Hero: checks/)
assert.match(persistedText, /BU: bets \$1200/)
assert.match(persistedText, /Hero: raises \$3300 to \$4500/)
assert.match(persistedText, /BU: calls \$3300/)
assert.match(persistedText, /BU: mucks/)
assert.match(persistedText, /Seat 4: Hero won \(\$45800\)/)
assert.doesNotMatch(persistedText, /Hero mucked/)
assert.doesNotMatch(persistedText, /^:\s*(?:\$\d+)?$/m)

console.log('hand export checks passed')
