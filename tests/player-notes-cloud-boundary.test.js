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
assert.match(source, /playerCardImportReceipts:\s*'player_card_import_receipts'/, 'cloud function should define private card receipt collection')
assert.match(source, /begin_player_card_import_receipt/, 'cloud function should route receipt begin')
assert.match(source, /complete_player_card_import_receipt/, 'cloud function should route receipt completion')
assert.match(source, /get_player_card_import_receipt/, 'cloud function should route receipt point read')
assert.match(source, /await ensureCollection\(COLLECTIONS\.playerCardImportReceipts\)/, 'receipt writes should provision the dedicated collection before transactions')

assert.match(
  source,
  /fetchWhere\(COLLECTIONS\.playerNotes,\s*\{\s*playerId,\s*ownerOpenId/s,
  'list_player_notes must scope reads by playerId and ownerOpenId'
)
assert.doesNotMatch(source, /importedCardShareId:\s*String\(merged\.importedCardShareId/, 'player notes must not carry card receipt state')
assert.doesNotMatch(source, /importedCardMode:\s*merged\.importedCardMode/, 'player notes must not carry card receipt mode')

const cloudApiSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'cloud-data-api.js'), 'utf8')
assert.doesNotMatch(cloudApiSource, /'importedCardShareId'/, 'player-note cloud payload must not carry receipt state')
assert.doesNotMatch(cloudApiSource, /'importedCardMode'/, 'player-note cloud payload must not carry receipt mode')
assert.match(cloudApiSource, /begin_player_card_import_receipt/)
assert.match(cloudApiSource, /complete_player_card_import_receipt/)
assert.match(cloudApiSource, /get_player_card_import_receipt/)
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
