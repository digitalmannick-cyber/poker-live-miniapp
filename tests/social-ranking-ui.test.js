const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const root = path.join(__dirname, '..')

test('ranking surface has podium, rich rank cards, privacy states and reduced-motion support', () => {
  const wxml = fs.readFileSync(path.join(root, 'components/friend-hub/friend-hub.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(root, 'components/friend-hub/friend-hub.wxss'), 'utf8')
  assert.match(wxml, /本周[\s\S]*本月[\s\S]*累计/)
  assert.match(wxml, /ranking-podium[\s\S]*ranking-list/)
  assert.match(wxml, /我的排名/)
  assert.match(wxml, /rankingStatus === 'loading'[\s\S]*rankingStatus === 'error'[\s\S]*rankingRows\.length/)
  assert.match(wxss, /ranking-podium/)
  assert.match(wxss, /ranking-row-accent/)
  assert.match(wxss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  assert.doesNotMatch(wxss, /rotate\(/)
})

test('range switching ignores stale ranking responses and does not duplicate an in-top10 viewer', async () => {
  let definition
  const pending = []
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (parent && /components[\\/]friend-hub[\\/]friend-hub\.js$/.test(parent.filename || '')) {
      if (request === '../../services/social-service') return {
        listRanking(input) { return new Promise(resolve => pending.push({ rangeKey: input.rangeKey, resolve })) }
      }
      if (request === '../../services/data-service') return {}
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Component = config => { definition = config }
  const componentPath = require.resolve('../components/friend-hub/friend-hub')
  delete require.cache[componentPath]
  try { require(componentPath) } finally { Module._load = originalLoad; delete global.Component }

  const instance = { data: Object.assign({}, definition.data), setData(patch) { Object.assign(this.data, patch) }, triggerEvent() {} }
  Object.assign(instance, definition.methods)
  definition.lifetimes.attached.call(instance)
  const week = instance.loadRanking('week')
  const month = instance.selectRankingRange({ currentTarget: { dataset: { range: 'month' } } })
  pending.find(item => item.rangeKey === 'month').resolve({ top10: [{ socialUserId: 'su_new', nickname: 'New', rank: 1, durationMinutes: 120 }], myRank: null })
  pending.find(item => item.rangeKey === 'week').resolve({ top10: [{ socialUserId: 'su_old', nickname: 'Old', rank: 1, durationMinutes: 999 }], myRank: null })
  await Promise.all([week, month])

  assert.equal(instance.data.rankingRange, 'month')
  assert.deepEqual(instance.data.rankingRows.map(row => row.socialUserId), ['su_new'])
  assert.equal(instance.data.rankingStatus, 'ready')
  assert.equal(instance.data.rankingMyRank, null)
})
