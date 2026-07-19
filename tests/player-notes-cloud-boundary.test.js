const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'poker_data', 'index.js'), 'utf8')

assert.match(source, /playerNotes:\s*'player_notes'/, 'cloud function should define player_notes collection')
assert.match(source, /create_player_note/, 'cloud function should route create_player_note action')
assert.match(source, /list_player_notes/, 'cloud function should route list_player_notes action')
assert.match(source, /update_player_note/, 'cloud function should route update_player_note action')
assert.match(source, /delete_player_note/, 'cloud function should route delete_player_note action')
assert.match(source, /list_player_note_hands/, 'cloud function should route list_player_note_hands action')
assert.match(source, /get_player_note_hand_replay/, 'cloud function should route get_player_note_hand_replay action')

assert.match(
  source,
  /fetchWhere\(COLLECTIONS\.playerNotes,\s*\{\s*playerId,\s*ownerOpenId/s,
  'list_player_notes must scope reads by playerId and ownerOpenId'
)
assert.match(source, /importedCardShareId:\s*String\(merged\.importedCardShareId/, 'private player-note docs must persist the imported card share receipt')
assert.match(source, /importedCardMode:\s*merged\.importedCardMode/, 'private player-note docs must persist the imported card mode')

const cloudApiSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'cloud-data-api.js'), 'utf8')
assert.match(cloudApiSource, /'importedCardShareId'/, 'player-note cloud payload must allow the private card receipt')
assert.match(cloudApiSource, /'importedCardMode'/, 'player-note cloud payload must allow the private card mode')
assert.match(
  source,
  /normalizePlayerId\(current\.playerId\)\s*!==\s*playerId\s*\|\|\s*current\.ownerOpenId\s*!==\s*ownerOpenId/s,
  'player note mutations must reject documents outside the account boundary'
)
assert.match(
  source,
  /fetchWhere\(COLLECTIONS\.hands,\s*\{\s*playerId,\s*ownerOpenId/s,
  'battle hand summary reads must scope hands by playerId and ownerOpenId'
)

console.log('player notes cloud boundary tests passed')
