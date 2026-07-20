const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

function clone(value) { return JSON.parse(JSON.stringify(value)) }

function loadDataService(options = {}) {
  const state = Object.assign({
    backup: {
      profile: { playerId: 'PLAYER-A' }, sessions: [], hands: [], handActions: [], playerNotes: [], bankrollLogs: []
    },
    events: [], deleteHandCalls: [], deleteSessionCalls: [], withdrawCalls: [], clearResponses: []
  }, options)
  const storage = {}
  const store = {
    getSessions: () => clone(state.backup.sessions || []),
    getProfile: () => clone(state.backup.profile || { playerId: 'PLAYER-A' }),
    exportBackup: () => clone(state.backup),
    importBackup(value) { state.backup = clone(value); return clone(state.backup) },
    clearAllData() {
      state.events.push('local-clear')
      state.backup = { profile: { playerId: '' }, sessions: [], hands: [], handActions: [], playerNotes: [], bankrollLogs: [] }
      return clone(state.backup)
    },
    enqueueAiRemindersForHand() {}
  }
  const socialService = {
    scheduleMyStatsSync: async () => true,
    async withdrawSharesBySourceHand(input) {
      state.events.push('social-withdraw:' + input.handId)
      state.withdrawCalls.push(clone(input))
      if (state.withdrawError) throw state.withdrawError
      return { withdrawn: 1 }
    },
    async clearMySocialData(input) {
      state.events.push('social-clear')
      state.socialClearCalls = (state.socialClearCalls || []).concat([clone(input)])
      if (state.socialClearImpl) return state.socialClearImpl(input)
      if (state.socialClearError) throw state.socialClearError
      return state.clearResponses.shift() || { completed: true, remainingStage: '', socialUserId: 'su-a' }
    }
  }
  const cloudDataApi = {
    async loginAccount() { return {} },
    async recoverBestBackup() { return {} },
    async syncAndGetStats() { return { sessions: [], hands: [], settings: {} } },
    async deleteHand(input) {
      state.events.push('core-delete-hand')
      state.deleteHandCalls.push(clone(input))
      if (state.deleteHandImpl) return state.deleteHandImpl(input)
      return { deleted: true, handId: input.handId, session: null }
    },
    async deleteSession(input) {
      state.events.push('core-delete-session')
      state.deleteSessionCalls.push(clone(input))
      if (state.deleteSessionImpl) return state.deleteSessionImpl(input)
      return { deleted: true, sessionId: input.sessionId, handIds: ['hand-a', 'hand-b'] }
    },
    async clearAllData(input) {
      state.events.push('private-clear')
      state.privateClearCalls = (state.privateClearCalls || []).concat([clone(input)])
      if (state.privateClearImpl) return state.privateClearImpl(input)
      if (state.privateClearError) throw state.privateClearError
      return { completed: true }
    }
  }
  const socialCache = {
    clearAllFeedCaches() {},
    clearAccountCaches(input) { state.events.push('cache-clear'); state.cacheClearInput = clone(input); return true }
  }
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (parent && /services[\\/]data-service\.js$/.test(parent.filename || '')) {
      if (request === '../utils/store') return store
      if (request === './cloud-repo') return {}
      if (request === '../utils/cloud') return { canUseCloud: () => true }
      if (request === '../utils/session-rules') return { assertCanCreateSession() {} }
      if (request === './social-service') return socialService
      if (request === './cloud-data-api') return cloudDataApi
      if (request === '../utils/social-cache') return socialCache
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const previousWx = global.wx
  global.wx = {
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) {
      storage[key] = clone(value)
      if (key === 'pokerLiveAccountLoggedOut') state.events.push('account-logout:' + key)
    },
    removeStorageSync(key) { delete storage[key]; state.events.push('account-clear:' + key) },
    cloud: { callFunction: async () => ({ result: {} }) }
  }
  const modulePath = require.resolve('../services/data-service')
  delete require.cache[modulePath]
  let service
  try { service = require('../services/data-service') } finally { Module._load = originalLoad }
  return {
    service, state, storage,
    restore() {
      delete require.cache[modulePath]
      if (previousWx === undefined) delete global.wx
      else global.wx = previousWx
    }
  }
}

test('foreground hand/session delete share one deterministic best-effort social cleanup without leaking errors', async t => {
  const secret = new Error('private openid and source tuple')
  const loaded = loadDataService({ withdrawError: secret })
  t.after(() => loaded.restore())
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  t.after(() => { console.warn = originalWarn })

  assert.equal(await loaded.service.deleteHand('hand-one'), true)
  assert.equal(await loaded.service.deleteSession('session-one'), true)
  assert.deepEqual(loaded.state.withdrawCalls.map(call => call.handId), ['hand-one', 'hand-a', 'hand-b'])
  assert.ok(loaded.state.withdrawCalls.every(call => typeof call.clientMutationId === 'string' && call.clientMutationId.length <= 128))
  assert.ok(warnings.length >= 3)
  assert.doesNotMatch(warnings.join('\n'), /private openid|source tuple/)

  const derive = loaded.service.__test && loaded.service.__test.deriveWithdrawMutationId
  assert.equal(typeof derive, 'function')
  assert.equal(derive('PLAYER-A', 'hand-one', 'core-op'), derive('PLAYER-A', 'hand-one', 'core-op'))
  assert.notEqual(derive('PLAYER-A', 'hand-one', 'core-op'), derive('PLAYER-A', 'hand-two', 'core-op'))
  assert.notEqual(derive('PLAYER-A', 'hand-one', 'core-op'), derive('PLAYER-B', 'hand-one', 'core-op'))
})

test('response-lost delete reuses the core operation id and outbox replay runs the same post-delete cleanup', async t => {
  let attempt = 0
  const loaded = loadDataService({
    deleteHandImpl(input) {
      attempt += 1
      if (attempt === 1) {
        const error = new Error('response lost')
        error.code = 'NETWORK_ERROR'
        throw error
      }
      return { deleted: true, handId: input.handId, session: null }
    }
  })
  t.after(() => loaded.restore())
  await assert.rejects(loaded.service.deleteHand('hand-replay'), /response lost/)
  assert.equal(loaded.state.withdrawCalls.length, 0)
  await loaded.service.syncBusinessDataNow()
  assert.equal(loaded.state.deleteHandCalls.length, 2)
  assert.equal(loaded.state.deleteHandCalls[0].clientMutationId, loaded.state.deleteHandCalls[1].clientMutationId)
  assert.equal(loaded.state.withdrawCalls.length, 1)
  assert.equal(loaded.state.withdrawCalls[0].handId, 'hand-replay')
})

test('response-lost session delete replay withdraws every hand with distinct stable derived ids', async t => {
  let attempt = 0
  const loaded = loadDataService({
    deleteSessionImpl(input) {
      attempt += 1
      if (attempt === 1) throw Object.assign(new Error('response lost'), { code: 'NETWORK_ERROR' })
      return { deleted: true, sessionId: input.sessionId, handIds: ['hand-a', 'hand-b'] }
    }
  })
  t.after(() => loaded.restore())

  await assert.rejects(loaded.service.deleteSession('session-replay'), /response lost/)
  await loaded.service.syncBusinessDataNow()

  const coreMutationId = loaded.state.deleteSessionCalls[0].clientMutationId
  const derive = loaded.service.__test.deriveWithdrawMutationId
  assert.equal(loaded.state.deleteSessionCalls[1].clientMutationId, coreMutationId)
  assert.deepEqual(loaded.state.withdrawCalls.map(call => call.handId), ['hand-a', 'hand-b'])
  assert.deepEqual(loaded.state.withdrawCalls.map(call => call.clientMutationId), [
    derive('PLAYER-A', 'hand-a', coreMutationId),
    derive('PLAYER-A', 'hand-b', coreMutationId)
  ])
  assert.notEqual(loaded.state.withdrawCalls[0].clientMutationId, loaded.state.withdrawCalls[1].clientMutationId)
})

test('outbox delete success after an account switch still withdraws for the record owner and clears the record', async t => {
  let attempt = 0
  const loaded = loadDataService({
    deleteHandImpl(input) {
      attempt += 1
      if (attempt === 1) throw Object.assign(new Error('response lost'), { code: 'NETWORK_ERROR' })
      loaded.state.backup = {
        profile: { playerId: 'PLAYER-B' }, sessions: [],
        hands: [{ _id: 'hand-b-local' }], handActions: [], playerNotes: [], bankrollLogs: []
      }
      return { deleted: true, handId: input.handId, session: null }
    }
  })
  t.after(() => loaded.restore())

  await assert.rejects(loaded.service.deleteHand('hand-a-remote'), /response lost/)
  await loaded.service.syncBusinessDataNow()

  assert.equal(loaded.state.withdrawCalls.length, 1)
  assert.equal(loaded.state.withdrawCalls[0].handId, 'hand-a-remote')
  assert.equal(loaded.state.backup.profile.playerId, 'PLAYER-B')
  assert.deepEqual(loaded.state.backup.hands.map(hand => hand._id), ['hand-b-local'])
  assert.deepEqual((loaded.storage.pokerCloudMutationOutboxV1 || {}).records, [])
})

test('clearAllData is social-first, loops to completed, then clears private, local, account and scoped cache', async t => {
  const loaded = loadDataService({ clearResponses: [
    { completed: false, remainingStage: 'comments', socialUserId: 'su-a' },
    { completed: true, remainingStage: '', socialUserId: 'su-a' }
  ] })
  t.after(() => loaded.restore())
  await loaded.service.clearAllData()
  assert.deepEqual(loaded.state.events.filter(item => /^(social-clear|private-clear|local-clear|account-logout|cache-clear)/.test(item)), [
    'social-clear', 'social-clear', 'private-clear', 'local-clear', 'account-logout:pokerLiveAccountLoggedOut', 'cache-clear'
  ])
  assert.equal(loaded.storage.pokerLiveAccountLoggedOut, true)
  assert.equal(loaded.state.socialClearCalls[0].clientMutationId, loaded.state.socialClearCalls[1].clientMutationId)
  assert.deepEqual(loaded.state.cacheClearInput, { accountId: 'PLAYER-A', socialUserId: 'su-a' })
  assert.equal(loaded.state.privateClearCalls[0].playerId, 'PLAYER-A')
})

test('clearAllData propagates social/private failures and never clears later stages', async t => {
  const socialFailure = loadDataService({ socialClearError: Object.assign(new Error('social offline'), { code: 'NETWORK_ERROR' }) })
  t.after(() => socialFailure.restore())
  await assert.rejects(socialFailure.service.clearAllData(), /social offline/)
  assert.deepEqual(socialFailure.state.events.filter(item => /clear/.test(item)), ['social-clear'])

  const privateFailure = loadDataService({ privateClearError: new Error('private clear failed') })
  t.after(() => privateFailure.restore())
  await assert.rejects(privateFailure.service.clearAllData(), /private clear failed/)
  assert.deepEqual(privateFailure.state.events.filter(item => /clear/.test(item)), ['social-clear', 'private-clear'])
})

test('clearAllData retries successfully after partial social and private failures without early local clearing', async t => {
  let socialAttempt = 0
  const socialRetry = loadDataService({
    socialClearImpl() {
      socialAttempt += 1
      if (socialAttempt === 1) return { completed: false, remainingStage: 'comments', socialUserId: 'su-a' }
      if (socialAttempt === 2) throw Object.assign(new Error('social interrupted'), { code: 'NETWORK_ERROR' })
      return { completed: true, remainingStage: '', socialUserId: 'su-a' }
    }
  })
  t.after(() => socialRetry.restore())
  await assert.rejects(socialRetry.service.clearAllData(), /social interrupted/)
  assert.equal(socialRetry.state.socialClearCalls.length, 2)
  assert.equal(socialRetry.state.events.includes('local-clear'), false)
  await socialRetry.service.clearAllData()
  assert.equal(socialRetry.state.events.filter(item => item === 'local-clear').length, 1)

  let privateAttempt = 0
  const privateRetry = loadDataService({
    privateClearImpl() {
      privateAttempt += 1
      if (privateAttempt === 1) throw new Error('private interrupted')
      return { completed: true }
    }
  })
  t.after(() => privateRetry.restore())
  await assert.rejects(privateRetry.service.clearAllData(), /private interrupted/)
  assert.equal(privateRetry.state.events.includes('local-clear'), false)
  await privateRetry.service.clearAllData()
  assert.equal(privateRetry.state.events.filter(item => item === 'local-clear').length, 1)
})

test('clearAllData fails closed when the account changes during private clear and never touches the new local account', async t => {
  let releasePrivate
  let signalPrivateStarted
  const privateStarted = new Promise(resolve => { signalPrivateStarted = resolve })
  const loaded = loadDataService({
    privateClearImpl() {
      signalPrivateStarted()
      return new Promise(resolve => { releasePrivate = resolve })
    }
  })
  t.after(() => loaded.restore())

  const clearing = loaded.service.clearAllData()
  await privateStarted
  loaded.state.backup = {
    profile: { playerId: 'PLAYER-B' }, sessions: [{ _id: 'session-b' }],
    hands: [{ _id: 'hand-b' }], handActions: [], playerNotes: [], bankrollLogs: []
  }
  releasePrivate({ completed: true })

  await assert.rejects(clearing, error => error && error.code === 'STALE_ACCOUNT_CONTEXT')
  assert.equal(loaded.state.backup.profile.playerId, 'PLAYER-B')
  assert.deepEqual(loaded.state.backup.sessions.map(item => item._id), ['session-b'])
  assert.deepEqual(loaded.state.backup.hands.map(item => item._id), ['hand-b'])
  assert.equal(loaded.state.events.includes('local-clear'), false)
  assert.equal(loaded.storage.pokerLiveAccountLoggedOut, undefined)
  assert.equal(loaded.state.cacheClearInput, undefined)
})

test('clearAllData detects an account switch away and back by epoch even when the final player id matches', async t => {
  let releasePrivate
  let signalPrivateStarted
  const privateStarted = new Promise(resolve => { signalPrivateStarted = resolve })
  const loaded = loadDataService({
    privateClearImpl() {
      signalPrivateStarted()
      return new Promise(resolve => { releasePrivate = resolve })
    }
  })
  t.after(() => loaded.restore())

  const clearing = loaded.service.clearAllData()
  await privateStarted
  await loaded.service.switchToTestAccount()
  await loaded.service.exitTestAccount()
  assert.equal(loaded.state.backup.profile.playerId, 'PLAYER-A')
  releasePrivate({ completed: true })

  await assert.rejects(clearing, error => error && error.code === 'STALE_ACCOUNT_CONTEXT')
  assert.equal(loaded.state.events.includes('local-clear'), false)
  assert.equal(loaded.storage.pokerLiveAccountLoggedOut, undefined)
  assert.equal(loaded.state.cacheClearInput, undefined)
})

test('clearAllData caps social continuation at 200 rounds and exposes a stable retry code', async t => {
  const loaded = loadDataService({
    clearResponses: Array.from({ length: 200 }, () => ({ completed: false, remainingStage: 'shares', socialUserId: 'su-a' }))
  })
  t.after(() => loaded.restore())
  await assert.rejects(loaded.service.clearAllData(), error => error && error.code === 'SOCIAL_CLEAR_INCOMPLETE')
  assert.equal(loaded.state.socialClearCalls.length, 200)
  assert.equal(loaded.state.events.includes('private-clear'), false)
  assert.equal(loaded.state.events.includes('local-clear'), false)
})

test('profile reports completion only after clear succeeds and exposes an explicit retryable failure state', () => {
  const source = fs.readFileSync(path.join(__dirname, '../pages/profile/profile.js'), 'utf8')
  assert.match(source, /try\s*\{[\s\S]*await dataService\.clearAllData\(\)[\s\S]*已重置[\s\S]*\}\s*catch\s*\(/)
  assert.match(source, /未全部清除|可重试/)
})
