const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

test('app enables required-component lazy code loading', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))

  assert.equal(config.lazyCodeLoading, 'requiredComponents')
})

test('app launch does not synchronously initialize the full store or cloud sync', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8')

  assert.doesNotMatch(source, /store\.initStore\(\)/)
  assert.doesNotMatch(source, /bootstrapCloudSync\(/)
  assert.doesNotMatch(source, /require\(['"]\.\/services\/data-service['"]\)/)
})

test('session list schedules its first refresh after the initial page frame', () => {
  const source = fs.readFileSync(path.join(root, 'pages', 'session-list', 'session-list.js'), 'utf8')

  assert.doesNotMatch(source, /if \(!isFresh\) await this\.refreshSessions\(\)/)
  assert.match(source, /scheduleInitialSessionRefresh\(\)/)
  assert.match(source, /clearTimeout\(this\.initialSessionRefreshTimer\)/)
})

test('automatic cloud bootstrap is deferred beyond the first local refresh', () => {
  const source = fs.readFileSync(path.join(root, 'services', 'data-service.js'), 'utf8')

  assert.match(source, /CLOUD_BOOTSTRAP_DEFER_MS/)
  assert.match(source, /cloudBootstrapScheduleTimer = setTimeout\(/)
  assert.match(source, /if \(forceRefresh\) \{\s*start\(\)/)
})

test('reading sessions does not hydrate hand action chunks until actions are requested', () => {
  const storage = {}
  const reads = []
  global.wx = {
    getStorageSync(key) {
      reads.push(key)
      return storage[key]
    },
    setStorageSync(key, value) {
      storage[key] = value
    },
    removeStorageSync(key) {
      delete storage[key]
    }
  }

  const storePath = require.resolve('../utils/store')
  delete require.cache[storePath]
  const store = require('../utils/store')
  const backup = store.__test.buildInitialStoreData()
  backup.sessions = [{
    _id: 'session_startup',
    title: 'Startup',
    status: 'finished',
    startTime: '2026-07-15 12:00',
    createdAt: 1,
    updatedAt: 1
  }]
  backup.hands = [{
    _id: 'hand_startup',
    sessionId: 'session_startup',
    heroCardsInput: 'AsKs',
    createdAt: 1,
    updatedAt: 1
  }]
  backup.handActions = Array.from({ length: 120 }, (_, index) => ({
    _id: 'action_' + index,
    handId: 'hand_startup',
    street: 'preflop',
    actorLabel: 'Hero',
    actionType: 'call',
    sequence: index + 1
  }))

  store.importBackup(backup)
  store.__test.resetCachedStoreForTest()
  reads.length = 0

  assert.equal(store.getSessions().length, 1)
  assert.equal(
    reads.some(key => /^pokerLiveMiniappStore:handActions:\d+$/.test(key)),
    false,
    'session startup must not read hand action chunks'
  )

  assert.equal(store.getActionsByHandId('hand_startup').length, 120)
  assert.equal(
    reads.some(key => /^pokerLiveMiniappStore:handActions:\d+$/.test(key)),
    true,
    'action chunks should load when hand actions are requested'
  )
})
