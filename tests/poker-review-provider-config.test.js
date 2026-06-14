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

test('poker Agent extract reads structured JSON from answer text', () => {
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

test('poker review cloud function reads poker Agent provider config', () => {
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

test('poker review cloud function defaults to deployed poker Agent', () => {
  const review = loadPokerReview({})

  const config = review.__test.getEnvConfig()

  assert.equal(config.provider, 'poker-agent')
  assert.match(config.baseUrl, /^https:\/\/flask-v2u1-267284-4-1429181305\.sh\.run\.tcloudbase\.com/)
})

test('poker Agent response is normalized into review analysis payload', () => {
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
