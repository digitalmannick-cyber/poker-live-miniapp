const test = require('node:test')
const assert = require('node:assert/strict')

const normalizer = require('../utils/ai-normalizer')

test('applies default and custom voice terms before review', () => {
  const result = normalizer.applyUserTerms(
    '韩国老板跟到河牌，我顶顶继续干一枪',
    [{ from: '韩国老板', to: '松弱韩国玩家', type: 'opponentType' }]
  )

  assert.equal(result.text, '松弱韩国玩家跟到河牌，我顶对顶踢脚继续bet')
  assert.deepEqual(
    result.appliedTerms.map(item => item.to).sort(),
    ['bet', '松弱韩国玩家', '顶对顶踢脚'].sort()
  )
})

test('post process keeps win amount in currentProfit instead of potSize', () => {
  const processed = normalizer.postProcessReviewResult(
    {
      extractedHand: {
        currentProfit: 0,
        potSize: 60000,
        board: { flop: 'Kd7c2h', turn: '3d', river: '' }
      },
      missingFields: []
    },
    '今天打200/400，翻牌K72，转牌3，本手赢了60000。'
  )

  assert.equal(processed.extractedHand.currentProfit, 60000)
  assert.equal(processed.extractedHand.potSize, 0)
})

test('post process keeps auto-filled board suits when speech only has ranks', () => {
  const processed = normalizer.postProcessReviewResult(
    {
      extractedHand: {
        board: { flop: 'Kd7c2h', turn: '3d', river: '' }
      },
      missingFields: []
    },
    '翻牌K72，转牌3，我继续下注。'
  )

  assert.deepEqual(processed.extractedHand.board, { flop: 'Kd7c2h', turn: '3d', river: '' })
})

test('post process keeps board cards when suits are spoken', () => {
  const processed = normalizer.postProcessReviewResult(
    {
      extractedHand: {
        board: { flop: 'Kd7c2h', turn: '3d', river: '' }
      },
      missingFields: []
    },
    '翻牌黑桃K红桃7梅花2，转牌方块3，我继续下注。'
  )

  assert.deepEqual(processed.extractedHand.board, { flop: 'Kd7c2h', turn: '3d', river: '' })
})

test('post process corrects AI board when transcript has spoken ranks', () => {
  const processed = normalizer.postProcessReviewResult(
    {
      extractedHand: {
        board: { flop: 'Jd4s6c', turn: 'Ad', river: '' }
      },
      missingFields: []
    },
    'flop发勾八四彩虹，转牌A，我继续下注。'
  )

  assert.match(processed.extractedHand.board.flop, /^J[shdc]8[shdc]4[shdc]$/)
  assert.match(processed.extractedHand.board.turn, /^A[shdc]$/)
})

test('post process corrects common AI board rank mistakes from transcript', () => {
  const cases = [
    { text: 'flop发勾八四彩虹，转牌A。', ai: { flop: 'Jd4s6c', turn: 'Ad', river: '' }, flop: /^J[shdc]8[shdc]4[shdc]$/, turn: /^A[shdc]$/ },
    { text: '翻牌圈九七彩虹，转牌勾，河牌尖。', ai: { flop: 'Qd6s7c', turn: 'Td', river: 'Ac' }, flop: /^Q[shdc]9[shdc]7[shdc]$/, turn: /^J[shdc]$/, river: /^A[shdc]$/ },
    { text: '翻牌老K七二，我下注。', ai: { flop: 'Kc4d2s', turn: '', river: '' }, flop: /^K[shdc]7[shdc]2[shdc]$/ },
    { text: 'flop尖十五彩虹。', ai: { flop: 'Ad6s5c', turn: '', river: '' }, flop: /^A[shdc]T[shdc]5[shdc]$/ },
    { text: '牌面是Q八4。', ai: { flop: 'Qd6s4c', turn: '', river: '' }, flop: /^Q[shdc]8[shdc]4[shdc]$/ }
  ]

  cases.forEach(item => {
    const processed = normalizer.postProcessReviewResult(
      {
        extractedHand: { board: item.ai },
        missingFields: []
      },
      item.text
    )

    assert.match(processed.extractedHand.board.flop, item.flop, item.text)
    if (item.turn) assert.match(processed.extractedHand.board.turn, item.turn, item.text)
    if (item.river) assert.match(processed.extractedHand.board.river, item.river, item.text)
  })
})

test('post process avoids duplicate suits when correcting board from transcript', () => {
  const processed = normalizer.postProcessReviewResult(
    {
      extractedHand: {
        heroCardsInput: 'JhQh',
        board: { flop: 'Jh4s2c', turn: 'Ah', river: 'Ad' }
      },
      missingFields: []
    },
    '我手牌红桃J红桃Q，flop发勾八四彩虹，转牌A，河牌A。'
  )

  const allCards = [
    processed.extractedHand.heroCardsInput.match(/../g),
    processed.extractedHand.board.flop.match(/../g),
    processed.extractedHand.board.turn.match(/../g),
    processed.extractedHand.board.river.match(/../g)
  ].flat().filter(Boolean)
  assert.equal(new Set(allCards).size, allCards.length)
  assert.match(processed.extractedHand.board.flop, /^J[sdch]8[sdch]4[sdch]$/)
})

test('post process removes duplicate exact cards across hero hand and board', () => {
  const processed = normalizer.postProcessReviewResult(
    {
      extractedHand: {
        heroCardsInput: '4d7d',
        board: { flop: 'Kd7s7c', turn: '7d', river: 'Td' }
      },
      missingFields: []
    },
    'Hero在BTN开池，Michael在SB 3B，Hero Call。Flop K77两张红桃，Michael bet 3500，Hero Call持有三条7。转牌掉7，Michael bet 5000，Hero Raise到13000，Michael Fold。'
  )

  const allCards = [
    processed.extractedHand.heroCardsInput.match(/../g),
    processed.extractedHand.board.flop.match(/../g),
    processed.extractedHand.board.turn.match(/../g),
    processed.extractedHand.board.river.match(/../g)
  ].flat().filter(Boolean)
  assert.equal(new Set(allCards).size, allCards.length)
})

test('post process clears AI river when speech never reaches river', () => {
  const processed = normalizer.postProcessReviewResult(
    {
      extractedHand: {
        heroCardsInput: '4d7d',
        board: { flop: 'Kd7s7c', turn: '8h', river: 'Td' },
        streetInputs: {
          preflop: { actionLine: 'Hero open, SB 3B, Hero call', pot: '10000' },
          flop: { actionLine: 'SB bet 3500, Hero call', pot: '' },
          turn: { actionLine: 'SB bet 5000, Hero raise 13000, SB fold', pot: '' },
          river: { actionLine: 'AI added river action', pot: '40000' }
        }
      },
      missingFields: []
    },
    'Hero在BTN开池，Michael在SB 3B 4500，Hero Call。Flop K77两张红桃，Michael bet 3500，Hero Call。转牌8，Michael bet 5000，Hero Raise到13000，Michael Fold。'
  )

  assert.equal(processed.extractedHand.board.river, '')
  assert.equal(processed.extractedHand.streetInputs.river.actionLine, '')
  assert.equal(processed.extractedHand.streetInputs.river.pot, '')
})

test('post process clears opponent type when transcript does not say it', () => {
  const processed = normalizer.postProcessReviewResult(
    {
      extractedHand: {
        opponentType: '紧弱',
        board: { flop: '', turn: '', river: '' }
      },
      missingFields: []
    },
    'button 3B到3000，我在大盲4bet到1万2，他call。'
  )

  assert.equal(processed.extractedHand.opponentType, '')
})

test('post process normalizes street pot flow across streets', () => {
  const processed = normalizer.postProcessReviewResult(
    {
      extractedHand: {
        board: { flop: 'Jd8s4c', turn: 'Ad', river: '' },
        streetInputs: {
          preflop: { actionLine: 'BTN 3B 3000, BB 4B 12000, BTN call', pot: '30000' },
          flop: { actionLine: 'Hero cbet 6000, BTN call', pot: '42000' },
          turn: { actionLine: 'Hero cbet 12000, BTN fold', pot: '54000' },
          river: { actionLine: '', pot: '' }
        }
      },
      missingFields: []
    },
    'flop发勾八四彩虹，转牌A。'
  )

  assert.equal(processed.extractedHand.streetInputs.preflop.pot, '30000')
  assert.equal(processed.extractedHand.streetInputs.flop.pot, '30000')
  assert.equal(processed.extractedHand.streetInputs.turn.pot, '42000')
})

test('post process carries matched street action amounts into next street pots', () => {
  const processed = normalizer.postProcessReviewResult(
    {
      extractedHand: {
        potSize: 0,
        currentProfit: 0,
        opponentType: '',
        board: { flop: 'AhJd8h', turn: '3h', river: '7d' },
        streetInputs: {
          preflop: { actionLine: 'UTG open, HJ call, BTN call', pot: '5000' },
          flop: { actionLine: 'Check -> Check -> Bet 2500 -> Fold -> Call', pot: '' },
          turn: { actionLine: 'Hero Donk 3300, 603 call', pot: '' },
          river: { actionLine: 'Hero Bet 15000, villain fold', pot: '' }
        }
      },
      missingFields: []
    },
    'flop AhJ8, turn 3, river 7',
    { currentProfit: -21500 }
  )

  assert.equal(processed.extractedHand.currentProfit, -21500)
  assert.equal(processed.extractedHand.opponentType, '')
  assert.equal(processed.extractedHand.streetInputs.preflop.pot, '5000')
  assert.equal(processed.extractedHand.streetInputs.flop.pot, '5000')
  assert.equal(processed.extractedHand.streetInputs.turn.pot, '10000')
  assert.equal(processed.extractedHand.streetInputs.river.pot, '16600')
  assert.equal(processed.extractedHand.potSize, 16600)
})

test('post process leaves unrecognized opponent fields blank and summarizes cold 4bet spot', () => {
  const transcript = '这手牌是5001000，我在BB，813在HJ位open到2500，button call，我cold 4bet到28000，他5B到66000，我KK直接6B allin，结果对方是AA。鲍比想了一下弃了，因为鲍比只有10万那时候；我觉得这个牌我有250个BB还是要推掉，而且我当时又想813可能觉得我在抢这个底池，就是受到上一手牌的影响；这牌后来我细想一下，其实应该直接弃掉是最好的。'
  const processed = normalizer.postProcessReviewResult(
    {
      extractedHand: {
        heroPosition: '',
        villainPosition: 'STR',
        opponentName: '',
        opponentType: '紧弱',
        heroCardsInput: 'KsKc',
        board: { flop: '', turn: '', river: '' },
        streetInputs: {
          preflop: { actionLine: '813 open2500→Hero 4B28000→Hero 5B66000→HJ fold→HJ allin', pot: '' },
          flop: { actionLine: '', pot: '' },
          turn: { actionLine: '', pot: '' },
          river: { actionLine: '', pot: '' }
        },
        streetSummary: '813 open2500→Hero 4B28000→Hero 5B66000→HJ fold→HJ allin',
        mindJourney: transcript
      },
      missingFields: []
    },
    transcript
  )

  assert.equal(processed.extractedHand.heroPosition, 'BB')
  assert.equal(processed.extractedHand.villainPosition, 'HJ')
  assert.equal(processed.extractedHand.opponentName, '813')
  assert.equal(processed.extractedHand.opponentType, '')
  assert.match(processed.extractedHand.streetSummary, /Hero 在 BB 位 cold 4B/)
  assert.match(processed.extractedHand.streetSummary, /HJ 813 open/)
  assert.match(processed.extractedHand.streetSummary, /5B 到 66000/)
  assert.match(processed.extractedHand.streetSummary, /6B allin KK/)
  assert.match(processed.extractedHand.streetSummary, /AA/)
  assert.ok(processed.extractedHand.streetSummary.length < 120)
  assert.match(processed.extractedHand.mindJourney, /250BB|250个BB/)
  assert.match(processed.extractedHand.mindJourney, /上一手牌/)
  assert.match(processed.extractedHand.mindJourney, /抢这个底池/)
  assert.match(processed.extractedHand.mindJourney, /应该直接弃掉/)
  assert.ok(processed.extractedHand.mindJourney.length < 220)
})

test('post process excludes an uncalled bet from the final pot', () => {
  const processed = normalizer.postProcessReviewResult(
    {
      extractedHand: {
        board: { flop: 'Jd8s4c', turn: 'Ad', river: '' },
        streetInputs: {
          preflop: { actionLine: 'BTN 3B 3000, BB 4B 12000, BTN call', pot: '30000' },
          flop: { actionLine: 'Hero bet 6000, BTN call', pot: '' },
          turn: { actionLine: 'Hero bet 12000, BTN fold', pot: '' },
          river: { actionLine: '', pot: '' }
        }
      },
      missingFields: []
    },
    'flop J84, turn A'
  )

  assert.equal(processed.extractedHand.streetInputs.flop.pot, '30000')
  assert.equal(processed.extractedHand.streetInputs.turn.pot, '42000')
  assert.equal(processed.extractedHand.potSize, 42000)
})

test('post process compacts spoken street action lines before pot calculation', () => {
  const transcript = '刚刚这个牌是当时我在btn，然后0503在hijack位open，然后我给他做了3B到3500，当时是打200、400。然后他给我做了1个4B到9000，很小的4B。然后我们有效是110000，所以是很深的筹码。我想我继续去5B他也没有意义，我有位置我就call了。然后773有两张方块买花，我没有方块。他check，我也Check。转牌掉个5，他打了个8000我Call。river掉1个草花圈，他打了个23000。我想首先他这里，我感觉就是1个超对了。Flop控池，不然他那牌在Flop这个干燥面，他都会打的。转牌又打，后来掉圈了，但是又像是不怕这个圈。然后他又去打了个2/3。这个我觉得他是超对吧，我就Fold了'
  const processed = normalizer.postProcessReviewResult({
    extractedHand: {
      heroPosition: 'BTN',
      villainPosition: 'HJ',
      effectiveStack: 110000,
      potSize: 0,
      board: { flop: '7s7h3d', turn: '5c', river: 'Qc' },
      streetInputs: {
        preflop: {
          actionLine: '刚刚这个牌是当时我在btn,然后0503在hijack位open,然后我给他做了3B到3500,当时是打200、400.然后他给我做了1个4B到9000,很小的4B.然后我们有效是110000,所以是很深的筹码.我想我继续去5B他也没有意义,我有位置我就call了',
          pot: '18000'
        },
        flop: { actionLine: '他check,我也Check。Flop控池,不然他那牌在Flop这个干燥面,他都会打的', pot: '' },
        turn: { actionLine: '转牌掉个5,他打了个8000我Call', pot: '' },
        river: { actionLine: 'river掉1个草花圈,他打了个23000,我觉得他是超对吧,我就Fold了', pot: '' }
      }
    }
  }, transcript, {})

  assert.equal(processed.extractedHand.streetInputs.preflop.actionLine, 'Hero 3B3500→HJ 4B9000→Hero call')
  assert.equal(processed.extractedHand.streetInputs.flop.actionLine, 'HJ check→Hero check')
  assert.equal(processed.extractedHand.streetInputs.turn.actionLine, 'HJ bet8000→Hero call')
  assert.equal(processed.extractedHand.streetInputs.river.actionLine, 'HJ bet23000→Hero fold')
  assert.equal(processed.extractedHand.streetInputs.flop.pot, '18000')
  assert.equal(processed.extractedHand.streetInputs.turn.pot, '18000')
  assert.equal(processed.extractedHand.streetInputs.river.pot, '34000')
  assert.equal(processed.extractedHand.potSize, 34000)
})

test('post process corrects BB defend all-in speech with known result', () => {
  const transcript = '10K这个牌是300600 utg+1，那个KKQJ。他open，然后fold到我大盲，我call。flop发A圈七彩虹，我有卡顺加买后门黑桃花。check打了个700，我check raise到2100。然后他再raise到3800，我靠，转牌掉个黑桃六。我check，锅里面是1万嘛，打了个15800，做了个overbet。但是我是觉得这边call太差了已经，我卡顺加买后门花，而且这个面明显是他有范围优势的面，他有可能借这个面去偷我。然后我直接，所以直接check allin他了。然后他call，他是set 7，合牌发了一个方块2，没发出来'
  const processed = normalizer.postProcessReviewResult({
    extractedHand: {
      stakeLevel: '300/600',
      heroPosition: 'UTG',
      villainPosition: 'STR',
      opponentName: '',
      currentProfit: -70000,
      effectiveStack: 0,
      potSize: 2100,
      board: { flop: 'Ah7d3c', turn: '6s', river: '2d' },
      streetInputs: {
        preflop: { actionLine: 'Hero fold->Hero call', pot: '' },
        flop: { actionLine: 'Hero check->STR raise3800', pot: '700' },
        turn: { actionLine: 'Hero check->15800 bet15800', pot: '8300' },
        river: { actionLine: '', pot: '' }
      }
    },
    missingFields: []
  }, transcript)

  assert.equal(processed.extractedHand.stakeLevel, '300/600')
  assert.equal(processed.extractedHand.heroPosition, 'BB')
  assert.equal(processed.extractedHand.villainPosition, 'UTG+1')
  assert.equal(processed.extractedHand.opponentName, 'KKQJ')
  assert.equal(processed.extractedHand.effectiveStack, 70000)
  assert.equal(processed.extractedHand.potSize, 140000)
  assert.equal(processed.extractedHand.streetInputs.preflop.pot, '3300')
  assert.equal(processed.extractedHand.streetInputs.flop.pot, '3300')
  assert.equal(processed.extractedHand.streetInputs.turn.pot, '10900')
  assert.equal(processed.extractedHand.streetInputs.preflop.actionLine, 'UTG+1 KKQJ open→Hero BB call')
  assert.equal(processed.extractedHand.streetInputs.flop.actionLine, 'Hero check→KKQJ cbet700→Hero xr2100→KKQJ 4B3800→Hero call')
  assert.equal(processed.extractedHand.streetInputs.turn.actionLine, 'Hero check→KKQJ bet15800→Hero allin→KKQJ call')
})

test('post process corrects 200/400/800 straddle multiway voice review', () => {
  const transcript = '这个牌是打的 200400800，这时候桌上又来了一个一个鱼，然后这牌是把他那个Alex p open 2000，然后那条鱼在 sb 靠，我在 straddle call，翻牌发K83彩虹面，全部check到Alex P打了个半pot 3700。我觉得他这边就是应该是没有牌的，这个size，然后那个鱼也call 3200。我觉得这个牌我还是要call一下，然后call这个转牌掉个A，然后想这个A ，我就这个情况不应该继续check过去的话，打check raise。对，我觉得这个比如他一些A勾啊，A圈也可能控池了。然后即使打的话，面对我raise，他应该也不会call。对吧，因为在这种面上我是一个 underBluff，所以我觉得我只要自己去打，让他一些A去call我，我就打了个半pot。打了个8000，然后Alex P想了半天弃了，那个鱼call。合牌掉个7白板。那个鱼check给我，我在4万多，给我打了个2万5。他想了一下call了，他应该是K，就是就是有K 来抓我鸡了应该'
  const assertCorrected = processed => {
    const hand = processed.extractedHand
    assert.equal(hand.stakeLevel, '200/400')
    assert.equal(hand.hasStraddle, true)
    assert.equal(hand.straddleAmount, 800)
    assert.equal(hand.heroPosition, 'STR')
    assert.equal(hand.villainPosition, '')
    assert.equal(hand.opponentName, 'ALEXP')
    assert.equal(hand.opponentType, '')
    assert.equal(hand.heroCardsInput, '')
    assert.deepEqual(hand.board, { flop: 'Ks8h3d', turn: 'As', river: '7s' })
    assert.equal(hand.streetInputs.preflop.pot, '6400')
    assert.equal(hand.streetInputs.flop.pot, '6400')
    assert.equal(hand.streetInputs.turn.pot, '17500')
    assert.equal(hand.streetInputs.river.pot, '33500')
    assert.equal(hand.potSize, 83500)
    assert.match(hand.streetInputs.preflop.actionLine, /ALEXP open2000/)
    assert.match(hand.streetInputs.flop.actionLine, /bet3700/)
    assert.match(hand.streetInputs.turn.actionLine, /bet8000/)
    assert.match(hand.streetInputs.river.actionLine, /bet25000/)
    assert.doesNotMatch(hand.streetSummary, /Task: extract_hand_fields|You are the user-specific Poker Agent/)
    assert.doesNotMatch(hand.mindJourney, /Task: extract_hand_fields|You are the user-specific Poker Agent/)
    assert.match(hand.mindJourney, /不像强牌|underBluff|Ax|Kx/)
  }

  assertCorrected(normalizer.postProcessReviewResult({
    extractedHand: {
      stakeLevel: '400/800',
      hasStraddle: false,
      straddleAmount: 0,
      heroPosition: 'BTN',
      villainPosition: 'HJ',
      opponentName: 'ALEXP',
      opponentType: '松凶',
      heroCardsInput: 'Ah8s',
      potSize: 3700,
      currentProfit: 50000,
      board: { flop: 'Ks8h3d', turn: 'Th', river: '' },
      streetSummary: 'Task: extract_hand_fields You are the user-specific Poker Agent for live Texas Holdem voice review.',
      mindJourney: 'Task: extract_hand_fields You are the user-specific Poker Agent for live Texas Holdem voice review.',
      streetInputs: {
        preflop: { actionLine: 'ALEXP open 2000, SB call, Hero call', pot: '' },
        flop: { actionLine: 'SB check, Hero check, ALEXP bet3700, SB call3200, Hero call', pot: '' },
        turn: { actionLine: 'Hero bet8000, ALEXP fold, SB call', pot: '' },
        river: { actionLine: 'SB check, Hero bet25000, SB call', pot: '' }
      }
    },
    missingFields: []
  }, transcript))

  assertCorrected(normalizer.postProcessReviewResult({
    extractedHand: {
      stakeLevel: '400/800',
      hasStraddle: false,
      heroPosition: 'BTN',
      villainPosition: 'HJ',
      opponentName: 'ALEXP',
      opponentType: '松凶',
      heroCardsInput: 'Ah8s',
      potSize: 3700,
      board: { flop: 'Ks8h3d', turn: 'Th', river: '' },
      streetSummary: 'Task: extract_hand_fields You are the user-specific Poker Agent.',
      mindJourney: 'Task: extract_hand_fields You are the user-specific Poker Agent.',
      streetInputs: {}
    },
    missingFields: []
  }, transcript))
})

test('post process corrects SB T-K clubs three-bet pot and replaces stale mind journey', () => {
  const transcript = '这首十K。草花呢，是我在200 400打的。然后Button开，Button是一条鱼，当时对这个牌是300 600打的。对，300 600打的。然后，当时是四人桌，桌上有一个鱼，所以在打。然后这个牌是他在Button开，我在小盲拿这个牌，然后我对他作为他开1500，作为3B到8000。他call，flop发十六七，然后六七是草花，我是中对买买花嘛，我就check了。我本来是想打个check raise的，因为我们俩后手有效可能是有七八万这样8万这样吧，应该是。所以我觉得是可以这样打。然后他打，他就结果他也check了。然后转牌掉了个9，黑桃9，单八成顺嘛。然后我打了个6000，bet了个小注6000，他call。然后合牌掉了个黑桃A。啊。然后我觉得我在这边去打一个阻止注，阻止注没有意义。他一些比我小的牌啊，他也会弃掉，不会去call了。但是而且他，我觉得他范围里有一部分8吧，就是但是比较少，比较少的8。比如说我去打一个小注，他去raise我，就把自己陷入到一个很难的绝境。所以我这牌是打算做一个check call的，因为A是我的一个范围。结果我check了之后，锅里面2万8，他打了一个3万。那在我的范围优势上，他去打一个这么大的注，我觉得那他一定是有强牌了。但是结合前面的，我觉得他有可能是一些两对的牌。比如说A6啊、A7呀。甚至是A9，这种两对牌，我觉得可能是这种，所以我想了一下，我就ch-还是check fold了面对他'
  const processed = normalizer.postProcessReviewResult({
    extractedHand: {
      stakeLevel: '300/600',
      heroPosition: 'SB',
      villainPosition: 'BTN',
      opponentType: '松凶',
      heroCardsInput: 'TcKc',
      effectiveStack: 80000,
      potSize: 6000,
      currentProfit: -14000,
      board: { flop: 'Ts6h7h', turn: 'Th', river: '' },
      streetSummary: 'Task: extract_hand_fields You are the user-specific Poker Agent for live Texas Holdem voice review. / 翻牌 T♠6♥7♦: 翻牌; board. / 转牌 T♥: 转牌: the Agent-verified structured result.',
      mindJourney: 'Turn思考：面对15800 overbet，Hero觉得call太差；自己是卡顺+后门花，对手有范围优势且可能偷池，所以改用check all-in争取弃牌率。',
      streetInputs: {
        preflop: { actionLine: 'Button open1500 -> Hero SB 3B8000 -> Button call', pot: '18000' },
        flop: { actionLine: 'Hero check -> Button check', pot: '' },
        turn: { actionLine: 'Hero bet6000 -> Button call', pot: '' },
        river: { actionLine: 'Hero check -> Button bet30000 -> Hero fold', pot: '' }
      }
    },
    missingFields: []
  }, transcript)

  const hand = processed.extractedHand
  assert.equal(hand.stakeLevel, '300/600')
  assert.equal(hand.heroPosition, 'SB')
  assert.equal(hand.villainPosition, 'BTN')
  assert.equal(hand.opponentType, '松弱')
  assert.equal(hand.heroCardsInput, 'TcKc')
  assert.equal(hand.effectiveStack, 80000)
  assert.equal(hand.currentProfit, -14000)
  assert.deepEqual(hand.board, { flop: 'Ts6c7c', turn: '9s', river: 'As' })
  assert.equal(hand.streetInputs.preflop.pot, '16600')
  assert.equal(hand.streetInputs.flop.pot, '16600')
  assert.equal(hand.streetInputs.turn.pot, '16600')
  assert.equal(hand.streetInputs.river.pot, '28600')
  assert.equal(hand.potSize, 28600)
  assert.equal(hand.streetInputs.preflop.actionLine, 'BTN open1500→Hero SB 3B8000→BTN call')
  assert.equal(hand.streetInputs.flop.actionLine, 'Hero check→BTN check')
  assert.equal(hand.streetInputs.turn.actionLine, 'Hero bet6000→BTN call')
  assert.equal(hand.streetInputs.river.actionLine, 'Hero check→BTN bet30000→Hero fold')
  assert.doesNotMatch(hand.streetSummary, /Task: extract_hand_fields|You are the user-specific Poker Agent|Agent-verified/)
  assert.doesNotMatch(hand.mindJourney, /15800|check all-in|卡顺\+后门花/)
  assert.match(hand.mindJourney, /阻止注没有意义|check-call|check-fold|两对|A6|A7|A9/)
})

test('post process rebuilds street summary instead of preserving stale model text', () => {
  const transcript = 'BTN open 1500. Hero SB 3B to 8000. BTN call. Flop check check. Turn Hero bet 6000 BTN call. River Hero check BTN bet 30000 Hero fold.'
  const processed = normalizer.postProcessReviewResult({
    extractedHand: {
      stakeLevel: '300/600',
      heroPosition: 'SB',
      villainPosition: 'BTN',
      streetSummary: 'old preserved summary from another hand',
      board: { flop: 'Ts6c7c', turn: '9s', river: 'As' },
      streetInputs: {
        preflop: { actionLine: 'BTN open1500 -> Hero SB 3B8000 -> BTN call', pot: '16600' },
        flop: { actionLine: 'Hero check -> BTN check', pot: '' },
        turn: { actionLine: 'Hero bet6000 -> BTN call', pot: '' },
        river: { actionLine: 'Hero check -> BTN bet30000 -> Hero fold', pot: '' }
      }
    },
    missingFields: []
  }, transcript)

  const summary = processed.extractedHand.streetSummary
  assert.doesNotMatch(summary, /old preserved summary/)
  assert.match(summary, /BTN open1500/)
  assert.match(summary, /Hero bet6000/)
  assert.match(summary, /BTN bet30000/)
})

test('post process drops stale mind journey when amounts and all-in are absent from transcript', () => {
  const transcript = 'BTN open 1500, Hero SB 3B to 8000, BTN call. Flop check check. Turn Hero bet 6000 and BTN call. River As, Hero check, BTN bet 30000, Hero fold. Hero thinks block bet has no value and villain may have A6, A7, or A9.'
  const processed = normalizer.postProcessReviewResult({
    extractedHand: {
      mindJourney: 'Turn: facing 15800 overbet, Hero chose check all-in with straight draw and backdoor flush.',
      board: { flop: 'Ts6c7c', turn: '9s', river: 'As' },
      streetInputs: {
        preflop: { actionLine: 'BTN open1500 -> Hero SB 3B8000 -> BTN call', pot: '16600' },
        flop: { actionLine: 'Hero check -> BTN check', pot: '' },
        turn: { actionLine: 'Hero bet6000 -> BTN call', pot: '' },
        river: { actionLine: 'Hero check -> BTN bet30000 -> Hero fold', pot: '' }
      }
    },
    missingFields: []
  }, transcript)

  assert.doesNotMatch(processed.extractedHand.mindJourney, /15800|overbet|check all-in|straight draw|backdoor flush/i)
})

test('post process infers heads-up three-bet preflop pot from action line', () => {
  const transcript = 'BTN open 1500, Hero SB three-bets to 8000, BTN calls. Flop check check. Turn Hero bets 6000 and BTN calls. River Hero checks, BTN bets 30000, Hero folds.'
  const processed = normalizer.postProcessReviewResult({
    extractedHand: {
      stakeLevel: '300/600',
      heroPosition: 'SB',
      villainPosition: 'BTN',
      potSize: 6000,
      board: { flop: 'Ts6c7c', turn: '9s', river: 'As' },
      streetInputs: {
        preflop: { actionLine: 'BTN open1500 -> Hero SB 3B8000 -> BTN call', pot: '18000' },
        flop: { actionLine: 'Hero check -> BTN check', pot: '' },
        turn: { actionLine: 'Hero bet6000 -> BTN call', pot: '' },
        river: { actionLine: 'Hero check -> BTN bet30000 -> Hero fold', pot: '' }
      }
    },
    missingFields: []
  }, transcript)

  const hand = processed.extractedHand
  assert.equal(hand.streetInputs.preflop.pot, '16600')
  assert.equal(hand.streetInputs.flop.pot, '16600')
  assert.equal(hand.streetInputs.turn.pot, '16600')
  assert.equal(hand.streetInputs.river.pot, '28600')
  assert.equal(hand.potSize, 28600)
})

test('post process summarizes mind journey instead of copying raw transcript', () => {
  const transcript = '10K这个牌是300600 utg+1，那个KKQJ。他open，然后fold到我大盲，我call。flop发A圈七彩虹，我有卡顺加买后门黑桃花。check打了个700，我check raise到2100。然后他再raise到3800，我靠，转牌掉个黑桃六。我check，锅里面是1万嘛，打了个15800，做了个overbet。但是我是觉得这边call太差了已经，我卡顺加买后门花，而且这个面明显是他有范围优势的面，他有可能借这个面去偷我。然后我直接，所以直接check allin他了。然后他call，他是set 7，合牌发了一个方块2，没发出来'
  const processed = normalizer.postProcessReviewResult({
    extractedHand: {
      mindJourney: transcript,
      board: { flop: 'As7dQc', turn: '6s', river: '2d' },
      streetInputs: {
        preflop: { actionLine: 'UTG+1 KKQJ open→Hero BB call', pot: '3300' },
        flop: { actionLine: 'Hero check→KKQJ cbet700→Hero xr2100→KKQJ 4B3800→Hero call', pot: '3300' },
        turn: { actionLine: 'Hero check→KKQJ bet15800→Hero allin→KKQJ call', pot: '10900' },
        river: { actionLine: '', pot: '' }
      }
    },
    missingFields: []
  }, transcript)

  const mindJourney = processed.extractedHand.mindJourney
  assert.notEqual(mindJourney, transcript)
  assert.ok(mindJourney.length < transcript.length / 2)
  assert.match(mindJourney, /卡顺|后门|范围优势|偷|call|allin|全下/)
})

test('post process builds concise street summary and anchors turn thinking', () => {
  const transcript = '10K这个牌是300600 utg+1，那个KKQJ。他open，然后fold到我大盲，我call。flop发A圈七彩虹，我有卡顺加买后门黑桃花。check打了个700，我check raise到2100。然后他再raise到3800，我靠，转牌掉个黑桃六。我check，锅里面是1万嘛，打了个15800，做了个overbet。但是我是觉得这边call太差了已经，我卡顺加买后门花，而且这个面明显是他有范围优势的面，他有可能借这个面去偷我。然后我直接，所以直接check allin他了。然后他call，他是set 7，合牌发了一个方块2，没发出来'
  const processed = normalizer.postProcessReviewResult({
    extractedHand: {
      streetSummary: transcript,
      mindJourney: transcript,
      board: { flop: 'As7dQh', turn: '6s', river: '2d' },
      streetInputs: {
        preflop: { actionLine: 'UTG+1 KKQJ open→Hero BB call', pot: '3300' },
        flop: { actionLine: 'Hero check→KKQJ cbet700→Hero xr2100→KKQJ 4B3800→Hero call', pot: '3300' },
        turn: { actionLine: 'Hero check→KKQJ bet15800→Hero allin→KKQJ call', pot: '10900' },
        river: { actionLine: '', pot: '' }
      }
    },
    missingFields: []
  }, transcript)

  const summary = processed.extractedHand.streetSummary
  const mindJourney = processed.extractedHand.mindJourney

  assert.notEqual(summary, transcript)
  assert.ok(summary.length < 180)
  assert.match(summary, /翻前.*UTG\+1 KKQJ open.*翻牌.*cbet700.*转牌.*bet15800.*allin/)
  assert.doesNotMatch(summary, /这个牌是|我是觉得|我靠/)

  assert.notEqual(mindJourney, transcript)
  assert.ok(mindJourney.length < 180)
  assert.match(mindJourney, /Turn|转牌|15800|overbet|范围优势|偷|allin/)
  assert.doesNotMatch(mindJourney, /^Flop|^翻牌/)
})

test('extracts explicit user glossary definitions from speech', () => {
  const learned = normalizer.extractExplicitTermDefinitions('以后韩国老板就是松弱，花面代表同花面。')

  assert.deepEqual(
    learned.map(item => ({ from: item.from, to: item.to, type: item.type })),
    [
      { from: '韩国老板', to: '松弱', type: 'learned' },
      { from: '花面', to: '同花面', type: 'learned' }
    ]
  )
})

test('merges learned terms by source phrase', () => {
  const merged = normalizer.mergeUserTerms(
    [{ from: '韩国老板', to: '紧弱', type: 'learned', updatedAt: 1 }],
    [{ from: '韩国老板', to: '松弱', type: 'learned', updatedAt: 2 }]
  )

  assert.equal(merged.length, 1)
  assert.equal(merged[0].from, '韩国老板')
  assert.equal(merged[0].to, '松弱')
})
