const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const Module = require('node:module')

const root = path.resolve(__dirname, '..')
const reviewJs = fs.readFileSync(path.join(root, 'pages/review-list/review-list.js'), 'utf8')
const cloudPath = path.join(root, 'cloudfunctions/poker_review/index.js')
const cloud = fs.readFileSync(cloudPath, 'utf8')
const normalizer = fs.readFileSync(path.join(root, 'utils/ai-normalizer.js'), 'utf8')

function loadCloudReviewTestApi() {
  const originalLoad = Module._load
  delete require.cache[require.resolve(cloudPath)]
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {}
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    return require(cloudPath).__test
  } finally {
    Module._load = originalLoad
  }
}

function gitTrackedFiles(files) {
  const output = childProcess.execFileSync('git', ['ls-files', ...files], {
    cwd: root,
    encoding: 'utf8'
  })
  return new Set(output.split(/\r?\n/).filter(Boolean))
}

test('review request sends straddle and hero question fields', () => {
  assert.ok(reviewJs.includes('hasStraddle'))
  assert.ok(reviewJs.includes('straddleAmount'))
  assert.ok(reviewJs.includes('heroQuestion'))
})

test('cloud prompt asks AI to answer Hero question and preserve showdown', () => {
  assert.ok(cloud.includes('heroQuestion'))
  assert.ok(cloud.includes('hasStraddle'))
  assert.ok(cloud.includes('straddleAmount'))
  assert.ok(cloud.includes('showdown'))
})

test('cloud function local dependencies are tracked for deployment', () => {
  const files = [
    'cloudfunctions/poker_review/ai-normalizer.js',
    'cloudfunctions/poker_review/review-tags.js',
    'cloudfunctions/poker_review/package.json'
  ]
  const tracked = gitTrackedFiles(files)
  assert.deepEqual([...tracked].sort(), files.sort())
})

test('buildContext preserves and normalizes canonical fields from request hand', () => {
  const api = loadCloudReviewTestApi()
  const context = api.buildContext({
    stakeLevel: '300/600',
    hasStraddle: 'yes',
    straddleAmount: '1200',
    heroQuestion: 'turn shove?',
    opponentName: 'Alex',
    showdown: 'KKQJ'
  }, null, [])

  assert.equal(context.hand.hasStraddle, true)
  assert.equal(context.hand.straddleAmount, 1200)
  assert.equal(context.hand.heroQuestion, 'turn shove?')
  assert.equal(context.hand.opponentName, 'Alex')
  assert.equal(context.hand.showdown, 'KKQJ')

  const noStraddle = api.buildContext({
    stakeLevel: '300/600',
    hasStraddle: 'false',
    straddleAmount: '1200'
  }, null, [])
  assert.equal(noStraddle.hand.hasStraddle, false)
})

test('normalizeExtractedHand keeps straddle authoritative from current hand', () => {
  const api = loadCloudReviewTestApi()
  const context = api.buildContext({
    stakeLevel: '300/600',
    hasStraddle: true,
    straddleAmount: 1200,
    heroQuestion: 'turn shove?'
  }, { smallBlind: 300, bigBlind: 600 }, [])

  const extracted = api.normalizeExtractedHand({
    stakeLevel: '300/600',
    hasStraddle: false,
    straddleAmount: 0,
    heroQuestion: ''
  }, context, '')

  assert.equal(extracted.hasStraddle, true)
  assert.equal(extracted.straddleAmount, 1200)
  assert.equal(extracted.heroQuestion, 'turn shove?')
})

test('normalizeExtractedHand does not infer straddle from AI output', () => {
  const api = loadCloudReviewTestApi()
  const context = api.buildContext({
    stakeLevel: '300/600',
    hasStraddle: false,
    straddleAmount: 0
  }, { smallBlind: 300, bigBlind: 600 }, [])

  const extracted = api.normalizeExtractedHand({
    stakeLevel: '300/600',
    hasStraddle: true,
    straddleAmount: 1200
  }, context, '')

  assert.equal(extracted.hasStraddle, false)
  assert.equal(extracted.straddleAmount, 0)
})

test('normalizer preserves hero question and straddle fields', () => {
  assert.ok(normalizer.includes('heroQuestion'))
  assert.ok(normalizer.includes('hasStraddle'))
})
