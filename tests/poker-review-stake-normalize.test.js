const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadPokerReview() {
  const filePath = path.join(__dirname, '..', 'cloudfunctions', 'poker_review', 'index.js')
  const code = fs.readFileSync(filePath, 'utf8')
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(name) {
      if (name === 'wx-server-sdk') return { DYNAMIC_CURRENT_ENV: 'test', init() {} }
      if (name === './ai-normalizer') return require('../cloudfunctions/poker_review/ai-normalizer')
      if (name === './review-tags') return require('../cloudfunctions/poker_review/review-tags')
      return require(name)
    },
    process: { env: {} },
    Buffer,
    URL,
    console,
    setTimeout,
    clearTimeout
  }, { filename: filePath })
  return module.exports
}

test('invalid Agent stake level does not overwrite hand context stake', () => {
  const review = loadPokerReview()
  const extracted = review.__test.normalizeExtractedHand(
    { stakeLevel: '2026/06/08' },
    {
      hand: { stakeLevel: '200/400' },
      session: { stakeLevel: '100/200' },
      actions: []
    },
    '200/400 live'
  )

  assert.equal(extracted.stakeLevel, '200/400')
})

test('bet fraction in transcript does not overwrite hand context stake', () => {
  const review = loadPokerReview()
  const extracted = review.__test.normalizeExtractedHand(
    {},
    {
      hand: { stakeLevel: '200/400' },
      session: {},
      actions: []
    },
    'flop cbet 1/4 pot'
  )

  assert.equal(extracted.stakeLevel, '200/400')
})

test('explicit spoken table size is extracted as player count', () => {
  const review = loadPokerReview()
  const extracted = review.__test.normalizeExtractedHand(
    {},
    {
      hand: {},
      session: {},
      actions: []
    },
    '这手牌是七人桌，我在UTG open，他在大盲3B到3300'
  )

  assert.equal(extracted.playerCount, 7)
  const filtered = review.__test.filterResolvedQuestions(['table_size', 'effective_stack'], extracted)
  assert.deepEqual(filtered, ['effective_stack'])
})

test('misrecognized fold-to-big-blind phrase is not treated as table size', () => {
  const review = loadPokerReview()
  const extracted = review.__test.normalizeExtractedHand(
    {},
    {
      hand: {},
      session: {},
      actions: []
    },
    '这牌我在UTG open，7到他大盲，他3B到3300'
  )

  assert.equal(extracted.playerCount, 8)
})

test('missing spoken player count defaults to 8 players', () => {
  const review = loadPokerReview()
  const extracted = review.__test.normalizeExtractedHand(
    {},
    {
      hand: {},
      session: {}
    },
    'Hero UTG open, fold to BB, BB 3bet to 3300'
  )

  assert.equal(extracted.playerCount, 8)
})

test('spoken remaining players override default player count', () => {
  const review = loadPokerReview()
  const extracted = review.__test.normalizeExtractedHand(
    {},
    {
      hand: {},
      session: { playerCount: 8 }
    },
    '这手牌剩5个人，我在BB防守'
  )

  assert.equal(extracted.playerCount, 5)
})
