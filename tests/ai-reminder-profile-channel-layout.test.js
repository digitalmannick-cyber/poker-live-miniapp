const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const wxss = fs.readFileSync(path.join(__dirname, '..', 'pages', 'profile', 'profile.wxss'), 'utf8')

function lastCssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...wxss.matchAll(new RegExp(escaped + '\\s*\\{([\\s\\S]*?)\\}', 'gm'))]
  return matches.length ? matches[matches.length - 1][1] : ''
}

const row = lastCssBlock('.ai-reminder-channel-row')
const label = lastCssBlock('.ai-reminder-channel-label')
const chip = lastCssBlock('.ai-reminder-subscribe-chip')

assert.match(row, /display:\s*flex/)
assert.match(row, /align-items:\s*center/)
assert.match(label, /flex:\s*1\s+1\s+auto/)
assert.match(chip, /width:\s*auto/)
assert.match(chip, /min-width:\s*96rpx/)
assert.match(chip, /max-width:\s*172rpx/)
assert.match(chip, /height:\s*48rpx/)
assert.match(chip, /overflow:\s*hidden/)
assert.match(chip, /text-overflow:\s*ellipsis/)

console.log('AI reminder profile channel layout checks passed')
