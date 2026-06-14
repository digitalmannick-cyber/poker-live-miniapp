const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const actionLine = require('../utils/action-line')

test('formats street action lines with compact per-street syntax', () => {
  assert.equal(
    actionLine.formatStreetLine('preflop', 'HJ open 2.5, Hero BTN call', ''),
    'PF: HJ R2.5, Hero BTN C'
  )
  assert.equal(
    actionLine.formatStreetLine('flop', 'HJ bet 33%, Hero call', 'Qs8d4c'),
    'F Q\u26608\u26664\u2663: HJ B33%, Hero C'
  )
  assert.equal(
    actionLine.formatStreetLine('turn', 'HJ check, Hero bet 75, HJ call', 'Kh'),
    'T K\u2665: HJ X, Hero B75%, HJ C'
  )
  assert.equal(
    actionLine.formatStreetLine('river', 'HJ check, Hero check', '2c'),
    'R 2\u2663: HJ X, Hero X'
  )
})

test('postflop B33 and B75 are treated as pot percentages in display', () => {
  assert.equal(actionLine.formatActionLine('HJ B33, Hero C', 'flop'), 'HJ B33%, Hero C')
  assert.equal(actionLine.formatActionLine('Hero B75, HJ C', 'turn'), 'Hero B75%, HJ C')
  assert.equal(actionLine.formatActionLine('HJ B15800, Hero C', 'turn'), 'HJ B15800, Hero C')
  assert.equal(actionLine.formatStreetSummary('F Qs8d4c: HJ B33, Hero C'), 'F Q\u26608\u26664\u2663: HJ B33%, Hero C')
})

test('review views render formatted display action line', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../pages/review-list/review-list.wxml'), 'utf8')
  const js = fs.readFileSync(path.resolve(__dirname, '../pages/review-list/review-list.js'), 'utf8')

  assert.ok(js.includes("require('../../utils/action-line')"), 'review list should use shared action-line formatter')
  assert.ok(js.includes('displayActionLine: actionLine.formatActionLine'), 'street items should expose displayActionLine')
  assert.ok(wxml.includes('{{item.displayActionLine || \'-\'}}'), 'detail street rows should render displayActionLine')
})

test('poker review prompt requires compact action-line format', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../cloudfunctions/poker_review/index.js'), 'utf8')
  assert.ok(source.includes('Compact action-line format is mandatory'), 'cloud prompt should require compact format')
  assert.ok(source.includes('B33%'), 'cloud prompt should include pot percentage example')
  assert.ok(source.includes('B75%'), 'cloud prompt should include turn pot percentage example')
})
