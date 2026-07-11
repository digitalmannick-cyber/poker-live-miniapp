const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'poker_data', 'index.js'), 'utf8')

test('poker_data session writes derive duration minutes from start and end time', () => {
  assert.match(source, /function calculateDurationMinutes\(startTime, endTime\)/)
  assert.match(source, /const durationMinutes = Number\.isFinite\(explicitDuration\) && explicitDuration > 0\s*\?\s*explicitDuration\s*:\s*calculateDurationMinutes\(startTime, endTime\)/)
  assert.match(source, /durationMinutes,\s*\n\s*timerPausedAt:/)
})
