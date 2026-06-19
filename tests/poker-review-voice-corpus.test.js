const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const normalizer = require(path.join(root, 'cloudfunctions/poker_review/ai-normalizer.js'))

function processTranscript(transcript, extractedHand = {}, currentHand = {}) {
  return normalizer.postProcessReviewResult({
    extractedHand: Object.assign({
      stakeLevel: '',
      heroPosition: '',
      villainPosition: '',
      opponentName: '',
      opponentType: '',
      heroCardsInput: '',
      effectiveStack: 0,
      potSize: 0,
      board: { flop: '', turn: '', river: '' },
      streetInputs: {
        preflop: { actionLine: '', pot: '' },
        flop: { actionLine: '', pot: '' },
        turn: { actionLine: '', pot: '' },
        river: { actionLine: '', pot: '' }
      },
      streetSummary: '',
      mindJourney: '',
      showdown: ''
    }, extractedHand),
    missingFields: []
  }, transcript, currentHand)
}

test('corpus extracts SB pocket sixes squeeze all-in hand', () => {
  const transcript = [
    '200、400，这手牌是胡总在大盲，他就4万了。',
    'COV call，Button call，我在小盲也拿66 call，大盲搞了个6600 squeeze。',
    '我直接推all in，他call他是AA，flop还发了345。'
  ].join('')

  const hand = processTranscript(transcript).extractedHand

  assert.equal(hand.stakeLevel, '200/400')
  assert.equal(hand.heroPosition, 'SB')
  assert.equal(hand.villainPosition, 'BB')
  assert.equal(hand.opponentName, '胡总')
  assert.equal(Number(hand.effectiveStack), 40000)
  assert.match(hand.heroCardsInput, /6.*6|66/)
  assert.match(hand.board.flop, /3.*4.*5|345/)
  assert.match(hand.streetInputs.preflop.actionLine, /CO.*call|CO.*C/i)
  assert.match(hand.streetInputs.preflop.actionLine, /BTN.*call|BTN.*C/i)
  assert.match(hand.streetInputs.preflop.actionLine, /Hero.*SB.*call|Hero.*SB.*C/i)
  assert.match(hand.streetInputs.preflop.actionLine, /BB.*6600/)
  assert.match(hand.streetInputs.preflop.actionLine, /allin|all-in|AI/i)
  assert.match(hand.showdown || hand.streetSummary, /AA/)
})

test('corpus keeps folded-to-BB as villain action, not hero BB', () => {
  const transcript = [
    '9勾同花，我UTG+1开，弃到他大盲，他raise到9000。',
    '我有位置，我靠了。flop圈66彩虹，他check我check。',
    'turn红桃8，我没有后门花，只是卡顺，然后他打了个一万多，我直接弃掉。'
  ].join('')

  const hand = processTranscript(transcript).extractedHand

  assert.equal(hand.heroPosition, 'UTG+1')
  assert.equal(hand.villainPosition, 'BB')
  assert.match(hand.heroCardsInput, /J.*9|9.*J|勾|J9/)
  assert.match(hand.streetInputs.preflop.actionLine, /Hero.*UTG\+1.*open|Hero.*UTG\+1.*R/i)
  assert.match(hand.streetInputs.preflop.actionLine, /BB.*9000/)
  assert.match(hand.streetInputs.preflop.actionLine, /Hero.*call|Hero.*C/i)
  assert.match(hand.board.flop, /Q.*6.*6|圈.*6.*6|Q66/)
  assert.match(hand.board.turn, /8.*h|8h|红桃8/)
  assert.match(hand.streetInputs.turn.actionLine, /BB.*1万|BB.*10000|BB.*B/i)
  assert.match(hand.streetInputs.turn.actionLine, /Hero.*fold|Hero.*F/i)
})

test('corpus extracts suited broadway three-bet hand with corrected final stake', () => {
  const transcript = [
    '十K草花，刚说错了，对，300 600打的。',
    '他Button开1500，我小盲3B到8000，有效可能是七八万，他call。',
    'flop十六七，六七草花，我中对买花，turn黑桃9，river黑桃A。',
    '我flop打了三分之一，他call，turn继续打，他call，river我check，他打三万，我check fold。'
  ].join('')

  const hand = processTranscript(transcript).extractedHand

  assert.equal(hand.stakeLevel, '300/600')
  assert.equal(hand.heroPosition, 'SB')
  assert.equal(hand.villainPosition, 'BTN')
  assert.match(hand.heroCardsInput, /TcKc|KcTc|T.*K.*c|K.*T.*c/)
  assert.ok(Number(hand.effectiveStack) >= 70000)
  assert.match(hand.board.flop, /T.*6.*7|10.*6.*7/)
  assert.match(hand.board.turn, /9.*s|9s|黑桃9/)
  assert.match(hand.board.river, /A.*s|As|黑桃A/)
  assert.match(hand.streetInputs.preflop.actionLine, /BTN.*1500/)
  assert.match(hand.streetInputs.preflop.actionLine, /Hero.*SB.*3B.*8000/i)
  assert.match(hand.streetInputs.river.actionLine, /Hero.*check|Hero.*X/i)
  assert.match(hand.streetInputs.river.actionLine, /30000|三万/)
  assert.match(hand.streetInputs.river.actionLine, /fold|F/i)
})

test('corpus maps button aliases and avoids prompt leakage in summary', () => {
  const transcript = [
    'AA这手牌，UTG法国Polo open，CY在COV对他做3B到3500。',
    '我在巴特拿AA，我call3500，没有4B，法国人弃。',
    'turn白板2，CY打6500，我call。river A，我三条A，CY满炮21000，我min raise到4万，他弃。'
  ].join('')

  const hand = processTranscript(transcript, {
    streetSummary: 'Task: extract_hand_fields You are the user-specific Poker Agent. Return JSON if possible.'
  }).extractedHand

  assert.equal(hand.heroPosition, 'BTN')
  assert.equal(hand.villainPosition, 'CO')
  assert.equal(hand.opponentName, 'CY')
  assert.match(hand.heroCardsInput, /AA|A.*A/)
  assert.match(hand.streetInputs.preflop.actionLine, /Polo.*open|UTG.*open/i)
  assert.match(hand.streetInputs.preflop.actionLine, /CY.*3B.*3500/i)
  assert.match(hand.streetInputs.preflop.actionLine, /Hero.*BTN.*call|Hero.*BTN.*C/i)
  assert.match(hand.streetInputs.river.actionLine, /CY.*21000/)
  assert.match(hand.streetInputs.river.actionLine, /Hero.*40000|Hero.*4万/)
  assert.ok(!/Task:\s*extract_hand_fields|Return JSON if possible|You are the user-specific Poker Agent/i.test(hand.streetSummary))
})

test('confirmed rule inherits selected session stake when speech omits stakes', () => {
  const hand = processTranscript(
    'AK是个鱼在中位open，我在小盲拿到AK同色，我对他做3bet5000，他有效10万。',
    {},
    { stakeLevel: '300/600' }
  ).extractedHand

  assert.equal(hand.stakeLevel, '300/600')
})

test('confirmed rule assigns different suits for rainbow board without duplicating hero cards', () => {
  const hand = processTranscript('flop发A圈七彩虹，我在大盲check call。', {
    heroCardsInput: 'TsKs',
    board: { flop: '', turn: '', river: '' }
  }).extractedHand

  const flop = hand.board.flop
  assert.match(flop, /^A[shdc]Q[shdc]7[shdc]$/)
  const suits = [flop[1], flop[3], flop[5]]
  assert.equal(new Set(suits).size, 3)
  assert.ok(!['Ts', 'Ks'].includes(flop.slice(0, 2)))
  assert.ok(!['Ts', 'Ks'].includes(flop.slice(2, 4)))
  assert.ok(!['Ts', 'Ks'].includes(flop.slice(4, 6)))
})

test('confirmed rule maps backdoor heart cue to heart turn card when turn suit is omitted', () => {
  const hand = processTranscript('flop发K83彩虹，我有后门红桃兆，转牌掉了个9。', {
    heroCardsInput: 'AcQc',
    board: { flop: '', turn: '', river: '' }
  }).extractedHand

  assert.match(hand.board.flop, /^K[shdc]8[shdc]3[shdc]$/)
  assert.equal(hand.board.turn, '9h')
})
