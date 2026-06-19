const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')

function loadReviewListHelpers() {
  const filePath = path.join(root, 'pages', 'review-list', 'review-list.js')
  const code = fs.readFileSync(filePath, 'utf8') + `
module.exports.__test = {
  buildReviewListHandView
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
            return { positions: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'], opponentTypes: ['紧弱', '松弱'] }
          }
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

const { buildReviewListHandView } = loadReviewListHelpers()

const quickOnly = buildReviewListHandView({
  _id: 'quick-only-1',
  heroCardsInput: 'Ah8s',
  currentProfit: 50000,
  heroPosition: '',
  opponentType: '',
  villainType: '',
  streetSummary: '',
  streetInputs: {
    preflop: { actionLine: '', pot: '' },
    flop: { actionLine: '', pot: '' },
    turn: { actionLine: '', pot: '' },
    river: { actionLine: '', pot: '' }
  },
  board: { flop: '', turn: '', river: '' },
  potSize: '',
  effectiveStack: '',
  tags: []
}, 'HK$', '')

assert.equal(quickOnly.showHeroPosition, false)
assert.equal(quickOnly.heroPosition, '')
assert.equal(quickOnly.actionLine, '')
assert.equal(quickOnly.showActionLine, false)
assert.equal(quickOnly.metaText, '')
assert.equal(quickOnly.hasMetaText, false)
assert.equal(quickOnly.opponentDisplayName, '')
assert.ok(quickOnly.currentProfitDisplay.includes('50000'))

const reviewed = buildReviewListHandView({
  _id: 'reviewed-1',
  heroCardsInput: 'AdJd',
  currentProfit: 14000,
  heroPosition: 'BTN',
  opponentType: '紧弱',
  streetSummary: 'PF: UTG R1000, Hero BTN C',
  potSize: 28200,
  effectiveStack: 100000,
  tags: []
}, 'HK$', '')

assert.equal(reviewed.showHeroPosition, true)
assert.equal(reviewed.heroPosition, 'BTN')
assert.equal(reviewed.showActionLine, true)
assert.ok(reviewed.metaText.includes('底池 28200'))
assert.ok(reviewed.metaText.includes('有效筹码 100000'))
assert.equal(reviewed.opponentDisplayName, '紧弱玩家')

console.log('review list quick-entry display tests passed')
