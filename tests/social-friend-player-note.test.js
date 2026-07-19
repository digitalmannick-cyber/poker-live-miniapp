const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const storage = {}
global.wx = {
  getStorageSync(key) {
    return storage[key]
  },
  setStorageSync(key, value) {
    storage[key] = value
  },
  removeStorageSync(key) {
    delete storage[key]
  }
}

const store = require('../utils/store')

function resetStore(data) {
  Object.keys(storage).forEach(key => delete storage[key])
  store.__test.resetCachedStoreForTest()
  store.importBackup(data || store.__test.buildInitialStoreData())
  store.__test.resetCachedStoreForTest()
}

resetStore({
  sessions: [],
  hands: [],
  handActions: [],
  bankrollLogs: [],
  profile: { playerId: 'WX-OWNER', name: 'Hero' },
  settings: {},
  playerNotes: [
    { _id: 'legacy_note', name: 'Legacy player' }
  ]
})

const legacy = store.getPlayerNoteById('legacy_note')
assert.equal(legacy.sourceKind, 'library', 'old player library records must normalize to library')
assert.equal(legacy.linkedFriendUserId, '', 'old player library records must not become linked friends')

const friend = store.ensureFriendPlayerNote({
  socialUserId: 'su_a',
  nickname: 'Silver Wolf',
  avatarUrl: 'https://cdn.example/avatar-a.png',
  avatarText: '银狼'
})
assert.equal(friend.sourceKind, 'friend')
assert.equal(friend.linkedFriendUserId, 'su_a')
assert.equal(friend.name, 'Silver Wolf')
assert.equal(friend.avatarUrl, 'https://cdn.example/avatar-a.png')
assert.equal(store.getPlayerNotes({ sourceKind: 'library' }).some(item => item._id === friend._id), false)
assert.equal(store.getPlayerNotes({}).some(item => item._id === friend._id), false, 'default player library list must hide friend notes')
assert.equal(store.getFriendPlayerNote('su_a')._id, friend._id)

const annotated = store.updatePlayerNote(friend._id, {
  name: 'Table Wolf',
  avatarUrl: 'wxfile://local-wolf.png',
  type: 'Regular',
  leakTags: ['calls too wide'],
  note: 'local annotation',
  battleHandIds: ['hand-1']
})
const idempotent = store.ensureFriendPlayerNote({
  socialUserId: 'su_a',
  nickname: 'New remote nickname',
  avatarUrl: 'https://cdn.example/new-avatar.png'
})
assert.equal(idempotent._id, friend._id, 'each owner must have only one note for the same friend')
assert.equal(idempotent.name, annotated.name, 'later friend snapshots must not overwrite local names')
assert.equal(idempotent.avatarUrl, annotated.avatarUrl, 'later friend snapshots must not overwrite local avatars')
assert.deepEqual(idempotent.leakTags, ['calls too wide'])
assert.deepEqual(idempotent.battleHandIds, ['hand-1'])

const detached = store.detachFriendPlayerNote('su_a')
assert.equal(detached.sourceKind, 'library')
assert.equal(detached.linkedFriendUserId, '')
assert.equal(detached.name, 'Table Wolf')
assert.equal(detached.avatarUrl, 'wxfile://local-wolf.png')
assert.deepEqual(detached.leakTags, ['calls too wide'])
assert.equal(detached.note, 'local annotation')
assert.deepEqual(detached.battleHandIds, ['hand-1'])
assert.equal(store.getFriendPlayerNote('su_a'), null)
assert.equal(store.getPlayerNotes({ sourceKind: 'library' }).some(item => item._id === friend._id), true)

const dataServiceSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'data-service.js'), 'utf8')
const cloudApiSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'cloud-data-api.js'), 'utf8')
const cloudFunctionSource = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'poker_data', 'index.js'), 'utf8')
const cloudDataApi = require('../services/cloud-data-api')
assert.match(dataServiceSource, /async function getFriendPlayerNote\(/)
assert.match(dataServiceSource, /async function ensureFriendPlayerNote\(/)
assert.match(dataServiceSource, /async function detachFriendPlayerNote\(/)
assert.match(cloudApiSource, /function buildPlayerNotePayload\(/)
assert.match(cloudApiSource, /sourceKind/)
assert.match(cloudApiSource, /linkedFriendUserId/)
assert.match(cloudFunctionSource, /sourceKind/)
assert.match(cloudFunctionSource, /linkedFriendUserId/)
assert.deepEqual(
  cloudDataApi.__test.buildPlayerNotePayload({ note: 'only update this field' }),
  { note: 'only update this field' },
  'the client whitelist must preserve partial player-note updates without clearing unrelated local annotations'
)
assert.doesNotMatch(
  cloudFunctionSource,
  /fetchWhere\(COLLECTIONS\.playerNotes,\s*\{\s*linkedFriendUserId/s,
  'friend links must never become a cross-owner lookup key'
)
assert.match(
  cloudFunctionSource,
  /fetchWhere\(COLLECTIONS\.playerNotes,\s*\{\s*playerId,\s*ownerOpenId\s*\}\)[\s\S]{0,800}linkedFriendUserId/s,
  'the cloud must detect duplicate friend notes only inside the current playerId and ownerOpenId boundary'
)

resetStore({
  sessions: [],
  hands: [],
  handActions: [],
  bankrollLogs: [],
  profile: { playerId: 'WX-OWNER', name: 'Hero' },
  settings: {},
  playerNotes: [
    { _id: 'friend_old', sourceKind: 'friend', linkedFriendUserId: 'su_duplicate', name: 'Old', updatedAt: 10 },
    { _id: 'friend_new', sourceKind: 'friend', linkedFriendUserId: 'su_duplicate', name: 'New', updatedAt: 20 }
  ]
})
const duplicateFriendNotes = store.getPlayerNotes({ sourceKind: 'friend' })
assert.equal(duplicateFriendNotes.length, 1, 'local backup merges must keep at most one note for each linked friend')
assert.equal(duplicateFriendNotes[0]._id, 'friend_new', 'the newest local annotation wins when repairing duplicate friend notes')

console.log('social friend player note tests passed')
