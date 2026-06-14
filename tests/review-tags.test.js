const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const reviewTags = require('../utils/review-tags')

const root = path.resolve(__dirname, '..')
const reviewJs = fs.readFileSync(path.join(root, 'pages/review-list/review-list.js'), 'utf8')
const reviewWxml = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxml'), 'utf8')
const reviewWxss = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxss'), 'utf8')

assert.deepEqual(
  reviewTags.normalizeReviewTags(['river_overfold', 'badfold', 'value_check_behind', '3bet_pot']),
  ['Overfold', 'Bad Fold', '价值下注', '3Bet池'],
  'review tags should normalize Agent/internal aliases into fixed user-facing tags'
)

assert.ok(
  reviewJs.includes("tagFilter: 'all'") &&
  reviewJs.includes('selectTagFilter') &&
  reviewJs.includes('draftTagFilterOptions') &&
  reviewJs.includes('reviewTags.normalizeReviewTags(parsedVoice.tags)'),
  'review list should keep tag filter state and normalize parsed tags'
)

assert.ok(
  reviewJs.includes('function inferReviewTagsFromReview') &&
  reviewJs.includes('inferReviewTagsFromReview(mergedVoice') &&
  reviewJs.includes('inferReviewTagsFromReview(parsedVoice') &&
  reviewJs.includes("tags: reviewTags.normalizeReviewTags([].concat(normalizedTags).concat(displayInferredTags))"),
  'review backfill should infer fixed hand tags from extracted fields and Agent advice for display and filtering'
)

assert.ok(
  reviewWxml.includes('draftTagFilterOptions') &&
  reviewWxml.includes('bindtap="selectTagFilter"') &&
  reviewWxml.includes('review-hand-tag') &&
  reviewWxml.includes('wx:if="{{false}}" class="review-detail-block review-agent-section review-agent-section-tags"'),
  'review tags should be filterable and shown as hand-info chips, while Agent advice tags remain hidden'
)

assert.ok(
  reviewWxss.includes('.review-chip-wrap-tags') &&
  reviewWxss.includes('.review-hand-tag'),
  'review tag filter and hand tag chips should have dedicated styles'
)

console.log('review tags tests passed')
