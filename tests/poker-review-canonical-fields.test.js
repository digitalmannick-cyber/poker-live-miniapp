const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')
const reviewJs = fs.readFileSync(path.join(root, 'pages/review-list/review-list.js'), 'utf8')
const cloud = fs.readFileSync(path.join(root, 'cloudfunctions/poker_review/index.js'), 'utf8')
const normalizer = fs.readFileSync(path.join(root, 'utils/ai-normalizer.js'), 'utf8')

function getBuildContextBody() {
  const match = cloud.match(/function buildContext\(hand, session, actions, event\) \{[\s\S]*?\n\}/)
  assert.ok(match, 'buildContext function should exist')
  return match[0]
}

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

test('buildContext preserves canonical fields from request hand', () => {
  const body = getBuildContextBody()
  assert.match(body, /hasStraddle:\s*!!\(hand && hand\.hasStraddle\)/)
  assert.match(body, /straddleAmount:\s*Number\(hand && hand\.straddleAmount\)\s*\|\|\s*0/)
  assert.match(body, /heroQuestion:\s*hand && hand\.heroQuestion\s*\|\|\s*''/)
  assert.match(body, /opponentName:\s*hand && hand\.opponentName\s*\|\|\s*''/)
  assert.match(body, /showdown:\s*hand && hand\.showdown\s*\|\|\s*''/)
})

test('normalizer preserves hero question and straddle fields', () => {
  assert.ok(normalizer.includes('heroQuestion'))
  assert.ok(normalizer.includes('hasStraddle'))
})
