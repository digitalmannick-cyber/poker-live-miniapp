const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

function clone(value) { return JSON.parse(JSON.stringify(value)) }

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function createDatabase(seed) {
  const tables = clone(seed || {})
  let transactionTail = Promise.resolve()
  let failRemoveCollection = ''
  function collectionFor(source, name) {
    const rows = () => source[name] || (source[name] = [])
    return {
      doc(id) {
        return {
          async get() {
            const row = rows().find(item => item._id === id)
            if (!row) {
              const error = new Error('not found')
              error.errCode = 'DATABASE_DOCUMENT_NOT_EXIST'
              throw error
            }
            return { data: clone(row) }
          },
          async set(input) {
            const next = Object.assign({ _id: id }, clone(input && input.data || {}))
            const index = rows().findIndex(item => item._id === id)
            if (index < 0) rows().push(next)
            else rows()[index] = next
          },
          async remove() {
            if (failRemoveCollection === name) {
              failRemoveCollection = ''
              throw new Error('injected remove failure')
            }
            const index = rows().findIndex(item => item._id === id)
            if (index >= 0) rows().splice(index, 1)
          }
        }
      },
      where(filters) {
        const query = {
          orderBy() { return query }, skip() { return query }, limit() { return query },
          async get() {
            return { data: clone(rows().filter(row => Object.keys(filters || {}).every(key => {
              const expected = filters[key]
              return expected && Object.prototype.hasOwnProperty.call(expected, '$gt')
                ? String(row[key] || '') > String(expected.$gt)
                : row[key] === expected
            }))) }
          },
          async count() { return { total: rows().length } }
        }
        return query
      },
      async add(input) {
        const id = 'generated-' + (rows().length + 1)
        rows().push(Object.assign({ _id: id }, clone(input && input.data || {})))
        return { _id: id }
      }
    }
  }
  return {
    command: { gt(value) { return { $gt: value } } },
    collection(name) { return collectionFor(tables, name) },
    runTransaction(callback) {
      const operation = transactionTail.then(async () => {
        const draft = clone(tables)
        const result = await callback({ collection(name) { return collectionFor(draft, name) } })
        for (const key of Object.keys(tables)) delete tables[key]
        for (const [key, value] of Object.entries(draft)) tables[key] = value
        return result
      })
      transactionTail = operation.then(() => undefined, () => undefined)
      return operation
    },
    failNextRemove(name) { failRemoveCollection = name },
    dump() { return clone(tables) }
  }
}

function createInterleavingDatabase(seed) {
  const tables = clone(seed || {})
  const lifecycleLocks = new Map()
  let pausedQuery = null
  let pausedDocGet = null

  async function acquireLifecycleLock(id, transaction) {
    if (!transaction || transaction.locked.has(id)) return
    let lock = lifecycleLocks.get(id)
    if (!lock) {
      lock = { held: false, waiters: [] }
      lifecycleLocks.set(id, lock)
    }
    if (lock.held) await new Promise(resolve => lock.waiters.push(resolve))
    lock.held = true
    transaction.locked.add(id)
    transaction.releases.push(() => {
      const next = lock.waiters.shift()
      if (next) next()
      else lock.held = false
    })
  }

  function collectionFor(name, transaction) {
    const rows = () => tables[name] || (tables[name] = [])
    const queryState = { filters: {}, orders: [], offset: 0, limit: Infinity }
    const api = {
      doc(id) {
        return {
          async get() {
            if (pausedDocGet && pausedDocGet.name === name && pausedDocGet.id === id) {
              pausedDocGet.seen += 1
              if (pausedDocGet.seen === pausedDocGet.occurrence) {
                const pause = pausedDocGet
                pausedDocGet = null
                pause.started.resolve()
                await pause.release.promise
              }
            }
            if (name === 'poker_data_account_lifecycle') await acquireLifecycleLock(id, transaction)
            const row = rows().find(item => item._id === id)
            if (!row) {
              const error = new Error('not found')
              error.errCode = 'DATABASE_DOCUMENT_NOT_EXIST'
              throw error
            }
            return { data: clone(row) }
          },
          async set(input) {
            if (name === 'poker_data_account_lifecycle') await acquireLifecycleLock(id, transaction)
            const next = Object.assign({ _id: id }, clone(input && input.data || {}))
            const index = rows().findIndex(item => item._id === id)
            if (index < 0) rows().push(next)
            else rows()[index] = next
          },
          async remove() {
            if (name === 'poker_data_account_lifecycle') await acquireLifecycleLock(id, transaction)
            const index = rows().findIndex(item => item._id === id)
            if (index >= 0) rows().splice(index, 1)
          }
        }
      },
      where(filters) { queryState.filters = Object.assign({}, filters || {}); return api },
      orderBy(field, direction) { queryState.orders.push([field, direction]); return api },
      skip(value) { queryState.offset = Number(value) || 0; return api },
      limit(value) { queryState.limit = Number(value) || 100; return api },
      async get() {
        if (pausedQuery && pausedQuery.name === name && Object.keys(pausedQuery.filters).every(key => queryState.filters[key] === pausedQuery.filters[key])) {
          const pause = pausedQuery
          pausedQuery = null
          pause.started.resolve()
          await pause.release.promise
        }
        let result = rows().filter(row => Object.keys(queryState.filters).every(key => row[key] === queryState.filters[key]))
        for (let index = queryState.orders.length - 1; index >= 0; index -= 1) {
          const [field, direction] = queryState.orders[index]
          result = result.slice().sort((left, right) => (left[field] === right[field] ? 0 : left[field] < right[field] ? -1 : 1) * (direction === 'desc' ? -1 : 1))
        }
        return { data: clone(result.slice(queryState.offset, queryState.offset + queryState.limit)) }
      },
      async count() { return { total: rows().filter(row => Object.keys(queryState.filters).every(key => row[key] === queryState.filters[key])).length } },
      async add(input) {
        const id = 'generated-' + (rows().length + 1)
        rows().push(Object.assign({ _id: id }, clone(input && input.data || {})))
        return { _id: id }
      }
    }
    return api
  }

  return {
    command: { gt(value) { return { $gt: value } } },
    collection(name) { return collectionFor(name, null) },
    async runTransaction(callback) {
      const transaction = { locked: new Set(), releases: [] }
      try {
        return await callback({ collection(name) { return collectionFor(name, transaction) } })
      } finally {
        transaction.releases.reverse().forEach(release => release())
      }
    },
    pauseNextQuery(name, filters) {
      pausedQuery = { name, filters: Object.assign({}, filters), started: deferred(), release: deferred() }
      return pausedQuery
    },
    pauseDocGet(name, id, occurrence) {
      pausedDocGet = { name, id, occurrence, seen: 0, started: deferred(), release: deferred() }
      return pausedDocGet
    },
    dump() { return clone(tables) }
  }
}

function loadPokerData(database) {
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'wx-server-sdk') return {
      DYNAMIC_CURRENT_ENV: 'test', init() {}, database() { return database },
      getWXContext() { return { OPENID: 'owner-a' } }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const modulePath = require.resolve('../cloudfunctions/poker_data/index')
  delete require.cache[modulePath]
  try { return require('../cloudfunctions/poker_data/index') }
  finally { Module._load = originalLoad }
}

test('generation fence rejects old writes during and after clear while a new generation writes normally', async () => {
  const database = createDatabase()
  const lifecycle = loadPokerData(database).__test
  const oldFence = await lifecycle.captureAccountLifecycle('owner-a', 'PLAYER-A')
  assert.equal(oldFence.generation, 0)

  await lifecycle.runFencedBusinessTransaction(oldFence, transaction => {
    return transaction.collection('sessions').doc('before-clear').set({ data: { playerId: 'PLAYER-A' } })
  })
  const clearFence = await lifecycle.beginAccountClear('owner-a', 'PLAYER-A', 'clear-1')
  assert.equal(clearFence.generation, 1)

  await assert.rejects(
    lifecycle.runFencedBusinessTransaction(oldFence, transaction => {
      return transaction.collection('sessions').doc('during-clear').set({ data: { playerId: 'PLAYER-A' } })
    }),
    error => error && error.code === 'ACCOUNT_DATA_NOT_ACTIVE'
  )
  await lifecycle.completeAccountClear(clearFence)
  await assert.rejects(
    lifecycle.runFencedBusinessTransaction(oldFence, transaction => {
      return transaction.collection('sessions').doc('after-clear').set({ data: { playerId: 'PLAYER-A' } })
    }),
    error => error && error.code === 'ACCOUNT_DATA_GENERATION_CHANGED'
  )

  const nextFence = await lifecycle.captureAccountLifecycle('owner-a', 'PLAYER-A')
  assert.equal(nextFence.generation, 1)
  await lifecycle.runFencedBusinessTransaction(nextFence, transaction => {
    return transaction.collection('sessions').doc('new-generation').set({ data: { playerId: 'PLAYER-A' } })
  })
  assert.deepEqual(database.dump().sessions.map(row => row._id), ['before-clear', 'new-generation'])
})

test('same clear mutation resumes one generation and competing clear cannot overtake it', async () => {
  const database = createDatabase()
  const lifecycle = loadPokerData(database).__test
  const first = await lifecycle.beginAccountClear('owner-a', 'PLAYER-A', 'clear-1')
  const retry = await lifecycle.beginAccountClear('owner-a', 'PLAYER-A', 'clear-1')
  assert.deepEqual(retry, first)
  await assert.rejects(
    lifecycle.beginAccountClear('owner-a', 'PLAYER-A', 'clear-2'),
    error => error && error.code === 'ACCOUNT_CLEAR_IN_PROGRESS'
  )
  await lifecycle.completeAccountClear(first)
  const restored = await lifecycle.beginAccountClear('owner-a', 'PLAYER-A', 'clear-1')
  assert.equal(restored.completed, true)
  assert.equal(restored.generation, 1)
})

test('every poker_data business write action is captured by the generation fence before its handler runs', async () => {
  const database = createDatabase()
  const pokerData = loadPokerData(database)
  const lifecycle = pokerData.__test
  const playerId = lifecycle.createOpenIdPlayerId('owner-a')
  const expectedWriteActions = [
    'login_account', 'sync_stats', 'save_settings', 'backfill_session_durations',
    'begin_player_card_import_receipt', 'complete_player_card_import_receipt',
    'create_player_note', 'update_player_note', 'delete_player_note',
    'create_session', 'update_session', 'finish_session',
    'create_hand', 'update_hand', 'upsert_hand', 'delete_hand', 'delete_session'
  ]
  assert.deepEqual(lifecycle.BUSINESS_WRITE_ACTIONS, expectedWriteActions)
  await lifecycle.beginAccountClear('owner-a', playerId, 'clear-matrix')

  for (const action of expectedWriteActions) {
    const before = database.dump()
    const result = await pokerData.main({
      action, playerId, currentPlayerId: playerId, clientMutationId: 'blocked-' + action,
      dryRun: false, profile: { playerId, name: 'blocked' }, settings: { theme: 'blocked' },
      backup: { profile: { playerId, name: 'blocked' }, sessions: [{ _id: 'blocked-session' }] },
      payload: { _id: 'blocked-doc', name: 'blocked', sessionId: 'blocked-session' },
      sessionId: 'blocked-session', handId: 'blocked-hand', noteId: 'blocked-note',
      shareId: 'blocked-share', mode: 'new', targetPlayerNoteId: 'blocked-note'
    })
    assert.equal(result.code, 'ACCOUNT_DATA_NOT_ACTIVE', action)
    assert.deepEqual(database.dump(), before, action + ' must make zero writes while clearing')
  }
})

test('request-scoped fence context isolates concurrent account generations', async () => {
  const database = createDatabase()
  const lifecycle = loadPokerData(database).__test
  const fenceA = await lifecycle.captureAccountLifecycle('owner-a', 'PLAYER-A')
  const fenceB = await lifecycle.captureAccountLifecycle('owner-a', 'PLAYER-B')
  let releaseA
  const gateA = new Promise(resolve => { releaseA = resolve })
  let observedA
  const operationA = lifecycle.runWithBusinessFence(fenceA, async () => {
    await gateA
    observedA = lifecycle.currentBusinessFence()
  })
  const operationB = lifecycle.runWithBusinessFence(fenceB, async () => {
    assert.equal(lifecycle.currentBusinessFence().playerId, 'PLAYER-B')
    releaseA()
  })
  await Promise.all([operationA, operationB])
  assert.equal(observedA.playerId, 'PLAYER-A')
  assert.equal(lifecycle.currentBusinessFence(), null)
})

test('a target write transaction validates every captured migration source fence', async () => {
  const database = createDatabase()
  const lifecycle = loadPokerData(database).__test
  const targetFence = await lifecycle.captureAccountLifecycle('owner-a', 'TARGET-A')
  await lifecycle.runWithBusinessFence(targetFence, async () => {
    await lifecycle.addBusinessFence('owner-a', 'SOURCE-A')
    await lifecycle.beginAccountClear('owner-a', 'SOURCE-A', 'clear-source-before-target-write')
    await assert.rejects(
      lifecycle.setDocById('sessions', 'target-write', { ownerOpenId: 'owner-a', playerId: 'TARGET-A' }),
      error => error && error.code === 'ACCOUNT_DATA_NOT_ACTIVE'
    )
  })
  assert.equal((database.dump().sessions || []).length, 0)
})

test('actual low-level, hand-stage, and receipt writes re-read the captured generation in their write transaction', async () => {
  const database = createDatabase({
    sessions: [{ _id: 'session-1', ownerOpenId: 'owner-a', playerId: 'PLAYER-A' }]
  })
  const pokerData = loadPokerData(database)
  const lifecycle = pokerData.__test
  const oldFence = await lifecycle.captureAccountLifecycle('owner-a', 'PLAYER-A')
  await lifecycle.beginAccountClear('owner-a', 'PLAYER-A', 'clear-write-surfaces')

  await assert.rejects(
    lifecycle.runWithBusinessFence(oldFence, () => lifecycle.setDocById(
      'sessions', 'late-session', { ownerOpenId: 'owner-a', playerId: 'PLAYER-A' }
    )),
    error => error && ['ACCOUNT_DATA_NOT_ACTIVE', 'ACCOUNT_DATA_GENERATION_CHANGED'].includes(error.code)
  )
  await assert.rejects(
    lifecycle.runWithBusinessFence(oldFence, () => lifecycle.claimHandActionRevision(
      'late-hand', 'PLAYER-A', 'owner-a', 'a'.repeat(64),
      { _id: 'late-hand', ownerOpenId: 'owner-a', playerId: 'PLAYER-A', sessionId: 'session-1' }, true
    )),
    error => error && ['ACCOUNT_DATA_NOT_ACTIVE', 'ACCOUNT_DATA_GENERATION_CHANGED'].includes(error.code)
  )
  const receipt = await lifecycle.runWithBusinessFence(oldFence, () => pokerData.main({
    action: 'begin_player_card_import_receipt', playerId: 'PLAYER-A', clientMutationId: 'late-receipt',
    shareId: 'share-late', mode: 'new', targetPlayerNoteId: 'note-late'
  }))
  assert.ok(['ACCOUNT_DATA_NOT_ACTIVE', 'ACCOUNT_DATA_GENERATION_CHANGED'].includes(receipt.code))

  const dump = database.dump()
  assert.equal((dump.sessions || []).some(row => row._id === 'late-session'), false)
  assert.equal((dump.hands || []).some(row => row._id === 'late-hand'), false)
  assert.equal((dump.player_card_import_receipts || []).length, 0)
})

test('business collection helpers fail closed without a captured generation', async () => {
  const database = createDatabase({
    sessions: [{ _id: 'owned', ownerOpenId: 'owner-a', playerId: 'PLAYER-A' }]
  })
  const lifecycle = loadPokerData(database).__test
  await assert.rejects(
    lifecycle.setDocById('sessions', 'unfenced', { ownerOpenId: 'owner-a', playerId: 'PLAYER-A' }),
    error => error && error.code === 'ACCOUNT_LIFECYCLE_INVALID'
  )
  await assert.rejects(
    lifecycle.removeDocById('sessions', 'owned'),
    error => error && error.code === 'ACCOUNT_LIFECYCLE_INVALID'
  )
  assert.equal((database.dump().sessions || []).some(row => row._id === 'unfenced'), false)
  assert.equal((database.dump().sessions || []).some(row => row._id === 'owned'), true)
})

test('sync_stats without an explicit player still captures the OpenID player before reading a meaningful backup', async () => {
  const database = createDatabase()
  const pokerData = loadPokerData(database)
  const playerId = pokerData.__test.createOpenIdPlayerId('owner-a')
  await pokerData.__test.beginAccountClear('owner-a', playerId, 'clear-missing-player-sync')
  const before = database.dump()
  const result = await pokerData.main({
    action: 'sync_stats',
    backup: { profile: { name: 'legacy-local' }, sessions: [{ _id: 'must-not-write', title: 'old' }] }
  })
  assert.equal(result.code, 'ACCOUNT_DATA_NOT_ACTIVE')
  assert.deepEqual(database.dump(), before)
})

test('login after the OpenID target was cleared does not auto-recover a legacy player backup', async () => {
  const database = createDatabase({
    profiles: [{ _id: 'legacy-profile', ownerOpenId: 'owner-a', playerId: 'LEGACY-A', name: 'legacy' }],
    sessions: [{ _id: 'legacy-session', ownerOpenId: 'owner-a', playerId: 'LEGACY-A', title: 'old' }],
    sync_operations: [], audit_logs: []
  })
  const pokerData = loadPokerData(database)
  const targetPlayerId = pokerData.__test.createOpenIdPlayerId('owner-a')
  await pokerData.main({ action: 'clear_all_data', playerId: targetPlayerId, clientMutationId: 'clear-target-before-login' })

  const login = await pokerData.main({ action: 'login_account', includeBackup: true, backup: {} })
  assert.equal(login.code, 0)
  assert.equal(login.data.accountPlayerId, targetPlayerId)
  assert.equal(login.data.hasHistory, false)
  assert.equal(login.data.recoveredPlayerId, '')
  assert.deepEqual(login.data.candidates, [])
  assert.equal(login.data.backup, null)
  assert.equal((database.dump().sessions || []).some(row => row.playerId === targetPlayerId), false)
})

test('sync_stats after target clear never falls back to an intact legacy player', async () => {
  const database = createDatabase({
    profiles: [{ _id: 'legacy-profile', ownerOpenId: 'owner-a', playerId: 'LEGACY-A', name: 'legacy' }],
    sessions: [{ _id: 'legacy-session', ownerOpenId: 'owner-a', playerId: 'LEGACY-A', title: 'old', durationMinutes: 120 }],
    hands: [{ _id: 'legacy-hand', ownerOpenId: 'owner-a', playerId: 'LEGACY-A', sessionId: 'legacy-session' }],
    sync_operations: [], audit_logs: []
  })
  const pokerData = loadPokerData(database)
  const targetPlayerId = pokerData.__test.createOpenIdPlayerId('owner-a')
  await pokerData.main({ action: 'clear_all_data', playerId: targetPlayerId, clientMutationId: 'clear-target-before-sync' })
  const before = database.dump()

  const result = await pokerData.main({ action: 'sync_stats', playerId: targetPlayerId, backup: {} })
  assert.equal(result.code, 0)
  assert.equal(result.data.resolvedPlayerId, targetPlayerId)
  assert.deepEqual(result.data.sessions, [])
  assert.deepEqual(result.data.hands, [])
  assert.equal(JSON.stringify(result.data).includes('legacy-session'), false)
  assert.equal(JSON.stringify(result.data).includes('legacy-hand'), false)
  assert.deepEqual(database.dump().sessions, before.sessions)
  assert.deepEqual(database.dump().hands, before.hands)
})

test('sync_stats fails closed when a selected recovery source is clearing', async () => {
  const database = createDatabase({
    profiles: [{ _id: 'source-profile', ownerOpenId: 'owner-a', playerId: 'SOURCE-A', name: 'source' }],
    sessions: [{ _id: 'source-session', ownerOpenId: 'owner-a', playerId: 'SOURCE-A', title: 'old' }]
  })
  const pokerData = loadPokerData(database)
  await pokerData.__test.beginAccountClear('owner-a', 'SOURCE-A', 'clear-source-during-sync')
  const sessionsBefore = clone(database.dump().sessions)

  const result = await pokerData.main({ action: 'sync_stats', playerId: 'TARGET-A', backup: {} })
  assert.equal(result.code, 'ACCOUNT_DATA_NOT_ACTIVE')
  assert.deepEqual(database.dump().sessions, sessionsBefore)
})

test('sync_stats revalidates a captured source when clear interleaves on a per-account transaction lock', async () => {
  const database = createInterleavingDatabase({
    profiles: [{ _id: 'source-profile', ownerOpenId: 'owner-a', playerId: 'SOURCE-A', name: 'source' }],
    sessions: [{ _id: 'source-session', ownerOpenId: 'owner-a', playerId: 'SOURCE-A', title: 'old' }]
  })
  const pokerData = loadPokerData(database)
  const pause = database.pauseNextQuery('sessions', { playerId: 'SOURCE-A', ownerOpenId: 'owner-a' })
  const syncPromise = pokerData.main({ action: 'sync_stats', playerId: 'TARGET-A', backup: {} })
  await pause.started.promise

  const clearFence = await pokerData.__test.beginAccountClear('owner-a', 'SOURCE-A', 'interleaved-source-clear')
  assert.equal(clearFence.generation, 1)
  pause.release.resolve()

  const result = await syncPromise
  assert.equal(result.code, 'ACCOUNT_DATA_NOT_ACTIVE')
  assert.deepEqual(database.dump().sessions, [
    { _id: 'source-session', ownerOpenId: 'owner-a', playerId: 'SOURCE-A', title: 'old' }
  ])
})

test('first login does not migrate a captured legacy source when its clear interleaves', async () => {
  const database = createInterleavingDatabase({
    profiles: [{ _id: 'source-profile', ownerOpenId: 'owner-a', playerId: 'SOURCE-A', name: 'source' }],
    sessions: [{ _id: 'source-session', ownerOpenId: 'owner-a', playerId: 'SOURCE-A', title: 'old' }],
    user_settings: [{ _id: 'source-settings', ownerOpenId: 'owner-a', playerId: 'SOURCE-A', theme: 'legacy' }]
  })
  const pokerData = loadPokerData(database)
  const pause = database.pauseNextQuery('sessions', { playerId: 'SOURCE-A', ownerOpenId: 'owner-a' })
  const loginPromise = pokerData.main({ action: 'login_account', includeBackup: true, backup: {} })
  await pause.started.promise

  await pokerData.__test.beginAccountClear('owner-a', 'SOURCE-A', 'interleaved-login-source-clear')
  pause.release.resolve()
  const result = await loginPromise
  assert.equal(result.code, 'ACCOUNT_DATA_NOT_ACTIVE')
  const targetPlayerId = pokerData.__test.createOpenIdPlayerId('owner-a')
  assert.equal((database.dump().profiles || []).some(row => row.playerId === targetPlayerId), false)
  assert.equal((database.dump().user_settings || []).some(row => row.playerId === targetPlayerId), false)
})

test('a legacy mutation restore is rejected when clear starts before its final generation validation', async () => {
  const database = createInterleavingDatabase({ sync_operations: [] })
  const pokerData = loadPokerData(database)
  const event = {
    action: 'create_session', playerId: 'PLAYER-A', clientMutationId: 'legacy-restore-race',
    payload: { title: 'must not restore' }
  }
  const legacyId = pokerData.__test.getLegacySyncOperationDocumentId('owner-a', event.clientMutationId)
  await database.collection('sync_operations').doc(legacyId).set({ data: {
    ownerOpenId: 'owner-a', playerId: 'PLAYER-A', clientMutationId: event.clientMutationId,
    action: event.action,
    inputFingerprint: pokerData.__test.createMutationInputFingerprint('owner-a', 'PLAYER-A', event.action, event),
    status: 'completed', result: { session: { _id: 'legacy-result' } }
  } })
  const lifecycleId = pokerData.__test.getAccountLifecycleDocumentId('owner-a', 'PLAYER-A')
  const pause = database.pauseDocGet('poker_data_account_lifecycle', lifecycleId, 3)
  const restorePromise = pokerData.main(clone(event))
  await pause.started.promise

  await pokerData.__test.beginAccountClear('owner-a', 'PLAYER-A', 'clear-during-legacy-restore')
  pause.release.resolve()
  const result = await restorePromise
  assert.equal(result.code, 'ACCOUNT_DATA_NOT_ACTIVE')
  assert.equal((database.dump().sessions || []).length, 0)
})

test('a current mutation restore is rejected when clear starts before its final generation validation', async () => {
  const database = createInterleavingDatabase({ sync_operations: [] })
  const pokerData = loadPokerData(database)
  const event = {
    action: 'create_session', playerId: 'PLAYER-A', clientMutationId: 'current-restore-race',
    payload: { title: 'must not restore' }
  }
  const docId = pokerData.__test.getSyncOperationDocumentId('owner-a', event.clientMutationId)
  await database.collection('sync_operations').doc(docId).set({ data: {
    ownerOpenId: 'owner-a', playerId: 'PLAYER-A', clientMutationId: event.clientMutationId,
    action: event.action,
    inputFingerprint: pokerData.__test.createMutationInputFingerprint('owner-a', 'PLAYER-A', event.action, event),
    status: 'completed', attemptId: 'completed-attempt', result: { session: { _id: 'current-result' } }
  } })
  const lifecycleId = pokerData.__test.getAccountLifecycleDocumentId('owner-a', 'PLAYER-A')
  const pause = database.pauseDocGet('poker_data_account_lifecycle', lifecycleId, 4)
  const restorePromise = pokerData.main(clone(event))
  await pause.started.promise

  await pokerData.__test.beginAccountClear('owner-a', 'PLAYER-A', 'clear-during-current-restore')
  pause.release.resolve()
  const result = await restorePromise
  assert.equal(result.code, 'ACCOUNT_DATA_NOT_ACTIVE')
  assert.equal((database.dump().sessions || []).length, 0)
})

test('expired recovery claim rejects a cleared captured generation without rewriting its payload', async () => {
  const evidence = { before: { title: 'before' }, after: { title: 'after' }, nested: { keep: true } }
  const database = createDatabase({ sync_operations: [] })
  const lifecycle = loadPokerData(database).__test
  const docId = lifecycle.getSyncOperationDocumentId('owner-a', 'claim-race')
  await database.collection('sync_operations').doc(docId).set({ data: {
    ownerOpenId: 'owner-a', playerId: 'PLAYER-A', clientMutationId: 'claim-race',
    action: 'create_session', inputFingerprint: 'fingerprint', status: 'pending', attemptId: 'attempt-old',
    leaseExpiresAt: 1, recoveryEvidence: evidence
  } })
  const fence = await lifecycle.captureAccountLifecycle('owner-a', 'PLAYER-A')
  const before = clone(database.dump().sync_operations[0])
  await lifecycle.beginAccountClear('owner-a', 'PLAYER-A', 'clear-before-expired-claim')

  await assert.rejects(
    lifecycle.runWithBusinessFence(fence, () => lifecycle.claimSyncOperation(
      'owner-a', 'PLAYER-A', 'claim-race', 'create_session', 'fingerprint'
    )),
    error => error && error.code === 'ACCOUNT_DATA_NOT_ACTIVE'
  )
  assert.deepEqual(database.dump().sync_operations[0], before)
})

test('expired recovery claim remains functional while active and preserves recovery evidence', async () => {
  const evidence = { before: { title: 'before' }, after: { title: 'after' }, nested: { keep: true } }
  const database = createDatabase({ sync_operations: [] })
  const lifecycle = loadPokerData(database).__test
  const docId = lifecycle.getSyncOperationDocumentId('owner-a', 'claim-active')
  await database.collection('sync_operations').doc(docId).set({ data: {
    ownerOpenId: 'owner-a', playerId: 'PLAYER-A', clientMutationId: 'claim-active',
    action: 'create_session', inputFingerprint: 'fingerprint', status: 'pending', attemptId: 'attempt-old',
    leaseExpiresAt: 1, recoveryEvidence: evidence
  } })
  const fence = await lifecycle.captureAccountLifecycle('owner-a', 'PLAYER-A')
  const outcome = await lifecycle.runWithBusinessFence(fence, () => lifecycle.claimSyncOperation(
    'owner-a', 'PLAYER-A', 'claim-active', 'create_session', 'fingerprint'
  ))
  assert.equal(outcome.kind, 'execute')
  assert.equal(outcome.recovering, true)
  assert.deepEqual(database.dump().sync_operations[0].recoveryEvidence, evidence)
})

test('renew with recovery evidence rejects a cleared generation and active renew preserves payload', async () => {
  const evidence = { before: { value: 1 }, after: { value: 2 } }
  const seed = {
    _id: 'renew-doc', ownerOpenId: 'owner-a', playerId: 'PLAYER-A', clientMutationId: 'renew-race',
    action: 'create_session', status: 'pending', attemptId: 'attempt-renew', leaseExpiresAt: 1,
    recoveryEvidence: evidence
  }
  const database = createDatabase({ sync_operations: [seed] })
  const lifecycle = loadPokerData(database).__test
  const fence = await lifecycle.captureAccountLifecycle('owner-a', 'PLAYER-A')
  const claim = { docId: 'renew-doc', attemptId: 'attempt-renew', clearMode: false }
  assert.equal(await lifecycle.runWithBusinessFence(fence, () => lifecycle.renewSyncOperationClaim(claim)), true)
  assert.deepEqual(database.dump().sync_operations[0].recoveryEvidence, evidence)

  const beforeClearAttempt = clone(database.dump().sync_operations[0])
  await lifecycle.beginAccountClear('owner-a', 'PLAYER-A', 'clear-before-renew')
  await assert.rejects(
    lifecycle.runWithBusinessFence(fence, () => lifecycle.renewSyncOperationClaim(claim)),
    error => error && error.code === 'ACCOUNT_DATA_NOT_ACTIVE'
  )
  assert.deepEqual(database.dump().sync_operations[0], beforeClearAttempt)
})

test('clear_all_data advances once, converges in clearing mode, and a new active-generation login can write', async () => {
  const database = createDatabase({
    sync_operations: [], audit_logs: []
  })
  const pokerData = loadPokerData(database)
  const playerId = pokerData.__test.createOpenIdPlayerId('owner-a')
  const owned = { ownerOpenId: 'owner-a', playerId }
  await database.collection('sessions').doc('session-old').set({ data: owned })
  await database.collection('profiles').doc('profile-old').set({ data: Object.assign({ name: 'old' }, owned) })
  const first = await pokerData.main({ action: 'clear_all_data', playerId, clientMutationId: 'clear-main-1' })
  assert.deepEqual(first, { code: 0, data: { completed: true } })
  assert.deepEqual(database.dump().sessions || [], [])
  assert.deepEqual(database.dump().profiles || [], [])
  const lifecycleId = pokerData.__test.getAccountLifecycleDocumentId('owner-a', playerId)
  const afterClear = (database.dump().poker_data_account_lifecycle || []).find(row => row._id === lifecycleId)
  assert.equal(afterClear.state, 'active')
  assert.equal(afterClear.generation, 1)

  assert.deepEqual(await pokerData.main({ action: 'clear_all_data', playerId, clientMutationId: 'clear-main-1' }), first)
  assert.equal((database.dump().poker_data_account_lifecycle || []).find(row => row._id === lifecycleId).generation, 1)

  const login = await pokerData.main({
    action: 'login_account', profile: { playerId, name: 'fresh' }, backup: {}
  })
  assert.equal(login.code, 0)
  assert.equal((database.dump().profiles || []).some(row => row.playerId === playerId && row.name === 'fresh'), true)
})

test('failed clear remains clearing, blocks normal writes, and the same mutation resumes without another generation', async () => {
  const database = createDatabase({ sync_operations: [], audit_logs: [] })
  const pokerData = loadPokerData(database)
  const playerId = pokerData.__test.createOpenIdPlayerId('owner-a')
  await database.collection('sessions').doc('session-old').set({ data: { ownerOpenId: 'owner-a', playerId } })
  database.failNextRemove('sessions')

  const failed = await pokerData.main({ action: 'clear_all_data', playerId, clientMutationId: 'clear-resume-1' })
  assert.equal(failed.code, 'POKER_DATA_ERROR')
  const lifecycleId = pokerData.__test.getAccountLifecycleDocumentId('owner-a', playerId)
  const clearing = (database.dump().poker_data_account_lifecycle || []).find(row => row._id === lifecycleId)
  assert.equal(clearing.state, 'clearing')
  assert.equal(clearing.generation, 1)

  const blocked = await pokerData.main({
    action: 'create_session', playerId, clientMutationId: 'blocked-while-clear-failed',
    payload: { _id: 'blocked-session', status: 'finished' }
  })
  assert.equal(blocked.code, 'ACCOUNT_DATA_NOT_ACTIVE')
  assert.equal((database.dump().sessions || []).some(row => row._id === 'blocked-session'), false)

  const resumed = await pokerData.main({ action: 'clear_all_data', playerId, clientMutationId: 'clear-resume-1' })
  assert.deepEqual(resumed, { code: 0, data: { completed: true } })
  const active = (database.dump().poker_data_account_lifecycle || []).find(row => row._id === lifecycleId)
  assert.equal(active.state, 'active')
  assert.equal(active.generation, 1)
})
