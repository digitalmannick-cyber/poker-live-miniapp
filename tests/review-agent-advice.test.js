const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const js = fs.readFileSync(path.join(root, 'pages/review-list/review-list.js'), 'utf8')
const wxml = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxss'), 'utf8')

assert.ok(
  js.includes('aiReview: meta.analysis || parsedVoice.aiReview || null'),
  'parsed voice preview should keep cloud Agent analysis'
)

assert.ok(
  js.includes('aiReview: null') && js.includes("aiReviewStatus: 'generating'"),
  'voice backfill should clear stale Agent advice and mark advice as generating'
)

assert.ok(
  js.includes('function buildAiReviewView(aiReview)'),
  'review detail should map saved Agent advice for display'
)

assert.ok(
  wxml.includes('EV脑 建议') && wxml.includes('detailHand.aiReviewView.answer'),
  'review detail should show saved Agent advice'
)

assert.ok(
  wxml.includes('detailHand.aiReviewGenerating') &&
  wxml.includes('AI 建议生成中') &&
  wxml.includes('detailHand.aiReviewFailed'),
  'review detail should show generating and failed states for Agent advice'
)

assert.ok(
  wxml.includes('item.aiReviewReady || item.aiReviewGenerating') &&
  wxml.includes("item.aiReviewGenerating ? 'AI生成中' : 'AI建议'"),
  'review list should mark hands that have or are generating Agent advice'
)

assert.ok(
  /\.review-agent-card\s*\{[\s\S]*border-color:\s*rgba\(0,\s*209,\s*255,\s*0\.18\);/.test(wxss),
  'Agent advice card should have dedicated styling'
)

assert.ok(
  js.includes('cleanAgentAdviceText') && js.includes('spot_id') && js.includes('range_gap'),
  'review detail should filter Agent internal debug artifacts before display'
)

assert.ok(
  js.includes('function formatCardCodesInAdvice(value)') &&
  js.includes("s: '\\u2660'") &&
  js.includes("h: '\\u2665'") &&
  js.includes("d: '\\u2666'") &&
  js.includes("c: '\\u2663'") &&
  js.includes('return formatCardCodesInAdvice(value)'),
  'review detail should render card codes in Agent advice with visible suits'
)

assert.ok(
  js.includes('isLowValueAgentAdviceLine') &&
  js.includes('structured hand information loaded') &&
  js.includes('range_gap'),
  'review detail should filter generic Agent readiness text that is not real poker advice'
)

assert.ok(
  js.includes('goodPoints') && js.includes('clearMistakes') && js.includes('exploitAdjustments'),
  'review detail should support structured Agent advice sections'
)

assert.ok(
  js.includes('streetBreakdown') &&
  js.includes('keyTakeaway') &&
  js.includes('sanitizeAgentStreetBreakdown') &&
  js.includes('buildAgentStreetStatusClass'),
  'review detail should support street-by-street Agent coaching, colored status badges, and a key takeaway'
)

assert.ok(
  wxml.includes('detailHand.aiReviewView.goodPoints') &&
  wxml.includes('detailHand.aiReviewView.clearMistakes') &&
  wxml.includes('detailHand.aiReviewView.exploitAdjustments'),
  'review detail should render structured Agent advice lists'
)

assert.ok(
  wxml.includes('逐街拆解') &&
  wxml.includes('关键结论') &&
  wxml.includes('detailHand.aiReviewView.streetBreakdown'),
  'review detail should render street breakdown and key takeaway sections'
)

assert.ok(
  wxss.includes('.review-agent-street') &&
  wxss.includes('.review-agent-rule'),
  'street breakdown and key takeaway should have dedicated compact styling'
)

assert.ok(
  wxml.includes('review-agent-section-verdict') &&
  wxml.includes('review-agent-section-street') &&
  wxml.includes('review-agent-section-takeaway') &&
  wxml.includes('review-agent-section-training'),
  'Agent advice sections should have semantic color hooks'
)

assert.ok(
  wxml.includes('review-agent-list-item-good') &&
  wxml.includes('review-agent-list-item-issue') &&
  wxml.includes('review-agent-list-item-mistake') &&
  wxml.includes('review-agent-list-item-optimize') &&
  wxml.includes('review-agent-list-item-adjust'),
  'Agent advice list items should have per-section color classes'
)

assert.ok(
  wxss.includes('.review-agent-section-mistake > .kpi-label') &&
  wxss.includes('.review-agent-street-status.danger') &&
  wxss.includes('.review-agent-list-item-mistake') &&
  wxss.includes('.review-agent-list-item-optimize') &&
  wxss.includes('.review-agent-list-item-training'),
  'Agent advice sections should render with distinct visual color blocks'
)

assert.ok(
  wxss.includes('.review-ai-badge') &&
  wxss.includes('.review-agent-pending-card') &&
  wxss.includes('@keyframes review-ai-spin'),
  'Agent advice loading and list badges should have dedicated styling'
)

assert.ok(
  js.includes('function compactAgentAdviceText') &&
  js.includes('const answer = hasStructuredAdvice ?') &&
  js.includes('visible: !!(answer || verdict ||'),
  'structured Agent advice should hide duplicated raw answer and keep only compact fallback text'
)

console.log('review Agent advice tests passed')
