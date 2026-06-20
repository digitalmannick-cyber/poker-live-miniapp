const assert = require('assert')
const fs = require('fs')
const statusFilter = require('../utils/review-session-status')

const sessions = [
  { _id: 'active-session', status: 'active' },
  { _id: 'finished-session', status: 'finished' }
]
const hands = [
  { _id: 'active-hand', sessionId: 'active-session' },
  { _id: 'finished-hand', sessionId: 'finished-session' },
  { _id: 'orphan-hand', sessionId: 'missing-session' }
]

assert.strictEqual(statusFilter.getDefaultSessionStatus(sessions), 'active')
assert.strictEqual(statusFilter.getDefaultSessionStatus(sessions.slice(1)), 'finished')
assert.strictEqual(statusFilter.resolveSessionStatus({
  requestedStatus: 'active',
  sessions: sessions.slice(1)
}), 'finished')
assert.strictEqual(statusFilter.resolveSessionStatus({
  requestedStatus: 'finished',
  sessions
}), 'finished')
assert.strictEqual(statusFilter.resolveSessionStatus({
  legacySessionId: 'active-session',
  sessions
}), 'active')
assert.deepStrictEqual(
  statusFilter.filterHandsBySessionStatus(hands, sessions, 'active').map(item => item._id),
  ['active-hand']
)
assert.deepStrictEqual(
  statusFilter.filterHandsBySessionStatus(hands, sessions, 'finished').map(item => item._id),
  ['finished-hand']
)
assert.deepStrictEqual(
  statusFilter.buildSessionStatusOptions('finished'),
  [
    { key: 'active', label: '进行中', active: false },
    { key: 'finished', label: '已结束', active: true }
  ]
)

const reviewJs = fs.readFileSync('pages/review-list/review-list.js', 'utf8')
const reviewWxml = fs.readFileSync('pages/review-list/review-list.wxml', 'utf8')
const handRecordJs = fs.readFileSync('pages/hand-record/hand-record.js', 'utf8')
const dataServiceJs = fs.readFileSync('services/data-service.js', 'utf8')

assert.match(reviewJs, /selectedSessionStatus/)
assert.match(reviewJs, /draftSessionStatus/)
assert.doesNotMatch(reviewJs, /buildSessionOptions/)
assert.match(reviewWxml, /牌局状态/)
assert.match(reviewWxml, /draftSessionStatusOptions/)
assert.doesNotMatch(reviewWxml, /draftSessionOptions/)
assert.match(handRecordJs, /sessionStatus:\s*'active'/)
assert.doesNotMatch(handRecordJs, /REVIEW_PENDING_FILTER_KEY,[\s\S]{0,160}sessionId:/)
assert.match(dataServiceJs, /filterHandsBySessionStatus\(hands, sessions, filters\.sessionStatus\)/)

console.log('review session status filter tests passed')
