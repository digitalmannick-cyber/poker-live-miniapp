const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('sync_stats reads ownerOpenId and legacy _openid scoped player data', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'poker_data', 'index.js'), 'utf8')

  assert.match(source, /const sessions = \(await fetchOwnedByPlayer\(COLLECTIONS\.sessions, playerId, ownerOpenId\)\)\.map\(cleanCloudDoc\)/)
  assert.match(source, /const hands = \(await fetchOwnedByPlayer\(COLLECTIONS\.hands, playerId, ownerOpenId\)\)\.map\(cleanCloudDoc\)/)
  assert.doesNotMatch(source, /const sessions = await fetchAll\(COLLECTIONS\.sessions, playerId, ownerOpenId\)/)
  assert.doesNotMatch(source, /const hands = await fetchAll\(COLLECTIONS\.hands, playerId, ownerOpenId\)/)
})
