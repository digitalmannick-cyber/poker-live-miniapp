const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

function loadPokerData(database) {
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return { DYNAMIC_CURRENT_ENV: 'test', init() {}, database() { return database || {} }, getWXContext() { return {} } }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const modulePath = require.resolve('../cloudfunctions/poker_data/index')
  delete require.cache[modulePath]
  const result = require('../cloudfunctions/poker_data/index')
  Module._load = originalLoad
  return result
}

test('action revision token is deterministic per mutation and changes across mutations', () => {
  const { createHandActionRevision } = loadPokerData().__test
  const input = { ownerOpenId: 'openid-a', playerId: 'PLAYER-1', handId: 'hand-1', action: 'update_hand', clientMutationId: 'm1' }
  const first = createHandActionRevision(input)
  assert.match(first, /^[0-9a-f]{64}$/)
  assert.equal(createHandActionRevision(input), first)
  assert.notEqual(createHandActionRevision(Object.assign({}, input, { clientMutationId: 'm2' })), first)
  assert.notEqual(createHandActionRevision(Object.assign({}, input, { finalDoc: { potSize: 2000 } })), first)
})

test('action revision ignores server clock fields but covers action createdAt', () => {
  const { createHandActionRevision } = loadPokerData().__test
  const base = {
    ownerOpenId: 'openid-a', playerId: 'PLAYER-1', handId: 'hand-1', action: 'update_hand', clientMutationId: 'm1',
    actions: [{ _id: 'a1', actionType: 'raise', amount: 600, createdAt: 123 }],
    finalDoc: { sessionId: 's1', potSize: 1200, createdAt: 10, updatedAt: 20 }
  }
  const first = createHandActionRevision(base)
  assert.equal(createHandActionRevision(Object.assign({}, base, {
    finalDoc: Object.assign({}, base.finalDoc, { updatedAt: 999, actionCommittedAt: 888 })
  })), first)
  assert.notEqual(createHandActionRevision(Object.assign({}, base, {
    actions: [Object.assign({}, base.actions[0], { createdAt: 124 })]
  })), first)
  assert.notEqual(createHandActionRevision(Object.assign({}, base, {
    actions: [Object.assign({}, base.actions[0], { updatedAt: 124 })]
  })), first)
})

test('create hand id is deterministic for the raw mutation identity and collision resistant', () => {
  const { createMutationEntityId } = loadPokerData().__test
  const input = ['hand', 'owner-a', 'PLAYER-1', 'create_hand', 'same/mutation']
  assert.equal(createMutationEntityId(...input), createMutationEntityId(...input))
  assert.notEqual(createMutationEntityId(...input), createMutationEntityId('hand', 'owner-a', 'PLAYER-1', 'create_hand', 'same?mutation'))
})

test('hashed sync operation ids avoid legacy sanitized mutation collisions', () => {
  const { getSyncOperationDocumentId, getLegacySyncOperationDocumentId } = loadPokerData().__test
  assert.equal(getLegacySyncOperationDocumentId('owner', 'same/value'), getLegacySyncOperationDocumentId('owner', 'same?value'))
  assert.notEqual(getSyncOperationDocumentId('owner', 'same/value'), getSyncOperationDocumentId('owner', 'same?value'))
})

test('action row ids are deterministic and isolated by owner, player, hand, revision, and sequence', () => {
  const { createHandActionRowId } = loadPokerData().__test
  const args = ['owner-a', 'PLAYER-1', 'hand-1', 'a'.repeat(64), 1]
  assert.equal(createHandActionRowId(...args), createHandActionRowId(...args))
  assert.notEqual(createHandActionRowId(...args), createHandActionRowId('owner-b', ...args.slice(1)))
  assert.notEqual(createHandActionRowId(...args), createHandActionRowId('owner-a', 'PLAYER-2', ...args.slice(2)))
})

test('public cloud documents recursively remove action revision protocol fields', () => {
  const { cleanCloudDoc } = loadPokerData().__test
  assert.deepEqual(cleanCloudDoc({
    _id: 'h1', actionRevision: 'secret', actionRevisionPending: 'pending', actionCommittedAt: 1,
    nested: { actionRevision: 'also-secret', keep: true }
  }), { _id: 'h1', nested: { keep: true } })
})

test('claim CAS rejects stale metadata and competing revisions while same revision can repair', () => {
  const { prepareHandRevisionClaim } = loadPokerData().__test
  const expected = { _id: 'h1', ownerOpenId: 'o1', playerId: 'P1', sessionId: 's1', updatedAt: 10, actionRevision: 'old' }
  assert.throws(() => prepareHandRevisionClaim(Object.assign({}, expected, { updatedAt: 11 }), expected, 'a'.repeat(64), 'P1', 'o1'), /stale/)
  assert.throws(() => prepareHandRevisionClaim(Object.assign({}, expected, { actionRevisionPending: 'b'.repeat(64) }), expected, 'a'.repeat(64), 'P1', 'o1'), /busy/)
  const repairing = prepareHandRevisionClaim(Object.assign({}, expected, { actionRevisionPending: 'a'.repeat(64) }), Object.assign({}, expected, { actionRevisionPending: 'a'.repeat(64) }), 'a'.repeat(64), 'P1', 'o1')
  assert.equal(repairing.actionRevisionPending, 'a'.repeat(64))
})

test('two-phase action replacement claims pending before deletes and leaves pending on failure', async () => {
  const { executeHandActionRevision } = loadPokerData().__test
  const calls = []
  const input = { revision: 'a'.repeat(64), actions: [{ _id: 'a1' }] }
  await assert.rejects(executeHandActionRevision({
    claimPending: async revision => calls.push(['claim', revision]),
    replaceActions: async revision => { calls.push(['replace', revision]); throw new Error('write failed') },
    finalize: async revision => calls.push(['finalize', revision])
  }, input), /write failed/)
  assert.deepEqual(calls, [['claim', 'a'.repeat(64)], ['replace', 'a'.repeat(64)]])
})

test('same revision retry rewrites the full set and finalizes only after replacement', async () => {
  const { executeHandActionRevision } = loadPokerData().__test
  const calls = []
  const revision = 'b'.repeat(64)
  const result = await executeHandActionRevision({
    claimPending: async value => calls.push(['claim', value]),
    replaceActions: async value => { calls.push(['replace', value]); return [{ _id: 'a1', actionRevision: value }] },
    finalize: async value => calls.push(['finalize', value])
  }, { revision, actions: [{ _id: 'a1' }] })
  assert.deepEqual(calls, [['claim', revision], ['replace', revision], ['finalize', revision]])
  assert.equal(result[0].actionRevision, revision)
})

test('poker_data source enforces pending-before-replace and revision-tagged rows', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const source = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions/poker_data/index.js'), 'utf8')
  assert.match(source, /actionRevisionPending/)
  assert.match(source, /actionRevision/)
  assert.doesNotMatch(source, /syncMany\(COLLECTIONS\.handActions/)
})

test('handVersion is internal, monotonic, and part of metadata CAS evidence', () => {
  const { prepareHandMetadataWrite, cleanCloudDoc } = loadPokerData().__test
  const current = {
    _id: 'hand-1', ownerOpenId: 'owner-a', playerId: 'PLAYER-1', sessionId: 'session-1',
    updatedAt: 100, handVersion: 7, actionRevision: 'a'.repeat(64)
  }
  const next = prepareHandMetadataWrite(current, current, Object.assign({}, current, { notes: 'next', updatedAt: 101 }), 'PLAYER-1', 'owner-a', false)
  assert.equal(next.handVersion, 8)
  assert.equal(Object.hasOwn(cleanCloudDoc(next), 'handVersion'), false)
  assert.throws(() => prepareHandMetadataWrite(
    Object.assign({}, current, { handVersion: 8 }), current, next, 'PLAYER-1', 'owner-a', false
  ), /stale/)
})
