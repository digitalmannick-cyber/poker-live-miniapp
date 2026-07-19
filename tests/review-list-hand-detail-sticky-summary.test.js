const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxss'), 'utf8')

const summaryIndex = wxml.indexOf('class="review-hero-summary"')
const scrollIndex = wxml.indexOf('class="review-detail-scroll"')

assert.ok(summaryIndex >= 0, 'hand detail must render the hand summary')
assert.ok(scrollIndex > summaryIndex, 'hand summary must stay outside and above the detail scroll area')
assert.match(wxml, /<scroll-view[^>]*class="review-detail-scroll"[^>]*scroll-y="true"/)
assert.match(wxml, /<view class="review-detail-close-icon"[^>]*aria-label="关闭"/)
assert.match(wxml, /class="review-detail-close-glyph"/)
assert.doesNotMatch(wxml, /<button class="review-detail-close-icon"/)
assert.doesNotMatch(wxml, /class="review-top-action close"[^>]*>关闭<\/button>/)

assert.match(wxss, /\.review-modal-panel\s*\{[\s\S]*?overflow:\s*hidden/)
assert.match(wxss, /\.review-detail-loaded\s*\{[\s\S]*?display:\s*flex/)
assert.match(wxss, /\.review-detail-scroll\s*\{[\s\S]*?height:\s*0/)
assert.match(wxss, /\.review-detail-close-icon\s*\{[\s\S]*?width:\s*64rpx[\s\S]*?height:\s*64rpx/)

console.log('review-list hand detail fixed summary checks passed')
