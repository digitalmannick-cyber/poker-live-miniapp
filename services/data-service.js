const store = require('../utils/store')
const cloudRepo = require('./cloud-repo')
const cloudUtils = require('../utils/cloud')

let bootstrapPromise = null

function writeLocalDataPatch(patch) {
  const next = Object.assign({}, store.exportBackup(), patch || {})
  store.importBackup(next)
  return next
}

function getCurrentPlayerId() {
  return (store.getProfile().playerId || '').trim().toUpperCase()
}

function getLocalAdapter() {
  return {
    async getSessions() {
      return store.getSessions()
    },
    async getSessionById(sessionId) {
      return store.getSessionById(sessionId)
    },
    async getHandsBySessionId(sessionId) {
      return store.getHandsBySessionId(sessionId)
    },
    async getRecentHands(limit) {
      return store.getRecentHands(limit)
    },
    async getHandById(handId) {
      return store.getHandById(handId)
    },
    async getActionsByHandId(handId) {
      return store.getActionsByHandId(handId)
    },
    async createSession(payload) {
      return store.createSession(payload)
    },
    async updateSession(sessionId, patch) {
      return store.updateSession(sessionId, patch)
    },
    async finishSession(sessionId, endingChips) {
      return store.finishSession(sessionId, endingChips)
    },
    async createHand(payload) {
      return store.createHand(payload)
    },
    async updateHand(handId, patch) {
      return store.updateHand(handId, patch)
    },
    async deleteHand(handId) {
      return store.deleteHand(handId)
    },
    async getReviewHands(filters) {
      return store.getReviewHands(filters)
    },
    async getStatsSummary() {
      return store.getStatsSummary()
    }
  }
}

async function withAdapter(callback) {
  if (cloudUtils.canUseCloud()) {
    try {
      return await callback(cloudRepo)
    } catch (error) {
      console.warn('cloud fallback to local', error)
    }
  }
  return callback(getLocalAdapter())
}

async function bootstrapCloudSync(forceRefresh) {
  if (!cloudUtils.canUseCloud()) {
    return false
  }
  if (bootstrapPromise && !forceRefresh) {
    return bootstrapPromise
  }

  bootstrapPromise = (async () => {
    const localBackup = store.exportBackup()
    const localProfile = localBackup.profile
    const localSettings = localBackup.settings
    const playerId = (localProfile.playerId || '').trim().toUpperCase()

    if (!playerId) {
      return false
    }

    const cloudProfile = await cloudRepo.getProfile(playerId)
    if (!cloudProfile) {
      await cloudRepo.saveProfile(localProfile)
    } else if ((cloudProfile.updatedAt || 0) > (localProfile.updatedAt || 0)) {
      writeLocalDataPatch({ profile: cloudProfile })
    } else if ((localProfile.updatedAt || 0) > (cloudProfile.updatedAt || 0)) {
      await cloudRepo.saveProfile(localProfile)
    }

    const cloudSettings = await cloudRepo.getSettings(playerId)
    if (!cloudSettings) {
      await cloudRepo.saveSettings(playerId, localSettings)
    } else if ((cloudSettings.updatedAt || 0) > (localSettings.updatedAt || 0)) {
      writeLocalDataPatch({ settings: cloudSettings })
    } else if ((localSettings.updatedAt || 0) > (cloudSettings.updatedAt || 0)) {
      await cloudRepo.saveSettings(playerId, localSettings)
    }

    await cloudRepo.seedBusinessData(store.exportBackup())
    return true
  })()
    .catch(error => {
      console.warn('bootstrap cloud sync failed', error)
      return false
    })
    .finally(() => {
      bootstrapPromise = null
    })

  return bootstrapPromise
}

async function getDashboardData() {
  await bootstrapCloudSync()
  return withAdapter(async adapter => {
    const stats = await adapter.getStatsSummary()
    const sessions = await adapter.getSessions()
    const activeSession = sessions.find(item => item.status === 'active') || null
    const recentHands = await adapter.getRecentHands(4)
    return {
      stats,
      activeSession,
      recentHands
    }
  })
}

async function getSessionListData() {
  await bootstrapCloudSync()
  return withAdapter(async adapter => {
    const sessions = await adapter.getSessions()
    return { sessions }
  })
}

async function getSessionDetailData(sessionId) {
  await bootstrapCloudSync()
  return withAdapter(async adapter => {
    const session = await adapter.getSessionById(sessionId)
    const hands = session ? await adapter.getHandsBySessionId(session._id) : []
    return {
      session,
      hands
    }
  })
}

async function getReviewData(filters) {
  await bootstrapCloudSync()
  return withAdapter(async adapter => {
    const sessions = await adapter.getSessions()
    const hands = await adapter.getReviewHands(filters || {})
    const totalHands = hands.length
    const totalProfit = hands.reduce((sum, item) => sum + (Number(item.currentProfit) || 0), 0)
    return {
      sessions,
      hands,
      summary: {
        totalHands,
        totalProfit
      }
    }
  })
}

async function getStatsData() {
  await bootstrapCloudSync()
  return withAdapter(async adapter => {
    const stats = await adapter.getStatsSummary()
    return { stats }
  })
}

async function getProfilePageData() {
  await bootstrapCloudSync()
  const stats = await getStatsData()
  return {
    stats: stats.stats,
    profile: store.getProfile(),
    settings: store.getSettings()
  }
}

function getAppSettings() {
  return store.getSettings()
}

function updateProfile(patch) {
  const profile = store.updateProfile(patch)
  if (cloudUtils.canUseCloud()) {
    cloudRepo.saveProfile(profile)
      .then(saved => {
        if (saved) {
          writeLocalDataPatch({ profile: saved })
        }
      })
      .catch(error => {
        console.warn('sync profile failed', error)
      })
  }
  return profile
}

function updateSettings(patch) {
  const settings = store.updateSettings(patch)
  const playerId = getCurrentPlayerId()
  if (playerId && cloudUtils.canUseCloud()) {
    cloudRepo.saveSettings(playerId, settings)
      .then(saved => {
        if (saved) {
          writeLocalDataPatch({ settings: saved })
        }
      })
      .catch(error => {
        console.warn('sync settings failed', error)
      })
  }
  return settings
}

function exportBackup() {
  return store.exportBackup()
}

async function importBackup(payload) {
  const result = store.importBackup(payload)
  const playerId = (result.profile && result.profile.playerId) || getCurrentPlayerId()
  if (playerId && cloudUtils.canUseCloud()) {
    try {
      await cloudRepo.replaceBusinessData(result)
      await cloudRepo.saveProfile(result.profile)
      await cloudRepo.saveSettings(playerId, result.settings)
    } catch (error) {
      console.warn('sync import backup failed', error)
    }
  } else {
    await bootstrapCloudSync(true)
  }
  return result
}

async function clearAllData() {
  const previousPlayerId = getCurrentPlayerId()
  const result = store.clearAllData()
  const playerId = previousPlayerId || (result.profile && result.profile.playerId) || getCurrentPlayerId()
  if (playerId && cloudUtils.canUseCloud()) {
    try {
      await cloudRepo.clearAllData(playerId)
      await bootstrapCloudSync(true)
    } catch (error) {
      console.warn('clear cloud data failed', error)
    }
  }
  return result
}

async function getSessionById(sessionId) {
  await bootstrapCloudSync()
  return withAdapter(adapter => adapter.getSessionById(sessionId))
}

async function getHandById(handId) {
  await bootstrapCloudSync()
  return withAdapter(adapter => adapter.getHandById(handId))
}

async function getActionsByHandId(handId) {
  await bootstrapCloudSync()
  return withAdapter(adapter => adapter.getActionsByHandId(handId))
}

async function createSession(payload) {
  await bootstrapCloudSync()
  return withAdapter(adapter => adapter.createSession(payload))
}

async function updateSession(sessionId, patch) {
  await bootstrapCloudSync()
  return withAdapter(adapter => adapter.updateSession(sessionId, patch))
}

async function finishSession(sessionId, endingChips) {
  await bootstrapCloudSync()
  return withAdapter(adapter => adapter.finishSession(sessionId, endingChips))
}

async function createHand(payload) {
  await bootstrapCloudSync()
  return withAdapter(adapter => adapter.createHand(payload))
}

async function updateHand(handId, patch) {
  await bootstrapCloudSync()
  return withAdapter(adapter => adapter.updateHand(handId, patch))
}

async function deleteHand(handId) {
  await bootstrapCloudSync()
  return withAdapter(adapter => adapter.deleteHand(handId))
}

module.exports = {
  getDashboardData,
  bootstrapCloudSync,
  getSessionListData,
  getSessionDetailData,
  getReviewData,
  getStatsData,
  getProfilePageData,
  createSession,
  updateSession,
  finishSession,
  createHand,
  updateHand,
  deleteHand,
  getSessionById,
  getHandById,
  getActionsByHandId,
  getAppSettings,
  updateProfile,
  updateSettings,
  exportBackup,
  importBackup,
  clearAllData
}
