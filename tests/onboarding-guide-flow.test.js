const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const onboardingGuide = require('../utils/onboarding-guide')
const onboardingDemoData = require('../utils/onboarding-demo-data')

test('onboarding demo uses one session and one teaching hand', () => {
  const demo = onboardingDemoData.getDemoDataset()

  assert.equal(demo.sessions.length, 1)
  assert.equal(demo.hands.length, 1)
  assert.equal(demo.hands[0].heroCardsInput, 'QdQs')
  assert.equal(demo.handActions.every(action => action.handId === demo.hands[0]._id), true)
})

test('onboarding flow includes ai advice, ai summary, and cleanup steps', () => {
  const keys = onboardingGuide.STEPS.map(step => step.key)

  assert.equal(keys.includes('reviewAdvice'), true)
  assert.equal(keys.includes('recordFullEntry'), true)
  assert.equal(keys.includes('reviewLedgerEntry'), true)
  assert.equal(keys.includes('reviewReplay'), true)
  assert.equal(keys.includes('sessionSummaryOpen'), true)
  assert.equal(keys.includes('playerNotes'), true)
  assert.equal(keys.includes('stats'), true)
  assert.equal(keys.includes('reviewDelete'), true)
  assert.equal(keys.includes('sessionDelete'), true)
  assert.ok(keys.indexOf('reviewAdvice') > keys.indexOf('reviewApply'))
  assert.ok(keys.indexOf('reviewLedgerEntry') > keys.indexOf('reviewEntry'))
  assert.ok(keys.indexOf('reviewReplay') > keys.indexOf('reviewAdviceSheet'))
  assert.ok(keys.indexOf('sessionSummaryOpen') > keys.indexOf('reviewReplay'))
  assert.ok(keys.indexOf('playerNotes') > keys.indexOf('sessionSummaryOpen'))
  assert.ok(keys.indexOf('stats') > keys.indexOf('playerNotes'))
  assert.ok(keys.indexOf('reviewDelete') > keys.indexOf('stats'))
  assert.ok(keys.indexOf('sessionDelete') > keys.indexOf('reviewDelete'))
})

test('onboarding follows the current tab structure', () => {
  const routes = onboardingGuide.STEPS.map(step => step.route)
  const recordSteps = onboardingGuide.STEPS.filter(step => /^record/.test(step.key))
  const sessionListWxml = fs.readFileSync('pages/session-list/session-list.wxml', 'utf8')
  const playerNotesWxml = fs.readFileSync('pages/player-notes/player-notes.wxml', 'utf8')

  assert.equal(recordSteps.every(step => step.route === 'pages/session-list/session-list'), true)
  assert.equal(routes.includes('pages/player-notes/player-notes'), true)
  assert.equal(routes.includes('pages/hand-record/hand-record'), false)
  assert.match(sessionListWxml, /onboarding-target-session-buyin/)
  assert.match(sessionListWxml, /onboarding-target-session-full/)
  assert.match(sessionListWxml, /onboarding-target-record-session/)
  assert.match(sessionListWxml, /onboarding-target-record-save/)
  assert.match(playerNotesWxml, /onboarding-target-player-notes/)
  assert.match(playerNotesWxml, /<onboarding-guide/)
})

test('onboarding covers full ledger entry and replay surfaces', () => {
  const sessionListWxml = fs.readFileSync('pages/session-list/session-list.wxml', 'utf8')
  const reviewListWxml = fs.readFileSync('pages/review-list/review-list.wxml', 'utf8')
  const reviewListJs = fs.readFileSync('pages/review-list/review-list.js', 'utf8')

  assert.match(sessionListWxml, /session-tool full onboarding-target-session-full/)
  assert.match(reviewListWxml, /onboarding-target-review-ledger/)
  assert.match(reviewListWxml, /onboarding-target-review-replay-sheet/)
  assert.match(reviewListJs, /reviewLedgerEntry/)
  assert.match(reviewListJs, /reviewReplay/)
})

test('onboarding guide can sit above ai advice and session summary sheets', () => {
  const guideCss = fs.readFileSync('components/onboarding-guide/index.wxss', 'utf8')
  const reviewCss = fs.readFileSync('pages/review-list/review-list.wxss', 'utf8')
  const sessionCss = fs.readFileSync('pages/session-list/session-list.wxss', 'utf8')
  const guideZ = Number((guideCss.match(/\.onboarding-guide\s*\{[\s\S]*?z-index:\s*(\d+)/) || [])[1])
  const adviceZ = Number((reviewCss.match(/\.review-ai-sheet-modal\s*\{[\s\S]*?z-index:\s*(\d+)/) || [])[1])
  const summaryZ = Number((sessionCss.match(/\.session-summary-layer\s*\{[\s\S]*?z-index:\s*(\d+)/) || [])[1])

  assert.ok(guideZ > adviceZ)
  assert.ok(guideZ > summaryZ)
})

test('ai advice sheet uses an explicit view binding for onboarding demo content', () => {
  const reviewJs = fs.readFileSync('pages/review-list/review-list.js', 'utf8')
  const reviewWxml = fs.readFileSync('pages/review-list/review-list.wxml', 'utf8')

  assert.match(reviewJs, /aiAdviceSheetView/)
  assert.match(reviewWxml, /view:\s*aiAdviceSheetView/)
})
