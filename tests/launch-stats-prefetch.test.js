const assert = require('assert')
const launchPrefetch = require('../utils/launch-prefetch')

async function run() {
  const scheduled = []
  let prefetchCalls = 0
  const service = {
    getCurrentPlayerId: () => 'WX-TEST',
    getCachedStatsData: () => null,
    prefetchStatsData: rangeKey => {
      prefetchCalls += 1
      assert.strictEqual(rangeKey, 'all')
      return Promise.resolve({ analytics: {} })
    }
  }
  const timerId = launchPrefetch.scheduleStatsPrefetch(service, {
    setTimeout(fn, delay) {
      scheduled.push({ fn, delay })
      return 17
    }
  })
  assert.strictEqual(timerId, 17)
  assert.strictEqual(scheduled.length, 1)
  assert.strictEqual(scheduled[0].delay, 600)
  assert.strictEqual(prefetchCalls, 0)
  await scheduled[0].fn()
  assert.strictEqual(prefetchCalls, 1)

  const noSchedule = () => {
    throw new Error('should not schedule')
  }
  assert.strictEqual(launchPrefetch.scheduleStatsPrefetch(Object.assign({}, service, {
    getCachedStatsData: () => ({ analytics: {} })
  }), { setTimeout: noSchedule }), null)
  assert.strictEqual(launchPrefetch.scheduleStatsPrefetch(Object.assign({}, service, {
    getCurrentPlayerId: () => ''
  }), { setTimeout: noSchedule }), null)

  const rejected = launchPrefetch.scheduleStatsPrefetch(Object.assign({}, service, {
    prefetchStatsData: () => Promise.reject(new Error('offline'))
  }), {
    setTimeout(fn) {
      scheduled.push({ fn, delay: 600 })
      return 18
    }
  })
  assert.strictEqual(rejected, 18)
  assert.strictEqual(await scheduled[1].fn(), null)
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
