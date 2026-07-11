const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const source = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'poker_data', 'index.js'), 'utf8')

test('sync_stats resolves the best owner account when local playerId is missing or stale', () => {
  const syncStatsStart = source.indexOf('async function syncStats')
  assert.notEqual(syncStatsStart, -1)
  const syncStatsSource = source.slice(syncStatsStart, source.indexOf('async function exportAgentData', syncStatsStart))
  const missingPlayerBranch = syncStatsSource.slice(
    syncStatsSource.indexOf('if (!playerId)'),
    syncStatsSource.indexOf('if (hasMeaningfulBackup(event.backup))')
  )

  assert.match(syncStatsSource, /recoveryCandidates\s*=\s*recoveryCandidates\s*\|\|\s*await listRecoveryCandidates\(ownerOpenId\)/)
  assert.match(syncStatsSource, /createOpenIdPlayerId\(ownerOpenId\)/)
  assert.match(syncStatsSource, /sessions\.length\s*<\s*5\s*&&\s*hands\.length\s*<\s*20/)
  assert.match(syncStatsSource, /bestCandidate\.score\s*>\s*requestedScore/)
  assert.match(syncStatsSource, /resolvedPlayerId:\s*playerId/)
  assert.match(missingPlayerBranch, /playerId\s*=\s*createOpenIdPlayerId\(ownerOpenId\)/)
  assert.doesNotMatch(missingPlayerBranch, /listRecoveryCandidates/)
})
