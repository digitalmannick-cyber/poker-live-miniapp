const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'poker_data', 'index.js'), 'utf8')

test('poker_data hand updates persist AI advice display state', () => {
  assert.match(source, /aiReview:\s*merged\.aiReview \|\| null/)
  assert.match(source, /aiReviewStatus:\s*merged\.aiReviewStatus \|\| ''/)
  assert.match(source, /aiReviewGeneratedAt:\s*merged\.aiReviewGeneratedAt \|\| ''/)
  assert.match(source, /aiReviewError:\s*merged\.aiReviewError \|\| ''/)
})
