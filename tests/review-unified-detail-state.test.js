const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')
const js = fs.readFileSync(path.join(root, 'pages/review-list/review-list.js'), 'utf8')
const wxml = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxml'), 'utf8')

test('review list uses shared hand detail field helpers', () => {
  assert.ok(js.includes("require('../../utils/hand-detail-fields')"))
  assert.ok(js.includes('buildHandDetailViewModel'))
})

test('voice confirmation includes new canonical fields', () => {
  assert.ok(wxml.includes('是否 Straddle'))
  assert.ok(wxml.includes('对手手牌'))
  assert.ok(wxml.includes('Hero 疑问点'))
})

test('read-only detail is gated while voice confirmation is expanded', () => {
  assert.ok(wxml.includes('wx:if="{{detailHand.shouldShowFullDetails && !voicePanelVisible}}"'))
})

test('voice patch preserves current street fields when voice extraction is blank', () => {
  assert.ok(js.includes('mergeBlankStreetInputs(lockedParsedVoice.streetInputs, current.streetInputs)'))
})

test('ai review status remains visible while voice confirmation is expanded', () => {
  const gateStart = wxml.indexOf('wx:if="{{detailHand.shouldShowFullDetails && !voicePanelVisible}}"')
  const gateEnd = wxml.indexOf('</block>', gateStart)
  const aiGenerating = wxml.indexOf('detailHand.aiReviewGenerating')

  assert.notEqual(gateStart, -1, 'expected full-detail gate to exist')
  assert.notEqual(gateEnd, -1, 'expected full-detail gate to close')
  assert.notEqual(aiGenerating, -1, 'expected AI generating card to exist')
  assert.ok(aiGenerating > gateEnd, 'AI status cards should not be inside the full-detail voice-panel gate')
})

test('apply voice patch marks hand as backfilled and collapses voice panel', () => {
  assert.ok(js.includes('detailBackfilled: true'))
  assert.ok(js.includes('voicePanelVisible: false'))
})
