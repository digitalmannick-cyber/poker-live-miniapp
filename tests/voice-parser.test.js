const test = require('node:test')
const assert = require('node:assert/strict')

const voiceParser = require('../utils/voice-parser')

test('voice parser extracts natural Chinese poker review fields', () => {
  const parsed = voiceParser.parseVoiceText(
    '啊，这个是前打的500/1000嘛，当时前面那个UTG条鱼open，然后韩国老板call，我call。总共是6人池这个牌。flop 发A2，是两张黑桃。我在最中间位置，我bet了个半pot，7500。最后赢了80000。'
  )

  assert.equal(parsed.stakeLevel, '500/1000')
  assert.equal(parsed.heroPosition, 'HJ')
  assert.equal(parsed.opponentType, '松弱')
  assert.equal(parsed.potSize, '7500')
  assert.equal(parsed.currentProfit, '80000')
  assert.equal(parsed.board.flop, 'As2s')
  assert.ok(parsed.streetSummary.includes('500/1000'))
  assert.ok(parsed.tags.includes('多人池'))
})

test('voice parser extracts suited cards and losing result', () => {
  const parsed = voiceParser.parseVoiceText(
    '我在CO拿AhKd，有效筹码80000，底池16000，翻牌Ts7d2c，转牌Ad，河牌5h，本手输了42000，对手是跟注站。'
  )

  assert.equal(parsed.heroPosition, 'CO')
  assert.equal(parsed.heroCardsInput, 'AhKd')
  assert.equal(parsed.effectiveStack, '80000')
  assert.equal(parsed.potSize, '16000')
  assert.equal(parsed.currentProfit, '-42000')
  assert.equal(parsed.opponentType, '跟注站')
  assert.deepEqual(parsed.board, {
    flop: 'Ts7d2c',
    turn: 'Ad',
    river: '5h'
  })
})

test('voice parser expands spoken money and auto-fills board suits', () => {
  const parsed = voiceParser.parseVoiceText(
    '我在BB拿AhAd，翻牌前加到1万2，两人有效十五万，flop发JJ8彩虹，turn 3，river A，最后赢八万。'
  )

  assert.equal(parsed.heroPosition, 'BB')
  assert.equal(parsed.heroCardsInput, 'AhAd')
  assert.equal(parsed.effectiveStack, '150000')
  assert.equal(parsed.potSize, '12000')
  assert.equal(parsed.currentProfit, '80000')
  assert.deepEqual(parsed.board, {
    flop: 'JsJh8d',
    turn: '3s',
    river: 'As'
  })
  assert.deepEqual(parsed.boardText, {
    flop: 'JJ8',
    turn: '3',
    river: 'A'
  })
})

test('voice parser extracts villain position and estimates street pots', () => {
  const parsed = voiceParser.parseVoiceText(
    '在button 3B到3000吧，我call，我在大盲位拿到这个牌，然后我四逼到1万2，他想了一下，靠，我们俩有效有15万条，然后flop发勾八四彩虹吧，我c bet了一个1/4 6000，他靠，转牌A，第二个方块，然后我又cbet三分之一，一万二，他弃了。'
  )

  assert.equal(parsed.heroPosition, 'BB')
  assert.equal(parsed.villainPosition, 'BTN')
  assert.equal(parsed.opponentType, '')
  assert.equal(parsed.effectiveStack, '150000')
  assert.equal(parsed.potSize, '54000')
  assert.deepEqual(parsed.boardText, {
    flop: 'J84',
    turn: 'A',
    river: ''
  })
  assert.equal(parsed.streetInputs.preflop.pot, '30000')
  assert.equal(parsed.streetInputs.flop.pot, '30000')
  assert.equal(parsed.streetInputs.turn.pot, '54000')
})

test('voice parser keeps preflop and flop pot equal when flop is reached', () => {
  const parsed = voiceParser.parseVoiceText(
    '翻前HJ open到1000，BTN call，我在BB call。flop发K72彩虹，我打3000，他call，转牌A。'
  )

  assert.equal(parsed.streetInputs.preflop.pot, parsed.streetInputs.flop.pot)
  assert.equal(parsed.streetInputs.turn.pot, '8000')
})

test('voice parser terminates pot preflop when someone folds before flop', () => {
  const parsed = voiceParser.parseVoiceText(
    '翻前HJ open到1000，BTN 3B到4000，我在BB 4B到12000，BTN弃了。'
  )

  assert.equal(parsed.streetInputs.preflop.pot, '17000')
  assert.equal(parsed.streetInputs.flop.pot, '')
  assert.equal(parsed.streetInputs.turn.pot, '')
})

test('voice parser keeps all ranks from spoken rainbow flop', () => {
  const parsed = voiceParser.parseVoiceText(
    '我在BB拿AhAd，flop发勾八四彩虹，我cbet 6000，他call，最后赢八万。'
  )

  assert.equal(parsed.boardText.flop, 'J84')
  assert.equal(parsed.board.flop.length, 6)
  assert.match(parsed.board.flop, /^J[shdc]8[shdc]4[shdc]$/)
  assert.equal(parsed.currentProfit, '80000')
})

test('voice parser keeps common spoken board rank variants', () => {
  const cases = [
    { text: 'flop发勾八四彩虹', flop: 'J84' },
    { text: '翻牌圈九七彩虹', flop: 'Q97' },
    { text: '翻牌老K七二', flop: 'K72' },
    { text: 'flop尖十五彩虹', flop: 'AT5' },
    { text: '翻牌勾勾八', flop: 'JJ8' },
    { text: '牌面是Q八4', flop: 'Q84' }
  ]

  cases.forEach(item => {
    const parsed = voiceParser.parseVoiceText(item.text)
    assert.equal(parsed.boardText.flop, item.flop, item.text)
    assert.equal(parsed.board.flop.length, 6, item.text)
  })
})

test('voice parser keeps spoken turn and river ranks', () => {
  const parsed = voiceParser.parseVoiceText(
    '翻牌老K七二，转牌勾，河牌尖，最后输了五万。'
  )

  assert.deepEqual(parsed.boardText, {
    flop: 'K72',
    turn: 'J',
    river: 'A'
  })
  assert.equal(parsed.currentProfit, '-50000')
})

test('voice parser defaults player count to 8 and detects remaining players', () => {
  const defaultParsed = voiceParser.parseVoiceText('Hero UTG open, fold to BB, BB call')
  assert.equal(defaultParsed.playerCount, 8)

  const shortHandedParsed = voiceParser.parseVoiceText('这手牌剩5个人，我在BB防守')
  assert.equal(shortHandedParsed.playerCount, 5)
})
