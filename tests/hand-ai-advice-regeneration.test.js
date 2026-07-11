const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const handDetailSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'hand-detail', 'hand-detail.js'), 'utf8')
const ledgerSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'hand-ledger-input', 'hand-ledger-input.js'), 'utf8')

test('hand detail save invalidates old AI advice and starts regeneration', () => {
  assert.match(handDetailSource, /const aiService = require\('\.\.\/\.\.\/services\/ai-service'\)/)
  assert.match(handDetailSource, /async generateDetailAiAdvice\(handId, payload\)/)
  assert.match(handDetailSource, /aiService\.reviewHandVoice\(this\.buildAiAdviceRequest\(savedHand, this\.data\.session, this\.data\.actions\)\)/)

  const saveStart = handDetailSource.indexOf('async saveDetail()')
  const saveEnd = handDetailSource.indexOf('deleteHand()', saveStart)
  const saveBody = handDetailSource.slice(saveStart, saveEnd)

  assert.notEqual(saveStart, -1)
  assert.notEqual(saveEnd, -1)
  assert.match(saveBody, /const detailPatch = \{/)
  assert.match(saveBody, /aiReview: null/)
  assert.match(saveBody, /aiReviewStatus: 'generating'/)
  assert.match(saveBody, /aiReviewError: ''/)
  assert.match(saveBody, /await dataService\.updateHand\(this\.data\.handId, detailPatch\)/)
  assert.match(saveBody, /this\.generateDetailAiAdvice\(this\.data\.handId, detailPatch\)/)
})

test('AI advice regeneration clears stale advice on start and failure', () => {
  assert.match(ledgerSource, /aiReview: null/)
  assert.match(ledgerSource, /aiReviewStatus: 'generating'/)
  assert.match(ledgerSource, /aiReview: null,\s*aiReviewStatus: 'failed'/)

  assert.match(handDetailSource, /aiReview: null,\s*aiReviewStatus: 'failed'/)
})
