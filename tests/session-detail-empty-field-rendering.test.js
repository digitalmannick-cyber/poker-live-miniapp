const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/session-detail/session-detail.wxml'), 'utf8')

assert.match(
  wxml,
  /wx:if="\{\{item\.heroPosition\}\}"\s+class="position-chip"/,
  'session detail should not render an empty position chip'
)

assert.match(
  wxml,
  /class="session-hand-meta-row"\s+wx:if="\{\{item\.potSize \|\| item\.effectiveStack \|\| item\.opponentType\}\}"/,
  'session detail should hide the meta row when pot, stack, and opponent type are all empty'
)

assert.doesNotMatch(
  wxml,
  /\{\{item\.potSize \|\| '-'\}\}/,
  'session detail should not show dash placeholders for missing pot values'
)

assert.doesNotMatch(
  wxml,
  /\{\{item\.effectiveStack \|\| '-'\}\}/,
  'session detail should not show dash placeholders for missing stack values'
)

console.log('session detail empty field rendering checks passed')
