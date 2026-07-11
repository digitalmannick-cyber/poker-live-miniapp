const test = require('node:test')
const assert = require('node:assert/strict')

const storage = {}
global.wx = {
  getStorageSync(key) {
    return storage[key]
  },
  setStorageSync(key, value) {
    storage[key] = value
  },
  removeStorageSync(key) {
    delete storage[key]
  }
}

const store = require('../utils/store')
const onboardingGuide = require('../utils/onboarding-guide')
const dataService = require('../services/data-service')

function resetFixture() {
  Object.keys(storage).forEach(key => delete storage[key])
  store.__test.resetCachedStoreForTest()
  store.importBackup({
    profile: {
      playerId: 'WX-REAL',
      name: 'Player'
    },
    sessions: [],
    hands: [],
    handActions: [],
    bankrollLogs: []
  })
  onboardingGuide.setGuideContext({ accountId: 'WX-REAL', hasRealData: true })
  onboardingGuide.resetGuide()
  dataService.clearStatsDataCache()
}

test('stats cache does not return onboarding demo for a WeChat account with no cached cloud result', () => {
  resetFixture()

  const cached = dataService.getCachedStatsData('all')

  assert.equal(cached, null)
})

test('stats cache does not synthesize local fallback data when no cloud result is cached', () => {
  resetFixture()
  store.importBackup({
    profile: {
      playerId: 'WX-REAL',
      name: 'Player'
    },
    sessions: [{
      id: 'session-local',
      status: 'finished',
      buyIn: 1000,
      cashOut: 2000,
      durationMinutes: 60
    }],
    hands: [{
      id: 'hand-local',
      sessionId: 'session-local',
      currentProfit: 1000
    }],
    handActions: [],
    bankrollLogs: []
  })
  onboardingGuide.setGuideContext({ accountId: 'WX-REAL', hasRealData: true })
  onboardingGuide.resetGuide()
  dataService.clearStatsDataCache()

  const cached = dataService.getCachedStatsData('all')

  assert.equal(cached, null)
})

test('stats cache can still return onboarding demo for an anonymous empty account', () => {
  Object.keys(storage).forEach(key => delete storage[key])
  store.__test.resetCachedStoreForTest()
  store.importBackup({
    profile: {
      playerId: 'PLR-DEMO',
      name: 'Player'
    },
    sessions: [],
    hands: [],
    handActions: [],
    bankrollLogs: []
  })
  onboardingGuide.setGuideContext({ accountId: 'PLR-DEMO', hasRealData: false })
  onboardingGuide.resetGuide()
  dataService.clearStatsDataCache()

  const cached = dataService.getCachedStatsData('all')

  assert.equal(cached.source, 'onboarding_demo')
  assert.equal(cached.stats.handCount, 1)
})

test('profile preferCache returns unavailable stats instead of crashing when cache is empty', async () => {
  resetFixture()

  const profileData = await dataService.getProfilePageData({ preferCache: true })

  assert.equal(profileData.stats.statsUnavailable, true)
  assert.equal(profileData.stats.handCount, 0)
})

test('profile fast local cache renders local stats before cloud stats cache exists', async () => {
  resetFixture()
  store.importBackup({
    profile: {
      playerId: 'WX-REAL',
      name: 'Player'
    },
    settings: store.getDefaultSettings(),
    sessions: [{
      _id: 'session-local',
      status: 'finished',
      buyIn: 1000,
      cashOut: 2500,
      durationMinutes: 90
    }],
    hands: [{
      _id: 'hand-local',
      sessionId: 'session-local',
      currentProfit: 1500
    }],
    handActions: [],
    bankrollLogs: []
  })
  dataService.clearStatsDataCache()

  const profileData = await dataService.getProfilePageData({ preferCache: true, fastLocal: true })

  assert.equal(profileData.stats.statsUnavailable, undefined)
  assert.equal(profileData.stats.handCount, 1)
  assert.equal(profileData.stats.totalProfit, 1500)
  assert.equal(profileData.stats.totalHours, '1.5')
})

test('profile stats keep newer local total hours when cloud stats are stale', async () => {
  resetFixture()
  store.importBackup({
    profile: {
      playerId: 'WX-REAL',
      name: 'Player'
    },
    settings: store.getDefaultSettings(),
    sessions: [{
      _id: 'session-local-new',
      status: 'finished',
      buyIn: 1000,
      cashOut: 1800,
      durationMinutes: 300,
      updatedAt: 200
    }],
    hands: [{
      _id: 'hand-local-new',
      sessionId: 'session-local-new',
      currentProfit: 800,
      updatedAt: 200
    }],
    handActions: [],
    bankrollLogs: []
  })
  dataService.clearStatsDataCache()

  let syncStatsCalls = 0
  const emptyQuery = {
    get: () => Promise.resolve({ data: [] }),
    set: () => Promise.resolve({}),
    update: () => Promise.resolve({}),
    remove: () => Promise.resolve({}),
    where: () => emptyQuery,
    orderBy: () => emptyQuery,
    skip: () => emptyQuery,
    limit: () => emptyQuery,
    doc: () => emptyQuery,
    add: () => Promise.resolve({ _id: 'mock_doc' })
  }
  global.wx.cloud = {
    init() {},
    database() {
      return {
        collection: () => emptyQuery
      }
    },
    callFunction(request) {
      assert.equal(request.name, 'poker_data')
      if (request.data.action !== 'sync_stats') {
        return Promise.resolve({
          result: {
            code: 0,
            data: {}
          }
        })
      }
      syncStatsCalls += 1
      return Promise.resolve({
        result: {
          code: 0,
          data: {
            sessions: [],
            hands: [],
            settings: store.getDefaultSettings(),
            stats: {
              sessionCount: 1,
              handCount: 1,
              totalProfit: 800,
              bankrollCurrent: 12800,
              totalHours: '1.5',
              hourlyRate: '533.3'
            }
          }
        }
      })
    }
  }

  try {
    const profileData = await dataService.getProfilePageData({ forceRefresh: true })

    assert.equal(profileData.stats.totalHours, '5.0')
    assert.equal(profileData.stats.sessionCount, 1)
    assert.equal(profileData.stats.handCount, 1)
    assert.equal(syncStatsCalls >= 1, true)
  } finally {
    delete global.wx.cloud
  }
})

test('test account switch isolates player id and restores original local account', async () => {
  resetFixture()
  store.importBackup({
    profile: {
      playerId: 'WX-REAL',
      name: 'Real Player'
    },
    sessions: [{ _id: 'session-real', buyIn: 1000 }],
    hands: [{ _id: 'hand-real', sessionId: 'session-real' }],
    handActions: [],
    bankrollLogs: []
  })

  const testProfile = await dataService.switchToTestAccount()

  assert.equal(dataService.isTestAccountActive(), true)
  assert.match(testProfile.playerId, /^TEST-/)
  assert.equal(dataService.getCurrentPlayerId(), testProfile.playerId)
  assert.equal(store.getSessions().length, 0)
  assert.equal(store.getRecentHands().length, 0)

  const restoredProfile = await dataService.exitTestAccount()

  assert.equal(dataService.isTestAccountActive(), false)
  assert.equal(restoredProfile.playerId, 'WX-REAL')
  assert.equal(dataService.getCurrentPlayerId(), 'WX-REAL')
  assert.equal(store.getSessions().length, 1)
  assert.equal(store.getRecentHands().length, 1)
})

test('settings save keeps newer local presets when cloud returns stale settings', async () => {
  resetFixture()
  let saveSettingsCalled = false
  global.wx.cloud = {
    init() {},
    callFunction(request) {
      saveSettingsCalled = true
      assert.equal(request.name, 'poker_data')
      assert.equal(request.data.action, 'save_settings')
      return Promise.resolve({
        result: {
          code: 0,
          data: {
            settings: {
              venues: ['Old Room'],
              blindPresets: ['100/200'],
              lastBlindPreset: '100/200',
              updatedAt: 1
            }
          }
        }
      })
    }
  }

  try {
    const settings = await dataService.updateSettings({
      venues: ['Old Room', 'Studio City'],
      blindPresets: ['100/200', '500/1000'],
      lastBlindPreset: '500/1000'
    }, { waitForCloud: true })

    assert.equal(saveSettingsCalled, true)
    assert.deepEqual(settings.venues, ['Old Room', 'Studio City'])
    assert.deepEqual(settings.blindPresets, ['100/200', '500/1000'])
    assert.equal(settings.lastBlindPreset, '500/1000')
    assert.deepEqual(store.getSettings().venues, ['Old Room', 'Studio City'])
  } finally {
    delete global.wx.cloud
  }
})

test('stats data does not show partial cloud repository data when data cloud function is unavailable', async () => {
  resetFixture()
  global.wx.cloud = {
    init() {},
    callFunction() {
      return Promise.reject(new Error('cloud function missing'))
    }
  }

  try {
    await assert.rejects(
      () => dataService.getStatsData('all'),
      /cloud function missing/
    )
  } finally {
    delete global.wx.cloud
  }
})
