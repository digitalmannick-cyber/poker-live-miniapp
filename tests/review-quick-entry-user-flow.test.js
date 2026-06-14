const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')

function loadReviewListHelpers() {
  const filePath = path.join(root, 'pages', 'review-list', 'review-list.js')
  const code = fs.readFileSync(filePath, 'utf8') + `
module.exports.__test = {
  normalizeParsedVoice,
  buildParsedVoicePreview,
  buildVoicePatch
}
`
  const module = { exports: {} }
  const sandbox = {
    module,
    exports: module.exports,
    require(name) {
      if (name === '../../services/data-service') {
        return {
          getAppSettings() {
            return { voiceTerms: [] }
          },
          updateSettings() {}
        }
      }
      const map = {
        '../../services/ai-service': path.join(root, 'services', 'ai-service.js'),
        '../../utils/voice-parser': path.join(root, 'utils', 'voice-parser.js'),
        '../../utils/card-ui': path.join(root, 'utils', 'card-ui.js'),
        '../../utils/tab-bar': path.join(root, 'utils', 'tab-bar.js'),
        '../../utils/display': path.join(root, 'utils', 'display.js'),
        '../../utils/ai-normalizer': path.join(root, 'utils', 'ai-normalizer.js'),
        '../../utils/review-tags': path.join(root, 'utils', 'review-tags.js'),
        '../../utils/action-line': path.join(root, 'utils', 'action-line.js'),
        '../../utils/hand-detail-fields': path.join(root, 'utils', 'hand-detail-fields.js')
      }
      return require(map[name] || name)
    },
    Page() {},
    wx: {
      getStorageSync() { return null },
      removeStorageSync() {},
      showToast() {},
      showModal() {},
      navigateTo() {}
    },
    console,
    setTimeout,
    clearTimeout
  }
  vm.runInNewContext(code, sandbox, { filename: filePath })
  return module.exports.__test
}

const helpers = loadReviewListHelpers()

const quickEntryHand = {
  _id: 'hand-quick-1',
  playedDate: '2026/06/12',
  stakeLevel: '300/600',
  heroPosition: 'BB',
  villainPosition: 'UTG+1',
  opponentName: 'KKQJ',
  opponentType: '紧弱',
  heroCardsInput: 'TsKs',
  currentProfit: -70000,
  effectiveStack: 70000,
  potSize: 140000,
  board: { flop: '', turn: '', river: '' },
  streetInputs: {}
}

const aiExtractedConflict = {
  playedDate: '2026/06/12',
  stakeLevel: '300/600',
  heroPosition: 'UTG',
  villainPosition: 'STR',
  opponentName: '',
  opponentType: '未说明',
  heroCardsInput: 'AhAd',
  currentProfit: 88000,
  effectiveStack: 0,
  potSize: 2100,
  board: {
    flop: 'AsQh7d',
    turn: '6s',
    river: '2d'
  },
  streetInputs: {
    preflop: { pot: 3300, actionLine: 'UTG+1 KKQJ open→Hero BB call' },
    flop: { pot: 3300, actionLine: 'Hero check→KKQJ cbet700→Hero xr2100→KKQJ 4B3800→Hero call' },
    turn: { pot: 10900, actionLine: 'Hero check→KKQJ bet15800→Hero allin→KKQJ call' }
  },
  streetSummary: '翻前 UTG+1 open，Hero BB call；翻牌 Hero check-raise；转牌 Hero check allin。',
  mindJourney: 'Hero 认为自己是卡顺加后门花，想利用 fold equity。',
  tags: ['可优化']
}

const normalized = helpers.normalizeParsedVoice(
  aiExtractedConflict,
  { missingFields: [], followUpQuestions: [] },
  '10K 这手牌我在大盲，输了 70000。',
  quickEntryHand
)
const preview = helpers.buildParsedVoicePreview(normalized, { missingFields: [], followUpQuestions: [] })
const patch = helpers.buildVoicePatch(quickEntryHand, preview, '10K 这手牌我在大盲，输了 70000。')

assert.equal(preview.heroCardsInput, 'TsKs', 'review preview should keep quick-entry hero hand even when AI extracts another hand')
assert.equal(preview.currentProfit, -70000, 'review preview should keep quick-entry win/loss even when AI extracts another result')
assert.equal(patch.heroCardsInput, 'TsKs', 'confirmed backfill should save the quick-entry hero hand')
assert.equal(patch.currentProfit, -70000, 'confirmed backfill should save the quick-entry win/loss')
assert.equal(patch.voiceExtract.heroCardsInput, 'TsKs', 'stored voice extract should preserve quick-entry hero hand for later review')
assert.equal(patch.voiceExtract.currentProfit, -70000, 'stored voice extract should preserve quick-entry win/loss for later review')
assert.equal(patch.board.flop, 'AsQh7d', 'backfill should still accept AI supplemental board fields')
assert.equal(patch.streetInputs.flop.actionLine, 'Hero check→KKQJ cbet700→Hero xr2100→KKQJ 4B3800→Hero call')

console.log('review quick-entry user-flow tests passed')
