const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const reviewTags = require('../utils/review-tags')

function loadReviewListHelpers() {
  const filePath = path.join(root, 'pages', 'review-list', 'review-list.js')
  const code = fs.readFileSync(filePath, 'utf8') + `
module.exports.__test = {
  normalizeParsedVoice,
  buildParsedVoicePreview,
  buildVoicePatch,
  buildConfirmItems,
  buildVoiceCorrectionText
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

const quickEntryWithStaleStreetPots = {
  _id: 'hand-agent-structured-1',
  playedDate: '2026/06/14',
  stakeLevel: '200/400',
  heroPosition: 'BTN',
  villainPosition: 'UTG',
  opponentName: '',
  heroCardsInput: 'AdJd',
  currentProfit: 14000,
  effectiveStack: 0,
  potSize: 4800,
  board: { flop: 'AhJh3s', turn: '6s', river: '4s' },
  streetInputs: {
    preflop: { pot: 4800, actionLine: '' },
    flop: { pot: 4800, actionLine: '' },
    turn: { pot: 4800, actionLine: '' },
    river: { pot: '', actionLine: '' }
  }
}

const pokerAgentExtract = {
  provider: 'poker-agent',
  playedDate: '2026/06/14',
  stakeLevel: '200/400',
  playerCount: 8,
  heroPosition: 'BTN',
  villainPosition: 'UTG',
  opponentName: 'g88',
  heroCardsInput: 'AdJd',
  currentProfit: 14000,
  effectiveStack: 100000,
  potSize: 28200,
  board: { flop: 'AhJh3s', turn: '6s', river: '4s' },
  streetInputs: {
    preflop: { pot: 3200, actionLine: 'UTG g88 R1000->Hero BTN C->BB C' },
    flop: { pot: 3200, actionLine: 'UTG X->BB X->Hero B3500->BB F->UTG C' },
    turn: { pot: 10200, actionLine: 'UTG X->Hero B9000->UTG C' },
    river: { pot: 28200, actionLine: 'UTG X->Hero B30000->UTG F' }
  },
  streetSummary: 'PF: UTG g88 R1000, Hero BTN C, BB C / F AhJh3s: UTG X, BB X, Hero B3500, BB F, UTG C / T 6s: UTG X, Hero B9000, UTG C / R 4s: UTG X, Hero B30000, UTG F',
  mindJourney: 'Villain likely AQ/AK; river full pot may be too large, half pot is better.',
  showdown: ', mindJourney, heroQuestion, tags, missingFields, followUpQuestions, naturalLanguageSummary.',
  tags: ['deep_stack', 'value_bet']
}

const agentNormalized = helpers.normalizeParsedVoice(
  pokerAgentExtract,
  { provider: 'poker-agent', missingFields: [], followUpQuestions: [] },
  '',
  quickEntryWithStaleStreetPots
)
const agentPreview = helpers.buildParsedVoicePreview(agentNormalized, { provider: 'poker-agent', missingFields: [], followUpQuestions: [] })
const agentPatch = helpers.buildVoicePatch(quickEntryWithStaleStreetPots, agentPreview, '')

assert.equal(agentPreview.potSize, 28200, 'poker-agent current pot should not be replaced by stale quick-entry pot')
assert.equal(agentPreview.streetInputs.preflop.pot, 3200)
assert.equal(agentPreview.streetInputs.flop.pot, 3200)
assert.equal(agentPreview.streetInputs.turn.pot, 10200)
assert.equal(agentPreview.streetInputs.river.pot, 28200)
assert.equal(agentPreview.streetItems[0].actionLine, 'UTG g88 R1000->Hero BTN C->BB C')
assert.equal(agentPreview.streetItems[1].actionLine, 'UTG X->BB X->Hero B3500->BB F->UTG C')
assert.equal(agentPreview.streetItems[2].actionLine, 'UTG X->Hero B9000->UTG C')
assert.equal(agentPreview.streetItems[3].actionLine, 'UTG X->Hero B30000->UTG F')
assert.equal(agentPatch.streetInputs.river.pot, 28200)
assert.equal(agentPatch.streetInputs.river.actionLine, 'UTG X->Hero B30000->UTG F')
assert.equal(agentPreview.showdown, '', 'field-name leakage should not be displayed as opponent showdown')
assert.equal(agentPatch.showdown, '', 'field-name leakage should not be saved as opponent showdown')
assert.ok(agentPreview.mindJourney.includes('half pot'))
assert.ok(!agentPreview.mindJourney.includes('check all-in'))

const straddleQuickEntryHand = {
  _id: 'hand-agent-straddle-1',
  playedDate: '2026/06/14',
  stakeLevel: '200/400',
  heroPosition: '',
  villainPosition: '',
  opponentName: '',
  heroCardsInput: 'Ah8s',
  currentProfit: 50000,
  effectiveStack: 0,
  potSize: 0,
  board: { flop: '', turn: '', river: '' },
  streetInputs: {
    preflop: { pot: '', actionLine: '' },
    flop: { pot: '', actionLine: '' },
    turn: { pot: '', actionLine: '' },
    river: { pot: '', actionLine: '' }
  }
}

const straddleTranscript = '这个牌是打的200400800，这时候桌上又来了一个鱼，然后这牌是那个Alex p open 2000，然后那条鱼在sb靠，我在straddle call，翻牌发K83彩虹面，全部check到Alex P打了个半pot 3700。那个鱼也call 3200，我也call。转牌掉个A，我觉得这个A不应该继续check过去打check raise。我觉得他一些A勾、A圈也可能控池了。因为在这种面上我是一个underBluff，所以我只要自己去打，让他一些A去call我，我就打了个半pot。打了个8000，然后Alex P想了半天弃了，那个鱼call。合牌掉个7白板。那个鱼check给我，我在4万多，给我打了个25000。他想了一下call了。'

const pokerAgentStraddleExtract = {
  provider: 'poker-agent',
  playedDate: '2026/06/14',
  stakeLevel: '400/800',
  hasStraddle: false,
  heroPosition: 'BTN',
  villainPosition: 'HJ',
  opponentName: 'ALEXP',
  heroCardsInput: 'Ah8s',
  currentProfit: 50000,
  effectiveStack: 200000,
  potSize: 3700,
  board: { flop: 'Ks8h3d', turn: 'Ac', river: '' },
  streetInputs: {
    preflop: { pot: '', actionLine: 'Task: extract_hand_fields' },
    flop: { pot: '3700', actionLine: 'Task: extract_hand_fields' },
    turn: { pot: '', actionLine: '' },
    river: { pot: '', actionLine: '' }
  },
  streetSummary: 'Task: extract_hand_fields You are the user-specific Poker Agent. Return JSON if possible.',
  mindJourney: 'Task: extract_hand_fields You are the user-specific Poker Agent.'
}

const straddleNormalized = helpers.normalizeParsedVoice(
  pokerAgentStraddleExtract,
  { provider: 'poker-agent', missingFields: [], followUpQuestions: [] },
  straddleTranscript,
  straddleQuickEntryHand
)

assert.equal(straddleNormalized.stakeLevel, '200/400')
assert.equal(straddleNormalized.hasStraddle, true)
assert.equal(straddleNormalized.heroPosition, 'STR')
assert.equal(straddleNormalized.potSize, 83500)
assert.equal(straddleNormalized.streetInputs.preflop.pot, '6400')
assert.equal(straddleNormalized.streetInputs.turn.pot, '17500')
assert.equal(straddleNormalized.streetInputs.river.pot, '33500')
assert.ok(!/Task:\s*extract_hand_fields/i.test(straddleNormalized.streetSummary))
assert.ok(!/Task:\s*extract_hand_fields/i.test(straddleNormalized.mindJourney))

const duplicateStackConfirmItems = helpers.buildConfirmItems(
  ['effectiveStack'],
  ['有效后手大约是多少？'],
  false,
  { effectiveStack: '' }
)

assert.equal(
  duplicateStackConfirmItems.map(item => item.field).join(','),
  'effectiveStack',
  'effective stack and effective stack follow-up questions should collapse into one confirmation field'
)
assert.equal(
  duplicateStackConfirmItems[0].label,
  '有效筹码',
  'effective stack confirmation should use the canonical field label'
)

const resolvedStackConfirmItems = helpers.buildConfirmItems(
  ['effectiveStack'],
  ['有效后手大约是多少？'],
  false,
  { effectiveStack: 200000 }
)

assert.equal(
  resolvedStackConfirmItems.map(item => item.field).join(','),
  '',
  'confirmation fields already filled in the preview should be removed'
)

assert.equal(
  helpers.buildVoiceCorrectionText('100000', duplicateStackConfirmItems),
  '有效筹码: 100000',
  'correction text sent for reparsing should name the canonical field being corrected'
)

const selectiveTagExtract = {
  provider: 'poker-agent',
  stakeLevel: '200/400',
  hasStraddle: true,
  straddleAmount: 800,
  heroPosition: 'STR',
  opponentName: 'ALEXP',
  potSize: 83500,
  board: { flop: 'Ks8h3d', turn: 'As', river: '7s' },
  streetInputs: {
    preflop: { pot: 6400, actionLine: 'ALEXP open2000->SB鱼 call->Hero STR call' },
    flop: { pot: 6400, actionLine: 'SB鱼 check->Hero check->ALEXP bet3700->SB鱼 call->Hero call' },
    turn: { pot: 17500, actionLine: 'SB鱼 check->Hero bet8000->ALEXP fold->SB鱼 call' },
    river: { pot: 33500, actionLine: 'SB鱼 check->Hero bet25000->SB鱼 call' }
  },
  mindJourney: 'River 判断 SB 多为 Kx 抓诈，价值下注 25000。',
  tags: ['value_bet', 'multiway']
}
const taxonomyLeakAdvice = {
  verdict: '价值下注合理。',
  keyTakeaway: 'For tags, choose only from this fixed miniapp taxonomy: 精彩, 可优化, 明显错误, Hero Call, Overfold, Bad Fold, 价值下注, 诈唬, 多人池, 深筹码, 3Bet池, 4Bet池.',
  leak_tags: ['value_bet']
}
const selectivePreview = helpers.buildParsedVoicePreview(selectiveTagExtract, {
  provider: 'poker-agent',
  analysis: taxonomyLeakAdvice,
  missingFields: [],
  followUpQuestions: []
})
const selectivePatch = helpers.buildVoicePatch({}, selectivePreview, '')
const expectedSelectiveTags = reviewTags.normalizeReviewTags(['value_bet', 'multiway'])

assert.deepEqual(
  JSON.stringify(selectivePreview.tags),
  JSON.stringify(expectedSelectiveTags),
  'voice preview should not select every fixed tag from taxonomy leakage'
)
assert.deepEqual(
  JSON.stringify(selectivePatch.tags),
  JSON.stringify(expectedSelectiveTags),
  'saved voice patch should preserve only inferred hand tags'
)

console.log('review quick-entry user-flow tests passed')
