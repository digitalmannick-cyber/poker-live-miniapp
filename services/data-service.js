const store = require('../utils/store')
const cloudRepo = require('./cloud-repo')
const cloudUtils = require('../utils/cloud')
const sessionRules = require('../utils/session-rules')
const { AUTO_CLOUD_BOOTSTRAP } = require('../config/cloud')

let bootstrapPromise = null
let businessSyncPromise = Promise.resolve()
const CLOUD_TIMEOUT_MS = 1500
const CLOUD_RETRY_COOLDOWN_MS = 30000
let cloudRetryAfter = 0

function resolveAfter(ms, value) {
  return new Promise(resolve => setTimeout(() => resolve(value), ms))
}

async function withTimeout(promise, ms, fallbackValue) {
  return Promise.race([promise, resolveAfter(ms, fallbackValue)])
}

function isTimeoutError(error) {
  const message = String(error && (error.message || error.errMsg || error) || '').toLowerCase()
  return message.indexOf('timeout') > -1 || message.indexOf('timed out') > -1
}

function formatCloudError(error) {
  if (!error) return 'unknown error'
  return error.errMsg || error.message || String(error)
}

function markCloudRetryCooldown(error) {
  if (isTimeoutError(error)) {
    cloudRetryAfter = Date.now() + CLOUD_RETRY_COOLDOWN_MS
  }
}

function canStartCloudTask() {
  return Date.now() >= cloudRetryAfter
}

function logCloudBackgroundFailure(label, error) {
  markCloudRetryCooldown(error)
  const message = formatCloudError(error)
  console.warn((label || 'cloud background task failed') + ': ' + message)
}

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
    async deleteSession(sessionId) {
      return store.deleteSession(sessionId)
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
      return await Promise.race([
        callback(cloudRepo),
        resolveAfter(CLOUD_TIMEOUT_MS, null).then(() => {
          throw new Error('cloud adapter timeout')
        })
      ])
    } catch (error) {
      logCloudBackgroundFailure('cloud fallback to local', error)
    }
  }
  return callback(getLocalAdapter())
}

function shouldAwaitCloudBootstrap(options) {
  const config = options || {}
  return !!(config.forceRefresh || config.waitForCloud)
}

function runCloudTask(task, label) {
  if (!canStartCloudTask() || !cloudUtils.canUseCloud()) {
    return Promise.resolve(false)
  }
  return Promise.resolve()
    .then(task)
    .catch(error => {
      logCloudBackgroundFailure(label, error)
      return false
    })
}

function scheduleCloudBootstrap(forceRefresh) {
  if (!AUTO_CLOUD_BOOTSTRAP && !forceRefresh) return
  if (!canStartCloudTask()) return
  bootstrapCloudSync(forceRefresh, { waitForCloud: false }).catch(error => {
    logCloudBackgroundFailure('schedule cloud bootstrap failed', error)
  })
}

function scheduleBusinessDataSync(label) {
  if (!AUTO_CLOUD_BOOTSTRAP) {
    return Promise.resolve(false)
  }
  businessSyncPromise = businessSyncPromise
    .catch(() => false)
    .then(() => runCloudTask(
      () => cloudRepo.replaceBusinessData(store.exportBackup()),
      label || 'sync business data failed'
    ))
  return businessSyncPromise
}

async function bootstrapCloudSync(forceRefresh, options) {
  if (!AUTO_CLOUD_BOOTSTRAP && !forceRefresh) {
    return false
  }
  if (!canStartCloudTask() || !cloudUtils.canUseCloud()) {
    return false
  }
  if (bootstrapPromise && !forceRefresh) {
    return shouldAwaitCloudBootstrap(options)
      ? withTimeout(bootstrapPromise, CLOUD_TIMEOUT_MS, false)
      : false
  }

  const task = (async () => {
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
      logCloudBackgroundFailure('bootstrap cloud sync failed', error)
      return false
    })
    .finally(() => {
      bootstrapPromise = null
    })

  bootstrapPromise = task

  if (!shouldAwaitCloudBootstrap(Object.assign({}, options, { forceRefresh }))) {
    return false
  }

  return withTimeout(task, CLOUD_TIMEOUT_MS, false)
}

async function getDashboardData() {
  scheduleCloudBootstrap()
  const adapter = getLocalAdapter()
  const stats = await adapter.getStatsSummary()
  const sessions = await adapter.getSessions()
  const activeSession = sessions.find(item => item.status === 'active') || null
  const recentHands = await adapter.getRecentHands(4)
  return {
    stats,
    activeSession,
    recentHands
  }
}

async function getSessionListData() {
  scheduleCloudBootstrap()
  const adapter = getLocalAdapter()
  const sessions = await adapter.getSessions()
  const sessionsWithSummaryState = await Promise.all((sessions || []).map(async session => {
    const hands = await adapter.getHandsBySessionId(session._id)
    return Object.assign({}, session, getSessionSummaryReadiness(session, hands))
  }))
  return { sessions: sessionsWithSummaryState }
}

function getSessionSummaryReadiness(session, hands) {
  const sessionHands = Array.isArray(hands) ? hands : []
  const reviewedHands = sessionHands.filter(hand => !!(hand && hand.aiReview))
  const allHandsReviewed = sessionHands.length > 0 && reviewedHands.length === sessionHands.length
  const summaryEligible = !!(session && session.status === 'finished' && allHandsReviewed)
  return {
    summaryEligible,
    allHandsReviewed,
    reviewedHandCount: reviewedHands.length,
    totalHandCount: sessionHands.length
  }
}

async function getSessionDetailData(sessionId) {
  scheduleCloudBootstrap()
  const adapter = getLocalAdapter()
  const session = await adapter.getSessionById(sessionId)
  const hands = session ? await adapter.getHandsBySessionId(session._id) : []
  return {
    session,
    hands
  }
}

async function getReviewData(filters) {
  scheduleCloudBootstrap()
  const adapter = getLocalAdapter()
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
}

async function getStatsData() {
  scheduleCloudBootstrap()
  const stats = await getLocalAdapter().getStatsSummary()
  return { stats }
}

async function getRecentHands(limit) {
  scheduleCloudBootstrap()
  return getLocalAdapter().getRecentHands(limit || 50)
}

async function getProfilePageData() {
  scheduleCloudBootstrap()
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

function getCurrentProfile() {
  return store.getProfile()
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
        logCloudBackgroundFailure('sync profile failed', error)
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
        logCloudBackgroundFailure('sync settings failed', error)
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
      logCloudBackgroundFailure('sync import backup failed', error)
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
      logCloudBackgroundFailure('clear cloud data failed', error)
    }
  }
  return result
}

async function getSessionById(sessionId) {
  scheduleCloudBootstrap()
  return getLocalAdapter().getSessionById(sessionId)
}

async function getHandById(handId) {
  scheduleCloudBootstrap()
  return getLocalAdapter().getHandById(handId)
}

async function getActionsByHandId(handId) {
  scheduleCloudBootstrap()
  return getLocalAdapter().getActionsByHandId(handId)
}

async function createSession(payload) {
  const adapter = getLocalAdapter()
  const existingSessions = await adapter.getSessions()
  sessionRules.assertCanCreateSession(existingSessions)
  const result = await adapter.createSession(payload)
  scheduleBusinessDataSync('sync create session failed')
  return result
}

async function updateSession(sessionId, patch) {
  const result = await getLocalAdapter().updateSession(sessionId, patch)
  scheduleBusinessDataSync('sync update session failed')
  return result
}

async function finishSession(sessionId, endingChips) {
  const result = await getLocalAdapter().finishSession(sessionId, endingChips)
  scheduleBusinessDataSync('sync finish session failed')
  return result
}

async function createHand(payload) {
  const result = await getLocalAdapter().createHand(payload)
  scheduleBusinessDataSync('sync create hand failed')
  return result
}

async function updateHand(handId, patch) {
  const result = await getLocalAdapter().updateHand(handId, patch)
  scheduleBusinessDataSync('sync update hand failed')
  return result
}

async function deleteHand(handId) {
  const result = await getLocalAdapter().deleteHand(handId)
  scheduleBusinessDataSync('sync delete hand failed')
  return result
}

async function deleteSession(sessionId) {
  const result = await getLocalAdapter().deleteSession(sessionId)
  scheduleBusinessDataSync('sync delete session failed')
  return result
}

module.exports = {
  getDashboardData,
  bootstrapCloudSync,
  getSessionListData,
  getSessionDetailData,
  getReviewData,
  getStatsData,
  getRecentHands,
  getProfilePageData,
  createSession,
  updateSession,
  finishSession,
  createHand,
  updateHand,
  deleteHand,
  deleteSession,
  getSessionById,
  getHandById,
  getActionsByHandId,
  getAppSettings,
  getCurrentPlayerId,
  getCurrentProfile,
  updateProfile,
  updateSettings,
  exportBackup,
  importBackup,
  clearAllData,
  __test: {
    shouldAwaitCloudBootstrap,
    isTimeoutError,
    scheduleBusinessDataSync,
    getSessionSummaryReadiness
  }
}
