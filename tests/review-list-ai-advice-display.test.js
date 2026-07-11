const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'review-list', 'review-list.js'), 'utf8')

test('AI advice from the same hand id is not hidden by fingerprint drift', () => {
  const handIdMatch = "if (sourceHandId && hand._id) return sourceHandId === String(hand._id)"
  const fingerprintReject = 'if (sourceFingerprint && sourceFingerprint !== buildAiReviewFingerprint(hand)) return false'
  const handIdIndex = source.indexOf(handIdMatch)
  const fingerprintIndex = source.indexOf(fingerprintReject)

  assert.notEqual(handIdIndex, -1)
  assert.notEqual(fingerprintIndex, -1)
  assert(handIdIndex < fingerprintIndex)
})

test('legacy AI advice without source metadata is allowed to render', () => {
  const matchStart = source.indexOf('function aiReviewMatchesHand')
  const matchEnd = source.indexOf('function buildAiReviewMismatchError', matchStart)
  const body = source.slice(matchStart, matchEnd)

  assert.notEqual(matchStart, -1)
  assert.notEqual(matchEnd, -1)
  assert.doesNotMatch(body, /aiReviewTextBoardConflictsHand/)
  assert.match(body, /return true/)
})

test('AI advice generation keeps LLM failures separate from save failures', () => {
  assert.match(source, /const aiReviewPatch = \{/)
  assert.match(source, /this\.applyAiReviewPatchToVisibleHand\(handId, aiReviewPatch\)/)
  assert.match(source, /poker agent advice save failed/)
  assert.match(source, /poker agent advice failure status save failed/)
})

test('renderable AI advice overrides stale generating status in list and detail views', () => {
  assert.match(
    source,
    /function resolveAiReviewStatus\(hand, aiReviewView\) \{\s*if \(aiReviewView && aiReviewView\.visible\) return 'ready'\s*return String\(hand && hand\.aiReviewStatus \|\| ''\)\.trim\(\)\s*\}/
  )

  const listStart = source.indexOf('function buildReviewListHandView')
  const listEnd = source.indexOf('function buildReviewListHandViews', listStart)
  const listBody = source.slice(listStart, listEnd)

  assert.notEqual(listStart, -1)
  assert.notEqual(listEnd, -1)
  assert.match(listBody, /const aiReviewStatus = resolveAiReviewStatus\(item, aiReviewView\)/)
  assert.match(listBody, /aiReviewStatus,/)
  assert.match(listBody, /const aiReviewGenerating = aiReviewStatus === 'generating'/)
  assert.match(listBody, /const aiReviewFailed = aiReviewStatus === 'failed'/)
  assert.match(listBody, /aiReviewFailed,/)

  const detailStart = source.indexOf('function buildDetailHandView')
  const detailEnd = source.indexOf('function buildPositionClass', detailStart)
  const detailBody = source.slice(detailStart, detailEnd)

  assert.notEqual(detailStart, -1)
  assert.notEqual(detailEnd, -1)
  assert.match(detailBody, /const aiReviewStatus = resolveAiReviewStatus\(hand, aiReviewView\)/)
  assert.doesNotMatch(detailBody, /hand\.aiReviewStatus \|\| \(aiReviewView/)
})

test('failed AI advice is hidden from the list advice entry', () => {
  const listStart = source.indexOf('function buildReviewListHandView')
  const listEnd = source.indexOf('function buildReviewListHandViews', listStart)
  const listBody = source.slice(listStart, listEnd)

  assert.notEqual(listStart, -1)
  assert.notEqual(listEnd, -1)
  assert.match(listBody, /const aiReviewFailed = aiReviewStatus === 'failed'/)
  assert.match(listBody, /aiReviewFailed,/)
  assert.match(listBody, /canRequestAiAdvice: completedReview && !aiReviewReady && !aiReviewGenerating && !aiReviewFailed/)
})

test('loading hand detail syncs AI advice status back to the list row', () => {
  const loadStart = source.indexOf('async loadHandDetail(handId)')
  const loadEnd = source.indexOf('openHandDetail(e)', loadStart)
  const loadBody = source.slice(loadStart, loadEnd)

  assert.notEqual(loadStart, -1)
  assert.notEqual(loadEnd, -1)
  assert.match(loadBody, /this\.syncAiReviewStatusFromDetailHand\(hand\)/)
  assert.match(source, /syncAiReviewStatusFromDetailHand\(hand\) \{/)
  assert.match(source, /this\.applyAiReviewPatchToVisibleHand\(hand\._id, \{/)
})

test('ready aiReview that cannot be rendered shows a diagnostic card', () => {
  assert.match(source, /const aiReviewMismatch = !!\(hand\.aiReview && !aiReviewView && hand\.aiReviewStatus === 'ready'\)/)
  assert.match(source, /aiReviewFailed: aiReviewStatus === 'failed' \|\| aiReviewMismatch/)
  assert.match(source, /buildAiReviewMismatchError\(hand, hand\.aiReview\)/)
})
