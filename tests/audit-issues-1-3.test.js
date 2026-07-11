const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

test('issue #1 uses persistent bankrollInitial across all stats paths', () => {
  const store = read('utils/store.js')
  const cloudRepo = read('services/cloud-repo.js')
  const pokerData = read('cloudfunctions/poker_data/index.js')

  assert.match(store, /bankrollInitial\s*:\s*0/)
  assert.match(store, /function\s+getBankrollInitial\s*\(/)
  assert.match(store, /bankrollCurrent\s*=\s*getBankrollInitial\(\)\s*\+\s*totalProfit/)
  assert.doesNotMatch(store, /12000\s*\+\s*totalProfit/)

  assert.match(cloudRepo, /getBankrollInitial/)
  assert.match(cloudRepo, /bankrollCurrent\s*=\s*getBankrollInitial\(\)\s*\+\s*totalProfit/)
  assert.doesNotMatch(cloudRepo, /12000\s*\+\s*totalProfit/)

  assert.match(pokerData, /bankrollInitial/)
  assert.doesNotMatch(pokerData, /bankrollCurrent\s*:\s*12000\s*\+\s*totalProfit/)
})

test('issue #2 validates currentProfit as finite and persists the parsed number', () => {
  const handRecord = read('pages/hand-record/hand-record.js')

  assert.match(handRecord, /const\s+profit\s*=\s*Number\(form\.currentProfit\)/)
  assert.match(handRecord, /if\s*\(\s*!Number\.isFinite\(profit\)\s*\)/)
  assert.match(handRecord, /请输入有效的输赢金额/)
  assert.match(handRecord, /currentProfit\s*:\s*profit/)
  assert.doesNotMatch(handRecord, /currentProfit\s*:\s*form\.currentProfit/)
})

test('issue #3 leaves no statements after formatActionLine delegated return', () => {
  const reviewList = read('pages/review-list/review-list.js')
  const match = reviewList.match(/function\s+formatActionLine\s*\(summary\)\s*\{([\s\S]*?)\n\}/)

  assert.ok(match, 'formatActionLine should exist')
  assert.equal(
    match[1].trim(),
    'return actionLine.formatStreetSummary(summary)',
    'formatActionLine should contain only the delegated return'
  )
})
