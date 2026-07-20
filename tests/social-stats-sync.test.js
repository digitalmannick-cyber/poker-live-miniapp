const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')

const ranking = require('../cloudfunctions/poker_social/lib/ranking')

test('daily buckets split a finished session at the Beijing midnight boundary and count dated hands', () => {
  const buckets = ranking.buildDailyBuckets({
    sessions: [
      { _id: 's1', status: 'finished', startTime: '2026-07-19 23:30', endTime: '2026-07-20 01:00' },
      { _id: 's2', status: 'active', startTime: '2026-07-20 02:00', endTime: '2026-07-20 03:00' },
      { _id: 's3', status: 'finished', startTime: '2026-07-20 04:00', endTime: '2026-07-20 04:00' }
    ],
    hands: [
      { _id: 'h1', playedDate: '2026-07-19' },
      { _id: 'h2', playedDate: '2026-07-20 00:10' },
      { _id: 'h3', playedDate: 'not-a-date' }
    ],
    timezoneOffsetMinutes: 480
  })

  assert.deepEqual(buckets, [
    { dateKey: '20260719', durationMinutes: 30, recordedHandCount: 1 },
    { dateKey: '20260720', durationMinutes: 60, recordedHandCount: 1 }
  ])
})

test('daily buckets support ISO and legacy timestamp fields without DST changes for Beijing', () => {
  const buckets = ranking.buildDailyBuckets({
    sessions: [{
      _id: 'legacy',
      status: 'finished',
      startTime: '2026-07-19T15:30:00.000Z',
      endTime: '2026-07-19T16:30:00.000Z'
    }],
    hands: [
      { _id: 'legacy-hand', createdAt: Date.parse('2026-07-19T16:05:00.000Z') },
      { _id: 'unknown-hand' }
    ],
    timezoneOffsetMinutes: 480
  })

  assert.deepEqual(buckets, [
    { dateKey: '20260719', durationMinutes: 30, recordedHandCount: 0 },
    { dateKey: '20260720', durationMinutes: 30, recordedHandCount: 1 }
  ])
})

test('time parsing accepts only strict valid session and hand timestamp formats', () => {
  assert.equal(ranking.parseTime('2026-02-30 12:00', 480), null)
  assert.equal(ranking.parseTime('2026/07/19 12:00', 480), null)
  assert.equal(ranking.parseTime('July 19, 2026 12:00', 480), null)
  assert.equal(ranking.parseTime('2026-07-19T12:00:00+25:00', 480), null)
  assert.equal(ranking.parseTime('2026-07-19T12:00:00Z', 480), Date.parse('2026-07-19T12:00:00Z'))
  assert.equal(ranking.parseTime('2026-07-19 12:00:00.123', 480), Date.UTC(2026, 6, 19, 12, 0, 0, 123) - 480 * 60000)
})

test('cross-midnight allocation preserves the rounded session duration without double counting', () => {
  const buckets = ranking.buildDailyBuckets({
    sessions: [{ _id: 's-short', status: 'finished', startTime: '2026-07-19 23:59:40', endTime: '2026-07-20 00:00:20' }],
    hands: [],
    timezoneOffsetMinutes: 480
  })

  assert.deepEqual(buckets, [
    { dateKey: '20260719', durationMinutes: 1, recordedHandCount: 0 }
  ])
  assert.equal(buckets.reduce((sum, item) => sum + item.durationMinutes, 0), 1)
})

test('server sync authorizes the authenticated owner and replaces stale daily buckets', async () => {
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const records = {
    social_users: [{
      _id: 'su_owner', ownerOpenId: 'openid-owner', privatePlayerId: 'PLAYER-1',
      profile: { nickname: 'Owner' }, statsVisible: true
    }],
    social_daily_stats: [{
      _id: 'sd_su_owner_20260101', socialUserId: 'su_owner', dateKey: '20260101', durationMinutes: 999, recordedHandCount: 9
    }],
    sessions: [
      { _id: 's1', ownerOpenId: 'openid-owner', playerId: 'PLAYER-1', status: 'finished', startTime: '2026-07-19 20:00', endTime: '2026-07-19 22:30' },
      { _id: 's-other', ownerOpenId: 'openid-other', playerId: 'PLAYER-1', status: 'finished', startTime: '2026-07-19 20:00', endTime: '2026-07-20 00:00' }
    ],
    hands: [
      { _id: 'h1', ownerOpenId: 'openid-owner', playerId: 'PLAYER-1', playedDate: '2026-07-19' },
      { _id: 'h-other', ownerOpenId: 'openid-other', playerId: 'PLAYER-1', playedDate: '2026-07-19' }
    ]
  }
  const repository = {
    setCalls: 0,
    statsPatches: [],
    async find(collection, query) {
      return (records[collection] || []).find(item => Object.keys(query).every(key => item[key] === query[key])) || null
    },
    async set(collection, id, value) {
      this.setCalls += 1
      const rows = records[collection] || (records[collection] = [])
      const index = rows.findIndex(item => item._id === id)
      const record = Object.assign({}, value, { _id: id })
      if (index >= 0) rows[index] = record
      else rows.push(record)
      return record
    },
    async patchSocialUserStats(id, patch) {
      this.statsPatches.push({ id, patch })
      const index = records.social_users.findIndex(item => item._id === id)
      records.social_users[index] = Object.assign({}, records.social_users[index], patch)
      return records.social_users[index]
    },
    async listPrivateOwned(collection, ownerOpenId, playerId) {
      return (records[collection] || []).filter(item => item.ownerOpenId === ownerOpenId && item.playerId === playerId)
    },
    async replaceDailyStats(socialUserId, buckets) {
      records.social_daily_stats = (records.social_daily_stats || []).filter(item => item.socialUserId !== socialUserId)
      buckets.forEach(bucket => records.social_daily_stats.push(Object.assign({
        _id: 'sd_' + socialUserId + '_' + bucket.dateKey,
        socialUserId
      }, bucket)))
    }
  }
  const app = createSocialApp({
    repository,
    identity: { resolve: () => ({ ownerOpenId: 'openid-owner' }) },
    requestId: () => 'sync-request'
  })

  const synced = await app.handle({ action: 'sync_my_social_stats', playerId: ' player-1 ' }, {})
  const denied = await app.handle({ action: 'sync_my_social_stats', playerId: 'PLAYER-2' }, {})

  assert.deepEqual(synced, {
    code: 0,
    data: { title: '初来乍到', totalDurationMinutes: 150, totalRecordedHandCount: 1, syncedDayCount: 1 },
    requestId: 'sync-request'
  })
  assert.deepEqual(records.social_daily_stats, [{
    _id: 'sd_su_owner_20260719', socialUserId: 'su_owner', dateKey: '20260719', durationMinutes: 150, recordedHandCount: 1
  }])
  assert.equal(repository.setCalls, 0)
  assert.deepEqual(repository.statsPatches, [{
    id: 'su_owner',
    patch: { title: '初来乍到', publicStats: { durationMinutes: 150, recordedHandCount: 1 }, updatedAt: records.social_users[0].updatedAt }
  }])
  assert.deepEqual(denied, {
    code: 'FORBIDDEN', data: null, message: 'not allowed', requestId: 'sync-request'
  })
  assert.doesNotMatch(JSON.stringify(synced), /ownerOpenId|playerId|sessionId|handId|profit|buyIn|cashOut|venue|stake/)
})

test('CloudBase daily-stat replacement clears every older bucket before writing the current source snapshot', async () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({
    _id: 'sd_su_1_2025' + String(index).padStart(4, '0'), socialUserId: 'su_1', dateKey: '2025' + String(index).padStart(4, '0')
  }))
  const database = {
    collection() {
      return {
        where(query) {
          const filtered = rows.filter(row => Object.keys(query).every(key => row[key] === query[key]))
          const page = offset => ({
            limit(limit) {
              return { get: async () => ({ data: filtered.slice(offset, offset + limit) }) }
            }
          })
          return { skip: page, limit: limit => ({ get: async () => ({ data: filtered.slice(0, limit) }) }) }
        },
        doc(id) {
          return {
            async remove() {
              const index = rows.findIndex(row => row._id === id)
              if (index >= 0) rows.splice(index, 1)
            },
            async set(input) {
              const index = rows.findIndex(row => row._id === id)
              const record = Object.assign({}, input.data, { _id: id })
              if (index >= 0) rows[index] = record
              else rows.push(record)
            }
          }
        }
      }
    }
  }
  const { createCloudSocialRepository } = require('../cloudfunctions/poker_social/lib/repository')
  const repository = createCloudSocialRepository(database)

  await repository.replaceDailyStats('su_1', [{ dateKey: '20260719', durationMinutes: 150, recordedHandCount: 1 }])

  assert.deepEqual(rows, [{
    _id: 'sd_su_1_20260719', socialUserId: 'su_1', dateKey: '20260719', durationMinutes: 150, recordedHandCount: 1,
    updatedAt: rows[0].updatedAt
  }])
})

test('CloudBase stats patch updates only derived social fields without replacing profile preferences', async () => {
  const records = [{
    _id: 'su_1', ownerOpenId: 'private', profile: { nickname: 'kept', avatarFileId: 'kept-file' }, statsVisible: false,
    defaultShareScope: 'selected', title: 'old'
  }]
  let updateInput = null
  const database = {
    collection() {
      return {
        doc(id) {
          return {
            async update(input) {
              updateInput = input
              const index = records.findIndex(row => row._id === id)
              records[index] = Object.assign({}, records[index], input.data)
            }
          }
        }
      }
    }
  }
  const { createCloudSocialRepository } = require('../cloudfunctions/poker_social/lib/repository')
  const repository = createCloudSocialRepository(database)

  await repository.patchSocialUserStats('su_1', {
    title: '牌桌常客', publicStats: { durationMinutes: 2400, recordedHandCount: 12 }, updatedAt: 123
  })

  assert.deepEqual(updateInput, {
    data: { title: '牌桌常客', publicStats: { durationMinutes: 2400, recordedHandCount: 12 }, updatedAt: 123 }
  })
  assert.deepEqual(records[0], {
    _id: 'su_1', ownerOpenId: 'private', profile: { nickname: 'kept', avatarFileId: 'kept-file' }, statsVisible: false,
    defaultShareScope: 'selected', title: '牌桌常客', publicStats: { durationMinutes: 2400, recordedHandCount: 12 }, updatedAt: 123
  })
})

test('client schedule throttles per player only after success and shares one in-flight request', async () => {
  const apiPath = require.resolve('../services/social-api')
  const servicePath = require.resolve('../services/social-service')
  const api = require(apiPath)
  const original = api.callSocialFunction
  const storage = {}
  let calls = 0
  let resolveCall
  let fail = false
  global.wx = {
    getStorageSync: key => storage[key],
    setStorageSync: (key, value) => { storage[key] = value }
  }
  api.callSocialFunction = () => {
    calls += 1
    if (fail) return Promise.reject(new Error('network'))
    return new Promise(resolve => { resolveCall = resolve })
  }
  delete require.cache[servicePath]

  try {
    const socialService = require('../services/social-service')
    const first = socialService.scheduleMyStatsSync(' player-1 ')
    const second = socialService.scheduleMyStatsSync('PLAYER-1')
    assert.equal(calls, 1)
    assert.strictEqual(first, second)
    resolveCall({ ok: true })
    assert.deepEqual(await first, { ok: true })
    assert.equal(typeof storage['pokerSocialStatsSyncedAt_PLAYER-1'], 'number')
    assert.notEqual(socialService.__test.socialStatsStorageKey('A-B'), socialService.__test.socialStatsStorageKey('A_B'))

    assert.deepEqual(await socialService.scheduleMyStatsSync('PLAYER-1'), { skipped: true })
    fail = true
    await assert.rejects(() => socialService.scheduleMyStatsSync('PLAYER-2'), /network/)
    assert.equal(storage['pokerSocialStatsSyncedAt_PLAYER-2'], undefined)
    fail = false
    const retry = socialService.scheduleMyStatsSync('PLAYER-2')
    resolveCall({ retried: true })
    assert.deepEqual(await retry, { retried: true })
    assert.equal(typeof storage['pokerSocialStatsSyncedAt_PLAYER-2'], 'number')
  } finally {
    api.callSocialFunction = original
    delete require.cache[servicePath]
    delete global.wx
  }
})

test('data service schedules social sync only after authoritative cloud writes and social failures do not reject core writes', async () => {
  const file = path.join(__dirname, '..', 'services', 'data-service.js')
  const socialPath = path.join(__dirname, '..', 'services', 'social-service.js')
  const cloudDataPath = path.join(__dirname, '..', 'services', 'cloud-data-api.js')
  const originalLoad = Module._load
  const calls = []
  const social = { scheduleMyStatsSync(playerId) { calls.push(playerId); return Promise.reject(new Error('social rejected')) } }
  const cloudData = require(cloudDataPath)
  const originalCreate = cloudData.createHand
  const originalFinish = cloudData.finishSession
  const storage = {}
  global.wx = {
    getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value }, removeStorageSync: key => delete storage[key],
    cloud: { init() {}, callFunction() { return Promise.resolve({ result: { code: 0, data: {} } }) } }
  }
  cloudData.createHand = async () => ({ hand: { _id: 'h1', sessionId: 's1' }, session: { _id: 's1', status: 'active' }, actions: [] })
  cloudData.finishSession = async () => ({ session: { _id: 's1', status: 'finished' } })
  Module._load = function load(request, parent, isMain) {
    if (request === './social-service' && parent && parent.filename === file) return social
    return originalLoad.call(this, request, parent, isMain)
  }
  delete require.cache[file]
  const store = require('../utils/store')
  store.__test.resetCachedStoreForTest()
  const seed = store.__test.buildInitialStoreData()
  seed.profile = Object.assign({}, seed.profile, { playerId: 'PLAYER-1' })
  store.importBackup(seed)

  try {
    const dataService = require(file)
    assert.deepEqual(await dataService.createHand({ sessionId: 's1' }), { _id: 'h1', sessionId: 's1' })
    assert.deepEqual(await dataService.finishSession('s1', { cashOut: 1 }), { _id: 's1', status: 'finished' })
    assert.deepEqual(calls, ['PLAYER-1', 'PLAYER-1'])
  } finally {
    Module._load = originalLoad
    cloudData.createHand = originalCreate
    cloudData.finishSession = originalFinish
    delete require.cache[file]
    delete global.wx
  }
})
