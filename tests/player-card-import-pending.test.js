const test = require('node:test')
const assert = require('node:assert/strict')

function loadPendingStore(storage, failures = {}) {
  const previousWx = global.wx
  global.wx = {
    getStorageSync(key) {
      if (failures.get === key) throw new Error('get failed')
      return storage.get(key)
    },
    setStorageSync(key, value) {
      if (failures.set === key) throw new Error('set failed')
      storage.set(key, value)
    },
    removeStorageSync(key) {
      if (failures.remove === key) throw new Error('remove failed')
      storage.delete(key)
    }
  }
  const modulePath = require.resolve('../utils/player-card-import-pending')
  delete require.cache[modulePath]
  const pendingStore = require(modulePath)
  return {
    pendingStore,
    restore() {
      delete require.cache[modulePath]
      if (previousWx === undefined) delete global.wx
      else global.wx = previousWx
    }
  }
}

test('pending imports are account-scoped and legacy no-account records fail closed', t => {
  const storage = new Map([
    ['playerCardImportPending:pcs_1', { shareId: 'pcs_1', mutationId: 'legacy' }]
  ])
  const loaded = loadPendingStore(storage)
  t.after(() => loaded.restore())
  const { pendingStore } = loaded

  assert.equal(pendingStore.read('PLAYER-A', 'pcs_1'), null)
  pendingStore.write({ version: 2, accountId: 'PLAYER-A', shareId: 'pcs_1', mutationId: 'a' })
  pendingStore.write({ version: 2, accountId: 'PLAYER-B', shareId: 'pcs_1', mutationId: 'b' })
  assert.equal(pendingStore.read('PLAYER-A', 'pcs_1').mutationId, 'a')
  assert.equal(pendingStore.read('PLAYER-B', 'pcs_1').mutationId, 'b')
  assert.equal(storage.get('playerCardImportPending:pcs_1').mutationId, 'legacy')
})

test('a known share can delete only its exact legacy key without scanning or touching another legacy share', t => {
  const validShareId = 'pcs_' + 'a'.repeat(32)
  const otherShareId = 'pcs_' + 'b'.repeat(32)
  const storage = new Map([
    ['playerCardImportPending:' + validShareId, { shareId: validShareId, mutationId: 'legacy-1' }],
    ['playerCardImportPending:' + otherShareId, { shareId: otherShareId, mutationId: 'legacy-2' }]
  ])
  const loaded = loadPendingStore(storage)
  t.after(() => loaded.restore())

  assert.equal(loaded.pendingStore.clearLegacy(validShareId), true)
  assert.equal(storage.has('playerCardImportPending:' + validShareId), false)
  assert.equal(storage.get('playerCardImportPending:' + otherShareId).mutationId, 'legacy-2')
})

test('legacy cleanup rejects route-shaped input and cannot delete another account v2 key', t => {
  const injectedShareId = 'v2:PLAYER-B:pcs_foo'
  const victimKey = 'playerCardImportPending:' + injectedShareId
  const storage = new Map([[victimKey, {
    version: 2, accountId: 'PLAYER-B', shareId: 'pcs_foo', mutationId: 'b'
  }]])
  const loaded = loadPendingStore(storage)
  t.after(() => loaded.restore())

  assert.equal(loaded.pendingStore.clearLegacy(injectedShareId), false)
  assert.equal(storage.get(victimKey).accountId, 'PLAYER-B')
})

test('account cleanup uses its validated exact-key index and preserves other accounts', t => {
  const storage = new Map()
  const loaded = loadPendingStore(storage)
  t.after(() => loaded.restore())
  const { pendingStore } = loaded

  pendingStore.write({ version: 2, accountId: 'PLAYER-A', shareId: 'pcs_1', mutationId: 'a1' })
  pendingStore.write({ version: 2, accountId: 'PLAYER-A', shareId: 'pcs_2', mutationId: 'a2' })
  pendingStore.write({ version: 2, accountId: 'PLAYER-B', shareId: 'pcs_1', mutationId: 'b1' })
  assert.equal(pendingStore.clearAccount('PLAYER-A'), true)
  assert.equal(pendingStore.read('PLAYER-A', 'pcs_1'), null)
  assert.equal(pendingStore.read('PLAYER-A', 'pcs_2'), null)
  assert.equal(pendingStore.read('PLAYER-B', 'pcs_1').mutationId, 'b1')
})

test('corrupt or cross-account index fails closed without removing any pending key', t => {
  const storage = new Map()
  const loaded = loadPendingStore(storage)
  t.after(() => loaded.restore())
  const { pendingStore } = loaded
  pendingStore.write({ version: 2, accountId: 'PLAYER-A', shareId: 'pcs_1', mutationId: 'a' })
  pendingStore.write({ version: 2, accountId: 'PLAYER-B', shareId: 'pcs_1', mutationId: 'b' })

  storage.set(pendingStore.indexKey('PLAYER-A'), {
    version: 1,
    accountId: 'PLAYER-B',
    keys: [pendingStore.storageKey('PLAYER-A', 'pcs_1'), pendingStore.storageKey('PLAYER-B', 'pcs_1')]
  })
  assert.equal(pendingStore.clearAccount('PLAYER-A'), false)
  assert.equal(pendingStore.read('PLAYER-A', 'pcs_1').mutationId, 'a')
  assert.equal(pendingStore.read('PLAYER-B', 'pcs_1').mutationId, 'b')
})

test('storage errors fail closed without touching another account', t => {
  const storage = new Map()
  const failures = {}
  const loaded = loadPendingStore(storage, failures)
  t.after(() => loaded.restore())
  const { pendingStore } = loaded
  pendingStore.write({ version: 2, accountId: 'PLAYER-A', shareId: 'pcs_1', mutationId: 'a' })
  pendingStore.write({ version: 2, accountId: 'PLAYER-B', shareId: 'pcs_1', mutationId: 'b' })

  failures.get = pendingStore.indexKey('PLAYER-A')
  assert.equal(pendingStore.clearAccount('PLAYER-A'), false)
  failures.get = ''
  assert.equal(pendingStore.read('PLAYER-A', 'pcs_1').mutationId, 'a')
  assert.equal(pendingStore.read('PLAYER-B', 'pcs_1').mutationId, 'b')
})

test('an index pointing at a cross-account pending envelope is rejected before any deletion', t => {
  const storage = new Map()
  const loaded = loadPendingStore(storage)
  t.after(() => loaded.restore())
  const { pendingStore } = loaded
  pendingStore.write({ version: 2, accountId: 'PLAYER-A', shareId: 'pcs_1', mutationId: 'a1' })
  pendingStore.write({ version: 2, accountId: 'PLAYER-A', shareId: 'pcs_2', mutationId: 'a2' })
  const firstKey = pendingStore.storageKey('PLAYER-A', 'pcs_1')
  const secondKey = pendingStore.storageKey('PLAYER-A', 'pcs_2')
  storage.set(secondKey, { version: 2, accountId: 'PLAYER-B', shareId: 'pcs_2', mutationId: 'corrupt' })

  assert.equal(pendingStore.clearAccount('PLAYER-A'), false)
  assert.equal(storage.get(firstKey).mutationId, 'a1')
  assert.equal(storage.get(secondKey).mutationId, 'corrupt')
})
