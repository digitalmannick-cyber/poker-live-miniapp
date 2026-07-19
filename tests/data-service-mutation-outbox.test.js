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

function loadDataService(state) {
  const originalLoad = Module._load
  const storeAdapter = {
    getSessions: () => [],
    getProfile: () => clone(state.backup.profile || { playerId: 'PLAYER-A' }),
    exportBackup: () => clone(state.backup),
    importBackup(next) { state.backup = clone(next) },
    createPlayerNote(payload) {
      const note = Object.assign({ _id: `local-note-${Date.now()}` }, clone(payload || {}))
      state.backup.playerNotes = (state.backup.playerNotes || []).concat([note])
      return clone(note)
    },
    updatePlayerNote(id, patch) {
      let updated = null
      state.backup.playerNotes = (state.backup.playerNotes || []).map(note => {
        if (note._id !== id) return note
        updated = Object.assign({}, note, clone(patch || {}), { _id: id, updatedAt: Date.now() })
        return updated
      })
      return clone(updated)
    },
    enqueueAiRemindersForHand() {}
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
          async loginAccount() {
            if (state.events) state.events.push('login')
            return state.loginResult || {}
          },
          async recoverBestBackup() { return {} },
          async syncAndGetStats(input) {
            if (state.events) state.events.push('sync')
            if (state.syncCalls) state.syncCalls.push(clone(input))
            return { sessions: [], hands: [], settings: {} }
          },
          async createSession(input) {
            state.calls.push(clone(input))
            if (state.createSessionImpl) return state.createSessionImpl(input)
            const outcome = state.outcomes.shift() || 'success'
            if (outcome === 'failure') {
              const error = new Error('offline')
              error.code = 'NETWORK_ERROR'
              throw error
            }
            if (outcome === 'rejected') return { rejected: true, reason: 'ACTIVE_SESSION_EXISTS' }
            return { session: Object.assign({ _id: `session-${state.calls.length}` }, clone(input.payload)) }
          },
          async deleteSession(input) {
            if (state.events) state.events.push('delete')
            if (state.deleteCalls) state.deleteCalls.push(clone(input))
            return { deleted: true, sessionId: input.sessionId, handIds: [] }
          },
          async createPlayerNote(input) {
            if (state.noteCalls) state.noteCalls.push({ action: 'create', input: clone(input) })
            if (state.createPlayerNoteImpl) return state.createPlayerNoteImpl(input)
            const outcome = state.noteOutcomes && state.noteOutcomes.shift() || 'success'
            if (outcome === 'failure') {
              const error = new Error('note create offline')
              error.code = 'NETWORK_ERROR'
              throw error
            }
            return {
              playerNote: Object.assign({}, clone(input.payload), clone(state.noteCreateResult || {}), {
                _id: state.noteCreateResult && state.noteCreateResult._id || 'canonical-note'
              })
            }
          },
          async updatePlayerNote(input) {
            if (state.noteCalls) state.noteCalls.push({ action: 'update', input: clone(input) })
            return { playerNote: Object.assign({}, clone(input.patch), { _id: input.noteId }) }
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

test('different canonical payloads get distinct pending ids and restart success clears only its chain', async t => {
  const storage = {}
  const previousWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) { storage[key] = clone(value) },
    cloud: { callFunction: async () => ({ result: {} }) }
  }
  t.after(() => {
    global.wx = previousWx
    delete require.cache[require.resolve('../services/data-service')]
  })
  const state = {
    backup: { sessions: [], hands: [], handActions: [], playerNotes: [], bankrollLogs: [] },
    calls: [], outcomes: ['failure', 'failure', 'success']
  }
  const firstPayload = { title: 'First', status: 'finished' }
  const secondPayload = { status: 'finished', title: 'Second' }

  let service = loadDataService(state)
  await assert.rejects(service.createSession(clone(firstPayload)), /offline/)
  await assert.rejects(service.createSession(clone(secondPayload)), /offline/)
  const firstId = state.calls[0].clientMutationId
  const secondId = state.calls[1].clientMutationId
  assert.notEqual(firstId, secondId)
  assert.equal(storage.pokerCloudMutationOutboxV1.records.length, 2)

  service = loadDataService(state)
  const created = await service.createSession({ status: 'finished', title: 'First' })
  assert.equal(created.title, 'First')
  assert.equal(state.calls[2].clientMutationId, firstId)
  assert.equal(storage.pokerCloudMutationOutboxV1.records.length, 1)
  assert.equal(storage.pokerCloudMutationOutboxV1.records[0].clientMutationId, secondId)
})

test('authoritative rejection remains observable and the next manual chain gets a fresh id', async t => {
  const storage = {}
  const previousWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) { storage[key] = clone(value) },
    cloud: { callFunction: async () => ({ result: {} }) }
  }
  t.after(() => {
    global.wx = previousWx
    delete require.cache[require.resolve('../services/data-service')]
  })
  const state = {
    backup: { sessions: [], hands: [], handActions: [], playerNotes: [], bankrollLogs: [] },
    calls: [], outcomes: ['rejected', 'success']
  }
  const payload = { title: 'Rejected', status: 'finished' }
  let service = loadDataService(state)
  await assert.rejects(service.createSession(clone(payload)), /ACTIVE_SESSION_EXISTS/)
  const terminal = storage.pokerCloudMutationOutboxV1.records[0]
  assert.equal(terminal.status, 'terminal_rejected')

  service = loadDataService(state)
  await service.createSession(clone(payload))
  assert.notEqual(state.calls[1].clientMutationId, state.calls[0].clientMutationId)
  assert.equal(storage.pokerCloudMutationOutboxV1.records.some(row => row.status === 'pending'), false)
})

test('terminal history capacity never evicts the oldest pending mutation across restart', async t => {
  const storage = {}
  const previousWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) { storage[key] = clone(value) },
    cloud: { callFunction: async () => ({ result: {} }) }
  }
  t.after(() => {
    global.wx = previousWx
    delete require.cache[require.resolve('../services/data-service')]
  })
  const state = {
    backup: { sessions: [], hands: [], handActions: [], playerNotes: [], bankrollLogs: [] },
    calls: [], outcomes: ['failure', 'success']
  }
  const payload = { title: 'Oldest pending', status: 'finished' }
  let service = loadDataService(state)
  await assert.rejects(service.createSession(clone(payload)), /offline/)
  const pendingId = state.calls[0].clientMutationId

  for (let index = 0; index < 55; index += 1) {
    await service.__test.runAuthoritativeMutation(
      'create_session', `terminal-${index}`,
      { playerId: 'PLAYER-A', payload: { title: `Rejected ${index}` } },
      async () => ({ rejected: true, reason: 'ACTIVE_SESSION_EXISTS' })
    )
  }

  const retained = storage.pokerCloudMutationOutboxV1.records
  assert.equal(retained.some(row => row.status === 'pending' && row.clientMutationId === pendingId), true)
  assert.equal(retained.filter(row => row.status === 'terminal_rejected').length, 50)

  service = loadDataService(state)
  await service.createSession(clone(payload))
  assert.equal(state.calls[1].clientMutationId, pendingId)
})

test('bootstrap drains a response-lost create with its original id and reconciles the authoritative session', async t => {
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
  const state = {
    backup: { profile: { playerId: 'PLAYER-A' }, settings: {}, sessions: [], hands: [], handActions: [], playerNotes: [], bankrollLogs: [] },
    calls: [], outcomes: ['failure', 'success']
  }
  const payload = { title: 'Recovered create', status: 'finished' }
  let service = loadDataService(state)
  await assert.rejects(service.createSession(clone(payload)), /offline/)
  const originalId = state.calls[0].clientMutationId

  service = loadDataService(state)
  await service.bootstrapCloudSync(true, { waitForCloud: true, timeoutMs: 1000 })

  assert.equal(state.calls.length, 2)
  assert.equal(state.calls[1].clientMutationId, originalId)
  assert.equal(storage.pokerCloudMutationOutboxV1.records.some(row => row.status === 'pending'), false)
  assert.equal(state.backup.sessions.length, 1)
  assert.equal(state.backup.sessions[0].title, payload.title)
})

test('outbox drain is account isolated single-flight and bounded to five pending records', async t => {
  const storage = {}
  const previousWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) { storage[key] = clone(value) },
    cloud: { callFunction: async () => ({ result: {} }) }
  }
  t.after(() => {
    global.wx = previousWx
    delete require.cache[require.resolve('../services/data-service')]
  })
  const state = {
    backup: { profile: { playerId: 'PLAYER-A' }, settings: {}, sessions: [], hands: [], handActions: [], playerNotes: [], bankrollLogs: [] },
    calls: [], outcomes: []
  }
  const service = loadDataService(state)
  const records = []
  for (let index = 0; index < 7; index += 1) {
    const payload = { playerId: 'PLAYER-A', payload: { title: `Mine ${index}`, status: 'finished' } }
    records.push({
      accountId: 'PLAYER-A', action: 'create_session', targetId: '', payload,
      descriptor: service.__test.mutationOutboxDescriptor('PLAYER-A', 'create_session', '', payload),
      clientMutationId: `mine-${index}`, status: 'pending', attemptCount: 0, createdAt: index, updatedAt: index
    })
  }
  const foreignPayload = { playerId: 'PLAYER-B', payload: { title: 'Foreign', status: 'finished' } }
  records.push({
    accountId: 'PLAYER-B', action: 'create_session', targetId: '', payload: foreignPayload,
    descriptor: service.__test.mutationOutboxDescriptor('PLAYER-B', 'create_session', '', foreignPayload),
    clientMutationId: 'foreign-0', status: 'pending', attemptCount: 0, createdAt: 99, updatedAt: 99
  })
  storage.pokerCloudMutationOutboxV1 = { version: 1, records }

  await Promise.all([service.__test.drainCloudMutationOutbox(), service.__test.drainCloudMutationOutbox()])

  assert.equal(state.calls.length, 5)
  assert.equal(state.backup.sessions.length, 5)
  const remaining = storage.pokerCloudMutationOutboxV1.records.filter(row => row.status === 'pending')
  assert.equal(remaining.filter(row => row.accountId === 'PLAYER-A').length, 2)
  assert.equal(remaining.filter(row => row.accountId === 'PLAYER-B').length, 1)
})

test('bootstrap logs in before replaying a response-lost delete and never uploads the deleted session', async t => {
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
  const state = {
    backup: {
      profile: { playerId: 'PLAYER-A' }, settings: {},
      sessions: [{ _id: 'session-lost', title: 'Must stay deleted' }],
      hands: [], handActions: [], playerNotes: [], bankrollLogs: []
    },
    calls: [], outcomes: [], events: [], deleteCalls: [], syncCalls: [],
    loginResult: null
  }
  state.loginResult = { accountPlayerId: 'PLAYER-A', backup: clone(state.backup) }
  let service = loadDataService(state)
  const mutationPayload = { playerId: 'PLAYER-A', sessionId: 'session-lost' }
  await assert.rejects(service.__test.runAuthoritativeMutation(
    'delete_session', 'session-lost', mutationPayload,
    async () => {
      const error = new Error('response lost after server delete')
      error.code = 'NETWORK_ERROR'
      throw error
    }
  ), /response lost/)

  service = loadDataService(state)
  await service.bootstrapCloudSync(true, { waitForCloud: true, timeoutMs: 1000 })

  assert.deepEqual(state.events.slice(0, 2), ['login', 'delete'])
  assert.equal(state.deleteCalls.length, 1)
  assert.equal(state.backup.sessions.length, 0)
  assert.equal(state.syncCalls.some(call => (call.backup.sessions || []).some(row => row._id === 'session-lost')), false)
  assert.equal(storage.pokerCloudMutationOutboxV1.records.some(row => row.status === 'pending'), false)
})

test('drain stops FIFO after a transient create-note failure and does not send the dependent update', async t => {
  const storage = {}
  const previousWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) { storage[key] = clone(value) },
    cloud: { callFunction: async () => ({ result: {} }) }
  }
  t.after(() => {
    global.wx = previousWx
    delete require.cache[require.resolve('../services/data-service')]
  })
  const state = {
    backup: { profile: { playerId: 'PLAYER-A' }, settings: {}, sessions: [], hands: [], handActions: [], playerNotes: [], bankrollLogs: [] },
    calls: [], outcomes: [], noteCalls: [], noteOutcomes: ['failure']
  }
  const service = loadDataService(state)
  const createPayload = { playerId: 'PLAYER-A', payload: { _id: 'local-note', name: 'Local' } }
  const updatePayload = { playerId: 'PLAYER-A', noteId: 'local-note', patch: { note: 'Dependent update' } }
  storage.pokerCloudMutationOutboxV1 = { version: 1, records: [
    {
      accountId: 'PLAYER-A', action: 'create_player_note', targetId: 'local-note', payload: createPayload,
      descriptor: service.__test.mutationOutboxDescriptor('PLAYER-A', 'create_player_note', 'local-note', createPayload),
      clientMutationId: 'create-note-1', status: 'pending', attemptCount: 0, createdAt: 1, updatedAt: 1
    },
    {
      accountId: 'PLAYER-A', action: 'update_player_note', targetId: 'local-note', payload: updatePayload,
      descriptor: service.__test.mutationOutboxDescriptor('PLAYER-A', 'update_player_note', 'local-note', updatePayload),
      clientMutationId: 'update-note-1', status: 'pending', attemptCount: 0, createdAt: 2, updatedAt: 2
    }
  ] }

  await service.__test.drainCloudMutationOutbox()

  assert.deepEqual(state.noteCalls.map(call => call.action), ['create'])
  assert.equal(storage.pokerCloudMutationOutboxV1.records.filter(row => row.status === 'pending').length, 2)
  assert.equal(storage.pokerCloudMutationOutboxV1.records.some(row => row.status === 'terminal_rejected'), false)
})

test('account switch starts an independent drain and stale account results never merge into the new account', async t => {
  const storage = {}
  const previousWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) { storage[key] = clone(value) },
    cloud: { callFunction: async () => ({ result: {} }) }
  }
  t.after(() => {
    global.wx = previousWx
    delete require.cache[require.resolve('../services/data-service')]
  })
  const pendingA = deferred()
  const pendingB = deferred()
  const state = {
    backup: { profile: { playerId: 'PLAYER-A' }, settings: {}, sessions: [], hands: [], handActions: [], playerNotes: [], bankrollLogs: [] },
    calls: [], outcomes: [],
    createSessionImpl(input) {
      return input.clientMutationId === 'account-a' ? pendingA.promise : pendingB.promise
    }
  }
  const service = loadDataService(state)
  const makeRecord = (accountId, mutationId) => {
    const payload = { playerId: accountId, payload: { title: accountId, status: 'finished' } }
    return {
      accountId, action: 'create_session', targetId: '', payload,
      descriptor: service.__test.mutationOutboxDescriptor(accountId, 'create_session', '', payload),
      clientMutationId: mutationId, status: 'pending', attemptCount: 0, createdAt: 1, updatedAt: 1
    }
  }
  storage.pokerCloudMutationOutboxV1 = { version: 1, records: [makeRecord('PLAYER-A', 'account-a'), makeRecord('PLAYER-B', 'account-b')] }

  const drainA = service.__test.drainCloudMutationOutbox()
  await Promise.resolve()
  state.backup.profile.playerId = 'PLAYER-B'
  const drainB = service.__test.drainCloudMutationOutbox()
  await Promise.resolve()
  const bStarted = state.calls.some(call => call.clientMutationId === 'account-b')
  if (bStarted) pendingB.resolve({ session: { _id: 'session-b', title: 'B' } })
  pendingA.resolve({ session: { _id: 'session-a', title: 'A' } })
  await Promise.all([drainA, drainB])

  assert.equal(bStarted, true)
  assert.equal(state.backup.sessions.some(row => row._id === 'session-a'), false)
  assert.equal(state.backup.sessions.some(row => row._id === 'session-b'), true)
})

test('replayed library note create replaces the local id, preserves annotations, and updates by canonical id', async t => {
  const storage = {}
  const previousWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) { storage[key] = clone(value) },
    cloud: { callFunction: async () => ({ result: {} }) }
  }
  t.after(() => {
    global.wx = previousWx
    delete require.cache[require.resolve('../services/data-service')]
  })
  const localNote = {
    _id: 'local-note', name: 'Wolf', sourceKind: 'library', note: 'private annotation',
    leakTags: ['wide call'], battleHandIds: ['hand-1'], createdAt: 1, updatedAt: 2
  }
  const state = {
    backup: { profile: { playerId: 'PLAYER-A' }, settings: {}, sessions: [], hands: [], handActions: [], playerNotes: [localNote], bankrollLogs: [] },
    calls: [], outcomes: [], noteCalls: [], noteOutcomes: [],
    noteCreateResult: { _id: 'canonical-note', name: 'Wolf', sourceKind: 'library', updatedAt: 3 }
  }
  const service = loadDataService(state)
  const payload = { playerId: 'PLAYER-A', payload: localNote }
  const updatePayload = { playerId: 'PLAYER-A', noteId: 'local-note', patch: { note: 'dependent update' } }
  storage.pokerCloudMutationOutboxV1 = { version: 1, records: [
    {
      accountId: 'PLAYER-A', action: 'create_player_note', targetId: 'local-note', payload,
      descriptor: service.__test.mutationOutboxDescriptor('PLAYER-A', 'create_player_note', 'local-note', payload),
      clientMutationId: 'canonical-create', status: 'pending', attemptCount: 0, createdAt: 1, updatedAt: 1
    },
    {
      accountId: 'PLAYER-A', action: 'update_player_note', targetId: 'local-note', payload: updatePayload,
      descriptor: service.__test.mutationOutboxDescriptor('PLAYER-A', 'update_player_note', 'local-note', updatePayload),
      clientMutationId: 'canonical-update', status: 'pending', attemptCount: 0, createdAt: 2, updatedAt: 2
    }
  ] }

  await service.__test.drainCloudMutationOutbox()
  assert.equal(state.backup.playerNotes.length, 1)
  assert.equal(state.backup.playerNotes[0]._id, 'canonical-note')
  assert.equal(state.backup.playerNotes[0].note, localNote.note)
  assert.deepEqual(state.backup.playerNotes[0].leakTags, localNote.leakTags)
  assert.deepEqual(state.backup.playerNotes[0].battleHandIds, localNote.battleHandIds)
  assert.deepEqual(state.noteCalls.map(call => call.action), ['create', 'update'])
  assert.equal(state.noteCalls[1].input.noteId, 'canonical-note')

  await service.updatePlayerNote('canonical-note', { note: 'next' }, { waitForCloud: true })
  const update = state.noteCalls.find(call => call.action === 'update')
  assert.equal(update.input.noteId, 'canonical-note')
})

test('foreground session create clears only account A success and rejects its stale response after switching to B', async t => {
  const storage = {}
  const previousWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) { storage[key] = clone(value) },
    cloud: { callFunction: async () => ({ result: {} }) }
  }
  t.after(() => {
    global.wx = previousWx
    delete require.cache[require.resolve('../services/data-service')]
  })
  const pending = deferred()
  const state = {
    backup: { profile: { playerId: 'PLAYER-A' }, settings: {}, sessions: [], hands: [], handActions: [], playerNotes: [], bankrollLogs: [] },
    calls: [], outcomes: [], createSessionImpl: () => pending.promise
  }
  const service = loadDataService(state)
  const request = service.createSession({ title: 'A result', status: 'finished' })
  await Promise.resolve()
  state.backup = { profile: { playerId: 'PLAYER-B' }, settings: {}, sessions: [], hands: [], handActions: [], playerNotes: [], bankrollLogs: [] }
  pending.resolve({ session: { _id: 'session-a', title: 'A result' } })

  await assert.rejects(request, error => error && error.code === 'STALE_ACCOUNT_CONTEXT')
  assert.equal(state.backup.sessions.some(row => row._id === 'session-a'), false)
  assert.equal(storage.pokerCloudMutationOutboxV1.records.some(row => row.accountId === 'PLAYER-A' && row.status === 'pending'), false)
})

test('foreground player-note create never merges account A canonical response into B after an account switch', async t => {
  const storage = {}
  const previousWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) { storage[key] = clone(value) },
    cloud: { callFunction: async () => ({ result: {} }) }
  }
  t.after(() => {
    global.wx = previousWx
    delete require.cache[require.resolve('../services/data-service')]
  })
  const pending = deferred()
  const state = {
    backup: { profile: { playerId: 'PLAYER-A' }, settings: {}, sessions: [], hands: [], handActions: [], playerNotes: [], bankrollLogs: [] },
    calls: [], outcomes: [], noteCalls: [], createPlayerNoteImpl: () => pending.promise
  }
  const service = loadDataService(state)
  const request = service.createPlayerNote({ _id: 'local-a', name: 'A note', sourceKind: 'library' }, { waitForCloud: true })
  await Promise.resolve()
  state.backup = {
    profile: { playerId: 'PLAYER-B' }, settings: {}, sessions: [], hands: [], handActions: [],
    playerNotes: [{ _id: 'note-b', name: 'B note', sourceKind: 'library' }], bankrollLogs: []
  }
  pending.resolve({ playerNote: { _id: 'canonical-a', name: 'A note', sourceKind: 'library' } })

  await assert.rejects(request, error => error && error.code === 'STALE_ACCOUNT_CONTEXT')
  assert.deepEqual(state.backup.playerNotes.map(row => row._id), ['note-b'])
  assert.equal(storage.pokerCloudMutationOutboxV1.records.some(row => row.accountId === 'PLAYER-A' && row.status === 'pending'), false)
})
