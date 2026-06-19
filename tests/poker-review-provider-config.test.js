const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadPokerReview(env) {
  const filePath = path.join(__dirname, '..', 'cloudfunctions', 'poker_review', 'index.js')
  const code = fs.readFileSync(filePath, 'utf8')
  const module = { exports: {} }
  const sandbox = {
    module,
    exports: module.exports,
    require(name) {
      if (name === 'wx-server-sdk') {
        return {
          DYNAMIC_CURRENT_ENV: 'test',
          init() {}
        }
      }
      if (name === './ai-normalizer') {
        return require(path.join(__dirname, '..', 'cloudfunctions', 'poker_review', 'ai-normalizer.js'))
      }
      if (name === './review-tags') {
        return require(path.join(__dirname, '..', 'cloudfunctions', 'poker_review', 'review-tags.js'))
      }
      return require(name)
    },
    process: {
      env: Object.assign({}, env)
    },
    Buffer,
    URL,
    console,
    setTimeout,
    clearTimeout
  }

  vm.runInNewContext(code, sandbox, { filename: filePath })
  return module.exports
}

test('poker Agent extract prefers response.data.extractedHand over fallback parsing', () => {
  const review = loadPokerReview({ AI_PROVIDER: 'poker-agent' })
  const result = review.__test.normalizePokerAgentExtract(
    {
      answer: '300/600 hand summary',
      data: {
        extractedHand: {
          stakeLevel: '300/600',
          playerCount: 4,
          heroPosition: 'CO',
          villainPosition: 'SB',
          opponentType: '松弱',
          heroCardsInput: 'QdQh',
          effectiveStack: 40000,
          potSize: 18000,
          board: { flop: '2d3d6c', turn: '3d', river: '7c' },
          streetInputs: {
            preflop: { actionLine: 'Hero CO open->CO C->SB C->BB C', pot: 2400 },
            flop: { actionLine: 'Hero B3000->CO C3000->SB R6000->BB F->Hero C->CO F', pot: 18000 },
            turn: { actionLine: 'SB X->Hero X', pot: 18000 },
            river: { actionLine: 'SB B18000->Hero C', pot: 18000 }
          },
          streetSummary: '翻前四人池；翻牌Hero下注被SB加注后跟注；转牌过过；河牌面对pot size跟注。',
          mindJourney: '翻牌考虑隔离短码，转牌考虑是否轻注，河牌根据马脚选择跟注。',
          tags: ['多人池', 'Hero Call']
        },
        missingFields: [],
        followUpQuestions: [],
        naturalLanguageSummary: 'Agent structured summary'
      }
    },
    '这个圈圈是换到300、600，然后我在前位开，COV call，小盲鱼call，大盲call。Flop 2 3 6两张方块，我打3000，COV call，小盲raise6000，大盲弃牌，我call，COV弃牌。转牌方块3，双方check。河牌草花7，鱼pot size，我call。',
    { hand: {}, session: {} }
  )

  assert.equal(result.extractedHand.stakeLevel, '300/600')
  assert.equal(result.extractedHand.playerCount, 4)
  assert.equal(result.extractedHand.heroPosition, 'CO')
  assert.equal(result.extractedHand.villainPosition, 'SB')
  assert.equal(result.extractedHand.heroCardsInput, 'QdQh')
  assert.equal(result.extractedHand.board.flop, '2d3d6c')
  assert.match(result.extractedHand.streetInputs.flop.actionLine, /R6000/)
  assert.equal(result.naturalLanguageSummary, 'Agent structured summary')
})

test('poker review cloud function reads MiniMax provider config', () => {
  const review = loadPokerReview({
    AI_PROVIDER: 'minimax',
    MINIMAX_API_KEY: 'test-key',
    MINIMAX_BASE_URL: 'https://api.minimax.io/v1',
    MINIMAX_MODEL: 'MiniMax-M2.7-highspeed',
    AI_TIMEOUT_MS: '45000'
  })

  const config = review.__test.getEnvConfig()

  assert.equal(config.provider, 'minimax')
  assert.equal(config.apiKey, 'test-key')
  assert.equal(config.baseUrl, 'https://api.minimax.io/v1')
  assert.equal(config.model, 'MiniMax-M2.7-highspeed')
  assert.equal(config.timeout, 45000)
})

test('EV脑 extract reads structured JSON from answer text', () => {
  const review = loadPokerReview({ AI_PROVIDER: 'poker-agent' })
  const result = review.__test.normalizePokerAgentExtract(
    {
      answer: [
        '```json',
        JSON.stringify({
          extractedHand: {
            stakeLevel: '200/400',
            heroPosition: 'UTG',
            effectiveStack: 50000,
            streetInputs: {
              preflop: 'UTG open 1000, BB 3B 3300, UTG allin, BB call',
              flop: { actionLine: 'runout Kxx', pot: '' }
            }
          },
          missingFields: ['flop_action'],
          followUpQuestions: ['confirm flop action']
        }),
        '```'
      ].join('\n')
    },
    '200/400 UTG open 1000, BB 3B 3300',
    { hand: {}, session: {} }
  )

  assert.equal(result.extractedHand.stakeLevel, '200/400')
  assert.equal(result.extractedHand.heroPosition, 'UTG')
  assert.equal(result.extractedHand.effectiveStack, 50000)
  assert.equal(result.extractedHand.streetInputs.preflop.actionLine, 'UTG open 1000, BB 3B 3300, UTG allin, BB call')
  assert.equal(result.extractedHand.streetInputs.flop.actionLine, 'runout Kxx')
  assert.equal(result.missingFields.join(','), 'flop_action')
  assert.equal(result.followUpQuestions.join(','), 'confirm flop action')
})

test('poker review cloud function reads EV脑 provider config', () => {
  const review = loadPokerReview({
    AI_PROVIDER: 'poker-agent',
    POKER_AGENT_BASE_URL: 'https://example.test',
    POKER_AGENT_ASK_PATH: '/api/v1/agent/ask',
    POKER_AGENT_USER_ID: 'agent-user',
    POKER_AGENT_TIMEOUT_MS: '55000'
  })

  const config = review.__test.getEnvConfig()

  assert.equal(config.provider, 'poker-agent')
  assert.equal(config.baseUrl, 'https://example.test')
  assert.equal(config.path, '/api/v1/agent/ask')
  assert.equal(config.userId, 'agent-user')
  assert.equal(config.timeout, 55000)
})

test('poker Agent extract keeps prompt instructions out of question text', () => {
  const cloud = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'poker_review', 'index.js'), 'utf8')

  assert.ok(
    cloud.includes("question: mode === 'extract' ? cleanedTranscript : question"),
    'extract mode should send only the voice transcript as Agent question'
  )
  assert.ok(
    cloud.includes("instructions: mode === 'extract' ? question : undefined"),
    'extract prompt should be sent separately from transcript text'
  )
  assert.ok(
    cloud.includes("transcript: mode === 'extract' ? cleanedTranscript : undefined"),
    'extract payload should expose the raw transcript separately'
  )
})

test('poker review extract falls back to local parser when agent is unavailable', () => {
  const review = loadPokerReview({ AI_PROVIDER: 'poker-agent' })
  const transcript = '这首十K。草花呢，是我在200 400打的。然后Button开，Button是一条鱼，当时对这个牌是300 600打的。对，300 600打的。然后，当时是四人桌，桌上有一个鱼，所以在打。然后这个牌是他在Button开，我在小盲拿这个牌，然后我对他作为他开1500，作为3B到8000。他call，flop发十六七，然后六七是草花，我是中对买买花嘛，我就check了。我本来是想打个check raise的，因为我们俩后手有效可能是有七八万这样8万这样吧，应该是。所以我觉得是可以这样打。然后他打，他就结果他也check了。然后转牌掉了个9，黑桃9，单八成顺嘛。然后我打了个6000，bet了个小注6000，他call。然后合牌掉了个黑桃A。啊。然后我觉得我在这边去打一个阻止注，阻止注没有意义。他一些比我小的牌啊，他也会弃掉，不会去call了。但是而且他，我觉得他范围里有一部分8吧，就是但是比较少，比较少的8。比如说我去打一个小注，他去raise我，就把自己陷入到一个很难的绝境。所以我这牌是打算做一个check call的，因为A是我的一个范围。结果我check了之后，锅里面2万8，他打了一个3万。那在我的范围优势上，他去打一个这么大的注，我觉得那他一定是有强牌了。但是结合前面的，我觉得他有可能是一些两对的牌。比如说A6啊、A7呀。甚至是A9，这种两对牌，我觉得可能是这种，所以我想了一下，我就ch-还是check fold了面对他'
  const result = review.__test.buildExtractFallbackResult(
    transcript,
    transcript,
    { hand: {}, session: {}, actions: [] },
    { appliedTerms: [] },
    new Error('ai provider http 503: Service Temporarily Unavailable')
  )

  assert.equal(result.code, 0)
  assert.equal(result.provider, 'local-fallback')
  assert.equal(result.extractedHand.stakeLevel, '300/600')
  assert.equal(result.extractedHand.heroPosition, 'SB')
  assert.equal(result.extractedHand.villainPosition, 'BTN')
  assert.equal(result.extractedHand.streetInputs.preflop.pot, '16600')
  assert.equal(result.extractedHand.streetInputs.river.pot, '28600')
  assert.equal(review.__test.isPokerAgentUnavailable(new Error('ai provider timeout')), true)
})

test('poker review advice reports agent unavailability instead of local fallback', () => {
  const review = loadPokerReview({ AI_PROVIDER: 'poker-agent' })
  const hand = {
    stakeLevel: '300/600',
    heroPosition: 'SB',
    villainPosition: 'BTN',
    opponentType: '松弱',
    heroCardsInput: 'TcKc',
    effectiveStack: 80000,
    potSize: 28600,
    board: { flop: 'Ts6c7c', turn: '9s', river: 'As' },
    streetInputs: {
      preflop: { actionLine: 'BTN open1500→Hero SB 3B8000→BTN call', pot: '16600' },
      flop: { actionLine: 'Hero check→BTN check', pot: '16600' },
      turn: { actionLine: 'Hero bet6000→BTN call', pot: '16600' },
      river: { actionLine: 'Hero check→BTN bet30000→Hero fold', pot: '28600' }
    }
  }
  const result = review.__test.buildAdviceFallbackResult(
    '请给这手牌生成AI建议',
    '请给这手牌生成AI建议',
    { hand, session: {}, actions: [] },
    { appliedTerms: [] },
    new Error('ai provider timeout')
  )

  assert.equal(result.code, 'POKER_AGENT_UNAVAILABLE')
  assert.equal(result.provider, 'poker-agent')
  assert.equal(result.mode, 'advice')
  assert.equal(result.analysis, null)
  assert.match(result.message, /timeout|unavailable|EV/)
  assert.match(result.raw.fallbackReason, /timeout/)
})

test('poker review cloud function defaults to deployed EV脑', () => {
  const review = loadPokerReview({})

  const config = review.__test.getEnvConfig()

  assert.equal(config.provider, 'poker-agent')
  assert.match(config.baseUrl, /^https:\/\/flask-v2u1-267284-4-1429181305\.sh\.run\.tcloudbase\.com/)
})

test('EV脑 response is normalized into review analysis payload', () => {
  const review = loadPokerReview({})
  const result = review.__test.normalizePokerAgentReview(
    {
      intent: 'hand_review',
      answer: '总体：转牌下注尺度偏小，可以更极化。',
      confidence: 0.78,
      missing_fields: ['effective_stack'],
      data: {
        review: {
          parsed_hand: {
            stakes: '200/400',
            hero: { position: 'BB', hand: 'AhAd' },
            missing_fields: ['effective_stack']
          },
          summary: '转牌可以更大。',
          leak_tags: ['turn_sizing'],
          training_plan: ['复盘 3bet pot 转牌下注尺度。']
        }
      }
    },
    'Hero AA 4bet pot 转牌下注。',
    {
      hand: {
        heroPosition: 'BB',
        heroCardsInput: 'AhAd',
        currentProfit: 100000,
        board: { flop: 'Jd8s4c', turn: 'Ah', river: '' }
      },
      session: { date: '2026/06/08' },
      actions: []
    }
  )

  assert.equal(result.extractedHand.heroCardsInput, 'AhAd')
  assert.equal(result.extractedHand.stakeLevel, '200/400')
  assert.equal(result.analysis.provider, 'poker-agent')
  assert.equal(result.analysis.answer, '总体：转牌下注尺度偏小，可以更极化。')
  assert.deepEqual(result.analysis.leakTags, ['turn_sizing'])
  assert.deepEqual(result.analysis.trainingPlan, ['复盘 3bet pot 转牌下注尺度。'])
  assert.deepEqual(result.missingFields, ['effective_stack'])
})

test('EV脑 rejects generic advice when coach LLM did not complete', () => {
  const review = loadPokerReview({})
  const response = {
    intent: 'voice_review_advice',
    data: {
      llm_error: { status: 'error:ReadTimeout', retryable: true },
      review: {
        verdict: '主要决策点需要围绕范围和 SPR 判断。',
        street_breakdown: [{
          street: 'flop',
          status: '原则复盘',
          points: ['这一街需要结合对手范围、底池赔率和后续 SPR 来判断下注或跟注质量。']
        }]
      }
    },
    tool_calls: [{ name: 'llm_coach_review', status: 'error:ReadTimeout' }]
  }

  assert.throws(
    () => review.__test.assertPokerAgentAdviceQuality(response, 'advice'),
    error => error && error.code === 'POKER_AGENT_QUALITY_UNAVAILABLE'
  )
  assert.equal(review.__test.isPokerAgentUnavailable({ code: 'POKER_AGENT_QUALITY_UNAVAILABLE' }), true)
})

test('poker review final normalize keeps corrected spoken board ranks', () => {
  const review = loadPokerReview({})
  const normalizer = require('../cloudfunctions/poker_review/ai-normalizer')
  const transcript = '我手牌红桃J红桃Q，flop发勾八四彩虹，转牌A。'
  const processed = normalizer.postProcessReviewResult(
    {
      extractedHand: {
        heroCardsInput: 'JhQh',
        board: { flop: 'Jd6s4c', turn: 'Ah', river: '' }
      },
      missingFields: []
    },
    transcript
  )
  const extracted = review.__test.normalizeExtractedHand(
    processed.extractedHand,
    {
      hand: { heroCardsInput: 'JhQh', board: { flop: '', turn: '', river: '' } },
      session: {},
      actions: []
    },
    transcript
  )

  assert.match(extracted.board.flop, /^J[sdch]8[sdch]4[sdch]$/)
  assert.notEqual(extracted.board.flop.slice(0, 2), 'Jh')
})

test('poker review filters questions already answered by current hand context', () => {
  const review = loadPokerReview({})
  const extracted = review.__test.normalizeExtractedHand(
    {},
    {
      hand: {
        heroCardsInput: 'AhTh',
        heroPosition: 'BB',
        stakeLevel: '200/400',
        potSize: 12000,
        effectiveStack: 150000,
        opponentName: 'Jason',
        board: {
          flop: 'Kd8s3c',
          turn: 'Qs',
          river: '2d'
        }
      },
      session: {
        date: '2026/06/03',
        stakeLevel: '200/400'
      },
      actions: []
    },
    'CO open，BB防守，flop听牌下注，转牌继续加注，对手弃牌。'
  )

  const filtered = review.__test.filterResolvedQuestions([
    'heroCardsInput（口述未明说，由上下文补充）需要确认或手动补充。',
    'effective_stack',
    'River是什么牌？',
    'potSize 需要确认或手动补充。',
    '对手类型是什么？'
  ], extracted)

  assert.deepEqual(filtered, ['对手类型是什么？'])
})
