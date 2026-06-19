const assert = require('assert')
const duration = require('../utils/session-duration')

assert.strictEqual(duration.buildDurationView({
  status: 'active',
  startTime: '2026-06-19 17:52'
}, new Date(2026, 5, 20, 1, 42)).display, '07:50')

assert.strictEqual(duration.buildDurationView({
  status: 'active',
  startTime: '2026-06-19 17:52',
  timerPausedAt: '2026-06-19 20:12'
}, new Date(2026, 5, 20, 1, 42)).display, '02:20')

const finished = duration.buildDurationView({
  status: 'finished',
  startTime: '2026-06-19 17:52',
  endTime: '2026-06-20 01:42'
})
assert.strictEqual(finished.display, '07:50')
assert.strictEqual(finished.label, 'TOTAL DURATION')

assert.strictEqual(duration.formatDurationMinutes(1625), '27:05')
assert.strictEqual(duration.buildDurationView({ status: 'active', startTime: 'bad' }).display, '--:--')
assert.strictEqual(duration.buildDurationView({
  status: 'finished',
  startTime: '2026-06-20 02:00',
  endTime: '2026-06-20 01:00'
}).display, '--:--')

console.log('session duration tests passed')
