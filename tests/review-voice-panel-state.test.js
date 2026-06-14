const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxml'), 'utf8')
const js = fs.readFileSync(path.join(root, 'pages/review-list/review-list.js'), 'utf8')

const heroSummaryIndex = wxml.indexOf('class="review-hero-summary"')
const entryIndex = wxml.indexOf('class="review-voice-entry"')
const voiceCardIndex = wxml.indexOf('class="review-detail-card review-voice-card"')
const infoCardIndex = wxml.indexOf('class="review-detail-card review-info-card"')
const reflectionCardIndex = wxml.indexOf('class="review-detail-card review-reflection-card"')

assert.ok(heroSummaryIndex >= 0, 'review detail should render the hand summary')
assert.ok(entryIndex >= 0, 'review detail should render a collapsed voice review entry')
assert.ok(voiceCardIndex >= 0, 'review detail should render the expanded voice review card')
assert.ok(infoCardIndex >= 0, 'review detail should render hand info after voice review controls')
assert.ok(reflectionCardIndex >= 0, 'review detail should render review content later')

assert.ok(
  heroSummaryIndex < entryIndex && entryIndex < voiceCardIndex && voiceCardIndex < infoCardIndex,
  'voice review collapsed entry and expanded card should stay directly below the hand summary'
)

assert.ok(
  reflectionCardIndex > infoCardIndex,
  'voice review entry should not live inside the lower review content card'
)

assert.ok(
  wxml.includes('wx:if="{{!voicePanelVisible}}" class="review-voice-entry"'),
  'collapsed voice entry should only show when the full panel is folded'
)

assert.ok(
  js.includes('function hasCompletedReview(hand)'),
  'review detail should have a helper for deciding whether the hand was already reviewed'
)

assert.ok(
  js.includes('const reviewed = hasCompletedReview(hand)') && js.includes('voicePanelVisible: !reviewed'),
  'new hand detail should default expand only when the hand has not been reviewed'
)

assert.ok(
  js.includes('collapseVoicePanel()') && js.includes('voicePanelVisible: false'),
  'expanded voice panel should support folding back into the pinned entry'
)


assert.ok(
  js.includes('function stripAutoVoiceReviewNotes(value)'),
  'review detail should strip generated voice-review notes from the notes card'
)

assert.ok(
  js.includes('notes: baseNotes || \'\'') && js.includes('mindJourney: lockedParsedVoice.mindJourney || current.mindJourney || \'\''),
  'confirming voice review should not duplicate mind journey into notes'
)

assert.ok(
  wxml.includes('wx:if="{{detailHand.hasReflectionContent}}" class="review-detail-card review-reflection-card"') &&
  js.includes('hasReflectionContent'),
  'review content card should be hidden when only generated voice review notes exist'
)
console.log('review voice panel state tests passed')
