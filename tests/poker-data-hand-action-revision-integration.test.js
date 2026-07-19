const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createFakeCloud(seed) {
  const collections = clone(Object.assign({
    sessions: [], hands: [], hand_actions: [], profiles: [], user_settings: [],
    bankroll_logs: [], player_notes: [], player_card_import_receipts: [],
    sync_operations: [], audit_logs: []
  }, seed || {}))
  const failures = []
  let autoId = 0
  let transactionTail = Promise.resolve()

  function shouldFail(operation, collectionName) {
    const index = failures.findIndex(item => item.operation === operation && item.collectionName === collectionName && item.remaining > 0)
    if (index === -1) return false
    failures[index].remaining -= 1
    return true
  }

  function rows(name) {
    if (!collections[name]) collections[name] = []
    return collections[name]
  }

  function makeQuery(name, filters, orderings, offset, maximum) {
    const state = {
      filters: Object.assign({}, filters || {}),
      orderings: (orderings || []).slice(),
      offset: Number(offset) || 0,
      maximum: maximum == null ? null : Number(maximum)
    }
    const query = {
      where(next) { return makeQuery(name, Object.assign({}, state.filters, next || {}), state.orderings, state.offset, state.maximum) },
      orderBy(key, direction) { return makeQuery(name, state.filters, state.orderings.concat([[key, direction]]), state.offset, state.maximum) },
      skip(value) { return makeQuery(name, state.filters, state.orderings, value, state.maximum) },
      limit(value) { return makeQuery(name, state.filters, state.orderings, state.offset, value) },
      async get() {
        let result = rows(name).filter(item => Object.keys(state.filters).every(key => item && item[key] === state.filters[key]))
        state.orderings.slice().reverse().forEach(([key, direction]) => {
          result.sort((left, right) => {
            if (left[key] === right[key]) return 0
            const compared = left[key] < right[key] ? -1 : 1
            return direction === 'desc' ? -compared : compared
          })
        })
        result = result.slice(state.offset, state.maximum == null ? undefined : state.offset + state.maximum)
        return { data: clone(result) }
      },
      async count() {
        return { total: rows(name).filter(item => Object.keys(state.filters).every(key => item && item[key] === state.filters[key])).length }
      }
    }
    return query
  }

  function collection(name) {
    return Object.assign(makeQuery(name), {
      doc(id) {
        return {
          async get() {
            if (shouldFail('get', name)) throw new Error('injected get failure: ' + name)
            const found = rows(name).find(item => item && item._id === id)
            if (!found) throw new Error('not found')
            return { data: clone(found) }
          },
          async set({ data }) {
            if (shouldFail('set', name)) throw new Error('injected set failure: ' + name)
            const next = Object.assign({ _id: id }, clone(data || {}))
            const index = rows(name).findIndex(item => item && item._id === id)
            if (index === -1) rows(name).push(next)
            else rows(name)[index] = next
            return { updated: 1 }
          },
          async update({ data }) {
            if (shouldFail('update', name)) throw new Error('injected update failure: ' + name)
            const index = rows(name).findIndex(item => item && item._id === id)
            if (index === -1) throw new Error('not found')
            rows(name)[index] = Object.assign({}, rows(name)[index], clone(data || {}), { _id: id })
            return { updated: 1 }
          },
          async remove() {
            if (shouldFail('remove', name)) throw new Error('injected remove failure: ' + name)
            const index = rows(name).findIndex(item => item && item._id === id)
            if (index > -1) rows(name).splice(index, 1)
            return { removed: index > -1 ? 1 : 0 }
          }
        }
      },
      async add({ data }) {
        if (shouldFail('add', name)) throw new Error('injected add failure: ' + name)
        const id = data && data._id || ('auto_' + (++autoId))
        const next = Object.assign({ _id: id }, clone(data || {}))
        rows(name).push(next)
        return { _id: id }
      }
    })
  }

  const database = {
    collection,
    async createCollection(name) { rows(name); return true },
    runTransaction(callback) {
      const operation = transactionTail.then(async () => {
        const snapshot = clone(collections)
        try {
          return await callback({ collection })
        } catch (error) {
          Object.keys(collections).forEach(key => delete collections[key])
          Object.assign(collections, snapshot)
          throw error
        }
      })
      transactionTail = operation.then(() => undefined, () => undefined)
      return operation
    }
  }

  return {
    collections,
    database,
    failNext(operation, collectionName) { failures.push({ operation, collectionName, remaining: 1 }) }
  }
}

function loadPokerData(seed, initialOwner) {
  const cloud = createFakeCloud(seed)
  let ownerOpenId = initialOwner || 'owner-a'
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() { return cloud.database },
        getWXContext() { return { OPENID: ownerOpenId } }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const modulePath = require.resolve('../cloudfunctions/poker_data/index')
  delete require.cache[modulePath]
  try {
    return {
      main: require('../cloudfunctions/poker_data/index').main,
      test: require('../cloudfunctions/poker_data/index').__test,
      collections: cloud.collections,
      failNext: cloud.failNext,
      setOwner(value) { ownerOpenId = value }
    }
  } finally {
    Module._load = originalLoad
  }
}

function session(id, ownerOpenId, playerId) {
  return {
    _id: id,
    ownerOpenId: ownerOpenId || 'owner-a',
    playerId: playerId || 'PLAYER-A',
    title: 'Test', status: 'active', startTime: '2026-07-20 12:00',
    smallBlind: 10, bigBlind: 20, handCount: 0, createdAt: 1, updatedAt: 1
  }
}

function hand(id, overrides) {
  return Object.assign({
    _id: id,
    ownerOpenId: 'owner-a', playerId: 'PLAYER-A', sessionId: 'session-a',
    heroCardsInput: 'AsKd', potSize: 100, createdAt: 1, updatedAt: 1
  }, overrides || {})
}

function action(id, handId, overrides) {
  return Object.assign({
    _id: id, ownerOpenId: 'owner-a', playerId: 'PLAYER-A', handId,
    sessionId: 'session-a', street: 'preflop', actorSeat: 1, actorLabel: 'Hero',
    actionType: 'raise', amount: 60, potAfter: 90, sequence: 1, createdAt: 1, updatedAt: 1
  }, overrides || {})
}

function assertCommittedRows(loaded, handId) {
  const storedHand = loaded.collections.hands.find(item => item._id === handId)
  const rows = loaded.collections.hand_actions.filter(item => item.handId === handId)
  assert.match(String(storedHand && storedHand.actionRevision || ''), /^[0-9a-f]{64}$/)
  assert.ok(Number.isInteger(storedHand.handVersion) && storedHand.handVersion >= 1)
  assert.equal(storedHand.actionRevisionPending, undefined)
  assert.ok(rows.length > 0)
  assert.ok(rows.every(item => item.actionRevision === storedHand.actionRevision), 'every action row must carry the committed hand revision')
  return { storedHand, rows }
}

test('receipt regression: begin import receipt remains independent from hand action revision state', async () => {
  const loaded = loadPokerData()
  const result = await loaded.main({
    action: 'begin_player_card_import_receipt', playerId: 'PLAYER-A', clientMutationId: 'receipt-1',
    shareId: 'share-1', mode: 'new', targetPlayerNoteId: 'note-1'
  })
  assert.equal(result.code, 0, JSON.stringify(result))
  assert.deepEqual(result.data.receipt, { shareId: 'share-1', mode: 'new', targetPlayerNoteId: 'note-1', status: 'pending' })
})

test('legacy sync receipt restores only the exact raw mutation while new ids avoid sanitized collisions', async () => {
  const legacyId = 'sync_owner-a_legacy_1'
  const restoredResult = { hand: { _id: 'already-written' } }
  const loaded = loadPokerData({
    sync_operations: [{
      _id: legacyId, ownerOpenId: 'owner-a', playerId: 'PLAYER-A', action: 'update_hand',
      clientMutationId: 'legacy/1', result: restoredResult
    }]
  })
  const restored = await loaded.main({
    action: 'update_hand', playerId: 'PLAYER-A', handId: 'missing', clientMutationId: 'legacy/1', patch: {}
  })
  assert.deepEqual(restored, { code: 0, data: restoredResult })

  const collision = await loaded.main({
    action: 'update_hand', playerId: 'PLAYER-A', handId: 'missing', clientMutationId: 'legacy?1', patch: {}
  })
  assert.equal(collision.code, 'MUTATION_CONFLICT')
})

test('create_hand commits the same revision on the hand and every action row and strips it from the response', async () => {
  const loaded = loadPokerData({ sessions: [session('session-a')] })
  const result = await loaded.main({
    action: 'create_hand', playerId: 'PLAYER-A', clientMutationId: 'create-1',
    payload: { _id: 'hand-create', sessionId: 'session-a', actions: [action('create-action', 'hand-create')] }
  })
  assert.equal(result.code, 0, JSON.stringify(result))
  assertCommittedRows(loaded, 'hand-create')
  assert.equal(Object.hasOwn(result.data.hand, 'actionRevision'), false)
  assert.equal(Object.hasOwn(result.data.hand, 'handVersion'), false)
  assert.ok(result.data.actions.every(item => !Object.hasOwn(item, 'actionRevision')))
})

test('update_hand commits revision-tagged rows', async () => {
  const loaded = loadPokerData({
    sessions: [session('session-a')],
    hands: [hand('hand-update')],
    hand_actions: [action('old-update', 'hand-update')]
  })
  const result = await loaded.main({
    action: 'update_hand', playerId: 'PLAYER-A', handId: 'hand-update', clientMutationId: 'update-1',
    patch: { potSize: 200, actions: [action('new-update', 'hand-update', { amount: 80 })] }
  })
  assert.equal(result.code, 0, JSON.stringify(result))
  assertCommittedRows(loaded, 'hand-update')
})

test('upsert_hand commits revision-tagged rows', async () => {
  const loaded = loadPokerData({ sessions: [session('session-a')] })
  const result = await loaded.main({
    action: 'upsert_hand', playerId: 'PLAYER-A', handId: 'hand-upsert', clientMutationId: 'upsert-1',
    payload: { _id: 'hand-upsert', sessionId: 'session-a', actions: [action('upsert-action', 'hand-upsert')] }
  })
  assert.equal(result.code, 0, JSON.stringify(result))
  assertCommittedRows(loaded, 'hand-upsert')
})

test('sync_stats import commits revision-tagged rows', async () => {
  const loaded = loadPokerData()
  const result = await loaded.main({
    action: 'sync_stats', playerId: 'PLAYER-A',
    backup: {
      profile: { playerId: 'PLAYER-A' },
      sessions: [session('session-a')],
      hands: [hand('hand-sync')],
      handActions: [action('sync-action', 'hand-sync')]
    }
  })
  assert.equal(result.code, 0, JSON.stringify(result))
  assertCommittedRows(loaded, 'hand-sync')
})

test('sync_stats returns HAND_SOURCE_UPDATING instead of compacting a pending hand', async () => {
  const loaded = loadPokerData({
    sessions: [session('session-a')],
    hands: [hand('hand-sync-pending', { actionRevisionPending: 'f'.repeat(64) })]
  })
  const result = await loaded.main({ action: 'sync_stats', playerId: 'PLAYER-A' })

  assert.equal(result.code, 'HAND_SOURCE_UPDATING')
  assert.equal(result.data, undefined)
})

test('a deletion failure stays unresolved and never starts a second action writer', async () => {
  const loaded = loadPokerData({
    sessions: [session('session-a')], hands: [hand('hand-delete-fail')],
    hand_actions: [action('old-delete', 'hand-delete-fail')]
  })
  const event = {
    action: 'update_hand', playerId: 'PLAYER-A', handId: 'hand-delete-fail', clientMutationId: 'repair-delete-1',
    patch: { actions: [action('new-delete', 'hand-delete-fail')] }
  }
  loaded.failNext('remove', 'hand_actions')
  const failed = await loaded.main(event)
  assert.notEqual(failed.code, 0, 'failed deletion must abort before finalize')
  assert.match(String(loaded.collections.hands.find(item => item._id === 'hand-delete-fail').actionRevisionPending || ''), /^[0-9a-f]{64}$/)
  loaded.collections.sync_operations[0].leaseExpiresAt = 0
  const retried = await loaded.main(event)
  assert.equal(retried.code, 'POKER_DATA_ERROR')
  assert.match(retried.message, /recovery evidence is unresolved/)
  assert.match(String(loaded.collections.hands.find(item => item._id === 'hand-delete-fail').actionRevisionPending || ''), /^[0-9a-f]{64}$/)
  assert.equal(loaded.collections.sync_operations[0].status, 'pending')
})

test('a row write failure stays unresolved and never starts a second action writer', async () => {
  const loaded = loadPokerData({
    sessions: [session('session-a')], hands: [hand('hand-write-fail')],
    hand_actions: [action('old-write', 'hand-write-fail')]
  })
  const event = {
    action: 'update_hand', playerId: 'PLAYER-A', handId: 'hand-write-fail', clientMutationId: 'repair-write-1',
    patch: { potSize: 300, actions: [action('new-write', 'hand-write-fail')] }
  }
  loaded.failNext('set', 'hand_actions')
  const failed = await loaded.main(event)
  assert.notEqual(failed.code, 0)
  assert.match(String(loaded.collections.hands.find(item => item._id === 'hand-write-fail').actionRevisionPending || ''), /^[0-9a-f]{64}$/)
  loaded.collections.sync_operations[0].leaseExpiresAt = 0
  const retried = await loaded.main(event)
  assert.equal(retried.code, 'POKER_DATA_ERROR')
  assert.match(retried.message, /recovery evidence is unresolved/)
  assert.match(String(loaded.collections.hands.find(item => item._id === 'hand-write-fail').actionRevisionPending || ''), /^[0-9a-f]{64}$/)
  assert.equal(loaded.collections.sync_operations[0].status, 'pending')
})

test('upsert and sync cannot overwrite a hand document owned by another OpenID', async () => {
  const foreign = hand('foreign-hand', { ownerOpenId: 'owner-b', playerId: 'PLAYER-B', potSize: 777 })
  const loaded = loadPokerData({ sessions: [session('session-a')], hands: [foreign] })
  const upserted = await loaded.main({
    action: 'upsert_hand', playerId: 'PLAYER-A', handId: 'foreign-hand', clientMutationId: 'steal-upsert',
    payload: { _id: 'foreign-hand', sessionId: 'session-a', potSize: 1 }
  })
  assert.ok(upserted.code !== 0 || upserted.data && upserted.data.rejected, 'cross-owner upsert must be rejected')
  assert.deepEqual(loaded.collections.hands.find(item => item._id === 'foreign-hand'), foreign)

  await loaded.main({
    action: 'sync_stats', playerId: 'PLAYER-A',
    backup: { profile: { playerId: 'PLAYER-A' }, hands: [{ _id: 'foreign-hand', sessionId: 'session-a', potSize: 2 }], handActions: [] }
  })
  assert.deepEqual(loaded.collections.hands.find(item => item._id === 'foreign-hand'), foreign)
})

test('metadata-only writer cannot pass an active action pending barrier', async () => {
  const pending = 'a'.repeat(64)
  const original = hand('hand-pending', { potSize: 100, actionRevision: 'b'.repeat(64), actionRevisionPending: pending })
  const loaded = loadPokerData({ sessions: [session('session-a')], hands: [original] })
  const result = await loaded.main({
    action: 'update_hand', playerId: 'PLAYER-A', handId: 'hand-pending', clientMutationId: 'metadata-while-pending',
    patch: { potSize: 999 }
  })
  assert.ok(result.code !== 0 || result.data && result.data.rejected, 'metadata writer must not cross pending barrier')
  assert.equal(loaded.collections.hands.find(item => item._id === 'hand-pending').potSize, 100)
  assert.equal(loaded.collections.hands.find(item => item._id === 'hand-pending').actionRevisionPending, pending)
})

test('same clientMutationId conflicts when action or canonical input changes', async () => {
  const loaded = loadPokerData({ sessions: [session('session-a')], hands: [hand('hand-mutation')] })
  const first = await loaded.main({
    action: 'update_hand', playerId: 'PLAYER-A', handId: 'hand-mutation', clientMutationId: 'same-mutation',
    patch: { potSize: 200 }
  })
  assert.equal(first.code, 0)
  const changedInput = await loaded.main({
    action: 'update_hand', playerId: 'PLAYER-A', handId: 'hand-mutation', clientMutationId: 'same-mutation',
    patch: { potSize: 300 }
  })
  assert.equal(changedInput.code, 'MUTATION_CONFLICT')
  const changedAction = await loaded.main({
    action: 'delete_hand', playerId: 'PLAYER-A', handId: 'hand-mutation', clientMutationId: 'same-mutation'
  })
  assert.equal(changedAction.code, 'MUTATION_CONFLICT')
  assert.ok(loaded.collections.hands.some(item => item._id === 'hand-mutation'))
})

test('sync operation claim serializes the same mutation and runs business side effects once', async () => {
  const loaded = loadPokerData({ sessions: [session('session-a')], hands: [hand('hand-claim')] })
  const event = {
    action: 'update_hand', playerId: 'PLAYER-A', handId: 'hand-claim', clientMutationId: 'claim-same',
    patch: { potSize: 200 }
  }
  const results = await Promise.all([loaded.main(event), loaded.main(event)])

  assert.equal(results.filter(result => result.code === 0).length, 1)
  assert.equal(results.filter(result => result.code === 'MUTATION_IN_PROGRESS').length, 1)
  assert.equal(loaded.collections.audit_logs.filter(row => row.action === 'update_hand').length, 1)
  assert.equal(loaded.collections.hands.find(row => row._id === 'hand-claim').potSize, 200)
})

test('sync operation claim rejects concurrent different input before its business write', async () => {
  const loaded = loadPokerData({ sessions: [session('session-a')], hands: [hand('hand-claim-conflict')] })
  const base = {
    action: 'update_hand', playerId: 'PLAYER-A', handId: 'hand-claim-conflict', clientMutationId: 'claim-conflict'
  }
  const results = await Promise.all([
    loaded.main(Object.assign({}, base, { patch: { potSize: 200 } })),
    loaded.main(Object.assign({}, base, { patch: { potSize: 300 } }))
  ])

  assert.equal(results.filter(result => result.code === 0).length, 1)
  assert.equal(results.filter(result => result.code === 'MUTATION_CONFLICT').length, 1)
  assert.equal(loaded.collections.audit_logs.filter(row => row.action === 'update_hand').length, 1)
  assert.ok([200, 300].includes(loaded.collections.hands.find(row => row._id === 'hand-claim-conflict').potSize))
})

test('failed business write retains its WAL claim and remains unresolved after lease expiry', async () => {
  const loaded = loadPokerData({ sessions: [session('session-a')], hands: [hand('hand-claim-retry')] })
  const event = {
    action: 'update_hand', playerId: 'PLAYER-A', handId: 'hand-claim-retry', clientMutationId: 'claim-retry',
    patch: { potSize: 222 }
  }
  loaded.failNext('set', 'hands')
  const failed = await loaded.main(event)
  assert.equal(failed.code, 'POKER_DATA_ERROR')
  assert.equal(loaded.collections.sync_operations.length, 1)
  assert.equal(loaded.collections.sync_operations[0].status, 'pending')
  assert.ok(loaded.collections.sync_operations[0].recoveryEvidence)

  loaded.collections.sync_operations[0].leaseExpiresAt = 0
  const retried = await loaded.main(event)
  assert.equal(retried.code, 'POKER_DATA_ERROR')
  assert.match(retried.message, /recovery evidence is unresolved/)
  assert.notEqual(loaded.collections.hands.find(row => row._id === 'hand-claim-retry').potSize, 222)
  assert.equal(loaded.collections.audit_logs.filter(row => row.action === 'update_hand').length, 0)
  assert.equal(loaded.collections.sync_operations[0].status, 'pending')
})

test('expired matching sync operation lease is atomically taken over', async () => {
  const loaded = loadPokerData({ sessions: [session('session-a')], hands: [hand('hand-lease')] })
  const event = {
    action: 'update_hand', playerId: 'PLAYER-A', handId: 'hand-lease', clientMutationId: 'expired-lease',
    patch: { potSize: 444 }
  }
  const docId = loaded.test.getSyncOperationDocumentId('owner-a', event.clientMutationId)
  const fingerprint = loaded.test.createMutationInputFingerprint('owner-a', 'PLAYER-A', 'update_hand', event)
  loaded.collections.sync_operations.push({
    _id: docId, ownerOpenId: 'owner-a', playerId: 'PLAYER-A', clientMutationId: event.clientMutationId,
    action: 'update_hand', inputFingerprint: fingerprint, status: 'pending', attemptId: 'dead-attempt', leaseExpiresAt: 0
  })

  const result = await loaded.main(event)
  assert.equal(result.code, 0)
  assert.equal(loaded.collections.hands.find(row => row._id === 'hand-lease').potSize, 444)
  const receipt = loaded.collections.sync_operations.find(row => row._id === docId)
  assert.equal(receipt.status, 'completed')
  assert.ok(receipt.result)
  assert.notEqual(receipt.attemptId, 'dead-attempt')
})

test('delete failure propagates and cannot persist a false-success mutation receipt', async () => {
  const loaded = loadPokerData({
    sessions: [session('session-a')], hands: [hand('hand-remove')],
    hand_actions: [action('action-remove', 'hand-remove')]
  })
  const event = {
    action: 'delete_hand', playerId: 'PLAYER-A', handId: 'hand-remove', clientMutationId: 'delete-remove-failure'
  }
  loaded.failNext('remove', 'hand_actions')
  const failed = await loaded.main(event)

  assert.equal(failed.code, 'POKER_DATA_ERROR')
  assert.ok(loaded.collections.hands.some(row => row._id === 'hand-remove'))
  assert.equal(loaded.collections.sync_operations.length, 1)
  assert.equal(loaded.collections.sync_operations[0].status, 'pending')
  assert.equal(loaded.collections.sync_operations[0].recoveryEvidence.auditAction, 'delete_hand')
  assert.equal(loaded.collections.audit_logs.length, 0)
})

test('delete_session failure propagates and cannot persist a false-success mutation receipt', async () => {
  const loaded = loadPokerData({
    sessions: [session('session-remove')],
    hands: [hand('hand-session-remove', { sessionId: 'session-remove' })],
    hand_actions: [action('action-session-remove', 'hand-session-remove', { sessionId: 'session-remove' })]
  })
  const event = {
    action: 'delete_session', playerId: 'PLAYER-A', sessionId: 'session-remove', clientMutationId: 'delete-session-failure'
  }
  loaded.failNext('remove', 'hand_actions')
  const failed = await loaded.main(event)

  assert.equal(failed.code, 'POKER_DATA_ERROR')
  assert.ok(loaded.collections.sessions.some(row => row._id === 'session-remove'))
  assert.ok(loaded.collections.hands.some(row => row._id === 'hand-session-remove'))
  assert.equal(loaded.collections.sync_operations.length, 1)
  assert.equal(loaded.collections.sync_operations[0].status, 'pending')
  assert.equal(loaded.collections.sync_operations[0].recoveryEvidence.auditAction, 'delete_session')
  assert.equal(loaded.collections.audit_logs.length, 0)
})

test('sync_stats fails closed without re-owning foreign collection ids', async () => {
  const foreign = {
    sessions: [session('foreign-session', 'owner-b', 'PLAYER-B')],
    player_notes: [{ _id: 'foreign-note', ownerOpenId: 'owner-b', playerId: 'PLAYER-B', name: 'Foreign', updatedAt: 1 }],
    bankroll_logs: [{ _id: 'foreign-bankroll', ownerOpenId: 'owner-b', playerId: 'PLAYER-B', amount: 999, updatedAt: 1 }],
    profiles: [{ _id: 'foreign-profile', ownerOpenId: 'owner-b', playerId: 'PLAYER-B', nickname: 'Foreign' }],
    user_settings: [{ _id: 'foreign-settings', ownerOpenId: 'owner-b', playerId: 'PLAYER-B', theme: 'dark' }]
  }
  const before = clone(foreign)
  const loaded = loadPokerData(foreign)
  const result = await loaded.main({
    action: 'sync_stats', playerId: 'PLAYER-A',
    backup: {
      profile: { _id: 'foreign-profile', playerId: 'PLAYER-A', nickname: 'Attacker' },
      settings: { _id: 'foreign-settings', theme: 'light' },
      sessions: [Object.assign({}, session('foreign-session'), { title: 'Attacker' })],
      playerNotes: [{ _id: 'foreign-note', name: 'Attacker', updatedAt: 2 }],
      bankrollLogs: [{ _id: 'foreign-bankroll', amount: 1, updatedAt: 2 }]
    }
  })

  assert.equal(result.code, 'POKER_DATA_ERROR')
  assert.deepEqual(loaded.collections.sessions, before.sessions)
  assert.deepEqual(loaded.collections.player_notes, before.player_notes)
  assert.deepEqual(loaded.collections.bankroll_logs, before.bankroll_logs)
  assert.deepEqual(loaded.collections.profiles, before.profiles)
  assert.deepEqual(loaded.collections.user_settings, before.user_settings)
})
