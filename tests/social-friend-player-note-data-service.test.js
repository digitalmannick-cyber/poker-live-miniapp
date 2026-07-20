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
          async getPlayerCardImportReceipt(options) {
            calls.getReceipt.push(options)
            if (cloudState.failReceiptRead) throw new Error('receipt offline')
            if (cloudState.getReceiptImpl) return cloudState.getReceiptImpl(options)
            return { receipt: cloudState.receipt || null }
          },
          async beginPlayerCardImportReceipt(options) {
            calls.beginReceipt.push(options)
            if (cloudState.beginReceiptImpl) return cloudState.beginReceiptImpl(options)
            return { receipt: Object.assign({}, options, { status: 'pending' }) }
          },
          async completePlayerCardImportReceipt(options) {
            calls.completeReceipt.push(options)
            return { receipt: Object.assign({}, cloudState.receipt || {}, { shareId: options.shareId, status: 'completed' }) }
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
  const calls = { create: [], update: [], getReceipt: [], beginReceipt: [], completeReceipt: [] }
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

test('card import receipts use dedicated cloud actions and never player-note payload fields', async () => {
  resetStorage()
  const cloudState = { available: true, failCreate: false, canonicalId: 'unused' }
  const calls = { create: [], update: [], getReceipt: [], beginReceipt: [], completeReceipt: [] }
  const dataService = loadDataService(cloudState, calls)
  const accountContext = dataService.captureAccountContext()

  assert.equal(await dataService.getPlayerCardImportReceipt('pcs_1', accountContext), null)
  const pending = await dataService.beginPlayerCardImportReceipt({ shareId: 'pcs_1', mode: 'new', targetPlayerNoteId: 'note-1' }, accountContext)
  assert.equal(pending.status, 'pending')
  const completed = await dataService.completePlayerCardImportReceipt('pcs_1', '', accountContext)
  assert.equal(completed.status, 'completed')
  assert.equal(calls.getReceipt[0].shareId, 'pcs_1')
  assert.match(calls.beginReceipt[0].clientMutationId, /begin_player_card_import_receipt/)
  assert.match(calls.completeReceipt[0].clientMutationId, /complete_player_card_import_receipt/)

  const created = await dataService.createPlayerNote({ _id: 'note-1', name: '老张' }, { waitForCloud: true })
  assert.equal(Object.hasOwn(calls.create[0].payload, 'importedCardShareId'), false)
  assert.equal(Object.hasOwn(calls.create[0].payload, 'importedCardMode'), false)
  assert.equal(created._id, 'note-1')
})

test('an awaited card receipt write fails before local creation when cloud is unavailable', async () => {
  resetStorage()
  const cloudState = { available: false, failCreate: false, canonicalId: 'unused' }
  const calls = { create: [], update: [], getReceipt: [], beginReceipt: [], completeReceipt: [] }
  const dataService = loadDataService(cloudState, calls)
  await assert.rejects(dataService.createPlayerNote({
    _id: 'player_note_card_offline', name: '离线名片',
  }, { waitForCloud: true }), error => error.code === 'CLOUD_PLAYER_NOTE_WRITE_REQUIRED')
  assert.equal(await dataService.getPlayerNoteById('player_note_card_offline'), null)
  assert.equal(calls.create.length, 0)
})

test('receipt read failure is propagated for fail-closed page behavior', async () => {
  resetStorage()
  const cloudState = { available: true, failReceiptRead: true, canonicalId: 'unused' }
  const calls = { create: [], update: [], getReceipt: [], beginReceipt: [], completeReceipt: [] }
  const dataService = loadDataService(cloudState, calls)
  await assert.rejects(dataService.getPlayerCardImportReceipt('pcs_1', dataService.captureAccountContext()), /receipt offline/)
})

test('card receipt operations reject omitted account context before touching cloud', async () => {
  resetStorage()
  const cloudState = { available: true, failCreate: false, canonicalId: 'unused' }
  const calls = { create: [], update: [], getReceipt: [], beginReceipt: [], completeReceipt: [] }
  const dataService = loadDataService(cloudState, calls)

  await assert.rejects(dataService.getPlayerCardImportReceipt('pcs_1'), error => error && error.code === 'ACCOUNT_CONTEXT_REQUIRED')
  await assert.rejects(dataService.beginPlayerCardImportReceipt({ shareId: 'pcs_1', mode: 'new' }), error => error && error.code === 'ACCOUNT_CONTEXT_REQUIRED')
  await assert.rejects(dataService.completePlayerCardImportReceipt('pcs_1'), error => error && error.code === 'ACCOUNT_CONTEXT_REQUIRED')
  assert.deepEqual([calls.getReceipt.length, calls.beginReceipt.length, calls.completeReceipt.length], [0, 0, 0])
})

test('explicit receipt context keeps PLAYER-A ownership and rejects A-to-B and ABA completion', async () => {
  for (const aba of [false, true]) {
    resetStorage()
    let release
    let started
    const startedPromise = new Promise(resolve => { started = resolve })
    const cloudState = {
      available: true, failCreate: false, canonicalId: 'unused',
      getReceiptImpl() {
        started()
        return new Promise(resolve => { release = resolve })
      }
    }
    const calls = { create: [], update: [], getReceipt: [], beginReceipt: [], completeReceipt: [] }
    const dataService = loadDataService(cloudState, calls)
    dataService.updateProfile({ playerId: 'PLAYER-A' })
    const context = dataService.captureAccountContext()
    const reading = dataService.getPlayerCardImportReceipt('pcs_context', context)
    await startedPromise
    await dataService.switchToTestAccount()
    if (aba) await dataService.exitTestAccount()
    release({ receipt: null })

    await assert.rejects(reading, error => error && error.code === 'STALE_ACCOUNT_CONTEXT')
    assert.equal(calls.getReceipt[0].playerId, 'PLAYER-A')
  }
})

test('explicit player-note context never starts a cloud write for the account switched in before the local await resumes', async () => {
  resetStorage()
  const cloudState = { available: true, failCreate: false, canonicalId: 'unused' }
  const calls = { create: [], update: [], getReceipt: [], beginReceipt: [], completeReceipt: [] }
  const dataService = loadDataService(cloudState, calls)
  dataService.updateProfile({ playerId: 'PLAYER-A' })
  const context = dataService.captureAccountContext()
  const creating = dataService.createPlayerNote({ _id: 'note-context-a', name: 'A' }, {
    waitForCloud: true,
    accountContext: context
  })
  dataService.updateProfile({ playerId: 'PLAYER-B' })

  await assert.rejects(creating, error => error && error.code === 'STALE_ACCOUNT_CONTEXT')
  assert.equal(calls.create.length, 0)
})

test('updateProfile playerId ABA bumps the account epoch and never revives an old token', () => {
  resetStorage()
  const cloudState = { available: true, failCreate: false, canonicalId: 'unused' }
  const calls = { create: [], update: [], getReceipt: [], beginReceipt: [], completeReceipt: [] }
  const dataService = loadDataService(cloudState, calls)
  dataService.updateProfile({ playerId: 'PLAYER-A' })
  const context = dataService.captureAccountContext()
  dataService.updateProfile({ playerId: 'PLAYER-B' })
  dataService.updateProfile({ playerId: 'PLAYER-A' })
  assert.equal(dataService.isAccountContextCurrent(context), false)
})
