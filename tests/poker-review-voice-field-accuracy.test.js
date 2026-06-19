const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const normalizer = require(path.join(root, 'cloudfunctions/poker_review/ai-normalizer.js'))

test('post process trusts explicit hero position, effective stack, and computes multiway flop entry pot', () => {
  const transcript = [
    '\u8fd9\u724c200/400\u662f\u524d\u4f4d\u8001\u5916g88 UTG open\u3002',
    '\u6211\u89c9\u5f97\u8fd9\u724c\uff0c\u6211\u5728button\uff0c\u8fd9\u724c\u4e5f\u6ca1\u5fc5\u8981\u5bf9\u4ed6\u505a3B\uff0c\u6211\u5c31call\u4e86\u3002',
    '\u7136\u540eflop\u53d1A\u52fe\u4e09\uff0c\u4e24\u5f20\u7ea2\u6843\u5e94\u8be5\u662f\uff0c\u6709\u4e70\u82b1\u9762\u3002',
    '\u7136\u540e\u4ed6check\uff0c\u8fd8\u6709\u5927\u76f2call\u4e86\uff0c\u5c31flop\u662f3\u4eba\u5e95\u6c60\u3002',
    '\u7136\u540echeck\u5230\u6211\uff0c\u6211\u6253\u4e86\u4e2a\u91cd\u6ce8\uff0c\u6211\u6253\u4e86\u4e2a3500\u3002',
    '\u7136\u540e\u5927\u76f2fold\uff0c\u8fd9\u4e2aopen\u7684\u8001\u5916call\u3002',
    '\u6709\u6548\u7b79\u7801100000'
  ].join('')

  const processed = normalizer.postProcessReviewResult({
    extractedHand: {
      stakeLevel: '200/400',
      playerCount: 8,
      heroPosition: 'UTG',
      heroCardsInput: 'AdJd',
      effectiveStack: 0,
      potSize: 3500,
      villainPosition: 'UTG',
      opponentName: 'G88',
      streetInputs: {
        preflop: { actionLine: 'UTG G88 open -> Hero call -> BB call', pot: '' },
        flop: { actionLine: 'UTG check -> BB check -> Hero bet3500 -> BB fold -> UTG call', pot: '3500' },
        turn: { actionLine: '', pot: '' },
        river: { actionLine: '', pot: '' }
      }
    },
    missingFields: ['effectiveStack']
  }, transcript, {})

  const hand = processed.extractedHand
  assert.equal(hand.heroPosition, 'BTN')
  assert.equal(hand.effectiveStack, 100000)
  assert.equal(hand.streetInputs.preflop.pot, '3200')
  assert.equal(hand.streetInputs.flop.pot, '3200')
  assert.equal(hand.potSize, 10200)
  assert.ok(!processed.missingFields.includes('effectiveStack'))
})

test('post process removes prompt leakage and rebuilds Chinese street summary from action lines', () => {
  const transcript = '这手牌200/400，我在button，HJ open到1000，我call，大盲call。翻牌A勾三两张红桃，他check，大盲check，我打3500，HJ call，大盲fold。有效筹码100000。'

  const processed = normalizer.postProcessReviewResult({
    extractedHand: {
      stakeLevel: '200/400',
      heroPosition: 'BTN',
      effectiveStack: 100000,
      potSize: 3500,
      streetSummary: 'Task: extract_hand_fields You are the user-specific Poker Agent. Return JSON if possible. Important fields: playedDate stakeLevel',
      streetInputs: {
        preflop: { actionLine: 'UTG g88 R1000->Hero BTN C->BB C', pot: '3200' },
        flop: { actionLine: 'UTG X->BB X->Hero B3500->UTG C->BB F', pot: '3200' },
        turn: { actionLine: '', pot: '' },
        river: { actionLine: '', pot: '' }
      },
      board: { flop: 'AhJh3s', turn: '', river: '' }
    },
    missingFields: []
  }, transcript, {})

  assert.ok(processed.extractedHand.streetSummary.includes('翻前'))
  assert.ok(processed.extractedHand.streetSummary.includes('翻牌'))
  assert.ok(!processed.extractedHand.streetSummary.includes('Task: extract_hand_fields'))
  assert.ok(!processed.extractedHand.streetSummary.includes('Return JSON if possible'))
})

test('post process recognizes 200400800 straddle speech and keeps Chinese summary clean', () => {
  const transcript = [
    '这个牌是打的200400800，这时候桌上又来了一个鱼，',
    '这牌是那个Alex p open 2000，然后那条鱼在sb靠，我在straddle call，',
    '翻牌发K83彩虹面，全部check到Alex P打了个半pot 3700。那个鱼也call 3200，我也call。',
    '转牌掉个A，我觉得这个A不应该继续check过去打check raise。',
    '我觉得他一些A勾、A圈也可能控池了，即使打的话面对我raise他应该也不会call。',
    '在这种面上我是一个underBluff，所以我只要自己去打，让他一些A去call我，',
    '我就打了个半pot，打了个8000，然后Alex P想了半天弃了，那个鱼call。',
    '合牌掉个7白板。那个鱼check给我，我在4万多，给我打了个25000，他想了一下call了，',
    '他应该是K，就是有K来抓我鸡了。'
  ].join('')

  const processed = normalizer.postProcessReviewResult({
    extractedHand: {
      stakeLevel: '400/800',
      hasStraddle: false,
      heroPosition: 'BTN',
      villainPosition: 'HJ',
      opponentName: 'ALEXP',
      opponentType: '松凶',
      effectiveStack: 200000,
      potSize: 3700,
      heroCardsInput: 'Ah8s',
      board: { flop: 'Ks8h3d', turn: 'Ac', river: '' },
      streetSummary: '翻前: Task: extract_hand_fields You are the user-specific Poker Agent. Return JSON if possible.',
      mindJourney: 'Task: extract_hand_fields You are the user-specific Poker Agent.',
      streetInputs: {
        preflop: { actionLine: 'Task: extract_hand_fields', pot: '' },
        flop: { actionLine: 'Task: extract_hand_fields', pot: '3700' },
        turn: { actionLine: '', pot: '' },
        river: { actionLine: '', pot: '' }
      }
    },
    missingFields: []
  }, transcript, {})

  const hand = processed.extractedHand
  assert.equal(hand.stakeLevel, '200/400')
  assert.equal(hand.hasStraddle, true)
  assert.equal(hand.straddleAmount, 800)
  assert.equal(hand.heroPosition, 'STR')
  assert.equal(hand.villainPosition, '')
  assert.equal(hand.opponentName, 'ALEXP')
  assert.equal(hand.streetInputs.preflop.pot, '6400')
  assert.equal(hand.streetInputs.flop.pot, '6400')
  assert.equal(hand.streetInputs.turn.pot, '17500')
  assert.equal(hand.streetInputs.river.pot, '33500')
  assert.equal(hand.potSize, 83500)
  assert.match(hand.streetInputs.preflop.actionLine, /ALEXP/)
  assert.match(hand.streetInputs.preflop.actionLine, /STR/)
  assert.match(hand.streetInputs.flop.actionLine, /3700/)
  assert.match(hand.streetInputs.turn.actionLine, /8000/)
  assert.match(hand.streetInputs.river.actionLine, /25000/)
  assert.ok(!/Task:\s*extract_hand_fields/i.test(hand.streetSummary))
  assert.ok(!/You are the user-specific Poker Agent/i.test(hand.streetSummary))
  assert.ok(/[翻前翻牌转牌河牌]/.test(hand.streetSummary))
  assert.ok(!/Task:\s*extract_hand_fields/i.test(hand.mindJourney))
})
