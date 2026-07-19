const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

const storage = {}

function resetStorage() {
  Object.keys(storage).forEach(key => delete storage[key])
}

function loadDataService(cloudState, calls) {
  global.wx = {
    getStorageSync(key) {
      return storage[key]
    },
    setStorageSync(key, value) {
      storage[key] = value
    },
    removeStorageSync(key) {
      delete storage[key]
    },
    cloud: {
      init() {},
      database() {
        const chain = {
          where() { return chain },
          orderBy() { return chain },
          skip() { return chain },
          limit() { return chain },
          async get() { return { data: [] } },
          doc() {
            return {
              async get() { return { data: null } },
              async set() {}
            }
          }
        }
        return { collection() { return chain } }
      }
    }
  }
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (parent && /services[\\/]data-service\.js$/.test(parent.filename || '')) {
      if (request === '../utils/cloud') {
        return { canUseCloud: () => cloudState.available }
      }
      if (request === './cloud-data-api') {
        return {
          async createPlayerNote(options) {
            calls.create.push(options)
            if (cloudState.failCreate) throw new Error('offline')
            return {
              playerNote: Object.assign({}, options.payload, {
                _id: options.payload.sourceKind === 'friend' ? cloudState.canonicalId : options.payload._id,
                archived: false,
                updatedAt: (Number(options.payload.updatedAt) || 0) + 1
              })
            }
          },
          async updatePlayerNote(options) {
            calls.update.push(options)
            return { playerNote: Object.assign({}, options.patch, { _id: options.noteId }) }
          },
          async listPlayerNotes() {
            return { playerNotes: [] }
          },
          async loginAccount() {
            return {}
          }
        }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const dataServicePath = require.resolve('../services/data-service')
  const storePath = require.resolve('../utils/store')
  delete require.cache[dataServicePath]
  delete require.cache[storePath]
  try {
    return require('../services/data-service')
  } finally {
    Module._load = originalLoad
  }
}

test('offline friend ensure retries canonical cloud creation after recovery and subsequent update targets the canonical ID', async () => {
  resetStorage()
  const cloudState = { available: false, failCreate: false, canonicalId: 'canonical_cloud_note' }
  const calls = { create: [], update: [] }
  const dataService = loadDataService(cloudState, calls)

  const offline = await dataService.ensureFriendPlayerNote({ socialUserId: 'su_friend', nickname: 'Offline Wolf' })
  assert.notEqual(offline._id, cloudState.canonicalId)
  assert.equal(calls.create.length, 0)

  cloudState.available = true
  const recovered = await dataService.ensureFriendPlayerNote({ socialUserId: 'su_friend', nickname: 'Changed remote snapshot' })
  assert.equal(calls.create.length, 1)
  assert.equal(calls.create[0].payload.linkedFriendUserId, 'su_friend')
  assert.doesNotMatch(calls.create[0].clientMutationId, new RegExp(offline._id), 'ensure retry mutation IDs must not use a temporary local note ID')
  assert.match(calls.create[0].clientMutationId, /su_friend/)
  assert.equal(recovered._id, cloudState.canonicalId)
  assert.equal((await dataService.getFriendPlayerNote('su_friend'))._id, cloudState.canonicalId)
  assert.equal((await dataService.getPlayerNotes({ sourceKind: 'friend' })).length, 1)

  await dataService.updatePlayerNote(recovered._id, { note: 'update canonical record' })
  assert.equal(calls.update.length, 1)
  assert.equal(calls.update[0].noteId, cloudState.canonicalId)
})

test('card import receipts are included in awaited create and overwrite cloud writes', async () => {
  resetStorage()
  const cloudState = { available: true, failCreate: false, canonicalId: 'unused' }
  const calls = { create: [], update: [] }
  const dataService = loadDataService(cloudState, calls)

  const created = await dataService.createPlayerNote({
    _id: 'player_note_card_pcs_1', sourceKind: 'library', name: '老张',
    importedCardShareId: 'pcs_1', importedCardMode: 'new'
  }, { waitForCloud: true })
  assert.equal(created._id, 'player_note_card_pcs_1')
  assert.equal(calls.create[0].payload.importedCardShareId, 'pcs_1')
  assert.equal(calls.create[0].payload.importedCardMode, 'new')

  const updated = await dataService.updatePlayerNote(created._id, {
    name: '老张', importedCardShareId: 'pcs_2', importedCardMode: 'overwrite'
  }, { waitForCloud: true })
  assert.equal(updated.importedCardShareId, 'pcs_2')
  assert.equal(calls.update[0].patch.importedCardMode, 'overwrite')
})

test('an awaited card receipt write fails before local creation when cloud is unavailable', async () => {
  resetStorage()
  const cloudState = { available: false, failCreate: false, canonicalId: 'unused' }
  const calls = { create: [], update: [] }
  const dataService = loadDataService(cloudState, calls)
  await assert.rejects(dataService.createPlayerNote({
    _id: 'player_note_card_offline', name: '离线名片',
    importedCardShareId: 'pcs_offline', importedCardMode: 'new'
  }, { waitForCloud: true }), error => error.code === 'CLOUD_PLAYER_NOTE_WRITE_REQUIRED')
  assert.equal(await dataService.getPlayerNoteById('player_note_card_offline'), null)
  assert.equal(calls.create.length, 0)
})
