const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

const FEED_PREFIX = 'socialFeedFirstPage:'

test('clearAllFeedCaches removes every feed namespace key and preserves unrelated storage', () => {
  const storage = seededStorage()
  const originalWx = global.wx
  global.wx = storageWx(storage)
  try {
    const cachePath = require.resolve('../utils/social-cache')
    delete require.cache[cachePath]
    const cache = require(cachePath)
    assert.equal(typeof cache.clearAllFeedCaches, 'function')
    assert.equal(cache.clearAllFeedCaches(), 2)
    assert.equal(storage.has(FEED_PREFIX + 'su_a'), false)
    assert.equal(storage.has(FEED_PREFIX + 'su_b'), false)
    assert.deepEqual(storage.get('unrelated:key'), { keep: true })
  } finally {
    global.wx = originalWx
  }
})

for (const action of ['logoutAccount', 'clearAllData']) {
  test(`${action} clears all feed caches without touching other storage`, async () => {
    const storage = seededStorage()
    const loaded = loadDataService(storage)
    try {
      const result = await loaded.service[action]()
      assert.ok(result)
      assert.equal(storage.has(FEED_PREFIX + 'su_a'), false)
      assert.equal(storage.has(FEED_PREFIX + 'su_b'), false)
      assert.deepEqual(storage.get('unrelated:key'), { keep: true })
      assert.equal(loaded.calls[action], 1, 'the original account operation must still run')
    } finally { loaded.restore() }
  })

  test(`${action} survives feed-cache storage enumeration and removal failures`, async t => {
    for (const failure of ['info', 'remove']) {
      await t.test(failure, async () => {
        const storage = seededStorage()
        const loaded = loadDataService(storage, { failure })
        try {
          const result = await loaded.service[action]()
          assert.ok(result)
          assert.equal(loaded.calls[action], 1, 'cache cleanup must not block the original account operation')
          assert.deepEqual(storage.get('unrelated:key'), { keep: true })
        } finally { loaded.restore() }
      })
    }
  })
}

function seededStorage() {
  return new Map([
    [FEED_PREFIX + 'su_a', { account: 'a' }],
    [FEED_PREFIX + 'su_b', { account: 'b' }],
    ['unrelated:key', { keep: true }]
  ])
}

function storageWx(storage, options = {}) {
  return {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    getStorageInfoSync() {
      if (options.failure === 'info') throw new Error('storage info failed')
      return { keys: Array.from(storage.keys()) }
    },
    removeStorageSync(key) {
      if (options.failure === 'remove' && String(key).startsWith(FEED_PREFIX)) throw new Error('storage remove failed')
      storage.delete(key)
    }
  }
}

function loadDataService(storage, options = {}) {
  const calls = { logoutAccount: 0, clearAllData: 0 }
  const backup = {
    profile: { playerId: 'P5-ACCOUNT' },
    sessions: [], hands: [], handActions: [], playerNotes: [], bankrollLogs: []
  }
  const store = {
    exportBackup() { calls.logoutAccount += 1; return backup },
    clearAllData() { calls.clearAllData += 1; return backup },
    getProfile() { return backup.profile }
  }
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (parent && /services[\\/]data-service\.js$/.test(parent.filename || '')) {
      if (request === '../utils/store') return store
      if (request === './cloud-repo') return {}
      if (request === '../utils/cloud') return { canUseCloud: () => false }
      if (request === '../config/cloud') return { AUTO_CLOUD_BOOTSTRAP: false, AI_REMINDER_SUBSCRIBE_TEMPLATE_ID: '' }
      if (request === './social-service') return {}
      if ([
        '../utils/session-rules', '../utils/review-session-status', '../utils/stats-analytics',
        '../utils/onboarding-guide', '../utils/onboarding-demo-data', '../utils/pbt-notes-import',
        '../utils/pbt-bankroll-import', './cloud-data-api'
      ].includes(request)) return {}
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const originalWx = global.wx
  global.wx = storageWx(storage, options)
  const modulePath = require.resolve('../services/data-service')
  delete require.cache[modulePath]
  let service
  try { service = require(modulePath) } finally { Module._load = originalLoad }
  return {
    service,
    calls,
    restore() {
      delete require.cache[modulePath]
      global.wx = originalWx
    }
  }
}
