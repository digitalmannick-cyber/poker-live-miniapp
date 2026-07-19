const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

function matches(doc, filters) {
  return Object.keys(filters || {}).every(key => doc && doc[key] === filters[key])
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createCollections(seed) {
  const collections = Object.assign({
    player_notes: [],
    sync_operations: [],
    audit_logs: []
  }, seed || {})
  let transactionTail = Promise.resolve()

  function collection(name, source) {
    const store = source || collections
    let filters = {}
    let offset = 0
    let limit = 100
    if (!store[name]) store[name] = []
    return {
      where(nextFilters) {
        filters = nextFilters || {}
        return this
      },
      skip(nextOffset) {
        offset = Number(nextOffset) || 0
        return this
      },
      limit(nextLimit) {
        limit = Number(nextLimit) || 100
        return this
      },
      async get() {
        return { data: store[name].filter(item => matches(item, filters)).slice(offset, offset + limit) }
      },
      async add({ data }) {
        const next = Object.assign({ _id: name + '_' + (store[name].length + 1) }, data)
        store[name].push(next)
        return { _id: next._id }
      },
      doc(id) {
        return {
          async get() {
            const found = store[name].find(item => item._id === id)
            if (!found) throw new Error('not found')
            return { data: found }
          },
          async set({ data }) {
            const next = Object.assign({ _id: id }, data)
            const index = store[name].findIndex(item => item._id === id)
            if (index === -1) store[name].push(next)
            else store[name][index] = next
          },
          async remove() {
            store[name] = store[name].filter(item => item._id !== id)
          }
        }
      }
    }
  }

  return {
    collections,
    collection,
    runTransaction(callback) {
      const operation = transactionTail.then(async () => {
        const draft = clone(collections)
        const result = await callback({ collection(name) { return collection(name, draft) } })
        Object.keys(collections).forEach(key => delete collections[key])
        Object.assign(collections, draft)
        return result
      })
      transactionTail = operation.then(() => undefined, () => undefined)
      return operation
    }
  }
}

function loadPokerData(seed, ownerOpenId) {
  const mock = createCollections(seed)
  let activeOwnerOpenId = ownerOpenId || 'owner_a'
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() {
          return { collection: mock.collection, runTransaction: mock.runTransaction }
        },
        getWXContext() {
          return { OPENID: activeOwnerOpenId }
        }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const modulePath = require.resolve('../cloudfunctions/poker_data/index')
  delete require.cache[modulePath]
  try {
    return {
      pokerData: require('../cloudfunctions/poker_data/index'),
      collections: mock.collections,
      setOwnerOpenId(value) {
        activeOwnerOpenId = value
      }
    }
  } finally {
    Module._load = originalLoad
  }
}

function createFriendEvent(clientMutationId, localId, linkedFriendUserId) {
  return {
    action: 'create_player_note',
    playerId: 'WX-OWNER',
    clientMutationId,
    payload: {
      _id: localId,
      sourceKind: 'friend',
      linkedFriendUserId,
      name: 'Table Wolf',
      note: 'private note'
    }
  }
}

test('two devices creating a friend note with different local IDs converge on one canonical cloud document', async () => {
  const { pokerData, collections } = loadPokerData()
  const [left, right] = await Promise.all([
    pokerData.main(createFriendEvent('device_a', 'local_a', 'su_friend')),
    pokerData.main(createFriendEvent('device_b', 'local_b', 'su_friend'))
  ])

  assert.equal(left.code, 0, left.message)
  assert.equal(right.code, 0, right.message)
  assert.equal(left.data.playerNote._id, right.data.playerNote._id)
  assert.notEqual(left.data.playerNote._id, 'local_a')
  assert.notEqual(right.data.playerNote._id, 'local_b')
  assert.match(left.data.playerNote._id, /^[a-f0-9]{64}$/)
  assert.equal(collections.player_notes.length, 1)
  assert.equal(collections.player_notes[0]._id, left.data.playerNote._id)

  const sequential = await pokerData.main(createFriendEvent('device_c', 'local_c', 'su_friend'))
  assert.equal(sequential.code, 0)
  assert.equal(sequential.data.playerNote._id, left.data.playerNote._id)
  assert.equal(collections.player_notes.length, 1, 'a later device must also converge without trusting its local ID')
})

test('recreating an archived legacy friend note restores the owner-scoped note without erasing private annotations', async () => {
  const { pokerData, collections } = loadPokerData({
    player_notes: [{
      _id: 'legacy_note',
      playerId: 'WX-OWNER',
      ownerOpenId: 'owner_a',
      sourceKind: 'friend',
      linkedFriendUserId: 'su_friend',
      name: 'Local Wolf',
      note: 'keep me',
      leakTags: ['wide call'],
      archived: true,
      createdAt: 1,
      updatedAt: 2
    }]
  })
  const result = await pokerData.main(createFriendEvent('restore_legacy', 'local_new', 'su_friend'))

  assert.equal(result.code, 0, result.message)
  assert.equal(result.data.playerNote._id, 'legacy_note')
  assert.equal(result.data.playerNote.archived, false)
  assert.equal(result.data.playerNote.name, 'Local Wolf')
  assert.equal(result.data.playerNote.note, 'keep me')
  assert.deepEqual(result.data.playerNote.leakTags, ['wide call'])
  assert.equal(collections.player_notes[0].archived, false)
})

test('friend source transitions are constrained while detach remains allowed', async () => {
  const { pokerData } = loadPokerData()
  const missingLink = await pokerData.main(createFriendEvent('missing_link', 'local_missing', ''))
  assert.equal(missingLink.code, 0)
  assert.equal(missingLink.data.reason, 'FRIEND_LINK_REQUIRED')

  const library = await pokerData.main({
    action: 'create_player_note',
    playerId: 'WX-OWNER',
    clientMutationId: 'library_create',
    payload: { _id: 'library_note', name: 'Library player' }
  })
  const promote = await pokerData.main({
    action: 'update_player_note',
    playerId: 'WX-OWNER',
    clientMutationId: 'library_promote',
    noteId: library.data.playerNote._id,
    patch: { sourceKind: 'friend', linkedFriendUserId: 'su_other' }
  })
  assert.equal(promote.code, 0)
  assert.equal(promote.data.reason, 'FRIEND_SOURCE_KIND_IMMUTABLE')

  const friend = await pokerData.main(createFriendEvent('friend_create', 'local_friend', 'su_bound'))
  const rebind = await pokerData.main({
    action: 'update_player_note',
    playerId: 'WX-OWNER',
    clientMutationId: 'friend_rebind',
    noteId: friend.data.playerNote._id,
    patch: { linkedFriendUserId: 'su_rebound' }
  })
  assert.equal(rebind.code, 0)
  assert.equal(rebind.data.reason, 'FRIEND_LINK_IMMUTABLE')

  const detached = await pokerData.main({
    action: 'update_player_note',
    playerId: 'WX-OWNER',
    clientMutationId: 'friend_detach',
    noteId: friend.data.playerNote._id,
    patch: { sourceKind: 'library' }
  })
  assert.equal(detached.code, 0)
  assert.equal(detached.data.playerNote.sourceKind, 'library')
  assert.equal(detached.data.playerNote.linkedFriendUserId, '')
})

test('owner-scoped friend creates use updatedAt last-write-wins without changing the binding', async () => {
  const { pokerData, collections } = loadPokerData({
    player_notes: [{
      _id: 'legacy_lww',
      playerId: 'WX-OWNER',
      ownerOpenId: 'owner_a',
      sourceKind: 'friend',
      linkedFriendUserId: 'su_friend',
      name: 'Remote old',
      avatarUrl: 'https://remote.example/old.png',
      type: 'RemoteType',
      leakTags: ['remote'],
      note: 'remote note',
      battleHandIds: ['remote-hand'],
      archived: false,
      createdAt: 1,
      updatedAt: 10
    }]
  })
  const localNewer = await pokerData.main(Object.assign(createFriendEvent('local_newer', 'local_newer', 'su_friend'), {
    payload: {
      _id: 'local_newer',
      sourceKind: 'friend',
      linkedFriendUserId: 'su_friend',
      name: 'Local newer',
      avatarUrl: 'wxfile://local.png',
      type: 'LocalType',
      leakTags: ['local'],
      note: 'local note',
      battleHandIds: ['local-hand'],
      updatedAt: 20
    }
  }))
  assert.equal(localNewer.data.playerNote._id, 'legacy_lww')
  assert.equal(localNewer.data.playerNote.name, 'Local newer')
  assert.equal(localNewer.data.playerNote.avatarUrl, 'wxfile://local.png')
  assert.equal(localNewer.data.playerNote.type, 'LocalType')
  assert.deepEqual(localNewer.data.playerNote.leakTags, ['local'])
  assert.equal(localNewer.data.playerNote.note, 'local note')
  assert.deepEqual(localNewer.data.playerNote.battleHandIds, ['local-hand'])
  assert.equal(localNewer.data.playerNote.linkedFriendUserId, 'su_friend')

  const remoteNewer = await pokerData.main(Object.assign(createFriendEvent('remote_newer', 'local_older', 'su_friend'), {
    payload: {
      _id: 'local_older',
      sourceKind: 'friend',
      linkedFriendUserId: 'su_friend',
      name: 'Offline older',
      note: 'must not replace newer cloud note',
      updatedAt: 15
    }
  }))
  assert.equal(remoteNewer.data.playerNote.name, 'Local newer')
  assert.equal(remoteNewer.data.playerNote.note, 'local note')
  assert.equal(collections.player_notes[0].linkedFriendUserId, 'su_friend')
})

test('same linked friend ID is isolated across owners and player IDs', async () => {
  const { pokerData, collections, setOwnerOpenId } = loadPokerData()
  const first = await pokerData.main(createFriendEvent('owner_a_player_1', 'local_a', 'su_shared'))
  setOwnerOpenId('owner_b')
  const otherOwner = await pokerData.main(createFriendEvent('owner_b_player_1', 'local_b', 'su_shared'))
  setOwnerOpenId('owner_a')
  const otherPlayer = await pokerData.main(Object.assign(createFriendEvent('owner_a_player_2', 'local_c', 'su_shared'), {
    playerId: 'WX-OTHER'
  }))

  assert.notEqual(first.data.playerNote._id, otherOwner.data.playerNote._id)
  assert.notEqual(first.data.playerNote._id, otherPlayer.data.playerNote._id)
  assert.notEqual(otherOwner.data.playerNote._id, otherPlayer.data.playerNote._id)
  assert.equal(collections.player_notes.length, 3)
  assert.equal(collections.player_notes.filter(item => item.ownerOpenId === 'owner_a' && item.playerId === 'WX-OWNER').length, 1)
  assert.equal(collections.player_notes.filter(item => item.ownerOpenId === 'owner_b' && item.playerId === 'WX-OWNER').length, 1)
  assert.equal(collections.player_notes.filter(item => item.ownerOpenId === 'owner_a' && item.playerId === 'WX-OTHER').length, 1)
})
