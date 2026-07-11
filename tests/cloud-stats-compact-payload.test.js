const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const source = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'poker_data', 'index.js'), 'utf8')

test('sync_stats returns compact stats payload instead of full hand detail', () => {
  const syncStatsStart = source.indexOf('async function syncStats')
  assert.notEqual(syncStatsStart, -1)
  const syncStatsSource = source.slice(syncStatsStart, source.indexOf('async function exportAgentData', syncStatsStart))
  const compactHandStart = source.indexOf('function compactStatsHand')
  assert.notEqual(compactHandStart, -1)
  const compactHandSource = source.slice(compactHandStart, source.indexOf('async function getOwnedProfiles', compactHandStart))

  assert.match(syncStatsSource, /sessions:\s*sessions\.map\(compactStatsSession\)/)
  assert.match(syncStatsSource, /hands:\s*hands\.map\(compactStatsHand\)/)
  assert.doesNotMatch(compactHandSource, /\bvoiceNote\b/)
  assert.doesNotMatch(compactHandSource, /mindJourney/)
  assert.match(compactHandSource, /aiReview:\s*item\.aiReview\s*\?\s*true\s*:\s*null/)
})
