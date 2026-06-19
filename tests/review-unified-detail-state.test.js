const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const js = fs.readFileSync(path.join(root, 'pages/review-list/review-list.js'), 'utf8')
const wxml = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxml'), 'utf8')

function loadReviewListHelpers() {
  const filePath = path.join(root, 'pages', 'review-list', 'review-list.js')
  const code = fs.readFileSync(filePath, 'utf8') + `
module.exports.__test = {
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

test('review list uses shared hand detail field helpers', () => {
  assert.ok(js.includes("require('../../utils/hand-detail-fields')"))
  assert.ok(js.includes('buildHandDetailViewModel'))
})

test('voice confirmation includes new canonical fields', () => {
  assert.ok(wxml.includes('是否 Straddle'))
  assert.ok(wxml.includes('对手手牌'))
  assert.ok(wxml.includes('data-field="heroQuestion"'))
})

test('read-only detail is gated while voice confirmation is expanded', () => {
  assert.ok(wxml.includes('wx:if="{{detailHand.shouldShowFullDetails && !voicePanelVisible}}"'))
})

test('backfilled read-only detail uses read-only cards and excludes duplicated summary fields', () => {
  assert.ok(wxml.includes('wx:for="{{detailHand.detailRows}}" wx:key="key" class="readonly-field-card"'))
  assert.ok(wxml.includes('readonly-field-value'))
  assert.ok(js.includes("excludeRowKeys: ['heroCardsInput', 'streetSummary', 'mindJourney']"))
})

test('voice patch preserves current street fields and straddle when voice extraction is blank', () => {
  const helpers = loadReviewListHelpers()
  const currentHand = {
    _id: 'hand-straddle-preserve',
    hasStraddle: true,
    streetInputs: {
      preflop: { pot: 1200, actionLine: 'UTG open 1200, Hero call BB' },
      flop: { pot: 3000, actionLine: 'Hero check, UTG bet 1500, Hero call' },
      turn: { pot: 6000, actionLine: 'Hero check, UTG check back' },
      river: { pot: 6000, actionLine: 'Hero bet 4000, UTG fold' }
    }
  }
  const patch = helpers.buildVoicePatch(
    currentHand,
    {
      streetInputs: {
        preflop: { pot: '', actionLine: '' },
        flop: { pot: '', actionLine: '' },
        turn: { pot: '', actionLine: '' },
        river: { pot: '', actionLine: '' }
      }
    },
    'voice note'
  )

  assert.equal(patch.hasStraddle, true)
  assert.equal(patch.streetInputs.preflop.pot, 1200)
  assert.equal(patch.streetInputs.preflop.actionLine, 'UTG open 1200, Hero call BB')
  assert.equal(patch.streetInputs.flop.pot, 3000)
  assert.equal(patch.streetInputs.flop.actionLine, 'Hero check, UTG bet 1500, Hero call')
  assert.equal(patch.streetInputs.turn.pot, 6000)
  assert.equal(patch.streetInputs.turn.actionLine, 'Hero check, UTG check back')
  assert.equal(patch.streetInputs.river.pot, 6000)
  assert.equal(patch.streetInputs.river.actionLine, 'Hero bet 4000, UTG fold')
})

test('voice patch allows confirmed straddle false to clear current straddle', () => {
  const helpers = loadReviewListHelpers()
  const patch = helpers.buildVoicePatch(
    { _id: 'hand-straddle-clear', hasStraddle: true },
    { hasStraddle: false },
    'voice note'
  )

  assert.equal(patch.hasStraddle, false)
})

test('ai review status remains visible while voice confirmation is expanded', () => {
  const gateStart = wxml.indexOf('wx:if="{{detailHand.shouldShowFullDetails && !voicePanelVisible}}"')
  const gateEnd = wxml.indexOf('</block>', gateStart)

  assert.notEqual(gateStart, -1, 'expected full-detail gate to exist')
  assert.notEqual(gateEnd, -1, 'expected full-detail gate to close')
  ;['detailHand.aiReviewGenerating', 'detailHand.aiReviewFailed', 'detailHand.aiReviewReady'].forEach(statusField => {
    const statusIndex = wxml.indexOf(statusField)
    assert.notEqual(statusIndex, -1, `expected ${statusField} card to exist`)
    assert.ok(statusIndex > gateEnd, `${statusField} should not be inside the full-detail voice-panel gate`)
  })
})

test('apply voice patch marks hand as backfilled and collapses voice panel', () => {
  assert.ok(js.includes('detailBackfilled: true'))
  assert.ok(js.includes('voicePanelVisible: false'))
})
