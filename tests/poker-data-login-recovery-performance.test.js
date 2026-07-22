const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

function loadPokerData(database) {
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() { return database }
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

function createControlledReadDatabase() {
  const pending = []
  return {
    pending,
    collection(name) {
      return {
        where(filters) {
          const query = {
            skip() { return query },
            limit() { return query },
            get() {
              return new Promise(resolve => pending.push({ name, filters, resolve }))
            }
          }
          return query
        }
      }
    }
  }
}

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve))
}

test('login recovery reads independent business collections concurrently', async () => {
  const database = createControlledReadDatabase()
  const pokerData = loadPokerData(database)
  assert.equal(typeof pokerData.__test.buildRecoveryCandidate, 'function')

  const resultPromise = pokerData.__test.buildRecoveryCandidate('PLAYER-A', 'owner-a', { updatedAt: 7 })
  await nextTurn()

  assert.equal(database.pending.length, 5, 'all five owner-scoped collection reads should start together')
  database.pending.slice(0, 5).forEach(read => read.resolve({ data: [] }))
  await nextTurn()

  assert.equal(database.pending.length, 10, 'legacy owner reads should start together after primary reads')
  database.pending.slice(5, 10).forEach(read => read.resolve({ data: [] }))

  const candidate = await resultPromise
  assert.deepEqual(candidate, {
    playerId: 'PLAYER-A',
    name: '',
    avatarText: '',
    sessionCount: 0,
    handCount: 0,
    handActionCount: 0,
    playerNoteCount: 0,
    bankrollLogCount: 0,
    updatedAt: 7,
    score: 0
  })
})
