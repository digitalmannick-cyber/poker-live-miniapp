const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

function createCloud(seed) {
  const collections = Object.assign({ player_card_import_receipts: [], sync_operations: [], audit_logs: [] }, seed || {})
  const transactionCalls = []
  function collection(name, inTransaction) {
    if (!collections[name]) collections[name] = []
    return {
      doc(id) {
        if (inTransaction) transactionCalls.push({ name, id })
        return {
          async get() {
            const found = collections[name].find(item => item._id === id)
            if (!found) throw new Error('not found')
            return { data: found }
          },
          async set({ data }) {
            const next = Object.assign({ _id: id }, data)
            const index = collections[name].findIndex(item => item._id === id)
            if (index === -1) collections[name].push(next)
            else collections[name][index] = next
          }
        }
      },
      where() { throw new Error('receipt actions must not query collections') },
      async add() { throw new Error('receipt actions must not add random documents') }
    }
  }
  return {
    collections,
    transactionCalls,
    database: {
      collection(name) { return collection(name, false) },
      async runTransaction(callback) {
        return callback({ collection(name) { return collection(name, true) } })
      }
    }
  }
}

function loadPokerData(seed) {
  const cloud = createCloud(seed)
  let ownerOpenId = 'owner-a'
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test', init() {}, database() { return cloud.database },
        getWXContext() { return { OPENID: ownerOpenId } }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const modulePath = require.resolve('../cloudfunctions/poker_data/index')
  delete require.cache[modulePath]
  try {
    return {
      pokerData: require('../cloudfunctions/poker_data/index'),
      collections: cloud.collections,
      transactionCalls: cloud.transactionCalls,
      setOwner(value) { ownerOpenId = value }
    }
  } finally { Module._load = originalLoad }
}

function beginEvent(overrides) {
  return Object.assign({
    action: 'begin_player_card_import_receipt', playerId: 'WX-ME', clientMutationId: 'begin-1',
    shareId: 'share-1', mode: 'new', targetPlayerNoteId: 'note-1'
  }, overrides || {})
}

test('begin receipt creates one deterministic owner-scoped pending document and point reads a safe DTO', async () => {
  const loaded = loadPokerData()
  const begun = await loaded.pokerData.main(beginEvent())
  assert.equal(begun.code, 0)
  assert.deepEqual(begun.data.receipt, { shareId: 'share-1', mode: 'new', targetPlayerNoteId: 'note-1', status: 'pending' })
  assert.equal(loaded.collections.player_card_import_receipts.length, 1)
  assert.match(loaded.collections.player_card_import_receipts[0]._id, /^[a-f0-9]{64}$/)
  assert.equal(loaded.collections.player_card_import_receipts[0].ownerOpenId, 'owner-a')
  assert.equal(loaded.collections.player_card_import_receipts[0].playerId, 'WX-ME')
  const read = await loaded.pokerData.main({ action: 'get_player_card_import_receipt', playerId: 'WX-ME', shareId: 'share-1' })
  assert.deepEqual(read, { code: 0, data: { receipt: begun.data.receipt } })
  assert.doesNotMatch(JSON.stringify(read), /owner-a|ownerOpenId|WX-ME|_id|clientMutationId/)
  assert.ok(loaded.transactionCalls.every(call => call.name === 'player_card_import_receipts'))
})

test('same share retries are idempotent but changing mode or target conflicts', async () => {
  const loaded = loadPokerData()
  const first = await loaded.pokerData.main(beginEvent())
  assert.deepEqual(await loaded.pokerData.main(beginEvent({ clientMutationId: 'begin-2' })), first)
  assert.equal(loaded.collections.player_card_import_receipts.length, 1)
  assert.equal((await loaded.pokerData.main(beginEvent({ clientMutationId: 'begin-3', mode: 'overwrite' }))).code, 'CONFLICT')
  assert.equal((await loaded.pokerData.main(beginEvent({ clientMutationId: 'begin-4', targetPlayerNoteId: 'note-2' }))).code, 'CONFLICT')
  assert.equal((await loaded.pokerData.main(beginEvent({ clientMutationId: '' }))).code, 'MISSING_CLIENT_MUTATION_ID')
})

test('complete changes only the matching receipt status and remains idempotent', async () => {
  const loaded = loadPokerData()
  await loaded.pokerData.main(beginEvent())
  const completed = await loaded.pokerData.main({
    action: 'complete_player_card_import_receipt', playerId: 'WX-ME', shareId: 'share-1', clientMutationId: 'complete-1'
  })
  assert.deepEqual(completed.data.receipt, { shareId: 'share-1', mode: 'new', targetPlayerNoteId: 'note-1', status: 'completed' })
  const retried = await loaded.pokerData.main({
    action: 'complete_player_card_import_receipt', playerId: 'WX-ME', shareId: 'share-1', clientMutationId: 'complete-2'
  })
  assert.deepEqual(retried, completed)
  assert.equal(loaded.collections.player_card_import_receipts.length, 1)
})

test('receipt point reads are isolated across owners and players', async () => {
  const loaded = loadPokerData()
  await loaded.pokerData.main(beginEvent())
  loaded.setOwner('owner-b')
  assert.deepEqual((await loaded.pokerData.main({ action: 'get_player_card_import_receipt', playerId: 'WX-ME', shareId: 'share-1' })).data, { receipt: null })
  loaded.setOwner('owner-a')
  assert.deepEqual((await loaded.pokerData.main({ action: 'get_player_card_import_receipt', playerId: 'WX-OTHER', shareId: 'share-1' })).data, { receipt: null })
})

test('two shares can complete independently while targeting the same player note', async () => {
  const loaded = loadPokerData()
  for (const shareId of ['share-1', 'share-2']) {
    await loaded.pokerData.main(beginEvent({ shareId, clientMutationId: 'begin-' + shareId, mode: 'overwrite', targetPlayerNoteId: 'same-player' }))
    await loaded.pokerData.main({ action: 'complete_player_card_import_receipt', playerId: 'WX-ME', shareId, clientMutationId: 'complete-' + shareId })
  }
  assert.equal(loaded.collections.player_card_import_receipts.length, 2)
  assert.ok(loaded.collections.player_card_import_receipts.every(item => item.status === 'completed' && item.targetPlayerNoteId === 'same-player'))
})
