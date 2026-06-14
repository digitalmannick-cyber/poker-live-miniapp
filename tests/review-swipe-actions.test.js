const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const reviewWxml = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxml'), 'utf8')
const reviewJs = fs.readFileSync(path.join(root, 'pages/review-list/review-list.js'), 'utf8')
const reviewWxss = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxss'), 'utf8')
const detailWxml = fs.readFileSync(path.join(root, 'pages/hand-detail/hand-detail.wxml'), 'utf8')
const detailJs = fs.readFileSync(path.join(root, 'pages/hand-detail/hand-detail.js'), 'utf8')

assert.ok(
  reviewWxml.includes('review-swipe-row') &&
  reviewWxml.includes('bindtouchstart="onReviewItemTouchStart"') &&
  reviewWxml.includes('bindtouchmove="onReviewItemTouchMove"') &&
  reviewWxml.includes('bindtouchend="onReviewItemTouchEnd"'),
  'review list should support left swipe gestures on each hand'
)

assert.ok(
  reviewWxml.includes('catchtap="editHandFromList"') &&
  reviewWxml.includes('catchtap="deleteHandFromList"') &&
  reviewWxml.includes('review-swipe-action edit') &&
  reviewWxml.includes('review-swipe-action delete'),
  'review list swipe row should expose edit and delete actions'
)

assert.ok(
  reviewJs.includes('SWIPE_OPEN_DISTANCE') &&
  reviewJs.includes('updateReviewSwipeState') &&
  reviewJs.includes('swiped: item._id === handId') &&
  reviewJs.includes("swipedHandId: handId || ''") &&
  reviewJs.includes("wx.navigateTo({ url: '/pages/hand-detail/hand-detail?id=' + handId + '&edit=1' })") &&
  reviewJs.includes('dataService.deleteHand(handId)'),
  'review list should open only one swipe row, navigate to editable detail, and delete hands'
)

assert.ok(
  reviewWxss.includes('.review-swipe-row.open .review-swipe-content') &&
  reviewWxss.includes('transform: translateX(-176rpx)') &&
  reviewWxss.includes('.review-swipe-action.delete') &&
  /\.review-swipe-actions\s*\{[\s\S]*display:\s*none;/.test(reviewWxss) &&
  /\.review-swipe-row\.open\s+\.review-swipe-actions\s*\{[\s\S]*display:\s*grid;/.test(reviewWxss) &&
  /\.review-swipe-content\s*\{[\s\S]*background:\s*#15171d;/.test(reviewWxss),
  'review list swipe actions should stay hidden until one row is opened and content should cover the action layer'
)

assert.ok(
  detailJs.includes("editMode: options.edit === '1'") &&
  detailWxml.includes('wx:if="{{editMode}}"') &&
  detailWxml.includes('本页字段均可修改'),
  'hand detail should show an edit-mode affordance when opened from swipe edit'
)

console.log('review swipe action tests passed')
