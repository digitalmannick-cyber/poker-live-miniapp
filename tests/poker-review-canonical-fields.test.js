const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')
const reviewJs = fs.readFileSync(path.join(root, 'pages/review-list/review-list.js'), 'utf8')
const cloud = fs.readFileSync(path.join(root, 'cloudfunctions/poker_review/index.js'), 'utf8')
const normalizer = fs.readFileSync(path.join(root, 'utils/ai-normalizer.js'), 'utf8')

test('review request sends straddle and hero question fields', () => {
  assert.ok(reviewJs.includes('hasStraddle'))
  assert.ok(reviewJs.includes('straddleAmount'))
  assert.ok(reviewJs.includes('heroQuestion'))
})

test('cloud prompt asks AI to answer Hero question and preserve showdown', () => {
  assert.ok(cloud.includes('heroQuestion'))
  assert.ok(cloud.includes('hasStraddle'))
  assert.ok(cloud.includes('straddleAmount'))
  assert.ok(cloud.includes('优先回答 Hero 疑问点'))
  assert.ok(cloud.includes('showdown'))
})

test('normalizer preserves hero question and straddle fields', () => {
  assert.ok(normalizer.includes('heroQuestion'))
  assert.ok(normalizer.includes('hasStraddle'))
})
