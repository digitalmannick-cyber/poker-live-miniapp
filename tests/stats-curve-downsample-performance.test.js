const test = require('node:test')
const assert = require('node:assert/strict')

global.wx = global.wx || {}
global.Page = function () {}

const statsAnalytics = require('../utils/stats-analytics')
const statsPage = require('../pages/stats/stats')

test('downsample returns segment averages only above the point limit', () => {
  const small = [1, 2, 3]
  assert.equal(statsAnalytics.downsample(small, 200), small)

  const large = Array.from({ length: 500 }, (_, index) => index)
  const sampled = statsAnalytics.downsample(large, 200)

  assert.equal(sampled.length, 200)
  assert.equal(sampled[0], 0.5)
  assert.equal(sampled[199], 498)
})

test('curve view model keeps labels and all series aligned at 200 points', () => {
  const count = 501
  const graph = {
    labels: Array.from({ length: count }, (_, index) => index + 'h'),
    series: ['total', 'showdown', 'nonShowdown', 'allInEv'].map(key => ({
      key,
      values: Array.from({ length: count }, (_, index) => index),
      showInChart: true
    }))
  }

  const startedAt = process.hrtime.bigint()
  const model = statsPage.buildCurveViewModel(graph)
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1000000

  assert.equal(model.labels.length, 200)
  model.series.forEach(line => assert.equal(line.points.length, 200))
  assert(elapsedMs < 1000, `500+ point view model should finish within 1 second, got ${elapsedMs}ms`)
})

test('canvas curve lines are drawn in requestAnimationFrame batches within one second', async () => {
  let frameCalls = 0
  const canvas = {
    requestAnimationFrame(callback) {
      frameCalls += 1
      setImmediate(callback)
    }
  }
  const drawn = []
  const startedAt = process.hrtime.bigint()

  await statsPage.runFrameBatches(canvas, [1, 2, 3, 4], item => drawn.push(item), 1)
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1000000

  assert.deepEqual(drawn, [1, 2, 3, 4])
  assert.equal(frameCalls, 4)
  assert(elapsedMs < 1000, `batched canvas drawing should finish within 1 second, got ${elapsedMs}ms`)
})
