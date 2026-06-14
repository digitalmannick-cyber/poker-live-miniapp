const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxml'), 'utf8')

assert.ok(
  !wxml.includes('<view class="section-title">复盘内容</view>'),
  'review detail should not show the extra review-content title above tags'
)

assert.ok(
  wxml.includes('detailHand.tagItems') &&
  wxml.includes('review-hand-tag'),
  'review detail should still render hand tags'
)

console.log('review reflection tags tests passed')
