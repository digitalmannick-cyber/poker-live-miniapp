const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const Module = require('node:module')

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key])
    return result
  }, {})
}

function mutationId(ownerOpenId, clientMutationId) {
  return 'sync_' + crypto.createHash('sha256').update(`${ownerOpenId}:${clientMutationId}`).digest('hex')
}

function mutationFingerprint(ownerOpenId, playerId, action, event) {
  return crypto.createHash('sha256').update(JSON.stringify([
    ownerOpenId,
    String(playerId || '').trim().toUpperCase(),
    action,
    canonicalize(event)
  ])).digest('hex')
}

function createFakeCloud(seed) {
  const tables = clone(Object.assign({
    sessions: [], hands: [], hand_actions: [], profiles: [], user_settings: [],
    bankroll_logs: [], player_notes: [], player_card_import_receipts: [],
    sync_operations: [], audit_logs: []
  }, seed || {}))
  const failures = []
  const afterWriteFailures = []
  const pauses = []
  const operations = []
  let autoId = 0
  let transactionTail = Promise.resolve()

  function rows(name, source) {
    const target = source || tables
    if (!target[name]) target[name] = []
    return target[name]
  }

  function takeFailure(operation, collection, input) {
    const index = failures.findIndex(item => item.operation === operation && item.collection === collection && item.remaining > 0 &&
      (!item.predicate || item.predicate(clone(input || {}))))
    if (index < 0) return null
    failures[index].remaining -= 1
    return failures[index].error
  }

  function takeAfterWriteFailure(operation, collection, input) {
    const index = afterWriteFailures.findIndex(item => item.operation === operation && item.collection === collection && item.remaining > 0 &&
      (!item.predicate || item.predicate(clone(input || {}))))
    if (index < 0) return null
    afterWriteFailures[index].remaining -= 1
    return afterWriteFailures[index].error
  }

  function takePause(operation, collection, input) {
    const index = pauses.findIndex(item => item.operation === operation && item.collection === collection &&
      (!item.predicate || item.predicate(clone(input || {}))))
    if (index < 0) return null
    return pauses.splice(index, 1)[0]
  }

  function collectionFor(name, source) {
    function query(filters, orders, offset, maximum) {
      const state = {
        filters: Object.assign({}, filters || {}),
        orders: (orders || []).slice(),
        offset: Number(offset) || 0,
        maximum: maximum == null ? Infinity : Number(maximum)
      }
      return {
        where(next) { return query(Object.assign({}, state.filters, next || {}), state.orders, state.offset, state.maximum) },
        orderBy(field, direction) { return query(state.filters, state.orders.concat([[field, direction]]), state.offset, state.maximum) },
        skip(value) { return query(state.filters, state.orders, value, state.maximum) },
        limit(value) { return query(state.filters, state.orders, state.offset, value) },
        async get() {
          await Promise.resolve()
          let result = rows(name, source).filter(row => Object.keys(state.filters).every(key => row && row[key] === state.filters[key]))
          for (let index = state.orders.length - 1; index >= 0; index -= 1) {
            const [field, direction] = state.orders[index]
            result = result.slice().sort((left, right) => {
              const order = left[field] === right[field] ? 0 : left[field] < right[field] ? -1 : 1
              return direction === 'desc' ? -order : order
            })
          }
          return { data: clone(result.slice(state.offset, state.offset + state.maximum)) }
        },
        async count() {
          const result = rows(name, source).filter(row => Object.keys(state.filters).every(key => row && row[key] === state.filters[key]))
          return { total: result.length }
        }
      }
    }

    return Object.assign(query(), {
      doc(id) {
        return {
          async get() {
            await Promise.resolve()
            const failure = takeFailure('get', name, { _id: id })
            if (failure) throw failure
            const found = rows(name, source).find(row => row && row._id === id)
            if (!found) {
              const error = new Error('document not found')
              error.code = '-502001'
              throw error
            }
            return { data: clone(found) }
          },
          async set(input) {
            operations.push({ operation: 'set', collection: name, id })
            const pause = takePause('set', name, input && input.data)
            if (pause) {
              pause.started.resolve()
              await pause.release.promise
            }
            const failure = takeFailure('set', name, input && input.data)
            if (failure) throw failure
            const next = Object.assign({ _id: id }, clone(input && input.data || {}))
            const index = rows(name, source).findIndex(row => row && row._id === id)
            if (index < 0) rows(name, source).push(next)
            else rows(name, source)[index] = next
            const afterWriteFailure = takeAfterWriteFailure('set', name, input && input.data)
            if (afterWriteFailure) throw afterWriteFailure
            await Promise.resolve()
            return { updated: 1 }
          },
          async update(input) {
            operations.push({ operation: 'update', collection: name, id })
            const failure = takeFailure('update', name, input && input.data)
            if (failure) throw failure
            const index = rows(name, source).findIndex(row => row && row._id === id)
            if (index < 0) throw new Error('document not found')
            rows(name, source)[index] = Object.assign({}, rows(name, source)[index], clone(input && input.data || {}), { _id: id })
            await Promise.resolve()
            return { updated: 1 }
          },
          async remove() {
            operations.push({ operation: 'remove', collection: name, id })
            const failure = takeFailure('remove', name)
            if (failure) throw failure
            const index = rows(name, source).findIndex(row => row && row._id === id)
            if (index >= 0) rows(name, source).splice(index, 1)
            await Promise.resolve()
            return { removed: index >= 0 ? 1 : 0 }
          }
        }
      },
      async add(input) {
        operations.push({ operation: 'add', collection: name })
        const failure = takeFailure('add', name)
        if (failure) throw failure
        const id = input && input.data && input.data._id || `auto_${++autoId}`
        rows(name, source).push(Object.assign({ _id: id }, clone(input && input.data || {})))
        await Promise.resolve()
        return { _id: id }
      }
    })
  }

  const database = {
    collection(name) { return collectionFor(name, tables) },
    async createCollection(name) { rows(name); return true },
    runTransaction(callback) {
      const operation = transactionTail.then(async () => {
        const draft = clone(tables)
        try {
          const result = await callback({ collection(name) { return collectionFor(name, draft) } })
          Object.keys(tables).forEach(key => delete tables[key])
          Object.assign(tables, draft)
          return result
        } catch (error) {
          if (error && error.afterCommit) {
            Object.keys(tables).forEach(key => delete tables[key])
            Object.assign(tables, draft)
          }
          throw error
        }
      })
      transactionTail = operation.then(() => undefined, () => undefined)
      return operation
    }
  }

  return {
    database,
    tables,
    operations,
    failNext(operation, collection, message) {
      const error = new Error(message || `injected ${operation} failure for ${collection}`)
      error.code = 'DATABASE_INTERNAL_ERROR'
      failures.push({ operation, collection, remaining: 1, error })
    },
    failNextMatching(operation, collection, predicate, message) {
      const error = new Error(message || `injected ${operation} failure for ${collection}`)
      error.code = 'DATABASE_INTERNAL_ERROR'
      failures.push({ operation, collection, remaining: 1, predicate, error })
    },
    failAfterNextMatching(operation, collection, predicate, message) {
      const error = new Error(message || `injected post-commit ${operation} failure for ${collection}`)
      error.code = 'DATABASE_INTERNAL_ERROR'
      error.afterCommit = true
      afterWriteFailures.push({ operation, collection, remaining: 1, predicate, error })
    },
    pauseNextMatching(operation, collection, predicate) {
      const control = { operation, collection, predicate, started: deferred(), release: deferred() }
      pauses.push(control)
      return control
    }
  }
}

function loadPokerData(seed) {
  const fake = createFakeCloud(seed)
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() { return fake.database },
        getWXContext() { return { OPENID: 'owner-a' } }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const modulePath = require.resolve('../cloudfunctions/poker_data/index')
  delete require.cache[modulePath]
  try {
    const pokerData = require('../cloudfunctions/poker_data/index')
    return Object.assign({ main: pokerData.main, __test: pokerData.__test }, fake)
  } finally {
    Module._load = originalLoad
  }
}

function session(id, overrides) {
  return Object.assign({
    _id: id,
    ownerOpenId: 'owner-a',
    playerId: 'PLAYER-A',
    title: 'Original',
    status: 'active',
    startTime: '2026-07-20 12:00',
    smallBlind: 10,
    bigBlind: 20,
    createdAt: 1,
    updatedAt: 1
  }, overrides || {})
}

function hand(id, overrides) {
  return Object.assign({
    _id: id,
    ownerOpenId: 'owner-a',
    playerId: 'PLAYER-A',
    sessionId: 'session-a',
    createdAt: 1,
    updatedAt: 1
  }, overrides || {})
}

function action(id, handId, overrides) {
  return Object.assign({
    _id: id,
    ownerOpenId: 'owner-a',
    playerId: 'PLAYER-A',
    sessionId: 'session-a',
    handId,
    sequence: 1,
    actionType: 'raise',
    createdAt: 1,
    updatedAt: 1
  }, overrides || {})
}

function syncReceipts(loaded, clientMutationId) {
  return loaded.tables.sync_operations.filter(row => row.clientMutationId === clientMutationId)
}

test('same mutation and input concurrent calls execute one business side effect and restore or report in progress', async () => {
  const loaded = loadPokerData()
  const event = {
    action: 'create_session',
    playerId: 'PLAYER-A',
    clientMutationId: 'concurrent-same',
    payload: { title: 'Only once', startTime: '2026-07-20 12:00', smallBlind: 10, bigBlind: 20 }
  }

  const results = await Promise.all([loaded.main(clone(event)), loaded.main(clone(event))])
  assert.equal(results.filter(result => result.code === 0).length >= 1, true)
  assert.ok(results.every(result => result.code === 0 || result.code === 'MUTATION_IN_PROGRESS'))
  assert.equal(loaded.tables.audit_logs.filter(row => row.action === 'create_session').length, 1)
  assert.equal(syncReceipts(loaded, event.clientMutationId).filter(row => row.status === 'completed').length, 1)
})

test('create_session cannot overwrite a foreign client-supplied document id', async () => {
  const foreign = session('foreign-session', { ownerOpenId: 'owner-b', playerId: 'PLAYER-B', title: 'Foreign' })
  const loaded = loadPokerData({ sessions: [foreign] })
  const created = await loaded.main({
    action: 'create_session', playerId: 'PLAYER-A', clientMutationId: 'safe-session-id',
    payload: { _id: foreign._id, title: 'Mine', status: 'finished' }
  })

  assert.equal(created.code, 0, JSON.stringify(created))
  assert.notEqual(created.data.session._id, foreign._id)
  assert.deepEqual(loaded.tables.sessions.find(row => row._id === foreign._id), foreign)

})

test('library create_player_note cannot overwrite a foreign client-supplied document id', async () => {
  const foreign = { _id: 'foreign-note', ownerOpenId: 'owner-b', playerId: 'PLAYER-B', name: 'Foreign', updatedAt: 1 }
  const loaded = loadPokerData({ player_notes: [foreign] })
  const created = await loaded.main({
    action: 'create_player_note', playerId: 'PLAYER-A', clientMutationId: 'safe-note-id',
    payload: { _id: foreign._id, name: 'Mine', sourceKind: 'library' }
  })

  assert.equal(created.code, 0, JSON.stringify(created))
  assert.notEqual(created.data.playerNote._id, foreign._id)
  assert.deepEqual(loaded.tables.player_notes.find(row => row._id === foreign._id), foreign)

})

test('finish_session cannot overwrite a foreign client-supplied bankroll log id', async () => {
  const foreign = { _id: 'foreign-bankroll', ownerOpenId: 'owner-b', playerId: 'PLAYER-B', amount: 999, updatedAt: 1 }
  const loaded = loadPokerData({ sessions: [session('session-a')], bankroll_logs: [foreign] })
  const finished = await loaded.main({
    action: 'finish_session', playerId: 'PLAYER-A', sessionId: 'session-a', clientMutationId: 'safe-bankroll-id',
    payload: { bankrollLogId: foreign._id, cashOut: 200 }
  })

  assert.equal(finished.code, 0, JSON.stringify(finished))
  assert.notEqual(finished.data.bankrollLog._id, foreign._id)
  assert.deepEqual(loaded.tables.bankroll_logs.find(row => row._id === foreign._id), foreign)

})

test('same mutation id with concurrent different action allows one winner and conflicts the other without foreign writes', async () => {
  const foreign = session('foreign-session', { ownerOpenId: 'owner-b', playerId: 'PLAYER-B', title: 'Foreign' })
  const loaded = loadPokerData({ sessions: [session('session-a'), foreign] })
  const clientMutationId = 'concurrent-action-conflict'
  const results = await Promise.all([
    loaded.main({ action: 'update_session', playerId: 'PLAYER-A', sessionId: 'session-a', patch: { title: 'Mine' }, clientMutationId }),
    loaded.main({ action: 'delete_session', playerId: 'PLAYER-A', sessionId: 'foreign-session', clientMutationId })
  ])

  assert.deepEqual(results.map(result => result.code).sort(), [0, 'MUTATION_CONFLICT'].sort())
  assert.deepEqual(loaded.tables.sessions.find(row => row._id === foreign._id), foreign)
  assert.equal(syncReceipts(loaded, clientMutationId).filter(row => row.status === 'completed').length, 1)
})

test('same mutation id with concurrent different input commits only one canonical input', async () => {
  const loaded = loadPokerData({ sessions: [session('session-a')] })
  const base = { action: 'update_session', playerId: 'PLAYER-A', sessionId: 'session-a', clientMutationId: 'concurrent-input-conflict' }
  const results = await Promise.all([
    loaded.main(Object.assign({}, base, { patch: { title: 'First' } })),
    loaded.main(Object.assign({}, base, { patch: { title: 'Second' } }))
  ])

  assert.deepEqual(results.map(result => result.code).sort(), [0, 'MUTATION_CONFLICT'].sort())
  const audits = loaded.tables.audit_logs.filter(row => row.action === 'update_session')
  assert.equal(audits.length, 1)
  assert.ok(['First', 'Second'].includes(audits[0].after.title))
})

test('pre-business handler failure leaves no completed receipt and the same input can retry', async () => {
  const loaded = loadPokerData({ sessions: [session('session-a')] })
  const event = {
    action: 'update_session', playerId: 'PLAYER-A', sessionId: 'session-a',
    patch: { title: 'Retry me' }, clientMutationId: 'handler-retry'
  }
  loaded.failNext('get', 'sessions')

  const failed = await loaded.main(clone(event))
  assert.notEqual(failed.code, 0)
  assert.equal(syncReceipts(loaded, event.clientMutationId).some(row => row.status === 'completed' || row.result), false)

  const retried = await loaded.main(clone(event))
  assert.equal(retried.code, 0, JSON.stringify(retried))
  assert.equal(syncReceipts(loaded, event.clientMutationId).filter(row => row.status === 'completed').length, 1)
  assert.equal(loaded.tables.audit_logs.filter(row => row.clientMutationId === event.clientMutationId).length, 1)
})

test('create_session repairs a failed completed receipt without rerunning durable business writes', async t => {
  const originalNow = Date.now
  let clock = 1_000
  Date.now = () => clock
  t.after(() => { Date.now = originalNow })
  const loaded = loadPokerData()
  const event = {
    action: 'create_session', playerId: 'PLAYER-A', clientMutationId: 'complete-create-repair',
    payload: { title: 'Durable once', status: 'finished' }
  }
  loaded.failNextMatching('set', 'sync_operations', data => data.status === 'completed')

  const failed = await loaded.main(clone(event))
  assert.equal(failed.code, 'POKER_DATA_ERROR')
  assert.equal(loaded.tables.sync_operations[0].status, 'applied')
  assert.ok(loaded.tables.sync_operations[0].result)
  const sessionWrites = loaded.operations.filter(row => row.operation === 'set' && row.collection === 'sessions').length
  const auditWrites = loaded.operations.filter(row => row.operation === 'set' && row.collection === 'audit_logs').length

  clock += 31_000
  const repaired = await loaded.main(clone(event))
  assert.equal(repaired.code, 0, JSON.stringify(repaired))
  assert.equal(loaded.tables.sessions.length, 1)
  assert.equal(loaded.tables.audit_logs.length, 1)
  assert.equal(loaded.operations.filter(row => row.operation === 'set' && row.collection === 'sessions').length, sessionWrites)
  assert.equal(loaded.operations.filter(row => row.operation === 'set' && row.collection === 'audit_logs').length, auditWrites)
  assert.equal(loaded.tables.sync_operations[0].status, 'completed')
})

test('an applied checkpoint response failure is retried idempotently without rerunning the handler', async () => {
  const loaded = loadPokerData()
  const event = {
    action: 'create_session', playerId: 'PLAYER-A', clientMutationId: 'applied-response-lost',
    payload: { title: 'Checkpoint once', status: 'finished' }
  }
  loaded.failAfterNextMatching('set', 'sync_operations', data => data.status === 'applied')

  const result = await loaded.main(clone(event))

  assert.equal(result.code, 0, JSON.stringify(result))
  assert.equal(loaded.tables.sessions.length, 1)
  assert.equal(loaded.tables.audit_logs.filter(row => row.action === 'create_session').length, 1)
  assert.equal(loaded.operations.filter(row => row.operation === 'set' && row.collection === 'sessions').length, 1)
  assert.equal(loaded.tables.sync_operations[0].status, 'completed')
})

test('double applied checkpoint failure recovers create and delete results without rerunning business', async t => {
  const originalNow = Date.now
  let clock = 1_000
  Date.now = () => clock
  t.after(() => { Date.now = originalNow })
  const cases = [
    {
      name: 'create_session',
      seed: {},
      event: {
        action: 'create_session', playerId: 'PLAYER-A', clientMutationId: 'double-stage-create',
        payload: { title: 'Created once', status: 'finished' }
      },
      businessWrites: loaded => loaded.operations.filter(row => row.operation === 'set' && row.collection === 'sessions').length,
      assertResult: result => assert.ok(result.data.session)
    },
    {
      name: 'delete_hand',
      seed: { sessions: [session('session-a')], hands: [hand('hand-a')], hand_actions: [action('action-a', 'hand-a')] },
      event: { action: 'delete_hand', playerId: 'PLAYER-A', handId: 'hand-a', clientMutationId: 'double-stage-delete-hand' },
      businessWrites: loaded => loaded.operations.filter(row => row.operation === 'remove' && ['hands', 'hand_actions'].includes(row.collection)).length,
      assertResult: result => assert.equal(result.data.deleted, true)
    },
    {
      name: 'delete_session',
      seed: { sessions: [session('session-a')] },
      event: { action: 'delete_session', playerId: 'PLAYER-A', sessionId: 'session-a', clientMutationId: 'double-stage-delete-session' },
      businessWrites: loaded => loaded.operations.filter(row => row.operation === 'remove' && row.collection === 'sessions').length,
      assertResult: result => assert.equal(result.data.deleted, true)
    }
  ]

  for (const item of cases) {
    await t.test(item.name, async () => {
      const loaded = loadPokerData(item.seed)
      loaded.failNextMatching('set', 'sync_operations', data => data.status === 'applied')
      loaded.failNextMatching('set', 'sync_operations', data => data.status === 'applied')
      const failed = await loaded.main(clone(item.event))
      assert.equal(failed.code, 'POKER_DATA_ERROR')
      const writes = item.businessWrites(loaded)
      clock += 31_000

      const recovered = await loaded.main(clone(item.event))
      assert.equal(recovered.code, 0, JSON.stringify(recovered))
      item.assertResult(recovered)
      assert.equal(item.businessWrites(loaded), writes)
      assert.equal(loaded.tables.audit_logs.filter(row => row.action === item.name).length, 1)
      assert.equal(loaded.tables.sync_operations[0].status, 'completed')
    })
  }
})

test('recovery point-read failure keeps the recovering claim and never falls back to the handler', async t => {
  const originalNow = Date.now
  let clock = 1_000
  Date.now = () => clock
  t.after(() => { Date.now = originalNow })
  const loaded = loadPokerData()
  const event = {
    action: 'create_session', playerId: 'PLAYER-A', clientMutationId: 'recovery-read-failure',
    payload: { title: 'Recover by evidence only', status: 'finished' }
  }
  loaded.failNextMatching('set', 'sync_operations', data => data.status === 'applied')
  loaded.failNextMatching('set', 'sync_operations', data => data.status === 'applied')

  const first = await loaded.main(clone(event))
  assert.equal(first.code, 'POKER_DATA_ERROR')
  const sessionWrites = loaded.operations.filter(row => row.operation === 'set' && row.collection === 'sessions').length
  clock += 31_000
  loaded.failNext('get', 'audit_logs')

  const recoveryReadFailed = await loaded.main(clone(event))
  assert.equal(recoveryReadFailed.code, 'POKER_DATA_ERROR')
  assert.equal(loaded.tables.sync_operations[0].status, 'pending')
  assert.equal(loaded.operations.filter(row => row.operation === 'set' && row.collection === 'sessions').length, sessionWrites)

  const stillLeased = await loaded.main(clone(event))
  assert.equal(stillLeased.code, 'MUTATION_IN_PROGRESS')
  clock += 31_000
  const recovered = await loaded.main(clone(event))
  assert.equal(recovered.code, 0, JSON.stringify(recovered))
  assert.equal(loaded.operations.filter(row => row.operation === 'set' && row.collection === 'sessions').length, sessionWrites)
})

test('double checkpoint recovery covers create update and upsert hand without advancing handVersion twice', async t => {
  const originalNow = Date.now
  let clock = 1_000
  Date.now = () => clock
  t.after(() => { Date.now = originalNow })
  const cases = [
    {
      name: 'create_hand',
      seed: { sessions: [session('session-a')] },
      event: {
        action: 'create_hand', playerId: 'PLAYER-A', clientMutationId: 'recover-create-hand',
        payload: { _id: 'created-hand', sessionId: 'session-a', title: 'Created', actions: [] }
      },
      handId: 'created-hand'
    },
    {
      name: 'update_hand',
      seed: { sessions: [session('session-a')], hands: [hand('updated-hand', { handVersion: 4 })] },
      event: {
        action: 'update_hand', playerId: 'PLAYER-A', clientMutationId: 'recover-update-hand',
        handId: 'updated-hand', patch: { title: 'Updated' }
      },
      handId: 'updated-hand'
    },
    {
      name: 'upsert_hand',
      seed: { sessions: [session('session-a')], hands: [hand('upserted-hand', { handVersion: 7 })] },
      event: {
        action: 'upsert_hand', playerId: 'PLAYER-A', clientMutationId: 'recover-upsert-hand',
        handId: 'upserted-hand', payload: { _id: 'upserted-hand', sessionId: 'session-a', title: 'Upserted' }
      },
      handId: 'upserted-hand'
    }
  ]

  for (const item of cases) {
    await t.test(item.name, async () => {
      const loaded = loadPokerData(item.seed)
      loaded.failNextMatching('set', 'sync_operations', data => data.status === 'applied')
      loaded.failNextMatching('set', 'sync_operations', data => data.status === 'applied')
      const first = await loaded.main(clone(item.event))
      assert.equal(first.code, 'POKER_DATA_ERROR')
      const version = loaded.tables.hands.find(row => row._id === item.handId).handVersion
      clock += 31_000

      const recovered = await loaded.main(clone(item.event))
      assert.equal(recovered.code, 0, JSON.stringify(recovered))
      assert.ok(recovered.data.hand)
      assert.equal(loaded.tables.hands.find(row => row._id === item.handId).handVersion, version)
      assert.equal(loaded.tables.audit_logs.filter(row => row.action === item.name).length, 1)
    })
  }
})

test('hand mutation recovery repairs deterministic session stats without rerunning hand or action writes', async t => {
  const baseSession = overrides => session('session-a', Object.assign({
    status: 'active', buyIn: 100, cashOut: 100, endingChips: 100,
    currentProfit: 0, totalProfit: 0, handCount: 0, updatedAt: 1
  }, overrides || {}))
  const cases = [
    {
      name: 'create_hand',
      seed: { sessions: [baseSession()] },
      event: {
        action: 'create_hand', playerId: 'PLAYER-A', clientMutationId: 'stats-recover-create',
        payload: { _id: 'stats-create-hand', sessionId: 'session-a', currentProfit: 50, actions: [action('create-action', 'stats-create-hand')] }
      },
      expected: { handCount: 1, currentProfit: 50, cashOut: 150 }, retryFailure: true
    },
    {
      name: 'update_hand',
      seed: {
        sessions: [baseSession({ handCount: 1, currentProfit: 10, cashOut: 110 })],
        hands: [hand('stats-update-hand', { currentProfit: 10, handVersion: 2 })],
        hand_actions: [action('old-update-action', 'stats-update-hand')]
      },
      event: {
        action: 'update_hand', playerId: 'PLAYER-A', handId: 'stats-update-hand', clientMutationId: 'stats-recover-update',
        patch: { currentProfit: 40, actions: [action('new-update-action', 'stats-update-hand')] }
      },
      expected: { handCount: 1, currentProfit: 40, cashOut: 140 }
    },
    {
      name: 'upsert_hand',
      seed: { sessions: [baseSession()] },
      event: {
        action: 'upsert_hand', playerId: 'PLAYER-A', handId: 'stats-upsert-hand', clientMutationId: 'stats-recover-upsert',
        payload: { _id: 'stats-upsert-hand', sessionId: 'session-a', currentProfit: 25, actions: [action('upsert-action', 'stats-upsert-hand')] }
      },
      expected: { handCount: 1, currentProfit: 25, cashOut: 125 }
    },
    {
      name: 'delete_hand',
      seed: {
        sessions: [baseSession({ handCount: 1, currentProfit: 50, cashOut: 150 })],
        hands: [hand('stats-delete-hand', { currentProfit: 50, handVersion: 3 })],
        hand_actions: [action('delete-action', 'stats-delete-hand')]
      },
      event: { action: 'delete_hand', playerId: 'PLAYER-A', handId: 'stats-delete-hand', clientMutationId: 'stats-recover-delete' },
      expected: { handCount: 0, currentProfit: 0, cashOut: 100 }
    }
  ]

  for (const item of cases) {
    await t.test(item.name, async () => {
      const loaded = loadPokerData(item.seed)
      loaded.failNext('set', 'sessions')
      const failed = await loaded.main(clone(item.event))
      assert.equal(failed.code, 'POKER_DATA_ERROR')
      const writes = loaded.operations.filter(row =>
        ['hands', 'hand_actions'].includes(row.collection) && ['set', 'remove'].includes(row.operation)).length
      const survivingHand = loaded.tables.hands.find(row => row._id === (item.event.handId || item.event.payload._id))
      const version = survivingHand && survivingHand.handVersion
      assert.equal(loaded.tables.sync_operations[0].status, 'pending')
      assert.equal(
        loaded.tables.sessions[0].handCount,
        ['update_hand', 'delete_hand'].includes(item.name) ? 1 : 0
      )

      if (item.retryFailure) {
        loaded.tables.sync_operations[0].leaseExpiresAt = 0
        loaded.failNext('set', 'sessions')
        const recoveryFailed = await loaded.main(clone(item.event))
        assert.equal(recoveryFailed.code, 'POKER_DATA_ERROR')
        assert.equal(loaded.tables.sync_operations[0].status, 'pending')
        assert.equal(loaded.operations.filter(row =>
          ['hands', 'hand_actions'].includes(row.collection) && ['set', 'remove'].includes(row.operation)).length, writes)
      }

      loaded.tables.sync_operations[0].leaseExpiresAt = 0
      const recovered = await loaded.main(clone(item.event))
      assert.equal(recovered.code, 0, JSON.stringify(recovered))
      const repaired = loaded.tables.sessions[0]
      assert.equal(repaired.handCount, item.expected.handCount)
      assert.equal(repaired.currentProfit, item.expected.currentProfit)
      assert.equal(repaired.cashOut, item.expected.cashOut)
      assert.equal(repaired.endingChips, item.expected.cashOut)
      assert.equal(repaired.totalProfit, item.expected.currentProfit)
      assert.ok(repaired.updatedAt > 1)
      assert.equal(loaded.operations.filter(row =>
        ['hands', 'hand_actions'].includes(row.collection) && ['set', 'remove'].includes(row.operation)).length, writes)
      const finalHand = loaded.tables.hands.find(row => row._id === (item.event.handId || item.event.payload._id))
      if (finalHand) assert.equal(finalHand.handVersion, version)
      assert.equal(loaded.tables.sync_operations[0].status, 'completed')
    })
  }
})

test('finish_session recovery never completes with an owner-correct stale deterministic bankroll record', async () => {
  const event = {
    action: 'finish_session', playerId: 'PLAYER-A', sessionId: 'session-a',
    payload: { cashOut: 200 }, clientMutationId: 'finish-stale-bankroll'
  }
  const loaded = loadPokerData({ sessions: [session('session-a', { buyIn: 100, cashOut: 0 })] })
  const bankrollId = loaded.__test.createMutationEntityId('bankroll', 'owner-a', 'PLAYER-A', 'finish_session', event.clientMutationId)
  loaded.tables.bankroll_logs.push({
    _id: bankrollId, ownerOpenId: 'owner-a', playerId: 'PLAYER-A', sessionId: 'session-a',
    type: 'session_settlement', amount: -999, note: 'stale owner-correct record', createdAt: 1, updatedAt: 1,
    lastClientMutationId: 'old', lastMutationAttemptId: 'old-attempt'
  })
  loaded.failNext('set', 'bankroll_logs')

  const failed = await loaded.main(clone(event))
  assert.equal(failed.code, 'POKER_DATA_ERROR')
  assert.equal(loaded.tables.sessions[0].status, 'finished')
  assert.equal(loaded.tables.bankroll_logs[0].amount, -999)
  assert.equal(loaded.tables.sync_operations[0].status, 'pending')
  assert.equal(loaded.tables.sync_operations[0].recoveryEvidence.bankrollLog.amount, 100)
  const sessionWrites = loaded.operations.filter(row => row.operation === 'set' && row.collection === 'sessions').length

  loaded.tables.sync_operations[0].leaseExpiresAt = 0
  loaded.failNext('set', 'bankroll_logs')
  const repairFailed = await loaded.main(clone(event))
  assert.equal(repairFailed.code, 'POKER_DATA_ERROR')
  assert.equal(loaded.tables.sync_operations[0].status, 'pending')
  assert.equal(loaded.tables.bankroll_logs[0].amount, -999)
  assert.equal(loaded.operations.filter(row => row.operation === 'set' && row.collection === 'sessions').length, sessionWrites)

  loaded.tables.sync_operations[0].leaseExpiresAt = 0
  const recovered = await loaded.main(clone(event))
  assert.equal(recovered.code, 0, JSON.stringify(recovered))
  assert.equal(loaded.tables.bankroll_logs[0].amount, 100)
  assert.equal(recovered.data.bankrollLog.amount, 100)
  assert.equal(Object.prototype.hasOwnProperty.call(recovered.data.bankrollLog, 'lastClientMutationId'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(recovered.data.bankrollLog, 'lastMutationAttemptId'), false)
  assert.equal(loaded.operations.filter(row => row.operation === 'set' && row.collection === 'sessions').length, sessionWrites)
  assert.equal(loaded.tables.sync_operations[0].status, 'completed')
})

test('finish_session actual audit recovery still repairs bankroll from matching WAL evidence', async t => {
  const originalNow = Date.now
  let clock = 1_000
  Date.now = () => clock
  t.after(() => { Date.now = originalNow })
  const event = {
    action: 'finish_session', playerId: 'PLAYER-A', sessionId: 'session-a',
    payload: { cashOut: 200 }, clientMutationId: 'finish-audit-stale-bankroll'
  }
  const loaded = loadPokerData({ sessions: [session('session-a', { buyIn: 100, cashOut: 0 })] })
  loaded.failNextMatching('set', 'sync_operations', data => data.status === 'applied')
  loaded.failNextMatching('set', 'sync_operations', data => data.status === 'applied')

  const failed = await loaded.main(clone(event))
  assert.equal(failed.code, 'POKER_DATA_ERROR')
  assert.equal(loaded.tables.audit_logs.filter(row => row.action === 'finish_session').length, 1)
  assert.equal(loaded.tables.sync_operations[0].status, 'pending')
  const expected = clone(loaded.tables.sync_operations[0].recoveryEvidence.bankrollLog)
  const bankroll = loaded.tables.bankroll_logs.find(row => row._id === expected._id)
  Object.assign(bankroll, {
    sessionId: 'different-session', amount: -777,
    lastClientMutationId: 'later-owned-sync', lastMutationAttemptId: 'later-attempt'
  })
  const sessionWrites = loaded.operations.filter(row => row.operation === 'set' && row.collection === 'sessions').length

  clock += 31_000
  const recovered = await loaded.main(clone(event))
  assert.equal(recovered.code, 0, JSON.stringify(recovered))
  const repaired = loaded.tables.bankroll_logs.find(row => row._id === expected._id)
  assert.equal(repaired.sessionId, 'session-a')
  assert.equal(repaired.amount, 100)
  assert.equal(repaired.lastClientMutationId, event.clientMutationId)
  assert.equal(repaired.lastMutationAttemptId, expected.lastMutationAttemptId)
  assert.equal(recovered.data.bankrollLog.sessionId, 'session-a')
  assert.equal(recovered.data.bankrollLog.amount, 100)
  assert.equal(loaded.operations.filter(row => row.operation === 'set' && row.collection === 'sessions').length, sessionWrites)
  assert.equal(loaded.tables.sync_operations[0].status, 'completed')
})

test('double checkpoint recovery also covers update and finish session plus create and update player note', async t => {
  const originalNow = Date.now
  let clock = 1_000
  Date.now = () => clock
  t.after(() => { Date.now = originalNow })
  const note = {
    _id: 'note-a', ownerOpenId: 'owner-a', playerId: 'PLAYER-A',
    name: 'Villain', sourceKind: 'library', createdAt: 1, updatedAt: 1
  }
  const cases = [
    {
      name: 'update_session', seed: { sessions: [session('session-a')] },
      event: { action: 'update_session', playerId: 'PLAYER-A', sessionId: 'session-a', patch: { title: 'Recovered update' }, clientMutationId: 'recover-update-session' },
      businessCount: loaded => loaded.operations.filter(row => row.operation === 'set' && row.collection === 'sessions').length,
      assertResult: result => assert.equal(result.data.session.title, 'Recovered update')
    },
    {
      name: 'finish_session', seed: { sessions: [session('session-a')] },
      event: { action: 'finish_session', playerId: 'PLAYER-A', sessionId: 'session-a', payload: { cashOut: 250 }, clientMutationId: 'recover-finish-session' },
      businessCount: loaded => loaded.operations.filter(row => row.operation === 'set' && ['sessions', 'bankroll_logs'].includes(row.collection)).length,
      assertResult: result => {
        assert.equal(result.data.session.status, 'finished')
        assert.ok(result.data.bankrollLog)
      }
    },
    {
      name: 'create_player_note', seed: {},
      event: { action: 'create_player_note', playerId: 'PLAYER-A', payload: { name: 'Created note', sourceKind: 'library' }, clientMutationId: 'recover-create-note' },
      businessCount: loaded => loaded.operations.filter(row => row.operation === 'set' && row.collection === 'player_notes').length,
      assertResult: result => assert.equal(result.data.playerNote.name, 'Created note')
    },
    {
      name: 'update_player_note', seed: { player_notes: [note] },
      event: { action: 'update_player_note', playerId: 'PLAYER-A', noteId: 'note-a', patch: { note: 'Recovered annotation' }, clientMutationId: 'recover-update-note' },
      businessCount: loaded => loaded.operations.filter(row => row.operation === 'set' && row.collection === 'player_notes').length,
      assertResult: result => assert.equal(result.data.playerNote.note, 'Recovered annotation')
    }
  ]

  for (const item of cases) {
    await t.test(item.name, async () => {
      const loaded = loadPokerData(item.seed)
      loaded.failNextMatching('set', 'sync_operations', data => data.status === 'applied')
      loaded.failNextMatching('set', 'sync_operations', data => data.status === 'applied')
      const failed = await loaded.main(clone(item.event))
      assert.equal(failed.code, 'POKER_DATA_ERROR')
      const writes = item.businessCount(loaded)
      clock += 31_000
      const recovered = await loaded.main(clone(item.event))
      assert.equal(recovered.code, 0, JSON.stringify(recovered))
      item.assertResult(recovered)
      assert.equal(item.businessCount(loaded), writes)
    })
  }
})

test('an unresolved recovery intent remains pending and never blindly reruns the handler', async () => {
  const event = {
    action: 'update_session', playerId: 'PLAYER-A', sessionId: 'session-a',
    patch: { title: 'Planned' }, clientMutationId: 'unresolved-recovery-intent'
  }
  const before = session('session-a')
  const after = session('session-a', { title: 'Planned', lastClientMutationId: event.clientMutationId })
  const current = session('session-a', { title: 'Concurrent change', updatedAt: 2 })
  const loaded = loadPokerData({
    sessions: [current],
    sync_operations: [{
      _id: mutationId('owner-a', event.clientMutationId), ownerOpenId: 'owner-a', playerId: 'PLAYER-A',
      clientMutationId: event.clientMutationId, action: event.action,
      inputFingerprint: mutationFingerprint('owner-a', 'PLAYER-A', event.action, event),
      status: 'pending', attemptId: 'expired', leaseExpiresAt: 1, createdAt: 1, updatedAt: 1,
      recoveryEvidence: {
        ownerOpenId: 'owner-a', playerId: 'PLAYER-A', clientMutationId: event.clientMutationId,
        auditAction: event.action, targetId: 'session-a', before, after
      }
    }]
  })

  const result = await loaded.main(clone(event))
  assert.equal(result.code, 'POKER_DATA_ERROR')
  assert.match(result.message, /recovery evidence is unresolved/)
  assert.equal(loaded.operations.filter(row => row.operation === 'set' && row.collection === 'sessions').length, 0)
  assert.equal(syncReceipts(loaded, event.clientMutationId)[0].status, 'pending')
})

test('consecutive deterministic audit failures retain WAL evidence and recover create and deletes without rerunning business', async t => {
  const originalNow = Date.now
  let clock = 1_000
  Date.now = () => clock
  t.after(() => { Date.now = originalNow })
  const cases = [
    {
      name: 'create_session', seed: {},
      event: {
        action: 'create_session', playerId: 'PLAYER-A', clientMutationId: 'audit-retry-create',
        payload: { title: 'Audit retry create', status: 'finished' }
      },
      businessCount: loaded => loaded.operations.filter(row => row.operation === 'set' && row.collection === 'sessions').length,
      assertResult: result => assert.ok(result.data.session)
    },
    {
      name: 'delete_hand',
      seed: { sessions: [session('session-a')], hands: [hand('audit-delete-hand')] },
      event: { action: 'delete_hand', playerId: 'PLAYER-A', handId: 'audit-delete-hand', clientMutationId: 'audit-retry-delete' },
      businessCount: loaded => loaded.operations.filter(row => row.operation === 'remove' && row.collection === 'hands').length,
      assertResult: result => assert.equal(result.data.deleted, true)
    },
    {
      name: 'delete_session',
      seed: { sessions: [session('audit-delete-session')] },
      event: { action: 'delete_session', playerId: 'PLAYER-A', sessionId: 'audit-delete-session', clientMutationId: 'audit-retry-delete-session' },
      businessCount: loaded => loaded.operations.filter(row => row.operation === 'remove' && row.collection === 'sessions').length,
      assertResult: result => assert.equal(result.data.deleted, true)
    }
  ]

  for (const item of cases) {
    await t.test(item.name, async () => {
      const loaded = loadPokerData(item.seed)
      loaded.failNext('set', 'audit_logs')
      loaded.failNext('set', 'audit_logs')
      const failed = await loaded.main(clone(item.event))
      assert.equal(failed.code, 'POKER_DATA_ERROR')
      assert.equal(item.businessCount(loaded), 1)
      const pending = syncReceipts(loaded, item.event.clientMutationId)[0]
      assert.equal(pending.status, 'pending')
      assert.equal(pending.recoveryEvidence.auditAction, item.name)

      clock += 31_000
      const recovered = await loaded.main(clone(item.event))
      assert.equal(recovered.code, 0, JSON.stringify(recovered))
      item.assertResult(recovered)
      assert.equal(item.businessCount(loaded), 1)
      assert.equal(loaded.tables.audit_logs.filter(row => row.clientMutationId === item.event.clientMutationId).length, 1)
      assert.equal(syncReceipts(loaded, item.event.clientMutationId)[0].status, 'completed')
    })
  }
})

test('failed write-ahead recovery intent performs no business write and the released mutation retries once safely', async () => {
  const loaded = loadPokerData()
  const event = {
    action: 'create_session', playerId: 'PLAYER-A', clientMutationId: 'wal-prewrite-failure',
    payload: { title: 'WAL before business', status: 'finished' }
  }
  loaded.failNextMatching('set', 'sync_operations', data => !!data.recoveryEvidence)

  const failed = await loaded.main(clone(event))
  assert.equal(failed.code, 'POKER_DATA_ERROR')
  assert.equal(loaded.tables.sessions.length, 0)
  assert.equal(syncReceipts(loaded, event.clientMutationId).length, 0)

  const retried = await loaded.main(clone(event))
  assert.equal(retried.code, 0, JSON.stringify(retried))
  assert.equal(loaded.tables.sessions.length, 1)
  assert.equal(loaded.operations.filter(row => row.operation === 'set' && row.collection === 'sessions').length, 1)
})

test('a stale attempt cannot prewrite after takeover or overwrite the active attempt evidence', async t => {
  const originalNow = Date.now
  let clock = 1_000
  Date.now = () => clock
  t.after(() => { Date.now = originalNow })
  const loaded = loadPokerData()
  const firstStarted = deferred()
  const allowFirstPrewrite = deferred()
  const secondPrewritten = deferred()
  const allowSecondBusiness = deferred()
  const event = { playerId: 'PLAYER-A', clientMutationId: 'stale-prewrite-attempt', payload: { value: 1 } }
  let firstBusinessWrites = 0
  let secondBusinessWrites = 0

  const first = loaded.__test.runMutation(event, 'owner-a', 'stale_prewrite', async (playerId, clientMutationId, writeRecoveryIntent) => {
    firstStarted.resolve()
    await allowFirstPrewrite.promise
    await writeRecoveryIntent({ auditAction: 'stale_prewrite', targetId: 'attempt-A', before: null, after: { value: 'A' } })
    firstBusinessWrites += 1
    return { winner: 'A' }
  })
  await firstStarted.promise
  clock += 31_000
  const second = loaded.__test.runMutation(event, 'owner-a', 'stale_prewrite', async (playerId, clientMutationId, writeRecoveryIntent) => {
    await writeRecoveryIntent({ auditAction: 'stale_prewrite', targetId: 'attempt-B', before: null, after: { value: 'B' } })
    secondPrewritten.resolve()
    await allowSecondBusiness.promise
    secondBusinessWrites += 1
    return { winner: 'B' }
  })
  await secondPrewritten.promise
  allowFirstPrewrite.resolve()

  await assert.rejects(first, /claim changed|attempt/i)
  assert.equal(firstBusinessWrites, 0)
  assert.equal(loaded.tables.sync_operations[0].recoveryEvidence.targetId, 'attempt-B')
  allowSecondBusiness.resolve()
  assert.deepEqual(await second, { code: 0, data: { winner: 'B' } })
  assert.equal(secondBusinessWrites, 1)
})

test('an in-flight fenced business transaction serializes a retry without a second business write', async t => {
  const originalNow = Date.now
  let clock = 1_000
  Date.now = () => clock
  t.after(() => { Date.now = originalNow })
  const loaded = loadPokerData({ sessions: [session('session-a')] })
  const event = {
    action: 'update_session', playerId: 'PLAYER-A', sessionId: 'session-a',
    patch: { title: 'Single writer' }, clientMutationId: 'prewritten-single-writer'
  }
  const pause = loaded.pauseNextMatching('set', 'sessions', () => true)
  const first = loaded.main(clone(event))
  await pause.started.promise
  clock += 31_000

  let secondSettled = false
  const secondPromise = loaded.main(clone(event)).finally(() => { secondSettled = true })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(secondSettled, false)
  pause.release.resolve()
  const completed = await first
  const second = await secondPromise
  assert.equal(completed.code, 0, JSON.stringify(completed))
  assert.ok(['POKER_DATA_ERROR', 'MUTATION_IN_PROGRESS'].includes(second.code))
  if (second.code === 'POKER_DATA_ERROR') assert.match(second.message, /claim changed|recovery evidence is unresolved/)
  assert.equal(loaded.tables.sessions[0].title, 'Single writer')
  assert.equal(loaded.operations.filter(row => row.operation === 'set' && row.collection === 'sessions').length, 1)
})

test('forged client mutation markers cannot turn a failed business write into false recovery success', async () => {
  const event = {
    action: 'update_session', playerId: 'PLAYER-A', sessionId: 'session-a',
    patch: { title: 'Actually persisted' }, clientMutationId: 'forged-marker-recovery'
  }
  const loaded = loadPokerData({
    sessions: [session('session-a', { lastClientMutationId: event.clientMutationId })]
  })
  loaded.failNext('set', 'sessions')
  const failed = await loaded.main(clone(event))
  assert.equal(failed.code, 'POKER_DATA_ERROR')
  assert.equal(loaded.tables.sessions[0].title, 'Original')
  loaded.tables.sync_operations[0].leaseExpiresAt = 0

  const retried = await loaded.main(clone(event))
  assert.equal(retried.code, 'POKER_DATA_ERROR')
  assert.match(retried.message, /recovery evidence is unresolved/)
  assert.equal(loaded.tables.sessions[0].title, 'Original')
  assert.equal(loaded.tables.sync_operations[0].status, 'pending')
  assert.equal(loaded.tables.audit_logs.length, 0)
})

test('sync_stats strips server-only mutation markers from imported sessions hands and player notes', async () => {
  const forged = { lastClientMutationId: 'client-forged', lastMutationAttemptId: 'attempt-forged' }
  const loaded = loadPokerData()
  const result = await loaded.main({
    action: 'sync_stats', playerId: 'PLAYER-A',
    backup: {
      sessions: [session('marker-session', Object.assign({ updatedAt: 10 }, forged))],
      hands: [hand('marker-hand', Object.assign({ sessionId: 'marker-session', updatedAt: 10 }, forged))],
      handActions: [],
      playerNotes: [Object.assign({
        _id: 'marker-note', name: 'Marker note', sourceKind: 'library', createdAt: 1, updatedAt: 10
      }, forged)],
      bankrollLogs: [Object.assign({ _id: 'marker-bankroll', amount: 10, createdAt: 1, updatedAt: 10 }, forged)]
    }
  })
  assert.equal(result.code, 0, JSON.stringify(result))
  for (const row of [loaded.tables.sessions[0], loaded.tables.hands[0], loaded.tables.player_notes[0], loaded.tables.bankroll_logs[0]]) {
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'lastClientMutationId'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'lastMutationAttemptId'), false)
  }
})

test('archived legacy friend note recovery uses its actual document id after consecutive audit failures', async t => {
  const originalNow = Date.now
  let clock = 1_000
  Date.now = () => clock
  t.after(() => { Date.now = originalNow })
  const legacy = {
    _id: 'legacy-friend-note', ownerOpenId: 'owner-a', playerId: 'PLAYER-A',
    name: 'Legacy friend', sourceKind: 'friend', linkedFriendUserId: 'friend-user-1',
    archived: true, note: 'keep me', createdAt: 1, updatedAt: 1
  }
  const loaded = loadPokerData({ player_notes: [legacy] })
  const event = {
    action: 'create_player_note', playerId: 'PLAYER-A', clientMutationId: 'recover-legacy-friend-note',
    payload: {
      _id: 'client-local-id', name: 'Legacy friend', sourceKind: 'friend',
      linkedFriendUserId: 'friend-user-1', updatedAt: 2
    }
  }
  loaded.failNext('set', 'audit_logs')
  loaded.failNext('set', 'audit_logs')
  const failed = await loaded.main(clone(event))
  assert.equal(failed.code, 'POKER_DATA_ERROR')
  assert.equal(loaded.tables.player_notes[0]._id, legacy._id)
  assert.equal(loaded.tables.player_notes[0].archived, false)
  const playerNoteWrites = loaded.operations.filter(row => row.operation === 'set' && row.collection === 'player_notes').length
  assert.equal(loaded.tables.sync_operations[0].recoveryEvidence.targetId, legacy._id)
  clock += 31_000

  const recovered = await loaded.main(clone(event))
  assert.equal(recovered.code, 0, JSON.stringify(recovered))
  assert.equal(recovered.data.playerNote._id, legacy._id)
  assert.equal(loaded.operations.filter(row => row.operation === 'set' && row.collection === 'player_notes').length, playerNoteWrites)
  assert.equal(loaded.tables.audit_logs.filter(row => row.clientMutationId === event.clientMutationId).length, 1)
})

test('every runMutation write entry fails closed without clientMutationId', async t => {
  const events = [
    { action: 'create_session', playerId: 'PLAYER-A', payload: { status: 'finished' } },
    { action: 'update_session', playerId: 'PLAYER-A', sessionId: 'session-a', patch: {} },
    { action: 'finish_session', playerId: 'PLAYER-A', sessionId: 'session-a', payload: {} },
    { action: 'create_hand', playerId: 'PLAYER-A', payload: { sessionId: 'session-a' } },
    { action: 'update_hand', playerId: 'PLAYER-A', handId: 'hand-a', patch: {} },
    { action: 'upsert_hand', playerId: 'PLAYER-A', handId: 'hand-a', payload: {} },
    { action: 'delete_hand', playerId: 'PLAYER-A', handId: 'hand-a' },
    { action: 'delete_session', playerId: 'PLAYER-A', sessionId: 'session-a' },
    { action: 'create_player_note', playerId: 'PLAYER-A', payload: { name: 'No id' } },
    { action: 'update_player_note', playerId: 'PLAYER-A', noteId: 'note-a', patch: {} },
    { action: 'delete_player_note', playerId: 'PLAYER-A', noteId: 'note-a' }
  ]
  for (const event of events) {
    await t.test(event.action, async () => {
      const loaded = loadPokerData()
      const result = await loaded.main(clone(event))
      assert.deepEqual(result, { code: 'MISSING_CLIENT_MUTATION_ID', message: 'missing clientMutationId' })
      assert.equal(loaded.tables.sync_operations.length, 0)
      assert.equal(loaded.tables.audit_logs.length, 0)
    })
  }
})

test('delete actions repair failed completed receipts without reinterpreting missing sources', async t => {
  const cases = [
    {
      action: 'delete_hand',
      event: { action: 'delete_hand', playerId: 'PLAYER-A', handId: 'hand-a', clientMutationId: 'complete-delete-hand-repair' },
      seed: { sessions: [session('session-a')], hands: [hand('hand-a')], hand_actions: [action('action-a', 'hand-a')] },
      missing: loaded => !loaded.tables.hands.some(row => row._id === 'hand-a')
    },
    {
      action: 'delete_session',
      event: { action: 'delete_session', playerId: 'PLAYER-A', sessionId: 'session-a', clientMutationId: 'complete-delete-session-repair' },
      seed: { sessions: [session('session-a')] },
      missing: loaded => !loaded.tables.sessions.some(row => row._id === 'session-a')
    }
  ]

  for (const item of cases) {
    await t.test(item.action, async () => {
      const loaded = loadPokerData(item.seed)
      loaded.failNextMatching('set', 'sync_operations', data => data.status === 'completed')
      const failed = await loaded.main(clone(item.event))
      assert.equal(failed.code, 'POKER_DATA_ERROR')
      assert.equal(item.missing(loaded), true)
      assert.equal(loaded.tables.sync_operations[0].status, 'applied')

      const repaired = await loaded.main(clone(item.event))
      assert.equal(repaired.code, 0, JSON.stringify(repaired))
      assert.equal(repaired.data.deleted, true)
      assert.equal(item.missing(loaded), true)
      assert.equal(loaded.tables.audit_logs.filter(row => row.action === item.action).length, 1)
      assert.equal(loaded.tables.sync_operations[0].status, 'completed')
    })
  }
})

test('a live handler heartbeat prevents lease takeover after thirty seconds', async t => {
  const originalNow = Date.now
  const originalSetInterval = global.setInterval
  const originalClearInterval = global.clearInterval
  let clock = 1_000
  let heartbeat = null
  Date.now = () => clock
  global.setInterval = callback => {
    heartbeat = callback
    return { unref() {} }
  }
  global.clearInterval = () => {}
  t.after(() => {
    Date.now = originalNow
    global.setInterval = originalSetInterval
    global.clearInterval = originalClearInterval
  })
  const loaded = loadPokerData()
  const started = deferred()
  const release = deferred()
  const event = { playerId: 'PLAYER-A', clientMutationId: 'long-live-handler', payload: { value: 1 } }
  let handlerCalls = 0
  const handler = async () => {
    handlerCalls += 1
    started.resolve()
    await release.promise
    return { ok: true }
  }

  const first = loaded.__test.runMutation(event, 'owner-a', 'slow_operation', handler)
  await started.promise
  clock += 31_000
  assert.equal(typeof heartbeat, 'function')
  await heartbeat()
  const second = await loaded.__test.runMutation(event, 'owner-a', 'slow_operation', handler)
  assert.equal(second.code, 'MUTATION_IN_PROGRESS')
  release.resolve()
  assert.deepEqual(await first, { code: 0, data: { ok: true } })
  assert.equal(handlerCalls, 1)
})

test('an expired pending mutation lease can be taken over by the exact same input', async () => {
  const event = {
    action: 'update_session', playerId: 'PLAYER-A', sessionId: 'session-a',
    patch: { title: 'Lease repaired' }, clientMutationId: 'expired-lease'
  }
  const receiptId = mutationId('owner-a', event.clientMutationId)
  const loaded = loadPokerData({
    sessions: [session('session-a')],
    sync_operations: [{
      _id: receiptId,
      ownerOpenId: 'owner-a',
      playerId: 'PLAYER-A',
      action: event.action,
      clientMutationId: event.clientMutationId,
      inputFingerprint: mutationFingerprint('owner-a', 'PLAYER-A', event.action, event),
      status: 'pending',
      leaseToken: 'expired-owner',
      leaseExpiresAt: 1,
      createdAt: 1,
      updatedAt: 1
    }]
  })

  const result = await loaded.main(clone(event))
  assert.equal(result.code, 0, JSON.stringify(result))
  const receipt = loaded.tables.sync_operations.find(row => row._id === receiptId)
  assert.equal(receipt.status, 'completed')
  assert.ok(receipt.result)
  assert.notEqual(receipt.leaseToken, 'expired-owner')
})

test('delete_hand fails closed on a non-not-found remove error without a success receipt or continuation', async () => {
  const loaded = loadPokerData({
    sessions: [session('session-a')],
    hands: [hand('hand-a')],
    hand_actions: [action('action-a', 'hand-a')]
  })
  const event = { action: 'delete_hand', playerId: 'PLAYER-A', handId: 'hand-a', clientMutationId: 'delete-hand-failure' }
  loaded.failNext('remove', 'hand_actions')

  const result = await loaded.main(event)
  assert.notEqual(result.code, 0)
  assert.ok(loaded.tables.hands.some(row => row._id === 'hand-a'))
  assert.equal(loaded.operations.some(row => row.operation === 'remove' && row.collection === 'hands'), false)
  assert.equal(syncReceipts(loaded, event.clientMutationId).some(row => row.status === 'completed' || row.result), false)
  assert.equal(loaded.tables.audit_logs.length, 0)
})

test('delete_session stops after a non-not-found child remove error and stores no success receipt', async () => {
  const loaded = loadPokerData({
    sessions: [session('session-a')],
    hands: [hand('hand-a')],
    hand_actions: [action('action-a', 'hand-a')],
    bankroll_logs: [{ _id: 'bank-a', ownerOpenId: 'owner-a', playerId: 'PLAYER-A', sessionId: 'session-a', amount: 100 }]
  })
  const event = { action: 'delete_session', playerId: 'PLAYER-A', sessionId: 'session-a', clientMutationId: 'delete-session-failure' }
  loaded.failNext('remove', 'hands')

  const result = await loaded.main(event)
  assert.notEqual(result.code, 0)
  assert.ok(loaded.tables.sessions.some(row => row._id === 'session-a'))
  assert.ok(loaded.tables.bankroll_logs.some(row => row._id === 'bank-a'))
  const failedHandRemove = loaded.operations.findIndex(row => row.operation === 'remove' && row.collection === 'hands')
  assert.ok(failedHandRemove >= 0)
  const businessCollections = new Set(['hands', 'hand_actions', 'bankroll_logs', 'sessions'])
  assert.equal(loaded.operations.slice(failedHandRemove + 1).some(row => row.operation === 'remove' && businessCollections.has(row.collection)), false)
  assert.equal(syncReceipts(loaded, event.clientMutationId).some(row => row.status === 'completed' || row.result), false)
})

test('sync_stats fails closed before foreign session, player note, or bankroll ids can be overwritten', async () => {
  const foreignRows = {
    sessions: [session('shared-session', { ownerOpenId: 'owner-b', playerId: 'PLAYER-B', title: 'Foreign session' })],
    player_notes: [{ _id: 'shared-note', ownerOpenId: 'owner-b', playerId: 'PLAYER-B', name: 'Foreign note', updatedAt: 1 }],
    bankroll_logs: [{ _id: 'shared-bank', ownerOpenId: 'owner-b', playerId: 'PLAYER-B', amount: 999, updatedAt: 1 }]
  }
  const loaded = loadPokerData(foreignRows)
  const before = clone(foreignRows)

  const result = await loaded.main({
    action: 'sync_stats',
    playerId: 'PLAYER-A',
    backup: {
      profile: { playerId: 'PLAYER-A' },
      sessions: [{ _id: 'shared-session', title: 'Stolen', updatedAt: 2 }],
      playerNotes: [{ _id: 'shared-note', name: 'Stolen', updatedAt: 2 }],
      bankrollLogs: [{ _id: 'shared-bank', amount: 1, updatedAt: 2 }]
    }
  })

  assert.notEqual(result.code, 0)
  assert.deepEqual(loaded.tables.sessions, before.sessions)
  assert.deepEqual(loaded.tables.player_notes, before.player_notes)
  assert.deepEqual(loaded.tables.bankroll_logs, before.bankroll_logs)
})

test('sync_stats returns HAND_SOURCE_UPDATING when an owned source hand is pending', async () => {
  const pending = 'a'.repeat(64)
  const original = hand('hand-pending', { actionRevision: 'b'.repeat(64), actionRevisionPending: pending })
  const loaded = loadPokerData({ sessions: [session('session-a')], hands: [original] })

  const result = await loaded.main({
    action: 'sync_stats',
    playerId: 'PLAYER-A',
    backup: { profile: { playerId: 'PLAYER-A' }, hands: [{ _id: 'hand-pending', sessionId: 'session-a', updatedAt: 2 }] }
  })

  assert.equal(result.code, 'HAND_SOURCE_UPDATING')
  assert.deepEqual(loaded.tables.hands.find(row => row._id === original._id), original)
})

function loadCloudRepoWithoutTransactions(seed) {
  const fake = createFakeCloud(seed)
  const database = {
    collection: fake.database.collection.bind(fake.database),
    createCollection: fake.database.createCollection.bind(fake.database)
  }
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (parent && /services[\\/]cloud-repo\.js$/.test(parent.filename || '')) {
      if (request === '../utils/cloud') return { getDb: () => database }
      if (request === '../utils/store') {
        return {
          getProfile: () => ({ playerId: 'PLAYER-A' }),
          getDefaultSettings: () => ({}),
          getBankrollInitial: () => 0
        }
      }
      if (request === '../utils/session-rules') return { assertCanCreateSession() {} }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const modulePath = require.resolve('../services/cloud-repo')
  delete require.cache[modulePath]
  try {
    return Object.assign({ repository: require('../services/cloud-repo') }, fake)
  } finally {
    Module._load = originalLoad
  }
}

test('client cloud repository refuses an unsafe hand write without transactions and leaves no partial rows', async () => {
  const loaded = loadCloudRepoWithoutTransactions({
    sessions: [{ _id: 'session-a', playerId: 'PLAYER-A', status: 'active', smallBlind: 10, bigBlind: 20, handCount: 0 }]
  })

  await assert.rejects(
    loaded.repository.createHand({
      _id: 'client-hand',
      sessionId: 'session-a',
      heroCardsInput: 'AsKd',
      actions: [{ street: 'preflop', actorSeat: 1, actorLabel: 'Hero', actionType: 'raise', amount: 60 }]
    }),
    /transaction|cloud function|server-authoritative|unsupported|unavailable|required/i
  )

  assert.deepEqual(loaded.tables.hands, [])
  assert.deepEqual(loaded.tables.hand_actions, [])
  assert.equal(loaded.operations.some(row => ['hands', 'hand_actions'].includes(row.collection) && row.operation !== 'get'), false)
})

function loadDataServiceForMutationRetry(state) {
  const originalLoad = Module._load
  const storeAdapter = {
    getSessions: () => clone(state.backup.sessions || []),
    getProfile: () => ({ playerId: 'PLAYER-A' }),
    exportBackup: () => clone(state.backup),
    importBackup(next) { state.backup = clone(next) }
  }
  Module._load = function load(request, parent, isMain) {
    if (parent && /services[\\/]data-service\.js$/.test(parent.filename || '')) {
      if (request === '../utils/store') return storeAdapter
      if (request === './cloud-repo') return {}
      if (request === '../utils/cloud') return { canUseCloud: () => true }
      if (request === '../utils/session-rules') return { assertCanCreateSession() {} }
      if (request === './social-service') return { scheduleMyStatsSync: async () => true }
      if (request === './cloud-data-api') {
        return {
          async createSession(input) {
            state.calls.push(clone(input))
            if (state.failNext) {
              state.failNext = false
              throw new Error('injected network failure')
            }
            return { session: Object.assign({ _id: 'session-authoritative', playerId: input.playerId }, clone(input.payload)) }
          }
        }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const modulePath = require.resolve('../services/data-service')
  delete require.cache[modulePath]
  try {
    return require('../services/data-service')
  } finally {
    Module._load = originalLoad
  }
}

test('data service persists a canonical mutation id across failure and restart, then clears it after authoritative success', async t => {
  const storage = {}
  const previousWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) { storage[key] = clone(value) },
    removeStorageSync(key) { delete storage[key] },
    cloud: { callFunction: async () => ({ result: {} }) }
  }
  t.after(() => {
    global.wx = previousWx
    delete require.cache[require.resolve('../services/data-service')]
  })
  const state = { backup: { sessions: [], hands: [], handActions: [], playerNotes: [], bankrollLogs: [] }, calls: [], failNext: true }
  const payload = { title: 'Restart-safe', status: 'finished', startTime: '2026-07-20 12:00', endTime: '2026-07-20 13:00' }

  const firstService = loadDataServiceForMutationRetry(state)
  await assert.rejects(firstService.createSession(clone(payload)), /injected network failure/)
  const firstMutationId = state.calls[0].clientMutationId
  assert.match(firstMutationId, /\S/)
  assert.match(JSON.stringify(storage), new RegExp(firstMutationId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  const restartedService = loadDataServiceForMutationRetry(state)
  const created = await restartedService.createSession(clone(payload))
  assert.equal(created._id, 'session-authoritative')
  assert.equal(state.calls[1].clientMutationId, firstMutationId)
  assert.doesNotMatch(JSON.stringify(storage), new RegExp(firstMutationId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('every data-service authoritative mutation uses the stable outbox and no client cloud-repo write bypass remains', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const source = fs.readFileSync(path.join(__dirname, '../services/data-service.js'), 'utf8')
  const lines = source.split(/\r?\n/)
  const mutationMethods = new Set([
    'createSession', 'updateSession', 'finishSession',
    'createHand', 'updateHand', 'upsertHand',
    'deleteHand', 'deleteSession',
    'createPlayerNote', 'updatePlayerNote', 'deletePlayerNote'
  ])
  const dispatcherStart = lines.findIndex(line => /function invokeCloudMutationRecord\(/.test(line))
  const dispatcherEnd = lines.findIndex((line, index) => index > dispatcherStart && /function reconcileCloudMutationResult\(/.test(line))
  const directCalls = []
  lines.forEach((line, index) => {
    const matches = line.matchAll(/cloudDataApi\.([A-Za-z0-9_]+)\s*\(/g)
    for (const match of matches) {
      if (!mutationMethods.has(match[1])) continue
      const nearby = lines.slice(Math.max(0, index - 5), index + 1).join('\n')
      const centralizedReplay = dispatcherStart >= 0 && index > dispatcherStart && index < dispatcherEnd
      directCalls.push({ method: match[1], line: index + 1, wrapped: nearby.includes('runAuthoritativeMutation(') || centralizedReplay })
    }
  })

  const unwrapped = directCalls.filter(call => !call.wrapped).map(call => `${call.method}@${call.line}`)
  assert.deepEqual(unwrapped, [], `direct cloud mutations bypass stable outbox: ${unwrapped.join(', ')}`)
  assert.match(source, /function\s+runAuthoritativeMutation\s*\(/)
  assert.match(source, /getOrCreateCloudMutation\s*\(/)
  assert.match(source, /function\s+invokeCloudMutationRecord\s*\(/)

  const bannedBypasses = Array.from(source.matchAll(/cloudRepo\.(seedBusinessData|replaceBusinessData|createSession|updateSession|finishSession|createHand|updateHand|replaceActions|deleteHand|deleteSession)\s*\(/g))
    .map(match => `${match[1]}@${source.slice(0, match.index).split(/\r?\n/).length}`)
  assert.deepEqual(bannedBypasses, [], `client cloud-repo write bypasses remain: ${bannedBypasses.join(', ')}`)
})

test('client cloud-repo has no Node crypto dependency or executable transaction-based hand writer', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const source = fs.readFileSync(path.join(__dirname, '../services/cloud-repo.js'), 'utf8')

  assert.doesNotMatch(source, /require\(\s*['"](?:node:)?crypto['"]\s*\)/)
  assert.doesNotMatch(source, /\.runTransaction\s*\(/)
})
