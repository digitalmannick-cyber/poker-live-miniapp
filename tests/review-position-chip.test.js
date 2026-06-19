const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const reviewJs = fs.readFileSync(path.join(root, 'pages/review-list/review-list.js'), 'utf8')
const reviewWxml = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxml'), 'utf8')
const reviewWxss = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxss'), 'utf8')

assert.ok(
  reviewJs.includes('function buildPositionClass(position)') &&
  reviewJs.includes("BTN: 'pos-btn'") &&
  reviewJs.includes("SB: 'pos-sb'") &&
  reviewJs.includes("'UTG+1': 'pos-utg1'") &&
  reviewJs.includes('heroPositionClass: buildPositionClass(heroPosition)') &&
  reviewJs.includes('showHeroPosition: !!heroPosition'),
  'review list should derive a stable position color class for each hand'
)

assert.ok(
  reviewWxml.includes('wx:if="{{item.showHeroPosition}}" class="position-chip {{item.heroPositionClass}}"'),
  'review list position chip should use the derived position color class'
)

;[
  'pos-btn',
  'pos-sb',
  'pos-bb',
  'pos-co',
  'pos-hj',
  'pos-lj',
  'pos-utg',
  'pos-utg1',
  'pos-str',
  'pos-unknown'
].forEach(className => {
  assert.ok(
    reviewWxss.includes('.position-chip.' + className),
    'review list should style .' + className + ' position chips'
  )
})

console.log('review position chip tests passed')
