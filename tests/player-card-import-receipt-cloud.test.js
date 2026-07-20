const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

function createCloud(seed) {
  const collections = Object.assign({ player_card_import_receipts: [], sync_operations: [], audit_logs: [] }, seed || {})
  const transactionCalls = []
  const queryCalls = []
  function collection(name, inTransaction) {
    if (!collections[name]) collections[name] = []
    const query = { filters: {}, offset: 0, size: Infinity, orders: [], usedSkip: false }
    const api = {
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
          },
          async remove() {
            const index = collections[name].findIndex(item => item._id === id)
            if (index !== -1) collections[name].splice(index, 1)
          }
        }
      },
      where(filters) { query.filters = filters || {}; return api },
      orderBy(field, order) { query.orders.push([field, order]); return api },
      skip(value) { query.usedSkip = true; query.offset = Number(value) || 0; return api },
      limit(value) { query.size = Number(value) || 100; return api },
      async get() {
        queryCalls.push({ name, filters: query.filters, orders: query.orders.slice(), limit: query.size, usedSkip: query.usedSkip })
        const matches = collections[name].filter(item => Object.keys(query.filters).every(key => {
          const expected = query.filters[key]
          return expected && Object.prototype.hasOwnProperty.call(expected, '$gt') ? String(item[key] || '') > expected.$gt : item[key] === expected
        }))
        matches.sort((left, right) => query.orders.reduce((delta, pair) => delta || String(left[pair[0]] || '').localeCompare(String(right[pair[0]] || '')) * (pair[1] === 'desc' ? -1 : 1), 0))
        return { data: matches.slice(query.offset, query.offset + query.size) }
      },
      async add() { throw new Error('receipt actions must not add random documents') }
    }
    return api
  }
  return {
    collections,
    transactionCalls,
    queryCalls,
    database: {
      command: { gt(value) { return { $gt: String(value) } } },
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
      queryCalls: cloud.queryCalls,
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
  assert.ok(loaded.transactionCalls.some(call => call.name === 'poker_data_account_lifecycle'))
  assert.ok(loaded.transactionCalls.every(call => [
    'poker_data_account_lifecycle',
    'player_card_import_receipts'
  ].includes(call.name)))
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

test('clear_all_data removes every owned private payload while retaining redacted operation history', async () => {
  const owned = (_id, extra) => Object.assign({ _id, ownerOpenId: 'owner-a', playerId: 'WX-ME' }, extra || {})
  const foreign = (_id) => ({ _id, ownerOpenId: 'owner-b', playerId: 'WX-ME', secret: 'keep' })
  const businessCollections = [
    'sessions', 'hands', 'hand_actions', 'player_notes', 'player_card_import_receipts',
    'bankroll_logs', 'profiles', 'user_settings'
  ]
  const seed = {}
  businessCollections.forEach(name => { seed[name] = [owned(name + '-mine', { secret: name }), foreign(name + '-foreign')] })
  seed.sync_operations = [
    owned('sync-old', { action: 'update_hand', clientMutationId: 'old-1', status: 'completed', result: { hand: { cards: 'AA' } }, recoveryEvidence: { before: { cards: 'KK' } } }),
    foreign('sync-foreign')
  ]
  seed.audit_logs = [
    owned('audit-old', { action: 'update_hand', targetId: 'hand-1', before: { cards: 'KK' }, after: { cards: 'AA' } }),
    foreign('audit-foreign')
  ]
  const loaded = loadPokerData(seed)

  const result = await loaded.pokerData.main({ action: 'clear_all_data', playerId: 'WX-ME', clientMutationId: 'clear-1' })
  assert.deepEqual(result, { code: 0, data: { completed: true } })
  businessCollections.forEach(name => {
    assert.deepEqual(loaded.collections[name].map(item => item._id), [name + '-foreign'], name)
  })
  const syncOld = loaded.collections.sync_operations.find(item => item._id === 'sync-old')
  const auditOld = loaded.collections.audit_logs.find(item => item._id === 'audit-old')
  assert.equal(syncOld.action, 'update_hand')
  assert.equal(syncOld.clientMutationId, 'old-1')
  assert.equal('result' in syncOld, false)
  assert.equal('recoveryEvidence' in syncOld, false)
  assert.equal(auditOld.action, 'update_hand')
  assert.equal(auditOld.targetId, 'hand-1')
  assert.equal('before' in auditOld, false)
  assert.equal('after' in auditOld, false)
  assert.equal(loaded.collections.sync_operations.find(item => item._id === 'sync-foreign').secret, 'keep')
  assert.equal(loaded.collections.audit_logs.find(item => item._id === 'audit-foreign').secret, 'keep')

  assert.deepEqual(await loaded.pokerData.main({ action: 'clear_all_data', playerId: 'WX-ME', clientMutationId: 'clear-1' }), result)

  const receiptQueries = loaded.queryCalls.filter(call => call.name === 'player_card_import_receipts')
  assert.ok(receiptQueries.length >= 1)
  assert.ok(receiptQueries.every(call => call.usedSkip === false && call.limit === 100))
  assert.ok(receiptQueries.every(call => JSON.stringify(call.orders) === JSON.stringify([['_id', 'asc']])))
  assert.ok(receiptQueries.every(call => Object.keys(call.filters).sort().join(',') === '_id,ownerOpenId,playerId'))
  assert.ok(receiptQueries.every(call => call.filters.ownerOpenId === 'owner-a' && call.filters.playerId === 'WX-ME'))
  assert.ok(receiptQueries.every(call => !Object.prototype.hasOwnProperty.call(call.filters, '_openid')))
})
