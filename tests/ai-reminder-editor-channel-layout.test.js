const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const wxss = fs.readFileSync(path.join(__dirname, '..', 'components', 'ai-reminder-editor', 'ai-reminder-editor.wxss'), 'utf8')

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = wxss.match(new RegExp(escaped + '\\s*\\{([\\s\\S]*?)\\}', 'm'))
  return match ? match[1] : ''
}

const row = cssBlock('.ai-reminder-channel-row')
const label = cssBlock('.ai-reminder-channel-label')
const chip = cssBlock('.ai-reminder-subscribe-chip')

assert.match(row, /display:\s*flex/)
assert.match(row, /align-items:\s*center/)
assert.match(label, /flex:\s*1\s+1\s+auto/)
assert.match(chip, /width:\s*auto/)
assert.match(chip, /min-width:\s*96rpx/)
assert.match(chip, /max-width:\s*172rpx/)
assert.match(chip, /height:\s*48rpx/)
assert.match(chip, /overflow:\s*hidden/)
assert.match(chip, /text-overflow:\s*ellipsis/)
assert.match(chip, /border-radius:\s*999rpx/)

const chipOn = cssBlock('.ai-reminder-subscribe-chip.on')
assert.doesNotMatch(chipOn, /box-shadow:\s*\d+rpx\s+\d+rpx\s+0\s+#e60012/)
assert.match(chipOn, /background:\s*linear-gradient/)

console.log('AI reminder editor channel layout checks passed')
