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
  let fullReadCount = 0
  return {
    pending,
    get fullReadCount() { return fullReadCount },
    collection(name) {
      return {
        where(filters) {
          const query = {
            skip() { return query },
            limit() { return query },
            get() {
              fullReadCount += 1
              return Promise.resolve({ data: [] })
            },
            count() {
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

  assert.equal(database.pending.length, 10, 'both ownership counters for all five collections should start together')
  database.pending.forEach(read => read.resolve({ total: 0 }))

  const candidate = await resultPromise
  assert.equal(database.fullReadCount, 0, 'empty recovery summaries must not fetch full collection pages')
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
