const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const source = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'poker_data', 'index.js'), 'utf8')

test('poker_data session writes derive duration minutes from start and end time', () => {
  assert.match(source, /function calculateDurationMinutes\(startTime, endTime\)/)
  assert.match(source, /const durationMinutes = Number\.isFinite\(explicitDuration\) && explicitDuration > 0\s*\?\s*explicitDuration\s*:\s*calculateDurationMinutes\(startTime, endTime\)/)
  assert.match(source, /durationMinutes,\s*\n\s*timerPausedAt:/)
})

test('poker_data exposes a guarded session duration backfill action', () => {
  assert.match(source, /function getSessionDurationBackfill\(session\)/)
  assert.match(source, /if \(item\.status !== 'finished'\) return null/)
  assert.match(source, /if \(isHistoryImportSession\(item\)\) return null/)
  assert.match(source, /if \(current > 0\) return null/)
  assert.match(source, /const dryRun = event\.dryRun !== false/)
  assert.match(source, /action === 'backfill_session_durations'/)
  assert.match(source, /code: 'BACKFILL_UNAUTHORIZED'/)
  assert.match(source, /durationBackfilledAt: now\(\)/)
})

test('session duration backfill only targets finished zero-duration sessions with valid times', () => {
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() {
          return {}
        },
        getWXContext() {
          return {}
        }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  const modulePath = require.resolve('../cloudfunctions/poker_data/index')
  delete require.cache[modulePath]
  const pokerData = require('../cloudfunctions/poker_data/index')
  Module._load = originalLoad

  assert.deepEqual(pokerData.__test.getSessionDurationBackfill({
    _id: 'session_missing',
    status: 'finished',
    durationMinutes: 0,
    startTime: '2026-07-01 20:00',
    endTime: '2026-07-02 02:30'
  }), {
    sessionId: 'session_missing',
    title: '',
    startTime: '2026-07-01 20:00',
    endTime: '2026-07-02 02:30',
    beforeDurationMinutes: 0,
    durationMinutes: 390,
    addedMinutes: 390
  })
  assert.equal(pokerData.__test.getSessionDurationBackfill({
    status: 'active',
    durationMinutes: 0,
    startTime: '2026-07-01 20:00',
    endTime: '2026-07-02 02:30'
  }), null)
  assert.equal(pokerData.__test.getSessionDurationBackfill({
    status: 'finished',
    durationMinutes: 120,
    startTime: '2026-07-01 20:00',
    endTime: '2026-07-02 02:30'
  }), null)
  assert.equal(pokerData.__test.getSessionDurationBackfill({
    status: 'finished',
    durationMinutes: 0,
    startTime: '2026-07-02 02:30',
    endTime: '2026-07-01 20:00'
  }), null)
  assert.equal(pokerData.__test.getSessionDurationBackfill({
    _id: 'feishu_session_2026-03-13',
    status: 'finished',
    durationMinutes: 0,
    source: { type: 'feishu_base_history_import' },
    startTime: '2026-03-13 00:00:00',
    endTime: '2026-03-13 23:59:00'
  }), null)
})
