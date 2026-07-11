const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('sync_stats skips mergeBusinessData when backup is empty', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'poker_data', 'index.js'), 'utf8')

  assert.match(source, /function hasMeaningfulBackup\(backup\)/)
  assert.match(source, /if \(hasMeaningfulBackup\(event\.backup\)\) \{\s*await mergeBusinessData\(event\.backup \|\| \{\}, playerId, ownerOpenId\)\s*\}/)
})
