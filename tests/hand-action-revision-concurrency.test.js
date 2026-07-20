const test = require('node:test')
const assert = require('node:assert/strict')
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

function createMemoryCloudDatabase(seed, hooks) {
  const tables = clone(seed || {})
  let transactionTail = Promise.resolve()
  let nextId = 0

  function collectionFor(source, name) {
    function rows() {
      return source[name] || (source[name] = [])
    }
    return {
      doc(id) {
        return {
          async get() {
            if (hooks && typeof hooks.beforeGet === 'function') await hooks.beforeGet({ collection: name, id })
            const row = rows().find(item => item._id === id)
            if (!row) {
              const error = new Error('document not found')
              error.errCode = 'DATABASE_DOCUMENT_NOT_EXIST'
              throw error
            }
            return { data: clone(row) }
          },
          async set(input) {
            if (hooks && typeof hooks.beforeSet === 'function') await hooks.beforeSet({ collection: name, id, data: clone(input && input.data || {}) })
            const index = rows().findIndex(item => item._id === id)
            const next = Object.assign({ _id: id }, clone(input && input.data || {}))
            if (index >= 0) rows()[index] = next
            else rows().push(next)
            return { _id: id }
          },
          async remove() {
            const index = rows().findIndex(item => item._id === id)
            if (index >= 0) rows().splice(index, 1)
            return { stats: { removed: index >= 0 ? 1 : 0 } }
          }
        }
      },
      async add(input) {
        if (hooks && typeof hooks.beforeAdd === 'function') await hooks.beforeAdd({ collection: name, data: clone(input && input.data || {}) })
        const id = `generated_${++nextId}`
        rows().push(Object.assign({ _id: id }, clone(input && input.data || {})))
        return { _id: id }
      },
      where(filters) {
        const state = { filters: filters || {}, orders: [], offset: 0, limit: Infinity }
        const query = {
          where(next) { state.filters = next || {}; return query },
          orderBy(key, direction) { state.orders.push([key, direction]); return query },
          skip(value) { state.offset = Math.max(0, Number(value) || 0); return query },
          limit(value) { state.limit = Math.max(0, Number(value) || 0); return query },
          async get() {
            let result = rows().filter(row => Object.keys(state.filters).every(key => row[key] === state.filters[key]))
            for (let index = state.orders.length - 1; index >= 0; index -= 1) {
              const [key, direction] = state.orders[index]
              result = result.slice().sort((left, right) => {
                const order = typeof left[key] === 'number' && typeof right[key] === 'number'
                  ? left[key] - right[key]
                  : String(left[key] || '').localeCompare(String(right[key] || ''))
                return direction === 'desc' ? -order : order
              })
            }
            const page = result.slice(state.offset, state.offset + state.limit)
            if (hooks && typeof hooks.beforeQueryResult === 'function') {
              await hooks.beforeQueryResult({ collection: name, state: clone(state), rows: clone(page) })
            }
            return { data: clone(page) }
          },
          async count() {
            const total = rows().filter(row => Object.keys(state.filters).every(key => row[key] === state.filters[key])).length
            return { total }
          }
        }
        return query
      }
    }
  }

  const database = {
    collection(name) { return collectionFor(tables, name) },
    runTransaction(callback) {
      const operation = transactionTail.then(async () => {
        const draft = clone(tables)
        const transaction = { collection(name) { return collectionFor(draft, name) } }
        const result = await callback(transaction)
        for (const key of Object.keys(tables)) delete tables[key]
        for (const [key, value] of Object.entries(draft)) tables[key] = value
        return result
      })
      transactionTail = operation.then(() => undefined, () => undefined)
      return operation
    },
    dump() { return clone(tables) }
  }
  return database
}

function loadPokerData(database) {
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() { return database || createMemoryCloudDatabase() },
        getWXContext() { return { OPENID: 'openid-a' } }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const modulePath = require.resolve('../cloudfunctions/poker_data/index')
  delete require.cache[modulePath]
  try {
    return require('../cloudfunctions/poker_data/index')
  } finally {
    Module._load = originalLoad
  }
}

function loadCloudRepo(database) {
  const cloudPath = require.resolve('../utils/cloud')
  const storePath = require.resolve('../utils/store')
  const repoPath = require.resolve('../services/cloud-repo')
  const previousCloud = require.cache[cloudPath]
  const previousStore = require.cache[storePath]
  const previousRepo = require.cache[repoPath]
  require.cache[cloudPath] = { exports: { getDb: () => database } }
  require.cache[storePath] = { exports: {
    getProfile: () => ({ playerId: 'PLAYER-1' }),
    getDefaultSettings: () => ({}),
    getBankrollInitial: () => 0
  } }
  delete require.cache[repoPath]
  try {
    return require('../services/cloud-repo')
  } finally {
    if (previousCloud) require.cache[cloudPath] = previousCloud
    else delete require.cache[cloudPath]
    if (previousStore) require.cache[storePath] = previousStore
    else delete require.cache[storePath]
    if (previousRepo) require.cache[repoPath] = previousRepo
    else delete require.cache[repoPath]
  }
}

function revisionProtocols() {
  const poker = loadPokerData(createMemoryCloudDatabase()).__test
  return [
    {
      name: 'poker_data', execute: poker.executeHandActionRevision,
      claim: (current, expected, revision) => poker.prepareHandRevisionClaim(current, expected, revision, 'PLAYER-1', 'openid-a', false),
      metadata: (current, expected, finalDoc) => poker.prepareHandMetadataWrite(current, expected, finalDoc, 'PLAYER-1', 'openid-a', false)
    }
  ]
}

function createRevisionHarness(protocol) {
  const state = {
    hand: { _id: 'hand-1', ownerOpenId: 'openid-a', playerId: 'PLAYER-1', sessionId: 'session-1', updatedAt: 100 },
    actions: [{ _id: 'old', handId: 'hand-1', actionRevision: 'legacy' }]
  }
  let transactionTail = Promise.resolve()
  function transaction(callback) {
    const operation = transactionTail.then(() => callback(state))
    transactionTail = operation.then(() => undefined, () => undefined)
    return operation
  }
  return { state, transaction, protocol }
}

test('two different action revisions cannot both claim the same hand', async t => {
  for (const protocol of revisionProtocols()) {
    await t.test(protocol.name, async () => {
      const harness = createRevisionHarness(protocol)
      const firstClaimed = deferred()
      const releaseFirst = deferred()
      const run = (revision, block) => protocol.execute({
        claimPending: token => harness.transaction(state => {
          state.hand = protocol.claim(state.hand, state.hand, token)
        }),
        replaceActions: async token => {
          if (block) {
            firstClaimed.resolve()
            await releaseFirst.promise
          }
          harness.state.actions = [{ _id: token.slice(0, 4), handId: 'hand-1', actionRevision: token }]
          return harness.state.actions
        },
        finalize: token => harness.transaction(state => {
          if (state.hand.actionRevisionPending !== token) throw new Error('hand action revision changed')
          state.hand = Object.assign({}, state.hand, { actionRevision: token })
          delete state.hand.actionRevisionPending
        })
      }, { revision, actions: [{}] })

      const first = run('a'.repeat(64), true)
      await firstClaimed.promise
      await assert.rejects(run('b'.repeat(64), false), /busy/)
      releaseFirst.resolve()
      await first
      assert.equal(harness.state.hand.actionRevision, 'a'.repeat(64))
    })
  }
})

test('same revision concurrent retries do not create duplicate action rows', async t => {
  for (const protocol of revisionProtocols()) {
    await t.test(protocol.name, async () => {
      const harness = createRevisionHarness(protocol)
      const bothRead = deferred()
      const snapshots = []
      let readers = 0
      let writerId = 0
      const run = () => {
        const localWriter = ++writerId
        return protocol.execute({
          claimPending: token => harness.transaction(state => { state.hand = protocol.claim(state.hand, state.hand, token) }),
          replaceActions: async token => {
            const oldIds = harness.state.actions.map(row => row._id)
            snapshots.push(oldIds)
            readers += 1
            if (readers === 2) bothRead.resolve()
            await bothRead.promise
            harness.state.actions = harness.state.actions.filter(row => !oldIds.includes(row._id))
            const row = { _id: `stable-${token}`, handId: 'hand-1', actionRevision: token, writer: localWriter }
            const index = harness.state.actions.findIndex(item => item._id === row._id)
            if (index >= 0) harness.state.actions[index] = row
            else harness.state.actions.push(row)
            return harness.state.actions
          },
          finalize: token => harness.transaction(state => {
            if (state.hand.actionRevisionPending !== token) throw new Error('hand action revision changed')
            state.hand = Object.assign({}, state.hand, { actionRevision: token })
            delete state.hand.actionRevisionPending
          })
        }, { revision: 'c'.repeat(64), actions: [{}] })
      }

      const results = await Promise.allSettled([run(), run()])
      assert.ok(results.some(result => result.status === 'fulfilled'))
      assert.deepEqual(snapshots, [['old'], ['old']])
      assert.equal(harness.state.actions.length, 1, 'same revision retries must not leave duplicate canonical rows')
      assert.equal(harness.state.actions[0].actionRevision, 'c'.repeat(64))
    })
  }
})

test('same revision production replacement keeps deterministic row JSON unchanged', async t => {
  const revision = 'e'.repeat(64)
  const actions = [{ street: 'Pre', actorSeat: 1, actorLabel: 'Hero BTN', actionType: 'raise', amount: 600, createdAt: 123, updatedAt: 456 }]

  await t.test('poker_data', async () => {
    const database = createMemoryCloudDatabase({ hand_actions: [] })
    const poker = loadPokerData(database).__test
    const fence = await poker.captureAccountLifecycle('openid-a', 'PLAYER-1')
    await poker.runWithBusinessFence(fence, () => poker.replaceHandActionsCloud('PLAYER-1', 'openid-a', 'hand-1', 'session-1', actions, revision))
    const first = database.dump().hand_actions
    await poker.runWithBusinessFence(fence, () => poker.replaceHandActionsCloud('PLAYER-1', 'openid-a', 'hand-1', 'session-1', actions, revision))
    assert.deepEqual(database.dump().hand_actions, first)
  })

})

test('metadata and action interleaving rejects the stale metadata write and preserves it on retry', async t => {
  for (const protocol of revisionProtocols()) {
    await t.test(protocol.name, async () => {
      const harness = createRevisionHarness(protocol)
      const claimed = deferred()
      const release = deferred()
      const original = clone(harness.state.hand)
      const actionWrite = protocol.execute({
        claimPending: token => harness.transaction(state => { state.hand = protocol.claim(state.hand, original, token) }),
        replaceActions: async token => {
          claimed.resolve()
          await release.promise
          harness.state.actions = [{ _id: 'new', handId: 'hand-1', actionRevision: token }]
          return harness.state.actions
        },
        finalize: token => harness.transaction(state => {
          if (state.hand.actionRevisionPending !== token) throw new Error('hand action revision changed')
          state.hand = Object.assign({}, state.hand, { actionRevision: token, updatedAt: 200 })
          delete state.hand.actionRevisionPending
        })
      }, { revision: 'd'.repeat(64), actions: [{}] })

      await claimed.promise
      await assert.rejects(harness.transaction(state => {
        state.hand = protocol.metadata(state.hand, original, Object.assign({}, original, { notes: 'metadata' }))
      }), /busy|stale/)
      release.resolve()
      await actionWrite

      const committed = clone(harness.state.hand)
      await harness.transaction(state => {
        state.hand = protocol.metadata(state.hand, committed, Object.assign({}, committed, { notes: 'metadata', updatedAt: 300 }))
      })
      assert.equal(harness.state.hand.notes, 'metadata')
      assert.equal(harness.state.hand.actionRevision, 'd'.repeat(64))
      assert.equal(harness.state.actions.length, 1)
    })
  }
})

test('transaction point-read infrastructure errors fail closed without allowMissing writes', async t => {
  const expected = { _id: 'hand-1', ownerOpenId: 'openid-a', playerId: 'PLAYER-1', sessionId: 'session-1', updatedAt: 1 }
  const database = createMemoryCloudDatabase({}, {
    beforeGet({ collection }) {
      if (collection === 'hands') {
        const error = new Error('permission denied')
        error.code = 'PERMISSION_DENIED'
        throw error
      }
    }
  })

  await t.test('poker_data', async () => {
    const poker = loadPokerData(database).__test
    const fence = await poker.captureAccountLifecycle('openid-a', 'PLAYER-1')
    await assert.rejects(
      poker.runWithBusinessFence(fence, () => poker.claimHandActionRevision('hand-1', 'PLAYER-1', 'openid-a', 'a'.repeat(64), expected, true)),
      /permission denied/
    )
    assert.deepEqual(database.dump().hands || [], [])
  })

})

test('ordinary point-read infrastructure errors cannot turn upsert or seed into allowMissing overwrite', async t => {
  function failingDatabase() {
    return createMemoryCloudDatabase({}, {
      beforeGet({ collection }) {
        if (collection === 'hands') {
          const error = new Error('ordinary point read unavailable')
          error.code = 'NETWORK_ERROR'
          throw error
        }
      }
    })
  }

  await t.test('poker_data upsert', async () => {
    const database = failingDatabase()
    const result = await loadPokerData(database).main({
      action: 'upsert_hand', playerId: 'PLAYER-1', handId: 'hand-1', clientMutationId: 'infra-upsert',
      payload: { _id: 'hand-1', sessionId: 'session-1', actions: [] }
    })
    assert.equal(result.code, 'POKER_DATA_ERROR')
    assert.deepEqual(database.dump().hands || [], [])
  })

})

test('pending and partial action data is hidden from client reads, replay sources, and poker_data export', async t => {
  const seed = {
    hands: [{
      _id: 'hand-1', ownerOpenId: 'openid-a', playerId: 'PLAYER-1', sessionId: 'session-1',
      updatedAt: 100, actionRevisionPending: 'f'.repeat(64)
    }],
    hand_actions: [{
      _id: 'partial', ownerOpenId: 'openid-a', playerId: 'PLAYER-1', handId: 'hand-1',
      sessionId: 'session-1', sequence: 1, actionType: 'raise', actionRevision: 'f'.repeat(64)
    }]
  }

  await t.test('client hand and replay action reads fail closed', async () => {
    const database = createMemoryCloudDatabase(seed)
    const cloudRepo = loadCloudRepo(database)
    assert.equal(await cloudRepo.getHandById('hand-1'), null)
    assert.deepEqual(await cloudRepo.getActionsByHandId('hand-1'), [])
  })

  await t.test('poker_data backup pages exclude both pending hand and partial actions', async () => {
    const database = createMemoryCloudDatabase(seed)
    const pokerData = loadPokerData(database)
    const hands = await pokerData.main({ action: 'export_backup_page', playerId: 'PLAYER-1', collection: 'hands' })
    const actions = await pokerData.main({ action: 'export_backup_page', playerId: 'PLAYER-1', collection: 'handActions' })
    assert.equal(hands.code, 'HAND_SOURCE_UPDATING')
    assert.equal(actions.code, 'HAND_SOURCE_UPDATING')
  })
})

test('full backup hand/action read rejects a hand revision race between enclosing reads', async () => {
  let database
  let changed = false
  database = createMemoryCloudDatabase({
    hands: [{ _id: 'hand-1', ownerOpenId: 'openid-a', playerId: 'PLAYER-1', sessionId: 'session-1', updatedAt: 100 }],
    hand_actions: [{ _id: 'a1', ownerOpenId: 'openid-a', playerId: 'PLAYER-1', handId: 'hand-1', sequence: 1 }]
  }, {
    async beforeQueryResult({ collection }) {
      if (collection !== 'hand_actions' || changed) return
      changed = true
      await database.collection('hands').doc('hand-1').set({
        data: { ownerOpenId: 'openid-a', playerId: 'PLAYER-1', sessionId: 'session-1', updatedAt: 101, actionRevisionPending: 'f'.repeat(64) }
      })
    }
  })
  const poker = loadPokerData(database).__test
  await assert.rejects(poker.fetchStableOwnedHandData('PLAYER-1', 'openid-a'), error => error && error.code === 'HAND_SOURCE_UPDATING')
})

test('backup page keeps indexed pagination and does not full-scan private hands', async () => {
  const querySizes = []
  const hands = Array.from({ length: 200 }, (_, index) => ({
    _id: `hand-${index}`, ownerOpenId: 'openid-a', playerId: 'PLAYER-1', sessionId: 'session-1', updatedAt: index + 1
  }))
  const database = createMemoryCloudDatabase({ hands }, {
    beforeQueryResult({ collection, state, rows }) {
      if (collection === 'hands') querySizes.push({ limit: state.limit, rows: rows.length })
    }
  })
  const result = await loadPokerData(database).main({
    action: 'export_backup_page', playerId: 'PLAYER-1', collection: 'hands', offset: 20, limit: 10
  })
  assert.equal(result.code, 0)
  assert.equal(result.data.items.length, 10)
  assert.deepEqual(querySizes, [{ limit: 10, rows: 10 }])
})

test('cloud-repo getHandById propagates ordinary point-read infrastructure errors', async () => {
  const database = createMemoryCloudDatabase({}, {
    beforeGet({ collection }) {
      if (collection === 'hands') {
        const error = new Error('hand point read unavailable')
        error.code = 'NETWORK_ERROR'
        throw error
      }
    }
  })
  const cloudRepo = loadCloudRepo(database)

  await assert.rejects(cloudRepo.getHandById('hand-1'), /hand point read unavailable/)
})

test('cloud-repo deleteSession is server-authoritative and performs zero client writes', async () => {
  const pending = 'f'.repeat(64)
  const seed = {
    sessions: [{ _id: 'session-1', playerId: 'PLAYER-1', status: 'finished', updatedAt: 1 }],
    hands: [{
      _id: 'hand-1', playerId: 'PLAYER-1', sessionId: 'session-1', updatedAt: 1,
      actionRevisionPending: pending
    }],
    hand_actions: [{
      _id: 'action-1', playerId: 'PLAYER-1', handId: 'hand-1', sessionId: 'session-1',
      actionRevision: pending, sequence: 1
    }],
    bankroll_logs: [{ _id: 'bankroll-1', playerId: 'PLAYER-1', sessionId: 'session-1', amount: 100 }]
  }
  const database = createMemoryCloudDatabase(seed)
  const cloudRepo = loadCloudRepo(database)

  await assert.rejects(cloudRepo.deleteSession('session-1'), /server-authoritative poker_data write required/)
  assert.deepEqual(database.dump(), seed)
})
