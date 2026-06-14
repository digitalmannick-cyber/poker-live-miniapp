const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const sessionListJs = fs.readFileSync(path.join(root, 'pages/session-list/session-list.js'), 'utf8')
const sessionListWxml = fs.readFileSync(path.join(root, 'pages/session-list/session-list.wxml'), 'utf8')
const sessionListWxss = fs.readFileSync(path.join(root, 'pages/session-list/session-list.wxss'), 'utf8')
const aiService = fs.readFileSync(path.join(root, 'services/ai-service.js'), 'utf8')
const dataService = fs.readFileSync(path.join(root, 'services/data-service.js'), 'utf8')
const cloud = fs.readFileSync(path.join(root, 'cloudfunctions/poker_review/index.js'), 'utf8')

function loadPokerReview() {
  const filePath = path.join(root, 'cloudfunctions', 'poker_review', 'index.js')
  const code = fs.readFileSync(filePath, 'utf8')
  const moduleObj = { exports: {} }
  const sandbox = {
    module: moduleObj,
    exports: moduleObj.exports,
    require(name) {
      if (name === 'wx-server-sdk') return { DYNAMIC_CURRENT_ENV: 'test', init() {} }
      if (name === './ai-normalizer') return require(path.join(root, 'cloudfunctions', 'poker_review', 'ai-normalizer.js'))
      if (name === './review-tags') return require(path.join(root, 'cloudfunctions', 'poker_review', 'review-tags.js'))
      return require(name)
    },
    process: { env: {} },
    Buffer,
    URL,
    console,
    setTimeout,
    clearTimeout
  }
  vm.runInNewContext(code, sandbox, { filename: filePath })
  return moduleObj.exports
}

assert.ok(
  dataService.includes('getSessionSummaryReadiness') &&
  dataService.includes('allHandsReviewed') &&
  dataService.includes('summaryEligible'),
  'session list data should mark finished sessions with all hands reviewed as summary eligible'
)

assert.ok(
  sessionListJs.includes('summarizeSession') &&
  sessionListJs.includes('openSessionSummary') &&
  sessionListJs.includes('buildSessionSummaryRequest') &&
  sessionListJs.includes('buildLocalSessionSummary') &&
  sessionListJs.includes('formatSessionSummaryView'),
  'session list page should build a local summary first, then request and format AI session summaries'
)

assert.ok(
  sessionListWxml.includes('session-summary-trigger') &&
  sessionListWxml.includes('catchtap="openSessionSummary"') &&
  sessionListWxml.includes('AI') &&
  sessionListWxml.includes('sessionSummaryVisible') &&
  sessionListWxml.includes('sessionSummaryView.handSummaries') &&
  sessionListWxml.includes('sessionSummaryView.tendency') &&
  sessionListWxml.includes('sessionSummaryView.trainingPlan'),
  'session list should render an AI summary trigger, per-hand summaries, tendency, and training plan'
)

assert.ok(
  sessionListJs.includes('getReviewSource') &&
  sessionListJs.includes('isRemoteSessionSummaryUseful') &&
  sessionListJs.includes('formatHandSummaryLine') &&
  sessionListJs.includes('handSummaries') &&
  sessionListJs.includes('localFallback'),
  'session summary should read every reviewed hand, show per-hand details, and reject empty remote answers'
)

assert.ok(
  sessionListWxss.includes('.session-summary-trigger') &&
  sessionListWxss.includes('.session-summary-modal') &&
  sessionListWxss.includes('.session-summary-count-grid'),
  'session summary modal should have dedicated styling'
)

assert.ok(
  aiService.includes('summarizeSession') &&
  aiService.includes("mode: 'session_summary'"),
  'ai service should expose a session summary request'
)

assert.ok(
  cloud.includes("mode === 'session_summary'") &&
  cloud.includes('buildPokerAgentSessionSummaryQuestion') &&
  cloud.includes('normalizePokerAgentSessionSummary') &&
  cloud.includes("? 'session_summary'"),
  'poker_review cloud function should support session summary mode'
)

const review = loadPokerReview()
assert.equal(review.__test.normalizeMode('session_summary'), 'session_summary')
const prompt = review.__test.buildPokerAgentSessionSummaryQuestion('session summary', {
  session: { title: 'June 6 Session', totalProfit: 107000 },
  hands: [
    { heroCardsInput: '44', currentProfit: 115000, aiReview: { verdict: 'good', goodPoints: ['set played well'] } },
    { heroCardsInput: '78s', currentProfit: -40000, aiReview: { issues: ['turn middle pair continued bet'] } }
  ]
})
assert.ok(prompt.includes('session summary'))
assert.ok(prompt.includes('44'))
assert.ok(prompt.includes('78s'))
assert.ok(prompt.includes('ONLY use the session and hands provided below'))
assert.ok(prompt.includes('Every provided hand must be considered'))
assert.ok(prompt.includes('hand_summaries'))
assert.ok(prompt.includes('training_plan'))

const normalized = review.__test.normalizePokerAgentSessionSummary({
  answer: 'one liner',
  data: {
    overview: '11 hands +107000',
    counts: { good: 3, mistakes: 2, optimizations: 4 },
    hand_summaries: ['44 set', '78s turn'],
    good_hands: ['44 set'],
    mistake_hands: ['78s turn'],
    optimization_hands: ['AJ size'],
    tendency: 'stake management loose',
    recommendations: ['keep one stake'],
    training_plan: ['turn middle pair check']
  }
})
assert.equal(normalized.counts.good, 3)
assert.deepEqual(normalized.handSummaries, ['44 set', '78s turn'])
assert.deepEqual(normalized.trainingPlan, ['turn middle pair check'])
assert.equal(normalized.tendency, 'stake management loose')

console.log('session ai summary tests passed')
