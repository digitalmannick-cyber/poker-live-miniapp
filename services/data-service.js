const store = require('../utils/store')
const cloudRepo = require('./cloud-repo')
const cloudUtils = require('../utils/cloud')
const sessionRules = require('../utils/session-rules')
const reviewSessionStatus = require('../utils/review-session-status')
const statsAnalytics = require('../utils/stats-analytics')
const onboardingGuide = require('../utils/onboarding-guide')
const onboardingDemoData = require('../utils/onboarding-demo-data')
const pbtNotesImport = require('../utils/pbt-notes-import')
const pbtBankrollImport = require('../utils/pbt-bankroll-import')
const cloudDataApi = require('./cloud-data-api')
const socialService = require('./social-service')
const socialCache = require('../utils/social-cache')
const playerCardImportPending = require('../utils/player-card-import-pending')
const { AUTO_CLOUD_BOOTSTRAP, AI_REMINDER_SUBSCRIBE_TEMPLATE_ID } = require('../config/cloud')

let bootstrapPromise = null
let cloudBootstrapScheduleTimer = null
let businessSyncPromise = Promise.resolve()
const cloudMutationDrainPromises = {}
let cloudMutationDrainEpoch = 0
let cloudMutationAccountContextId = ''
let cloudMutationAccountContextEpoch = 0
const publicAccountContexts = new WeakMap()
let destructiveAccountOperation = null
let cloudBootstrapComplete = false
const CLOUD_TIMEOUT_MS = 1500
const CLOUD_BOOTSTRAP_TIMEOUT_MS = 5000
const CLOUD_BOOTSTRAP_DEFER_MS = 1200
const CLOUD_STATS_FUNCTION_TIMEOUT_MS = 15000
const HAND_CLOUD_SYNC_CONFIRM_TIMEOUT_MS = 5000
const CLOUD_RETRY_COOLDOWN_MS = 30000
const ACCOUNT_LOGGED_OUT_KEY = 'pokerLiveAccountLoggedOut'
const TEST_ACCOUNT_KEY = 'pokerLiveTestAccount'
const TEST_ACCOUNT_BACKUP_KEY = 'pokerLiveTestAccountBackup'
const AI_REMINDER_SUBSCRIBE_GRANT_KEY = 'pokerAiReminderSubscribeGrantReady'
const PROFILE_STATS_SNAPSHOT_KEY = 'pokerLiveProfileStatsSnapshot'
const CLOUD_MUTATION_OUTBOX_KEY = 'pokerCloudMutationOutboxV1'
const CLOUD_MUTATION_DRAIN_LIMIT = 5
let cloudRetryAfter = 0
const statsDataCache = {}
const statsDataPrefetching = {}

function invalidateCloudMutationAccountContext() {
  cloudMutationAccountContextId = getCurrentPlayerId()
  cloudMutationAccountContextEpoch += 1
  cloudMutationDrainEpoch += 1
}

function accountDestructiveOperationError() {
  const error = new Error('account destructive operation is in progress')
  error.code = 'ACCOUNT_DESTRUCTIVE_OPERATION_IN_PROGRESS'
  return error
}

function pendingImportCleanupError() {
  const error = new Error('pending player-card import cleanup failed')
  error.code = 'PENDING_IMPORT_CLEANUP_FAILED'
  return error
}

function beginAccountDestructiveOperation() {
  if (destructiveAccountOperation) throw accountDestructiveOperationError()
  const before = captureCloudMutationAccountContext()
  invalidateCloudMutationAccountContext()
  const operation = {
    accountId: before.accountId,
    context: captureCloudMutationAccountContext(),
    phase: 'clearing'
  }
  destructiveAccountOperation = operation
  return operation
}

function finishAccountDestructiveOperation(operation, succeeded) {
  if (destructiveAccountOperation !== operation) return
  if (succeeded) operation.phase = 'logged_out'
  else destructiveAccountOperation = null
}

function activateAccountSession() {
  if (destructiveAccountOperation && destructiveAccountOperation.phase === 'logged_out') {
    destructiveAccountOperation = null
  }
}

function withTimeout(promise, ms, fallbackValue) {
  let timeoutId = null
  const timeoutPromise = new Promise(resolve => {
    timeoutId = setTimeout(() => resolve(fallbackValue), ms)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
  })
}

function withTimeoutError(promise, ms, message) {
  let timeoutId = null
  const timeoutPromise = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
  })
}

function isTimeoutError(error) {
  const message = String(error && (error.message || error.errMsg || error) || '').toLowerCase()
  return message.indexOf('timeout') > -1 || message.indexOf('timed out') > -1
}

function formatCloudError(error) {
  if (!error) return 'unknown error'
  return error.errMsg || error.message || String(error)
}

function isLocalStorageWriteError(error) {
  const message = formatCloudError(error).toLowerCase()
  return /setstoragesync|storage|quota|exceed|limit|full|空间|容量|上限|超出|写入/.test(message)
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

function rememberAiReminderSubscribeGrant(templateId) {
  const tmplId = String(templateId || '').trim()
  if (!tmplId || typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return
  try {
    wx.setStorageSync(AI_REMINDER_SUBSCRIBE_GRANT_KEY, {
      templateId: tmplId,
      grantedAt: Date.now()
    })
  } catch (error) {
    logCloudBackgroundFailure('remember ai reminder subscribe grant failed', error)
  }
}

function consumeAiReminderSubscribeGrant(templateId) {
  const tmplId = String(templateId || '').trim()
  if (!tmplId || typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return false
  try {
    const grant = wx.getStorageSync(AI_REMINDER_SUBSCRIBE_GRANT_KEY)
    return !!(grant && grant.templateId === tmplId)
  } catch (error) {
    logCloudBackgroundFailure('consume ai reminder subscribe grant failed', error)
    return false
  }
}

function clearAiReminderSubscribeGrant(templateId) {
  const tmplId = String(templateId || '').trim()
  if (!tmplId || typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function' || typeof wx.removeStorageSync !== 'function') return
  try {
    const grant = wx.getStorageSync(AI_REMINDER_SUBSCRIBE_GRANT_KEY)
    if (grant && grant.templateId === tmplId) {
      wx.removeStorageSync(AI_REMINDER_SUBSCRIBE_GRANT_KEY)
    }
  } catch (error) {
    logCloudBackgroundFailure('clear ai reminder subscribe grant failed', error)
  }
}

function buildUnavailableStatsSummary() {
  return {
    sessionCount: 0,
    handCount: 0,
    totalProfit: 0,
    bankrollCurrent: 0,
    totalHours: '0.0',
    hourlyRate: '0.0',
    statsUnavailable: true
  }
}

function buildStatsResult(sessions, hands, settings, stats, rangeKey, source) {
  const summary = stats || buildUnavailableStatsSummary()
  const appSettings = settings || store.getSettings()
  const analytics = statsAnalytics.buildStatsAnalytics({
    sessions: Array.isArray(sessions) ? sessions : [],
    hands: Array.isArray(hands) ? hands : [],
    settings: appSettings,
    bankrollCurrent: summary.bankrollCurrent,
    rangeKey: rangeKey || 'all'
  })
  return {
    stats: summary,
    analytics,
    source: source || 'local'
  }
}

function normalizeRangeKey(rangeKey) {
  return rangeKey || 'all'
}

function normalizeProfileStatsSnapshot(stats) {
  if (!stats || stats.statsUnavailable) return null
  const totalHours = Number(stats.totalHours)
  if (!Number.isFinite(totalHours) || totalHours < 0) return null
  return {
    sessionCount: Number(stats.sessionCount) || 0,
    handCount: Number(stats.handCount) || 0,
    totalProfit: Number(stats.totalProfit) || 0,
    bankrollCurrent: Number(stats.bankrollCurrent) || 0,
    totalHours: totalHours.toFixed(1),
    hourlyRate: Number.isFinite(Number(stats.hourlyRate)) ? Number(stats.hourlyRate).toFixed(1) : '0.0'
  }
}

function getProfileStatsSnapshot() {
  if (typeof wx === 'undefined' || !wx || typeof wx.getStorageSync !== 'function') return null
  if (isAccountLoggedOut()) return null
  try {
    const snapshot = wx.getStorageSync(PROFILE_STATS_SNAPSHOT_KEY)
    const playerId = getCurrentPlayerId()
    if (!snapshot || !playerId || String(snapshot.playerId || '').trim().toUpperCase() !== playerId) {
      return null
    }
    return normalizeProfileStatsSnapshot(snapshot.stats)
  } catch (error) {
    logCloudBackgroundFailure('read profile stats snapshot failed', error)
    return null
  }
}

function saveProfileStatsSnapshot(stats) {
  if (typeof wx === 'undefined' || !wx || typeof wx.setStorageSync !== 'function') return false
  const playerId = getCurrentPlayerId()
  const normalizedStats = normalizeProfileStatsSnapshot(stats)
  if (!playerId || !normalizedStats) return false
  try {
    wx.setStorageSync(PROFILE_STATS_SNAPSHOT_KEY, {
      playerId,
      stats: normalizedStats,
      cachedAt: Date.now()
    })
    return true
  } catch (error) {
    logCloudBackgroundFailure('save profile stats snapshot failed', error)
    return false
  }
}

function clearProfileStatsSnapshot() {
  if (typeof wx === 'undefined' || !wx || typeof wx.removeStorageSync !== 'function') return
  try {
    wx.removeStorageSync(PROFILE_STATS_SNAPSHOT_KEY)
  } catch (error) {
    logCloudBackgroundFailure('clear profile stats snapshot failed', error)
  }
}

function cacheStatsResult(rangeKey, result) {
  if (result) {
    statsDataCache[normalizeRangeKey(rangeKey)] = result
  }
  return result
}

function clearStatsDataCache(options) {
  Object.keys(statsDataCache).forEach(key => {
    delete statsDataCache[key]
  })
  if (!(options && options.keepProfileSnapshot)) {
    clearProfileStatsSnapshot()
  }
}

function getCachedStatsData(rangeKey) {
  const normalizedRangeKey = normalizeRangeKey(rangeKey)
  if (shouldUseOnboardingStatsDemo()) {
    const demo = getOnboardingDemoDataset()
    return cacheStatsResult(normalizedRangeKey, buildStatsResult(
      demo.sessions || [],
      demo.hands || [],
      getOnboardingDemoSettings(),
      getOnboardingDemoStatsSummary(demo),
      normalizedRangeKey,
      'onboarding_demo'
    ))
  }
  if (statsDataCache[normalizedRangeKey]) {
    return statsDataCache[normalizedRangeKey]
  }
  return null
}

function getLocalStatsData(rangeKey) {
  if (isAccountLoggedOut()) {
    return buildStatsResult([], [], store.getSettings(), getLoggedOutStatsSummary(), rangeKey || 'all', 'local')
  }
  const sessions = store.getSessions()
  const hands = store.getReviewHands()
  const settings = store.getSettings()
  const stats = store.getStatsSummary()
  return buildStatsResult(sessions, hands, settings, stats, rangeKey || 'all', 'local')
}

function getNumericStat(stats, key) {
  return Number(stats && stats[key]) || 0
}

function isProfileCloudStatsBehindLocal(cloudStats, localStats) {
  const cloud = cloudStats || {}
  const local = localStats || {}
  return getNumericStat(local, 'sessionCount') > getNumericStat(cloud, 'sessionCount') ||
    getNumericStat(local, 'handCount') > getNumericStat(cloud, 'handCount') ||
    getNumericStat(local, 'totalHours') > getNumericStat(cloud, 'totalHours')
}

function keepFreshestProfileStats(statsResult) {
  const localResult = getLocalStatsData('all')
  if (!statsResult || !statsResult.stats || statsResult.stats.statsUnavailable) {
    return statsResult || localResult
  }
  if (isProfileCloudStatsBehindLocal(statsResult.stats, localResult.stats)) {
    syncBusinessDataNow('sync stale profile stats failed').catch(error => {
      logCloudBackgroundFailure('sync stale profile stats failed', error)
    })
    return localResult
  }
  return statsResult
}

function writeLocalDataPatch(patch) {
  const next = Object.assign({}, store.exportBackup(), patch || {})
  store.importBackup(next)
  return next
}

function getCurrentPlayerId() {
  const testAccount = getActiveTestAccount()
  if (testAccount && testAccount.playerId) return testAccount.playerId
  return (store.getProfile().playerId || '').trim().toUpperCase()
}

function getActiveTestAccount() {
  try {
    const value = wx.getStorageSync(TEST_ACCOUNT_KEY)
    const playerId = String(value && value.playerId || '').trim().toUpperCase()
    return playerId ? Object.assign({}, value, { playerId }) : null
  } catch (error) {
    return null
  }
}

function isTestAccountActive() {
  return !!getActiveTestAccount()
}

function createTestPlayerId() {
  return 'TEST-' + Date.now().toString(36).toUpperCase()
}

function hasRealBusinessData() {
  const backup = store.exportBackup()
  return ['sessions', 'hands', 'handActions', 'playerNotes', 'bankrollLogs'].some(key => {
    return Array.isArray(backup[key]) && backup[key].length > 0
  })
}

function hasCloudAccountProfile() {
  const playerId = getCurrentPlayerId()
  return /^WX-/.test(playerId)
}

function refreshOnboardingGuideContext() {
  if (!onboardingGuide || !onboardingGuide.setGuideContext) return
  onboardingGuide.setGuideContext({
    accountId: getCurrentPlayerId(),
    hasRealData: hasRealBusinessData()
  })
}

function isAccountLoggedOut() {
  return wx.getStorageSync(ACCOUNT_LOGGED_OUT_KEY) === true
}

function getLoggedOutStatsSummary() {
  return {
    handCount: 0,
    totalProfit: 0,
    totalHours: '0.0'
  }
}

function getLoggedOutProfile() {
  return {
    name: '',
    playerId: '',
    title: '',
    avatarText: '',
    avatarUrl: '',
    updatedAt: 0
  }
}

function isOnboardingDemoActive() {
  refreshOnboardingGuideContext()
  return !!(
    onboardingGuide &&
    onboardingGuide.shouldAutoShowGuide &&
    onboardingGuide.shouldAutoShowGuide() &&
    onboardingGuide.getActiveStep &&
    onboardingGuide.getActiveStep()
  )
}

function shouldUseOnboardingStatsDemo() {
  if (!isOnboardingDemoActive()) return false
  if (hasCloudAccountProfile()) return false
  if (hasRealBusinessData()) return false
  return true
}

function getOnboardingDemoDataset() {
  return onboardingDemoData.getDemoDataset()
}

function getOnboardingDemoSettings() {
  const demo = getOnboardingDemoDataset()
  return Object.assign({}, store.getSettings(), demo.settings || {})
}

function getOnboardingDemoStatsSummary(demo) {
  const hands = demo.hands || []
  const sessions = demo.sessions || []
  const totalProfit = hands.reduce((sum, hand) => sum + (Number(hand.currentProfit) || 0), 0)
  const totalMinutes = sessions.reduce((sum, session) => sum + (Number(session.durationMinutes) || 0), 0)
  const totalHours = totalMinutes / 60
  return {
    sessionCount: sessions.length,
    handCount: hands.length,
    totalProfit,
    bankrollCurrent: demo.bankrollCurrent || 0,
    totalHours: totalHours.toFixed(1),
    hourlyRate: totalHours > 0 ? (totalProfit / totalHours).toFixed(1) : '0.0'
  }
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
    async getPlayerNotes(filters) {
      return store.getPlayerNotes(filters)
    },
    async getPlayerNoteById(noteId) {
      return store.getPlayerNoteById(noteId)
    },
    async getFriendPlayerNote(friendUserId) {
      return store.getFriendPlayerNote(friendUserId)
    },
    async reconcileFriendPlayerNote(remoteNote) {
      return store.reconcileFriendPlayerNote(remoteNote)
    },
    async getPlayerNoteBattleHands(noteId) {
      return store.getPlayerNoteBattleHands(noteId)
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
    async createPlayerNote(payload) {
      return store.createPlayerNote(payload)
    },
    async ensureFriendPlayerNote(snapshot) {
      return store.ensureFriendPlayerNote(snapshot)
    },
    async detachFriendPlayerNote(friendUserId) {
      return store.detachFriendPlayerNote(friendUserId)
    },
    async updatePlayerNote(noteId, patch) {
      return store.updatePlayerNote(noteId, patch)
    },
    async deletePlayerNote(noteId) {
      return store.deletePlayerNote(noteId)
    },
    async addPlayerNoteBattleHand(noteId, handId) {
      return store.addPlayerNoteBattleHand(noteId, handId)
    },
    async removePlayerNoteBattleHand(noteId, handId) {
      return store.removePlayerNoteBattleHand(noteId, handId)
    },
    async deleteSession(sessionId) {
      return store.deleteSession(sessionId)
    },
    async getReviewHands(filters) {
      return store.getReviewHands(filters)
    },
    async getStatsSummary() {
      return store.getStatsSummary()
    },
    async getSettings() {
      return store.getSettings()
    },
    async getPendingAiReminders() {
      return store.getPendingAiReminders()
    },
    async getAiRemindersBySessionId(sessionId) {
      return store.getAiRemindersBySessionId(sessionId)
    },
    async getAiRemindersByHandId(handId) {
      return store.getAiRemindersByHandId(handId)
    },
    async markAiReminderShown(reminderId) {
      return store.markAiReminderShown(reminderId)
    },
    async markAiReminderSubscribeResult(reminderId, result) {
      return store.markAiReminderSubscribeResult(reminderId, result)
    }
  }
}

async function withAdapter(callback) {
  if (cloudUtils.canUseCloud()) {
    try {
      return await withTimeoutError(callback(cloudRepo), CLOUD_TIMEOUT_MS, 'cloud adapter timeout')
    } catch (error) {
      logCloudBackgroundFailure('cloud fallback to local', error)
    }
  }
  return callback(getLocalAdapter())
}

async function withCloudStatsAdapter(callback) {
  if (!cloudUtils.canUseCloud()) {
    throw new Error('cloud stats unavailable')
  }
  try {
    return await withTimeoutError(callback(cloudRepo), CLOUD_TIMEOUT_MS, 'cloud stats timeout')
  } catch (error) {
    markCloudRetryCooldown(error)
    throw new Error('cloud stats unavailable: ' + formatCloudError(error))
  }
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
  if (cloudBootstrapComplete && !forceRefresh) return
  if (!canStartCloudTask()) return

  const start = () => {
    if (cloudBootstrapScheduleTimer) clearTimeout(cloudBootstrapScheduleTimer)
    cloudBootstrapScheduleTimer = null
    if (cloudBootstrapComplete && !forceRefresh) return
    if (!canStartCloudTask()) return
    bootstrapCloudSync(forceRefresh, { waitForCloud: false }).catch(error => {
      logCloudBackgroundFailure('schedule cloud bootstrap failed', error)
    })
  }

  if (forceRefresh) {
    start()
    return
  }
  if (cloudBootstrapScheduleTimer) return
  cloudBootstrapScheduleTimer = setTimeout(start, CLOUD_BOOTSTRAP_DEFER_MS)
}

function resetCloudBootstrapState() {
  if (cloudBootstrapScheduleTimer) clearTimeout(cloudBootstrapScheduleTimer)
  cloudBootstrapScheduleTimer = null
  cloudBootstrapComplete = false
  bootstrapPromise = null
}

function scheduleBusinessDataSync(label) {
  if (!canStartCloudTask() || !cloudUtils.canUseCloud()) return Promise.resolve(false)
  return drainCloudMutationOutbox().catch(error => {
    logCloudBackgroundFailure(label || 'sync business data failed', error)
    return false
  })
}

function syncBusinessDataNow(label) {
  return scheduleBusinessDataSync(label || 'sync business data now failed')
}

function createClientMutationId(action, targetId) {
  return [
    action || 'mutation',
    targetId || '',
    Date.now(),
    Math.floor(Math.random() * 1000000)
  ].join('_').replace(/[^0-9A-Za-z_-]/g, '_')
}

function requireCloudWriteAvailable() {
  if (!cloudUtils.canUseCloud() || !(wx.cloud && typeof wx.cloud.callFunction === 'function')) {
    throw new Error('cloud write unavailable')
  }
}

function mergeRemoteBusinessPatch(patch) {
  const remote = Object.assign({
    sessions: [],
    hands: [],
    handActions: [],
    playerNotes: [],
    bankrollLogs: []
  }, patch || {})
  const merged = mergeBackupData(store.exportBackup(), remote)
  try {
    store.importBackup(merged)
  } catch (error) {
    if (!isLocalStorageWriteError(error)) throw error
    logCloudBackgroundFailure('persist local business cache skipped', error)
  }
  clearStatsDataCache()
  return merged
}

function removeLocalBusinessDocs(config) {
  const target = config || {}
  const backup = store.exportBackup()
  const handIds = new Set(target.handIds || [])
  if (target.handId) handIds.add(target.handId)
  const sessionIds = new Set(target.sessionIds || [])
  if (target.sessionId) sessionIds.add(target.sessionId)
  const next = Object.assign({}, backup, {
    sessions: (backup.sessions || []).filter(item => !sessionIds.has(item && item._id)),
    hands: (backup.hands || []).filter(item => {
      if (!item) return false
      return !handIds.has(item._id) && !sessionIds.has(item.sessionId)
    }),
    handActions: (backup.handActions || []).filter(item => item && !handIds.has(item.handId)),
    bankrollLogs: (backup.bankrollLogs || []).filter(item => item && !sessionIds.has(item.sessionId)),
    playerNotes: (backup.playerNotes || []).map(item => {
      if (!item || !Array.isArray(item.battleHandIds)) return item
      return Object.assign({}, item, {
        battleHandIds: item.battleHandIds.filter(handId => !handIds.has(handId))
      })
    })
  })
  store.importBackup(next)
  clearStatsDataCache()
  return next
}

function scheduleHandCloudPatchSync(handId, patch, label) {
  if (!AUTO_CLOUD_BOOTSTRAP || !cloudUtils.canUseCloud() || !canStartCloudTask()) {
    return Promise.resolve(false)
  }
  return runCloudTask(
    async () => {
      const mutationPayload = { playerId: getCurrentPlayerId(), handId, patch: patch || {} }
      const response = await runAuthoritativeMutation('update_hand', handId, mutationPayload, clientMutationId =>
        cloudDataApi.updateHand(Object.assign({}, mutationPayload, { clientMutationId })))
      const result = response && response.hand
      if (!result) {
        throw new Error('cloud hand patch missed: ' + handId)
      }
      return result
    },
    label || 'sync hand patch failed'
  )
}

async function confirmHandCloudSync(handId, patch, hand, label) {
  if (!AUTO_CLOUD_BOOTSTRAP) {
    return { cloudSynced: false, cloudSyncError: 'cloud sync disabled' }
  }
  if (!canStartCloudTask()) {
    return { cloudSynced: false, cloudSyncError: 'cloud sync cooling down after timeout' }
  }
  if (!cloudUtils.canUseCloud()) {
    return { cloudSynced: false, cloudSyncError: 'cloud unavailable' }
  }

  try {
    const handForCloud = hand || Object.assign({ _id: handId }, patch || {})
    const playerId = getCurrentPlayerId()
    const mutationPayload = { playerId, handId, payload: handForCloud }
    const upsertResult = await withTimeoutError(
      runAuthoritativeMutation('upsert_hand', handId, mutationPayload, clientMutationId =>
        cloudDataApi.upsertHand(Object.assign({}, mutationPayload, { clientMutationId }))),
      HAND_CLOUD_SYNC_CONFIRM_TIMEOUT_MS,
      'cloud hand upsert timeout'
    )
    if (!upsertResult || !upsertResult.hand) {
      return { cloudSynced: false, cloudSyncError: 'cloud hand upsert missed: ' + handId }
    }
    scheduleBusinessDataSync(label || 'sync update hand failed')
    return {
      hand: upsertResult.hand,
      actions: upsertResult.actions || [],
      sessions: upsertResult.session ? [upsertResult.session] : [],
      cloudSynced: true,
      cloudSyncError: ''
    }
  } catch (error) {
    const message = formatCloudError(error)
    logCloudBackgroundFailure(label || 'confirm hand cloud sync failed', new Error(message))
    return {
      cloudSynced: false,
      cloudSyncError: message
    }
  }
}

async function saveHandPatchToCloudAfterLocalFailure(handId, patch, label) {
  if (!cloudUtils.canUseCloud()) return false
  try {
    const mutationPayload = { playerId: getCurrentPlayerId(), handId, patch: patch || {} }
    await withTimeoutError(
      runAuthoritativeMutation('update_hand', handId, mutationPayload, clientMutationId =>
        cloudDataApi.updateHand(Object.assign({}, mutationPayload, { clientMutationId }))),
      CLOUD_STATS_FUNCTION_TIMEOUT_MS,
      'cloud hand patch timeout'
    )
    scheduleBusinessDataSync(label || 'sync update hand failed')
    return true
  } catch (error) {
    logCloudBackgroundFailure(label || 'sync hand patch after local failure failed', error)
    return false
  }
}

function localBackupHasBusinessData(backup) {
  const data = backup || {}
  return ['sessions', 'hands', 'handActions', 'playerNotes', 'bankrollLogs'].some(key => {
    return Array.isArray(data[key]) && data[key].length > 0
  })
}

function mergeListById(localList, remoteList) {
  const map = {}
  ;(Array.isArray(localList) ? localList : []).forEach(item => {
    if (!item || !item._id) return
    map[item._id] = item
  })
  ;(Array.isArray(remoteList) ? remoteList : []).forEach(item => {
    if (!item || !item._id) return
    const current = map[item._id]
    if (!current) {
      map[item._id] = item
      return
    }
    const currentUpdatedAt = Number(current.updatedAt || current.createdAt) || 0
    const nextUpdatedAt = Number(item.updatedAt || item.createdAt) || 0
    map[item._id] = nextUpdatedAt >= currentUpdatedAt ? item : current
  })
  return Object.keys(map).map(key => map[key])
}

function mergeBackupData(localBackup, remoteBackup) {
  const localData = localBackup || {}
  const remoteData = remoteBackup || {}
  return Object.assign({}, localData, remoteData, {
    profile: Object.assign({}, localData.profile || {}, remoteData.profile || {}),
    settings: mergeSettingsByUpdatedAt(localData.settings || {}, remoteData.settings || {}),
    sessions: mergeListById(localData.sessions, remoteData.sessions),
    hands: mergeListById(localData.hands, remoteData.hands),
    handActions: mergeListById(localData.handActions, remoteData.handActions),
    playerNotes: mergeListById(localData.playerNotes, remoteData.playerNotes),
    bankrollLogs: mergeListById(localData.bankrollLogs, remoteData.bankrollLogs)
  })
}

function mergeSettingsByUpdatedAt(localSettings, remoteSettings) {
  const local = localSettings || {}
  const remote = remoteSettings || {}
  const localUpdatedAt = Number(local.updatedAt) || 0
  const remoteUpdatedAt = Number(remote.updatedAt) || 0
  if (remoteUpdatedAt > localUpdatedAt) {
    const merged = Object.assign({}, local, remote)
    if (hasCustomizedAiReminders(local.aiReminders) && isDefaultAiReminders(remote.aiReminders)) {
      merged.aiReminders = local.aiReminders
    }
    return merged
  }
  return Object.assign({}, remote, local)
}

function hasCustomizedAiReminders(aiReminders) {
  if (!aiReminders || typeof aiReminders !== 'object') return false
  const rules = aiReminders.rules || {}
  const ruleKeys = ['profitTarget', 'lossLimit', 'trailingProfit', 'postLossExtraRisk', 'sessionPreReminder', 'sessionMaxHours']
  if (aiReminders.enabled === false || aiReminders.openAgentOnTrigger === true) return true
  if (aiReminders.extraChannels && aiReminders.extraChannels.subscribeMessage) return true
  if (Array.isArray(aiReminders.textReminders) && aiReminders.textReminders.some(item => item && (item.enabled === false || item.subscribeMessage || item.title || item.content))) return true
  return ruleKeys.some(key => {
    const rule = rules[key] || {}
    return !!(Number(rule.amount) || Number(rule.percent) || Number(rule.hoursBefore) || rule.evBrain || rule.subscribeMessage || (key === 'sessionMaxHours' && Number(rule.hours) && Number(rule.hours) !== 0))
  })
}

function isLegacyDefaultTextReminder(item) {
  const title = String(item && item.title || '').trim()
  const content = String(item && item.content || '').trim()
  const enabled = !item || !Object.prototype.hasOwnProperty.call(item, 'enabled') || item.enabled !== false
  const subscribeMessage = !!(item && item.subscribeMessage)
  if (!enabled || subscribeMessage) return false
  if (title === '不要 overcall' && content === '连输后检查是否无计划跟注') return true
  if (title === '不要偷鸡' && content === '回撤后提醒不要强行找机会') return true
  return false
}

function hasOnlyDefaultTextReminders(textReminders) {
  if (!Array.isArray(textReminders) || !textReminders.length) return true
  return textReminders.every(isLegacyDefaultTextReminder)
}

function isDefaultAiReminders(aiReminders) {
  if (!aiReminders || typeof aiReminders !== 'object') return true
  const rules = aiReminders.rules || {}
  const ruleKeys = ['profitTarget', 'lossLimit', 'trailingProfit', 'postLossExtraRisk', 'sessionPreReminder', 'sessionMaxHours']
  if (aiReminders.enabled === false || aiReminders.openAgentOnTrigger === true) return false
  if (aiReminders.extraChannels && aiReminders.extraChannels.subscribeMessage) return false
  if (!hasOnlyDefaultTextReminders(aiReminders.textReminders)) return false
  return !ruleKeys.some(key => {
    const rule = rules[key] || {}
    if (rule.evBrain || rule.subscribeMessage) return true
    if (key === 'sessionMaxHours') {
      const hours = Number(rule.hours) || 0
      return hours !== 0 && hours !== 8
    }
    return !!(Number(rule.amount) || Number(rule.percent) || Number(rule.hoursBefore))
  })
}

async function fetchCloudBackupPaged(playerId) {
  const profilePage = await cloudDataApi.exportBackupPage({
    playerId,
    collection: 'profile',
    limit: 1
  })
  const settingsPage = await cloudDataApi.exportBackupPage({
    playerId,
    collection: 'settings',
    limit: 1
  })
  const backup = {
    profile: profilePage && profilePage.items && profilePage.items[0] || { playerId },
    settings: settingsPage && settingsPage.items && settingsPage.items[0] || {},
    sessions: [],
    hands: [],
    handActions: [],
    playerNotes: [],
    bankrollLogs: []
  }
  const collections = [
    ['sessions', 'sessions'],
    ['hands', 'hands'],
    ['handActions', 'handActions'],
    ['playerNotes', 'playerNotes'],
    ['bankrollLogs', 'bankrollLogs']
  ]
  for (let index = 0; index < collections.length; index += 1) {
    const pair = collections[index]
    const remoteCollection = pair[0]
    const backupKey = pair[1]
    let offset = 0
    while (true) {
      const page = await cloudDataApi.exportBackupPage({
        playerId,
        collection: remoteCollection,
        offset,
        limit: 100
      })
      const items = page && page.items || []
      backup[backupKey] = backup[backupKey].concat(items)
      if (!page || !page.hasMore || !items.length) break
      offset += items.length
    }
  }
  return backup
}

function normalizeBackupPlayerId(backup, playerId) {
  const normalizedPlayerId = String(playerId || '').trim().toUpperCase()
  if (!backup || !normalizedPlayerId) return backup
  const next = Object.assign({}, backup, {
    profile: Object.assign({}, backup.profile || {}, {
      playerId: normalizedPlayerId,
      updatedAt: Math.max(Number(backup.profile && backup.profile.updatedAt) || 0, Date.now())
    })
  })
  ;['sessions', 'hands', 'handActions', 'playerNotes', 'bankrollLogs'].forEach(key => {
    if (Array.isArray(next[key])) {
      next[key] = next[key].map(item => Object.assign({}, item, { playerId: normalizedPlayerId }))
    }
  })
  return next
}

function mergeLocalBusinessDataForStats() {
  return Promise.resolve(false)
}

async function recoverCloudBackupIfNeeded(localBackup) {
  if (isTestAccountActive()) {
    return false
  }
  if (localBackupHasBusinessData(localBackup)) {
    return false
  }
  const currentPlayerId = (localBackup && localBackup.profile && localBackup.profile.playerId || '').trim().toUpperCase()
  let result = null
  try {
    result = await withTimeoutError(
      cloudDataApi.recoverBestBackup({ currentPlayerId }),
      CLOUD_STATS_FUNCTION_TIMEOUT_MS,
      'cloud recovery timed out'
    )
  } catch (error) {
    logCloudBackgroundFailure('cloud recovery skipped', error)
    return false
  }
  const backup = result && result.backup
  if (!backup || !localBackupHasBusinessData(backup)) {
    return false
  }
  store.importBackup(backup)
  return true
}

async function loginWechatAccount(options) {
  const config = options || {}
  if (isTestAccountActive()) {
    return false
  }
  if (!config.manual && isAccountLoggedOut()) {
    return false
  }
  if (!cloudUtils.canUseCloud() || !canStartCloudTask()) {
    return false
  }
  const localBackup = store.exportBackup()
  const currentPlayerId = (localBackup.profile && localBackup.profile.playerId || '').trim().toUpperCase()
  let result = null
  try {
    result = await withTimeoutError(
      cloudDataApi.loginAccount({
        currentPlayerId,
        profile: localBackup.profile || {}
      }),
      CLOUD_STATS_FUNCTION_TIMEOUT_MS,
      'wechat account login timed out'
    )
  } catch (error) {
    logCloudBackgroundFailure('wechat account login failed', error)
    return false
  }

  const accountPlayerId = String(result && result.accountPlayerId || '').trim().toUpperCase()
  const sourcePlayerId = String(result && result.recoveredPlayerId || result && result.sourcePlayerId || accountPlayerId).trim().toUpperCase()
  let backup = result && result.backup
  if (!backup && sourcePlayerId) {
    backup = await fetchCloudBackupPaged(sourcePlayerId)
  }
  if (backup && accountPlayerId) {
    backup = normalizeBackupPlayerId(backup, accountPlayerId)
  }
  if (backup && (localBackupHasBusinessData(backup) || accountPlayerId)) {
    store.importBackup(mergeBackupData(localBackup, backup))
    wx.removeStorageSync(ACCOUNT_LOGGED_OUT_KEY)
    activateAccountSession()
    invalidateCloudMutationAccountContext()
    cloudBootstrapComplete = true
    scheduleBusinessDataSync('sync recovered cloud backup failed')
    return true
  }
  if (accountPlayerId) {
    if (accountPlayerId !== currentPlayerId) {
      writeLocalDataPatch({
        profile: Object.assign({}, localBackup.profile || {}, {
          playerId: accountPlayerId,
          updatedAt: Date.now()
        })
      })
    }
    wx.removeStorageSync(ACCOUNT_LOGGED_OUT_KEY)
    activateAccountSession()
    invalidateCloudMutationAccountContext()
    cloudBootstrapComplete = true
    return true
  }
  return false
}

async function bootstrapCloudSync(forceRefresh, options) {
  if (!AUTO_CLOUD_BOOTSTRAP && !forceRefresh) {
    return false
  }
  if (!canStartCloudTask() || !cloudUtils.canUseCloud()) {
    return false
  }
  if (cloudBootstrapComplete && !forceRefresh) {
    return true
  }
  const timeoutMs = Number(options && options.timeoutMs) || CLOUD_TIMEOUT_MS
  if (bootstrapPromise && !forceRefresh) {
    return shouldAwaitCloudBootstrap(options)
      ? withTimeout(bootstrapPromise, timeoutMs, false)
      : false
  }

  const task = (async () => {
    let localBackup = store.exportBackup()
    const loggedIn = await loginWechatAccount()
    await drainCloudMutationOutbox()
    localBackup = store.exportBackup()
    if (loggedIn) {
      return true
    }

    const recovered = await recoverCloudBackupIfNeeded(localBackup)
    if (recovered) {
      cloudBootstrapComplete = true
      return true
    }

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
      const mergedSettings = mergeSettingsByUpdatedAt(localSettings, cloudSettings)
      store.replaceSettings(mergedSettings)
    } else if ((localSettings.updatedAt || 0) > (cloudSettings.updatedAt || 0)) {
      await cloudRepo.saveSettings(playerId, localSettings)
    }

    await cloudDataApi.syncAndGetStats({
      playerId,
      backup: store.exportBackup(),
      rangeKey: 'all'
    })
    cloudBootstrapComplete = true
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

  return withTimeout(task, timeoutMs, false)
}

async function getDashboardData() {
  if (isAccountLoggedOut()) {
    return {
      stats: getLoggedOutStatsSummary(),
      activeSession: null,
      recentHands: []
    }
  }
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

async function getSessionListData(options) {
  const config = options || {}
  const includeSummary = config.includeSummary !== false
  if (isOnboardingDemoActive()) {
    const demo = getOnboardingDemoDataset()
    if (!includeSummary) {
      return { sessions: demo.sessions || [] }
    }
    const activeStep = onboardingGuide && onboardingGuide.getActiveStep ? onboardingGuide.getActiveStep() : null
    const forceSummaryEligible = !!(activeStep && (activeStep.key === 'sessionSummary' || activeStep.key === 'sessionSummaryOpen'))
    const sessionsWithSummaryState = (demo.sessions || []).map(session => {
      const hands = (demo.hands || []).filter(hand => hand.sessionId === session._id)
      const readiness = getSessionSummaryReadiness(session, hands)
      const summaryState = forceSummaryEligible
        ? Object.assign({}, readiness, {
          summaryEligible: true,
          allHandsReviewed: true,
          reviewedHandCount: hands.length,
          totalHandCount: hands.length
        })
        : readiness
      return Object.assign({}, session, summaryState, {
        onboardingDemo: true
      })
    })
    return { sessions: sessionsWithSummaryState }
  }
  if (isAccountLoggedOut()) {
    return { sessions: [] }
  }
  scheduleCloudBootstrap()
  const adapter = getLocalAdapter()
  const sessions = await adapter.getSessions()
  if (!includeSummary) {
    return { sessions }
  }
  const allHands = await adapter.getReviewHands({})
  const handsBySessionId = (allHands || []).reduce((map, hand) => {
    const sessionId = String(hand && hand.sessionId || '')
    if (!sessionId) return map
    if (!map[sessionId]) map[sessionId] = []
    map[sessionId].push(hand)
    return map
  }, {})
  const sessionsWithSummaryState = (sessions || []).map(session => {
    const hands = handsBySessionId[session._id] || []
    return Object.assign({}, session, getSessionSummaryReadiness(session, hands))
  })
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
  if (isOnboardingDemoActive()) {
    const demo = getOnboardingDemoDataset()
    const session = (demo.sessions || []).find(item => item._id === sessionId) || (demo.sessions || [])[0] || null
    const hands = session ? (demo.hands || []).filter(hand => hand.sessionId === session._id) : []
    return {
      session,
      hands
    }
  }
  if (isAccountLoggedOut()) {
    return {
      session: null,
      hands: []
    }
  }
  scheduleCloudBootstrap()
  const adapter = getLocalAdapter()
  const session = await adapter.getSessionById(sessionId)
  const hands = session ? await adapter.getHandsBySessionId(session._id) : []
  return {
    session,
    hands
  }
}

async function getReviewData(filters, options) {
  const config = options || {}
  if (isOnboardingDemoActive()) {
    const demo = getOnboardingDemoDataset()
    let hands = demo.hands || []
    if (filters && filters.sessionId) {
      hands = hands.filter(hand => hand.sessionId === filters.sessionId)
    }
    if (filters && filters.sessionStatus) {
      hands = reviewSessionStatus.filterHandsBySessionStatus(hands, demo.sessions || [], filters.sessionStatus)
    }
    const totalProfit = hands.reduce((sum, item) => sum + (Number(item.currentProfit) || 0), 0)
    return {
      sessions: demo.sessions || [],
      hands,
      summary: {
        totalHands: hands.length,
        totalProfit
      },
      onboardingDemo: true
    }
  }
  if (isAccountLoggedOut()) {
    return {
      sessions: [],
      hands: [],
      summary: {
        totalHands: 0,
        totalProfit: 0
      }
    }
  }
  scheduleCloudBootstrap()
  const adapter = getLocalAdapter()
  const sessions = Array.isArray(config.sessions) ? config.sessions : await adapter.getSessions()
  const sourceFilters = Object.assign({}, filters || {})
  delete sourceFilters.sessionStatus
  delete sourceFilters.sessionId
  let hands = await adapter.getReviewHands(sourceFilters)
  if (filters && filters.sessionStatus) {
    hands = reviewSessionStatus.filterHandsBySessionStatus(hands, sessions, filters.sessionStatus)
  }
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

async function getStatsData(rangeKey, options) {
  const normalizedRangeKey = normalizeRangeKey(rangeKey)
  if (shouldUseOnboardingStatsDemo()) {
    const demo = getOnboardingDemoDataset()
    return cacheStatsResult(normalizedRangeKey, buildStatsResult(
      demo.sessions || [],
      demo.hands || [],
      getOnboardingDemoSettings(),
      getOnboardingDemoStatsSummary(demo),
      normalizedRangeKey,
      'onboarding_demo'
    ))
  }
  if (options && options.preferCache) {
    const cached = getCachedStatsData(normalizedRangeKey)
    if (cached) return cached
  }
  const playerId = getCurrentPlayerId()
  if (cloudUtils.canUseCloud() && wx.cloud && typeof wx.cloud.callFunction === 'function') {
    const result = await withTimeoutError(cloudDataApi.syncAndGetStats({
      playerId,
      backup: {},
      rangeKey: normalizedRangeKey
    }), CLOUD_STATS_FUNCTION_TIMEOUT_MS, 'cloud stats timeout')
    const statsResult = cacheStatsResult(normalizedRangeKey, buildStatsResult(
      result.sessions || [],
      result.hands || [],
      result.settings || store.getSettings(),
      result.stats || buildUnavailableStatsSummary(),
      normalizedRangeKey,
      'cloud'
    ))
    if (normalizedRangeKey === 'all') {
      const localStats = store.getStatsSummary()
      saveProfileStatsSnapshot(
        isProfileCloudStatsBehindLocal(statsResult.stats, localStats) ? localStats : statsResult.stats
      )
    }
    return statsResult
  }

  throw new Error('cloud stats function unavailable')
}

async function refreshStatsData(rangeKey) {
  return getStatsData(rangeKey)
}

function prefetchStatsData(rangeKey) {
  const normalizedRangeKey = normalizeRangeKey(rangeKey)
  if (statsDataCache[normalizedRangeKey]) {
    return Promise.resolve(statsDataCache[normalizedRangeKey])
  }
  if (statsDataPrefetching[normalizedRangeKey]) {
    return statsDataPrefetching[normalizedRangeKey]
  }
  statsDataPrefetching[normalizedRangeKey] = getStatsData(normalizedRangeKey)
    .catch(error => {
      logCloudBackgroundFailure('prefetch stats failed', error)
      return null
    })
    .finally(() => {
      delete statsDataPrefetching[normalizedRangeKey]
    })
  return statsDataPrefetching[normalizedRangeKey]
}

async function getRecentHands(limit) {
  if (isOnboardingDemoActive()) {
    const demo = getOnboardingDemoDataset()
    return (demo.hands || []).slice(0, limit || 50)
  }
  if (isAccountLoggedOut()) {
    return []
  }
  scheduleCloudBootstrap()
  return getLocalAdapter().getRecentHands(limit || 50)
}

async function getProfilePageData(options) {
  if (isAccountLoggedOut()) {
    return {
      stats: getLoggedOutStatsSummary(),
      profile: getLoggedOutProfile(),
      settings: store.getSettings(),
      accountLoggedOut: true,
      testAccountActive: isTestAccountActive()
    }
  }
  if (!(options && options.preferCache)) {
    scheduleCloudBootstrap()
  }
  let stats
  try {
    if (options && options.preferCache) {
      stats = getCachedStatsData('all')
      if (!stats) {
        const snapshot = getProfileStatsSnapshot()
        if (snapshot) stats = { stats: snapshot, source: 'profile_snapshot' }
      }
      if (!stats && options.fastLocal) {
        stats = getLocalStatsData('all')
      }
    } else {
      stats = await getStatsData('all', { preferCache: !!(options && options.preferCache) })
      stats = keepFreshestProfileStats(stats)
    }
  } catch (error) {
    const snapshot = getProfileStatsSnapshot()
    stats = keepFreshestProfileStats(
      getCachedStatsData('all') || (snapshot ? { stats: snapshot, source: 'profile_snapshot' } : { stats: buildUnavailableStatsSummary() })
    )
  }
  if (!stats) {
    stats = { stats: buildUnavailableStatsSummary() }
  }
  return {
    stats: stats.stats,
    profile: store.getProfile(),
    settings: store.getSettings(),
    accountLoggedOut: false,
    testAccountActive: isTestAccountActive()
  }
}

function getAppSettings() {
  if (isOnboardingDemoActive()) {
    return getOnboardingDemoSettings()
  }
  return store.getSettings()
}

function getCurrentProfile() {
  return store.getProfile()
}

async function switchToTestAccount() {
  const localBackup = store.exportBackup()
  if (!isTestAccountActive()) {
    wx.setStorageSync(TEST_ACCOUNT_BACKUP_KEY, localBackup)
  }
  const playerId = createTestPlayerId()
  const testBackup = Object.assign({}, localBackup, {
    profile: Object.assign({}, localBackup.profile || {}, {
      name: '测试账号',
      playerId,
      title: '测试环境',
      avatarText: '测',
      avatarUrl: '',
      updatedAt: Date.now()
    }),
    sessions: [],
    hands: [],
    handActions: [],
    playerNotes: [],
    bankrollLogs: [],
    aiReminderQueue: []
  })
  store.importBackup(testBackup)
  wx.setStorageSync(TEST_ACCOUNT_KEY, {
    playerId,
    createdAt: Date.now()
  })
  wx.removeStorageSync(ACCOUNT_LOGGED_OUT_KEY)
  activateAccountSession()
  invalidateCloudMutationAccountContext()
  resetCloudBootstrapState()
  clearStatsDataCache()
  return testBackup.profile
}

async function exitTestAccount() {
  let backup = null
  try {
    backup = wx.getStorageSync(TEST_ACCOUNT_BACKUP_KEY)
  } catch (error) {
    backup = null
  }
  wx.removeStorageSync(TEST_ACCOUNT_KEY)
  wx.removeStorageSync(TEST_ACCOUNT_BACKUP_KEY)
  wx.removeStorageSync(ACCOUNT_LOGGED_OUT_KEY)
  if (backup && backup.profile) {
    store.importBackup(backup)
  } else {
    await loginWechatAccount({ manual: true })
  }
  resetCloudBootstrapState()
  clearStatsDataCache()
  invalidateCloudMutationAccountContext()
  activateAccountSession()
  return store.getProfile()
}

function updateProfile(patch) {
  const previousPlayerId = getCurrentPlayerId()
  const profile = store.updateProfile(patch)
  if (profile.playerId !== previousPlayerId) invalidateCloudMutationAccountContext()
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

async function logoutAccount() {
  const localBackup = store.exportBackup()
  const accountId = getCurrentPlayerId()
  wx.setStorageSync(ACCOUNT_LOGGED_OUT_KEY, true)
  invalidateCloudMutationAccountContext()
  destructiveAccountOperation = { accountId, context: captureCloudMutationAccountContext(), phase: 'logged_out' }
  if (!playerCardImportPending.clearAccount(accountId)) throw pendingImportCleanupError()
  socialCache.clearAccountCaches({ accountId })
  resetCloudBootstrapState()
  clearStatsDataCache()
  if (localBackupHasBusinessData(localBackup)) {
    scheduleBusinessDataSync('sync before account logout failed')
  }
  return localBackup
}

function updateSettings(patch, options) {
  const settings = store.updateSettings(patch)
  clearStatsDataCache({ keepProfileSnapshot: true })
  const playerId = getCurrentPlayerId()
  if (options && options.waitForCloud) {
    if (playerId && cloudUtils.canUseCloud()) {
      return cloudDataApi.saveSettings({
        playerId,
        settings
      }).then(result => {
        const saved = result && result.settings ? result.settings : settings
        const merged = mergeSettingsByUpdatedAt(store.getSettings(), saved)
        store.replaceSettings(merged)
        return merged
      }).catch(error => {
        error.localSettings = settings
        logCloudBackgroundFailure('sync settings failed', error)
        throw error
      })
    }
    return Promise.resolve(settings)
  }
  if (playerId && cloudUtils.canUseCloud()) {
    cloudRepo.saveSettings(playerId, settings)
      .then(saved => {
        if (saved) {
          store.replaceSettings(mergeSettingsByUpdatedAt(store.getSettings(), saved))
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
  clearStatsDataCache()
  const result = store.importBackup(payload)
  invalidateCloudMutationAccountContext()
  const playerId = (result.profile && result.profile.playerId) || getCurrentPlayerId()
  if (playerId && cloudUtils.canUseCloud()) {
    try {
      await cloudDataApi.syncAndGetStats({
        playerId,
        backup: result,
        rangeKey: 'all'
      })
    } catch (error) {
      logCloudBackgroundFailure('sync import backup failed', error)
    }
  } else {
    await bootstrapCloudSync(true)
  }
  return result
}

async function clearAllData() {
  requireCloudWriteAvailable()
  const destructiveOperation = beginAccountDestructiveOperation()
  const accountContext = destructiveOperation.context
  const accountId = accountContext.accountId
  let succeeded = false
  try {
    if (!accountId) throw new Error('missing playerId')
    const socialMutationId = createClientMutationId('clear_social', accountId)
    let socialResult = null
    for (let round = 0; round < 200; round += 1) {
      socialResult = await socialService.clearMySocialData({ clientMutationId: socialMutationId })
      if (!isCloudMutationAccountContextCurrent(accountContext)) throw staleAccountContextError()
      if (!socialResult || typeof socialResult.completed !== 'boolean' ||
        typeof socialResult.remainingStage !== 'string' || typeof socialResult.socialUserId !== 'string') {
        throw new Error('invalid social clear response')
      }
      if (socialResult.completed) break
    }
    if (!socialResult || !socialResult.completed) {
      const error = new Error('SOCIAL_CLEAR_INCOMPLETE')
      error.code = 'SOCIAL_CLEAR_INCOMPLETE'
      throw error
    }

    const privateResult = await cloudDataApi.clearAllData({
      playerId: accountId,
      clientMutationId: createClientMutationId('clear_private', accountId)
    })
    if (!isCloudMutationAccountContextCurrent(accountContext)) throw staleAccountContextError()
    if (!privateResult || privateResult.completed !== true) throw new Error('private clear did not complete')

    if (!playerCardImportPending.clearAccount(accountId)) throw pendingImportCleanupError()
    clearStatsDataCache()
    const result = store.clearAllData()
    wx.setStorageSync(ACCOUNT_LOGGED_OUT_KEY, true)
    const remainingOutbox = loadCloudMutationOutbox().filter(record => record && record.accountId !== accountId)
    saveCloudMutationOutbox(remainingOutbox)
    cloudMutationDrainEpoch += 1
    delete cloudMutationDrainPromises[accountId]
    resetCloudBootstrapState()
    captureCloudMutationAccountContext()
    socialCache.clearAccountCaches({ accountId, socialUserId: socialResult.socialUserId })
    succeeded = true
    return result
  } finally {
    finishAccountDestructiveOperation(destructiveOperation, succeeded)
  }
}

async function getSessionById(sessionId) {
  if (isOnboardingDemoActive()) {
    const demo = getOnboardingDemoDataset()
    return (demo.sessions || []).find(session => session._id === sessionId) || null
  }
  scheduleCloudBootstrap()
  return getLocalAdapter().getSessionById(sessionId)
}

async function getHandById(handId) {
  if (isOnboardingDemoActive()) {
    const demo = getOnboardingDemoDataset()
    return (demo.hands || []).find(hand => hand._id === handId) || null
  }
  scheduleCloudBootstrap()
  return getLocalAdapter().getHandById(handId)
}

async function getActionsByHandId(handId) {
  if (isOnboardingDemoActive()) {
    const demo = getOnboardingDemoDataset()
    return (demo.handActions || []).filter(action => action.handId === handId)
  }
  scheduleCloudBootstrap()
  return getLocalAdapter().getActionsByHandId(handId)
}

async function getReviewHands(filters) {
  if (isOnboardingDemoActive()) {
    const demo = getOnboardingDemoDataset()
    return store.__test && store.__test.filterReviewHands
      ? store.__test.filterReviewHands(demo.hands || [], filters || {})
      : (demo.hands || [])
  }
  scheduleCloudBootstrap()
  return store.getReviewHands(filters || {})
}

async function getPlayerNotes(filters) {
  scheduleCloudBootstrap()
  if (cloudUtils.canUseCloud() && canStartCloudTask()) {
    cloudDataApi.listPlayerNotes({
      playerId: getCurrentPlayerId()
    }).then(response => {
      if (response && response.playerNotes) {
        mergeRemoteBusinessPatch({ playerNotes: response.playerNotes })
      }
    }).catch(error => {
      logCloudBackgroundFailure('refresh player notes from cloud failed', error)
    })
  }
  return getLocalAdapter().getPlayerNotes(filters || {})
}

async function getPlayerNoteById(noteId) {
  scheduleCloudBootstrap()
  return getLocalAdapter().getPlayerNoteById(noteId)
}

function stableMutationHash(value, seed) {
  let hash = Number(seed) >>> 0
  const input = String(value || '')
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function deriveWithdrawMutationId(accountId, handId, coreMutationId) {
  const source = JSON.stringify([
    String(accountId || '').trim().toUpperCase(),
    String(handId || '').trim(),
    String(coreMutationId || '').trim()
  ])
  return 'withdraw_source_' + stableMutationHash(source, 2166136261) + stableMutationHash(source, 2246822519)
}

async function runPostDeleteSocialCleanup(record, result) {
  if (!record || !result || result.deleted !== true) return
  const action = String(record.action || '')
  let handIds = []
  if (action === 'delete_hand') {
    handIds = [result.handId || record.payload && record.payload.handId || record.targetId]
  } else if (action === 'delete_session') {
    handIds = Array.isArray(result.handIds) ? result.handIds : []
  }
  const accountId = String(record.accountId || record.payload && record.payload.playerId || '').trim()
  for (const handId of Array.from(new Set(handIds.map(value => String(value || '').trim()).filter(Boolean)))) {
    try {
      await socialService.withdrawSharesBySourceHand({
        handId,
        clientMutationId: deriveWithdrawMutationId(accountId, handId, record.clientMutationId)
      })
    } catch (error) {
      // Social cleanup is deliberately best effort: the private-data delete remains authoritative.
      console.warn('social share cleanup after core delete failed')
    }
  }
}

function canonicalizeMutationPayload(value) {
  if (Array.isArray(value)) return value.map(canonicalizeMutationPayload)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = canonicalizeMutationPayload(value[key])
    return result
  }, {})
}

function mutationOutboxDescriptor(accountId, action, targetId, payload) {
  return JSON.stringify([
    String(accountId || '').trim().toUpperCase(),
    String(action || '').trim(),
    String(targetId || '').trim(),
    canonicalizeMutationPayload(payload || {})
  ])
}

function loadCloudMutationOutbox() {
  if (typeof wx === 'undefined' || !wx || typeof wx.getStorageSync !== 'function') return []
  const stored = wx.getStorageSync(CLOUD_MUTATION_OUTBOX_KEY)
  return stored && stored.version === 1 && Array.isArray(stored.records) ? stored.records.filter(Boolean) : []
}

function saveCloudMutationOutbox(records) {
  if (typeof wx === 'undefined' || !wx || typeof wx.setStorageSync !== 'function') {
    throw new Error('cloud mutation outbox storage unavailable')
  }
  const safeRecords = (Array.isArray(records) ? records : []).filter(Boolean)
  const pending = safeRecords.filter(record => record.status === 'pending')
  const history = safeRecords.filter(record => record.status !== 'pending').slice(-50)
  wx.setStorageSync(CLOUD_MUTATION_OUTBOX_KEY, { version: 1, records: pending.concat(history) })
}

function getOrCreateCloudMutation(action, targetId, payload) {
  const accountId = getCurrentPlayerId()
  if (!accountId) throw new Error('missing playerId')
  const descriptor = mutationOutboxDescriptor(accountId, action, targetId, payload)
  const records = loadCloudMutationOutbox()
  const existing = records.find(record => record && record.status === 'pending' && record.descriptor === descriptor && record.accountId === accountId)
  const canonicalPayload = canonicalizeMutationPayload(payload || {})
  if (existing && existing.clientMutationId) {
    if (!existing.payload) {
      existing.payload = canonicalPayload
      saveCloudMutationOutbox(records)
    }
    return existing
  }
  const record = {
    accountId,
    action: String(action || ''),
    targetId: String(targetId || ''),
    descriptor,
    payload: canonicalPayload,
    clientMutationId: createClientMutationId(action, targetId),
    status: 'pending',
    attemptCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastErrorCode: ''
  }
  records.push(record)
  saveCloudMutationOutbox(records)
  return record
}

function updateCloudMutationRecord(record, patch) {
  const records = loadCloudMutationOutbox()
  const index = records.findIndex(item => item && item.descriptor === record.descriptor && item.clientMutationId === record.clientMutationId)
  if (index < 0) return
  records[index] = Object.assign({}, records[index], patch || {}, { updatedAt: Date.now() })
  saveCloudMutationOutbox(records)
}

function clearCloudMutationRecord(record) {
  const records = loadCloudMutationOutbox().filter(item => !(item && item.descriptor === record.descriptor && item.clientMutationId === record.clientMutationId))
  saveCloudMutationOutbox(records)
}

function captureCloudMutationAccountContext() {
  const accountId = getCurrentPlayerId()
  if (accountId !== cloudMutationAccountContextId) {
    cloudMutationAccountContextId = accountId
    cloudMutationAccountContextEpoch += 1
  }
  return { accountId, epoch: cloudMutationAccountContextEpoch }
}

function captureAccountContext() {
  if (destructiveAccountOperation) throw accountDestructiveOperationError()
  const context = captureCloudMutationAccountContext()
  const token = Object.freeze({ accountId: context.accountId })
  publicAccountContexts.set(token, context)
  return token
}

function resolveAccountContext(token) {
  if (!token) return captureCloudMutationAccountContext()
  const context = publicAccountContexts.get(token)
  if (!context) throw staleAccountContextError()
  return context
}

function resolveRequiredAccountContext(token) {
  if (!token) {
    const error = new Error('account context is required')
    error.code = 'ACCOUNT_CONTEXT_REQUIRED'
    throw error
  }
  return resolveAccountContext(token)
}

function isAccountContextCurrent(token) {
  const context = token && publicAccountContexts.get(token)
  return !!context && isCloudMutationAccountContextCurrent(context)
}

function assertAccountContextCurrent(context) {
  if (!isCloudMutationAccountContextCurrent(context)) throw staleAccountContextError()
}

function isCloudMutationAccountContextCurrent(context) {
  const current = captureCloudMutationAccountContext()
  return !!context && current.accountId === context.accountId && current.epoch === context.epoch
}

function staleAccountContextError() {
  const error = new Error('account changed while cloud mutation was in flight')
  error.code = 'STALE_ACCOUNT_CONTEXT'
  return error
}

async function runAuthoritativeMutation(action, targetId, payload, invoke) {
  const context = captureCloudMutationAccountContext()
  const record = getOrCreateCloudMutation(action, targetId, payload)
  updateCloudMutationRecord(record, {
    attemptCount: Math.max(0, Number(record.attemptCount) || 0) + 1,
    lastAttemptAt: Date.now(),
    lastErrorCode: ''
  })
  let result
  try {
    result = await invoke(record.clientMutationId)
  } catch (error) {
    updateCloudMutationRecord(record, {
      lastErrorCode: String(error && (error.code || error.errCode) || 'UNKNOWN').slice(0, 64)
    })
    throw error
  }
  if (result && result.rejected === true) {
    updateCloudMutationRecord(record, {
      status: 'terminal_rejected',
      terminalReason: String(result.reason || 'REJECTED').slice(0, 64)
    })
  } else {
    clearCloudMutationRecord(record)
  }
  if (!isCloudMutationAccountContextCurrent(context)) throw staleAccountContextError()
  return result
}

function invokeCloudMutationRecord(record) {
  const input = Object.assign({}, canonicalizeMutationPayload(record && record.payload || {}), {
    clientMutationId: record && record.clientMutationId || ''
  })
  const action = String(record && record.action || '')
  if (action === 'create_session') return cloudDataApi.createSession(input)
  if (action === 'update_session') return cloudDataApi.updateSession(input)
  if (action === 'finish_session') return cloudDataApi.finishSession(input)
  if (action === 'create_hand') return cloudDataApi.createHand(input)
  if (action === 'update_hand') return cloudDataApi.updateHand(input)
  if (action === 'upsert_hand') return cloudDataApi.upsertHand(input)
  if (action === 'delete_hand') return cloudDataApi.deleteHand(input)
  if (action === 'delete_session') return cloudDataApi.deleteSession(input)
  if (action === 'create_player_note') return cloudDataApi.createPlayerNote(input)
  if (action === 'update_player_note') return cloudDataApi.updatePlayerNote(input)
  if (action === 'delete_player_note') return cloudDataApi.deletePlayerNote(input)
  const error = new Error('unsupported cloud mutation action')
  error.code = 'UNSUPPORTED_MUTATION_ACTION'
  throw error
}

function reconcileCloudMutationResult(record, result) {
  const action = String(record && record.action || '')
  const payload = record && record.payload || {}
  if (['create_session', 'update_session'].includes(action) && result && result.session) {
    mergeRemoteBusinessPatch({ sessions: [result.session] })
    return
  }
  if (action === 'finish_session' && result && result.session) {
    mergeRemoteBusinessPatch({
      sessions: [result.session],
      bankrollLogs: result.bankrollLog ? [result.bankrollLog] : []
    })
    return
  }
  if (['create_hand', 'update_hand', 'upsert_hand'].includes(action) && result && result.hand) {
    mergeRemoteBusinessPatch({
      sessions: result.session ? [result.session] : (result.sessions || []),
      hands: [result.hand],
      handActions: result.actions || []
    })
    return
  }
  if (action === 'delete_hand' && result && result.deleted) {
    removeLocalBusinessDocs({ handId: payload.handId || record.targetId })
    if (result.session) mergeRemoteBusinessPatch({ sessions: [result.session] })
    return
  }
  if (action === 'delete_session' && result && result.deleted) {
    removeLocalBusinessDocs({ sessionId: payload.sessionId || record.targetId, handIds: result.handIds || [] })
    return
  }
  if (action === 'create_player_note' && result && result.playerNote) {
    const localId = String(payload.payload && payload.payload._id || record.targetId || '').trim()
    const canonicalId = String(result.playerNote._id || '').trim()
    if (localId && canonicalId && localId !== canonicalId) {
      const backup = store.exportBackup()
      const local = (backup.playerNotes || []).find(note => note && note._id === localId) || payload.payload || {}
      const canonical = Object.assign({}, local, result.playerNote, {
        _id: canonicalId,
        note: local.note != null ? local.note : result.playerNote.note,
        leakTags: Array.isArray(local.leakTags) ? local.leakTags : result.playerNote.leakTags,
        battleHandIds: Array.isArray(local.battleHandIds) ? local.battleHandIds : result.playerNote.battleHandIds
      })
      writeLocalDataPatch({
        playerNotes: [canonical].concat((backup.playerNotes || []).filter(note => note && note._id !== localId && note._id !== canonicalId))
      })
      const records = loadCloudMutationOutbox()
      let changed = false
      records.forEach(item => {
        if (!item || item.status !== 'pending' || item.accountId !== record.accountId ||
          !['update_player_note', 'delete_player_note'].includes(item.action)) return
        const itemPayload = Object.assign({}, item.payload || {})
        if (String(itemPayload.noteId || '') !== localId && String(item.targetId || '') !== localId) return
        itemPayload.noteId = canonicalId
        item.payload = itemPayload
        item.targetId = canonicalId
        item.descriptor = mutationOutboxDescriptor(item.accountId, item.action, canonicalId, itemPayload)
        changed = true
      })
      if (changed) saveCloudMutationOutbox(records)
      clearStatsDataCache()
      return
    }
    mergeRemoteBusinessPatch({ playerNotes: [result.playerNote] })
    return
  }
  if (['update_player_note', 'delete_player_note'].includes(action) && result && result.playerNote) {
    mergeRemoteBusinessPatch({ playerNotes: [result.playerNote] })
  }
}

function drainCloudMutationOutbox() {
  if (!canStartCloudTask() || !cloudUtils.canUseCloud()) return Promise.resolve({ attempted: 0, completed: 0 })
  const accountId = getCurrentPlayerId()
  if (!accountId) return Promise.resolve({ attempted: 0, completed: 0 })
  if (cloudMutationDrainPromises[accountId]) return cloudMutationDrainPromises[accountId]
  const accountContext = captureCloudMutationAccountContext()
  const epoch = ++cloudMutationDrainEpoch
  let task = null
  task = (async () => {
    const pending = loadCloudMutationOutbox()
      .filter(record => record && record.status === 'pending' && record.accountId === accountId && record.payload)
      .slice(0, CLOUD_MUTATION_DRAIN_LIMIT)
    let completed = 0
    for (const pendingRecord of pending) {
      if (epoch !== cloudMutationDrainEpoch || !isCloudMutationAccountContextCurrent(accountContext)) break
      const record = loadCloudMutationOutbox().find(item => item && item.status === 'pending' &&
        item.accountId === accountId && item.clientMutationId === pendingRecord.clientMutationId)
      if (!record || !record.payload) continue
      updateCloudMutationRecord(record, {
        attemptCount: Math.max(0, Number(record.attemptCount) || 0) + 1,
        lastAttemptAt: Date.now(),
        lastErrorCode: ''
      })
      try {
        const result = await invokeCloudMutationRecord(record)
        if (result && result.rejected === true) {
          updateCloudMutationRecord(record, {
            status: 'terminal_rejected',
            terminalReason: String(result.reason || 'REJECTED').slice(0, 64)
          })
          break
        }
        if (epoch === cloudMutationDrainEpoch && isCloudMutationAccountContextCurrent(accountContext)) {
          reconcileCloudMutationResult(record, result)
        }
        await runPostDeleteSocialCleanup(record, result)
        clearCloudMutationRecord(record)
        completed += 1
      } catch (error) {
        updateCloudMutationRecord(record, {
          lastErrorCode: String(error && (error.code || error.errCode) || 'UNKNOWN').slice(0, 64)
        })
        break
      }
    }
    return { attempted: pending.length, completed }
  })().finally(() => {
    if (cloudMutationDrainPromises[accountId] === task) delete cloudMutationDrainPromises[accountId]
  })
  cloudMutationDrainPromises[accountId] = task
  return task
}

function requirePlayerCardReceiptCloud() {
  if (!cloudUtils.canUseCloud() || !canStartCloudTask()) {
    const error = new Error('cloud player card receipt unavailable')
    error.code = 'CLOUD_PLAYER_CARD_RECEIPT_UNAVAILABLE'
    throw error
  }
}

async function getPlayerCardImportReceipt(shareId, accountToken) {
  requirePlayerCardReceiptCloud()
  const context = resolveRequiredAccountContext(accountToken)
  assertAccountContextCurrent(context)
  const response = await cloudDataApi.getPlayerCardImportReceipt({
    playerId: context.accountId,
    shareId: String(shareId || '').trim()
  })
  assertAccountContextCurrent(context)
  return response && response.receipt || null
}

async function beginPlayerCardImportReceipt(input, accountToken) {
  requirePlayerCardReceiptCloud()
  const context = resolveRequiredAccountContext(accountToken)
  assertAccountContextCurrent(context)
  const source = input || {}
  const shareId = String(source.shareId || '').trim()
  const response = await cloudDataApi.beginPlayerCardImportReceipt({
    playerId: context.accountId,
    clientMutationId: source.clientMutationId || createClientMutationId('begin_player_card_import_receipt', shareId),
    shareId,
    mode: source.mode,
    targetPlayerNoteId: source.targetPlayerNoteId
  })
  assertAccountContextCurrent(context)
  return response && response.receipt || null
}

async function completePlayerCardImportReceipt(shareId, clientMutationId, accountToken) {
  requirePlayerCardReceiptCloud()
  const context = resolveRequiredAccountContext(accountToken)
  assertAccountContextCurrent(context)
  const targetShareId = String(shareId || '').trim()
  const response = await cloudDataApi.completePlayerCardImportReceipt({
    playerId: context.accountId,
    clientMutationId: clientMutationId || createClientMutationId('complete_player_card_import_receipt', targetShareId),
    shareId: targetShareId
  })
  assertAccountContextCurrent(context)
  return response && response.receipt || null
}

function scheduleSocialStatsSyncAfterCloudWrite() {
  const playerId = getCurrentPlayerId()
  if (!playerId || !socialService || typeof socialService.scheduleMyStatsSync !== 'function') return
  Promise.resolve()
    .then(() => socialService.scheduleMyStatsSync(playerId))
    .catch(error => logCloudBackgroundFailure('sync social stats failed', error))
}

async function getFriendPlayerNote(friendUserId) {
  scheduleCloudBootstrap()
  return getLocalAdapter().getFriendPlayerNote(friendUserId)
}

async function getPlayerNoteBattleHands(noteId) {
  scheduleCloudBootstrap()
  return getLocalAdapter().getPlayerNoteBattleHands(noteId)
}

async function createPlayerNote(payload, options) {
  const waitForCloud = !!(options && options.waitForCloud)
  const accountContext = resolveAccountContext(options && options.accountContext)
  assertAccountContextCurrent(accountContext)
  if (waitForCloud && (!cloudUtils.canUseCloud() || !canStartCloudTask())) {
    const error = new Error('cloud player note write required')
    error.code = 'CLOUD_PLAYER_NOTE_WRITE_REQUIRED'
    throw error
  }
  const result = await getLocalAdapter().createPlayerNote(payload || {})
  assertAccountContextCurrent(accountContext)
  if (cloudUtils.canUseCloud() && canStartCloudTask()) {
    const mutationPayload = { playerId: accountContext.accountId, payload: result }
    const cloudTask = runAuthoritativeMutation('create_player_note', result._id, mutationPayload, clientMutationId =>
      cloudDataApi.createPlayerNote(Object.assign({}, mutationPayload, { clientMutationId }))).then(response => {
      if (response && response.playerNote) {
        reconcileCloudMutationResult({
          accountId: accountContext.accountId,
          action: 'create_player_note',
          targetId: result._id,
          payload: mutationPayload
        }, response)
        return response.playerNote
      }
      throw new Error('cloud create player note failed')
    }).catch(error => {
      if (waitForCloud) {
        scheduleBusinessDataSync('sync create player note backup failed')
        throw error
      }
      logCloudBackgroundFailure('sync create player note failed', error)
      scheduleBusinessDataSync('sync create player note backup failed')
    })
    if (waitForCloud) return cloudTask
  } else if (waitForCloud) {
    const error = new Error('cloud player note write required')
    error.code = 'CLOUD_PLAYER_NOTE_WRITE_REQUIRED'
    throw error
  }
  return result
}

async function ensureFriendPlayerNote(snapshot) {
  const adapter = getLocalAdapter()
  const result = await adapter.ensureFriendPlayerNote(snapshot || {})
  if (cloudUtils.canUseCloud() && canStartCloudTask()) {
    try {
      const mutationPayload = { playerId: getCurrentPlayerId(), payload: result }
      const response = await runAuthoritativeMutation('create_player_note', result.linkedFriendUserId, mutationPayload, clientMutationId =>
        cloudDataApi.createPlayerNote(Object.assign({}, mutationPayload, { clientMutationId })))
      if (response && response.playerNote) {
        mergeRemoteBusinessPatch({ playerNotes: [response.playerNote] })
        return adapter.reconcileFriendPlayerNote(response.playerNote) || response.playerNote
      }
    } catch (error) {
      logCloudBackgroundFailure('sync ensure friend player note failed', error)
      scheduleBusinessDataSync('sync ensure friend player note backup failed')
    }
  }
  return result
}

async function detachFriendPlayerNote(friendUserId) {
  const result = await getLocalAdapter().detachFriendPlayerNote(friendUserId)
  if (!result) return null
  if (cloudUtils.canUseCloud() && canStartCloudTask()) {
    const mutationPayload = { playerId: getCurrentPlayerId(), noteId: result._id, patch: result }
    runAuthoritativeMutation('update_player_note', result._id, mutationPayload, clientMutationId =>
      cloudDataApi.updatePlayerNote(Object.assign({}, mutationPayload, { clientMutationId }))).then(response => {
      if (response && response.playerNote) {
        mergeRemoteBusinessPatch({ playerNotes: [response.playerNote] })
      }
    }).catch(error => {
      logCloudBackgroundFailure('sync detach friend player note failed', error)
      scheduleBusinessDataSync('sync detach friend player note backup failed')
    })
  }
  return result
}

async function updatePlayerNote(noteId, patch, options) {
  const waitForCloud = !!(options && options.waitForCloud)
  const accountContext = resolveAccountContext(options && options.accountContext)
  assertAccountContextCurrent(accountContext)
  if (waitForCloud && (!cloudUtils.canUseCloud() || !canStartCloudTask())) {
    const error = new Error('cloud player note write required')
    error.code = 'CLOUD_PLAYER_NOTE_WRITE_REQUIRED'
    throw error
  }
  const result = await getLocalAdapter().updatePlayerNote(noteId, patch || {})
  assertAccountContextCurrent(accountContext)
  if (cloudUtils.canUseCloud() && canStartCloudTask()) {
    const mutationPayload = { playerId: accountContext.accountId, noteId, patch: result }
    const cloudTask = runAuthoritativeMutation('update_player_note', noteId, mutationPayload, clientMutationId =>
      cloudDataApi.updatePlayerNote(Object.assign({}, mutationPayload, { clientMutationId }))).then(response => {
      if (response && response.playerNote) {
        mergeRemoteBusinessPatch({ playerNotes: [response.playerNote] })
        return response.playerNote
      }
      throw new Error('cloud update player note failed')
    }).catch(error => {
      if (waitForCloud) {
        scheduleBusinessDataSync('sync update player note backup failed')
        throw error
      }
      logCloudBackgroundFailure('sync update player note failed', error)
      scheduleBusinessDataSync('sync update player note backup failed')
    })
    if (waitForCloud) return cloudTask
  } else if (waitForCloud) {
    const error = new Error('cloud player note write required')
    error.code = 'CLOUD_PLAYER_NOTE_WRITE_REQUIRED'
    throw error
  }
  return result
}

async function deletePlayerNote(noteId) {
  const deleted = await getLocalAdapter().deletePlayerNote(noteId)
  if (cloudUtils.canUseCloud() && canStartCloudTask()) {
    const mutationPayload = { playerId: getCurrentPlayerId(), noteId }
    runAuthoritativeMutation('delete_player_note', noteId, mutationPayload, clientMutationId =>
      cloudDataApi.deletePlayerNote(Object.assign({}, mutationPayload, { clientMutationId }))).then(response => {
      if (response && response.playerNote) {
        mergeRemoteBusinessPatch({ playerNotes: [response.playerNote] })
      }
    }).catch(error => {
      logCloudBackgroundFailure('sync delete player note failed', error)
      scheduleBusinessDataSync('sync delete player note backup failed')
    })
  }
  return deleted
}

async function previewPbtPlayerNotesCsv(csvText) {
  const plan = pbtNotesImport.buildImportPlan(csvText, store.exportBackup().playerNotes || [])
  if (!plan.ok) {
    const error = new Error(plan.error || 'PBT_IMPORT_FAILED')
    error.code = plan.error || 'PBT_IMPORT_FAILED'
    error.plan = plan
    throw error
  }
  return {
    total: plan.total,
    created: plan.create.length,
    updated: plan.update.length,
    skipped: plan.skipped.length,
    markerFound: plan.markerFound
  }
}

async function importPbtPlayerNotesFromCsv(csvText) {
  const backup = store.exportBackup()
  const existingNotes = backup.playerNotes || []
  const plan = pbtNotesImport.buildImportPlan(csvText, existingNotes)
  if (!plan.ok) {
    const error = new Error(plan.error || 'PBT_IMPORT_FAILED')
    error.code = plan.error || 'PBT_IMPORT_FAILED'
    error.plan = plan
    throw error
  }

  const byId = {}
  existingNotes.forEach(note => {
    if (note && note._id) byId[note._id] = note
  })
  plan.update.concat(plan.create).forEach(note => {
    if (note && note._id) byId[note._id] = note
  })
  const playerNotes = Object.keys(byId)
    .map(id => byId[id])
    .sort((a, b) => (Number(b.updatedAt || b.createdAt) || 0) - (Number(a.updatedAt || a.createdAt) || 0))

  writeLocalDataPatch({ playerNotes })

  if (cloudUtils.canUseCloud() && canStartCloudTask()) {
    const playerId = getCurrentPlayerId()
    const jobs = []
    plan.create.forEach(note => {
      const mutationPayload = { playerId, payload: note }
      jobs.push(runAuthoritativeMutation('create_player_note', note._id, mutationPayload, clientMutationId =>
        cloudDataApi.createPlayerNote(Object.assign({}, mutationPayload, { clientMutationId }))))
    })
    plan.update.forEach(note => {
      const mutationPayload = { playerId, noteId: note._id, patch: note }
      jobs.push(runAuthoritativeMutation('update_player_note', note._id, mutationPayload, clientMutationId =>
        cloudDataApi.updatePlayerNote(Object.assign({}, mutationPayload, { clientMutationId }))))
    })
    Promise.allSettled(jobs).then(results => {
      const syncedNotes = results
        .filter(item => item.status === 'fulfilled' && item.value && item.value.playerNote)
        .map(item => item.value.playerNote)
      if (syncedNotes.length) mergeRemoteBusinessPatch({ playerNotes: syncedNotes })
      if (results.some(item => item.status === 'rejected')) {
        scheduleBusinessDataSync('sync pbt player notes import failed')
      }
    }).catch(error => {
      logCloudBackgroundFailure('sync pbt player notes import failed', error)
      scheduleBusinessDataSync('sync pbt player notes import failed')
    })
  }

  return {
    total: plan.total,
    created: plan.create.length,
    updated: plan.update.length,
    skipped: plan.skipped.length,
    markerFound: plan.markerFound
  }
}

async function previewPbtBankrollSessionsCsv(csvText) {
  const backup = store.exportBackup()
  const plan = pbtBankrollImport.buildImportPlan(csvText, backup.sessions || [], backup.bankrollLogs || [])
  if (!plan.ok) {
    const error = new Error(plan.error || 'PBT_BANKROLL_IMPORT_FAILED')
    error.code = plan.error || 'PBT_BANKROLL_IMPORT_FAILED'
    error.plan = plan
    throw error
  }
  return {
    total: plan.total,
    created: plan.createSessions.length,
    updated: plan.updateSessions.length,
    skipped: plan.skipped.length,
    markerFound: plan.markerFound
  }
}

async function importPbtBankrollSessionsFromCsv(csvText) {
  const backup = store.exportBackup()
  const plan = pbtBankrollImport.buildImportPlan(csvText, backup.sessions || [], backup.bankrollLogs || [])
  if (!plan.ok) {
    const error = new Error(plan.error || 'PBT_BANKROLL_IMPORT_FAILED')
    error.code = plan.error || 'PBT_BANKROLL_IMPORT_FAILED'
    error.plan = plan
    throw error
  }

  const sessionById = {}
  ;(backup.sessions || []).forEach(session => {
    if (session && session._id) sessionById[session._id] = session
  })
  plan.updateSessions.concat(plan.createSessions).forEach(session => {
    if (session && session._id) sessionById[session._id] = session
  })

  const bankrollById = {}
  ;(backup.bankrollLogs || []).forEach(log => {
    if (log && log._id) bankrollById[log._id] = log
  })
  plan.bankrollLogs.forEach(log => {
    if (log && log._id) bankrollById[log._id] = log
  })

  const nextBackup = writeLocalDataPatch({
    sessions: Object.keys(sessionById)
      .map(id => sessionById[id])
      .sort((a, b) => (Number(b.updatedAt || b.createdAt) || 0) - (Number(a.updatedAt || a.createdAt) || 0)),
    bankrollLogs: Object.keys(bankrollById)
      .map(id => bankrollById[id])
      .sort((a, b) => (Number(b.updatedAt || b.createdAt) || 0) - (Number(a.updatedAt || a.createdAt) || 0))
  })
  clearStatsDataCache()

  const playerId = getCurrentPlayerId()
  if (playerId && cloudUtils.canUseCloud() && canStartCloudTask()) {
    cloudDataApi.syncAndGetStats({
      playerId,
      backup: nextBackup,
      rangeKey: 'all'
    }).catch(error => {
      logCloudBackgroundFailure('sync pbt bankroll import failed', error)
    })
  }

  return {
    total: plan.total,
    created: plan.createSessions.length,
    updated: plan.updateSessions.length,
    skipped: plan.skipped.length,
    markerFound: plan.markerFound
  }
}

async function addPlayerNoteBattleHand(noteId, handId) {
  const result = await getLocalAdapter().addPlayerNoteBattleHand(noteId, handId)
  if (result) {
    updatePlayerNote(noteId, { battleHandIds: result.battleHandIds }).catch(error => {
      logCloudBackgroundFailure('sync add player note battle hand failed', error)
    })
  }
  return result
}

async function removePlayerNoteBattleHand(noteId, handId) {
  const result = await getLocalAdapter().removePlayerNoteBattleHand(noteId, handId)
  if (result) {
    updatePlayerNote(noteId, { battleHandIds: result.battleHandIds }).catch(error => {
      logCloudBackgroundFailure('sync remove player note battle hand failed', error)
    })
  }
  return result
}

async function createSession(payload) {
  const existingSessions = store.getSessions()
  if (!payload || payload.status === 'active' || !payload.status) {
    sessionRules.assertCanCreateSession(existingSessions)
  }
  requireCloudWriteAvailable()
  const playerId = getCurrentPlayerId()
  const mutationPayload = { playerId, payload: payload || {} }
  const response = await runAuthoritativeMutation('create_session', '', mutationPayload, clientMutationId =>
    cloudDataApi.createSession(Object.assign({}, mutationPayload, { clientMutationId })))
  if (response && response.rejected) {
    throw new Error(response.reason || 'create session rejected')
  }
  const session = response && response.session
  if (!session) throw new Error('create session failed')
  mergeRemoteBusinessPatch({ sessions: [session] })
  scheduleSocialStatsSyncAfterCloudWrite()
  return session
}

async function updateSession(sessionId, patch) {
  requireCloudWriteAvailable()
  const mutationPayload = { playerId: getCurrentPlayerId(), sessionId, patch: patch || {} }
  const response = await runAuthoritativeMutation('update_session', sessionId, mutationPayload, clientMutationId =>
    cloudDataApi.updateSession(Object.assign({}, mutationPayload, { clientMutationId })))
  if (response && response.rejected) {
    throw new Error(response.reason || 'update session rejected')
  }
  const session = response && response.session
  if (!session) throw new Error('update session failed')
  mergeRemoteBusinessPatch({ sessions: [session] })
  scheduleSocialStatsSyncAfterCloudWrite()
  return session
}

async function finishSession(sessionId, endingChips) {
  requireCloudWriteAvailable()
  const payload = typeof endingChips === 'object' && endingChips !== null
    ? endingChips
    : { cashOut: endingChips }
  const mutationPayload = { playerId: getCurrentPlayerId(), sessionId, payload }
  const response = await runAuthoritativeMutation('finish_session', sessionId, mutationPayload, clientMutationId =>
    cloudDataApi.finishSession(Object.assign({}, mutationPayload, { clientMutationId })))
  if (response && response.rejected) {
    throw new Error(response.reason || 'finish session rejected')
  }
  const session = response && response.session
  if (!session) throw new Error('finish session failed')
  mergeRemoteBusinessPatch({
    sessions: [session],
    bankrollLogs: response.bankrollLog ? [response.bankrollLog] : []
  })
  scheduleSocialStatsSyncAfterCloudWrite()
  return session
}

function requestAiReminderSubscribePermission(templateId) {
  const tmplId = String(templateId || '').trim()
  if (!tmplId) {
    return Promise.resolve({ accepted: false, status: 'skipped', message: 'missing template id', templateId: tmplId })
  }
  if (typeof wx === 'undefined' || typeof wx.requestSubscribeMessage !== 'function') {
    return Promise.resolve({ accepted: false, status: 'skipped', message: 'requestSubscribeMessage unavailable', templateId: tmplId })
  }
  return new Promise(resolve => {
    wx.requestSubscribeMessage({
      tmplIds: [tmplId],
      success(res) {
        if (res && res[tmplId] === 'accept') {
          rememberAiReminderSubscribeGrant(tmplId)
        }
        resolve({
          accepted: res && res[tmplId] === 'accept',
          status: res && res[tmplId] === 'accept' ? 'accepted' : 'rejected',
          message: res && res[tmplId] || 'unknown',
          templateId: tmplId,
          raw: res || null
        })
      },
      fail(error) {
        resolve({
          accepted: false,
          status: 'failed',
          errCode: error && (error.errCode || error.errcode || error.code),
          message: error && (error.errMsg || error.message) || 'requestSubscribeMessage failed',
          templateId: tmplId,
          raw: error || null
        })
      }
    })
  })
}

function buildAiReminderSubscribeSummary(reminders) {
  const items = Array.isArray(reminders) ? reminders.filter(Boolean) : []
  if (items.length <= 1) {
    return items[0] || null
  }
  const highestSeverity = items.some(item => item.severity === 'danger') ? 'danger' : (items.some(item => item.severity === 'warning') ? 'warning' : 'info')
  const titles = items
    .map(item => String(item.title || '').trim())
    .filter(Boolean)
  return {
    _id: items.map(item => item._id).filter(Boolean).join(','),
    type: 'ai_reminder_summary',
    severity: highestSeverity,
    title: items.length + '条EV脑提醒',
    message: titles.length ? titles.join('；') : '本手牌触发了多条状态提醒',
    sessionId: items[0] && items[0].sessionId,
    handId: items[0] && items[0].handId,
    channels: { evBrain: true, subscribeMessage: true },
    status: 'pending',
    createdAt: Math.max.apply(null, items.map(item => Number(item.createdAt) || 0)) || Date.now()
  }
}

async function dispatchAiReminderSubscribeMessages(createdHand) {
  const handId = createdHand && createdHand._id
  if (!handId) return []
  const pending = (await getLocalAdapter().getAiRemindersByHandId(handId))
    .filter(item => item && item.handId === handId && item.channels && item.channels.subscribeMessage && item.subscribeStatus !== 'sent')
  if (!pending.length) return []
  const subscribeReminder = buildAiReminderSubscribeSummary(pending)
  let permission = consumeAiReminderSubscribeGrant(AI_REMINDER_SUBSCRIBE_TEMPLATE_ID)
    ? { accepted: true, status: 'accepted', message: 'prepared grant' }
    : await requestAiReminderSubscribePermission(AI_REMINDER_SUBSCRIBE_TEMPLATE_ID)
  let subscribeResult = { status: 'skipped', message: 'not sent' }
  if (!permission.accepted) {
    subscribeResult = { status: permission.status || 'skipped', message: permission.message || 'not accepted' }
  } else {
    try {
      await cloudDataApi.sendAiReminderSubscribeMessage({
        templateId: AI_REMINDER_SUBSCRIBE_TEMPLATE_ID,
        reminder: subscribeReminder
      })
      clearAiReminderSubscribeGrant(AI_REMINDER_SUBSCRIBE_TEMPLATE_ID)
      subscribeResult = {
        status: 'sent',
        message: pending.length > 1 ? 'sent as merged subscribe message' : 'sent'
      }
    } catch (error) {
      subscribeResult = {
        status: 'failed',
        message: error && (error.message || error.errMsg) || String(error)
      }
    }
  }
  const results = []
  for (let index = 0; index < pending.length; index += 1) {
    const reminder = pending[index]
    const result = subscribeResult
    await getLocalAdapter().markAiReminderSubscribeResult(reminder._id, result)
    results.push(Object.assign({ reminderId: reminder._id }, result))
  }
  return results
}

async function createHand(payload) {
  requireCloudWriteAvailable()
  const playerId = getCurrentPlayerId()
  const mutationPayload = { playerId, payload: payload || {} }
  const targetId = String(payload && payload._id || '')
  const response = await runAuthoritativeMutation('create_hand', targetId, mutationPayload, clientMutationId =>
    cloudDataApi.createHand(Object.assign({}, mutationPayload, { clientMutationId })))
  if (response && response.rejected) {
    throw new Error(response.reason || 'create hand rejected')
  }
  const result = response && response.hand
  if (!result) throw new Error('create hand failed')
  mergeRemoteBusinessPatch({
    sessions: response.session ? [response.session] : [],
    hands: [result],
    handActions: response.actions || []
  })
  store.enqueueAiRemindersForHand(result._id, { includeTextReminders: true })
  dispatchAiReminderSubscribeMessages(result).catch(error => {
    logCloudBackgroundFailure('dispatch ai reminder subscribe failed', error)
  })
  scheduleSocialStatsSyncAfterCloudWrite()
  return result
}

async function updateHandInternal(handId, patch, options) {
  const config = options || {}
  requireCloudWriteAvailable()
  const mutationPayload = { playerId: getCurrentPlayerId(), handId, patch: patch || {} }
  const response = await runAuthoritativeMutation('update_hand', handId, mutationPayload, clientMutationId =>
    cloudDataApi.updateHand(Object.assign({}, mutationPayload, { clientMutationId })))
  if (response && response.rejected) {
    if (config.waitForCloud && response.reason === 'HAND_NOT_FOUND') {
      const handForCloud = Object.assign({ _id: handId }, store.getHandById(handId) || {}, patch || {})
      const syncResult = await confirmHandCloudSync(handId, patch, handForCloud, config.syncLabel)
      if (syncResult && syncResult.cloudSynced && syncResult.hand) {
        mergeRemoteBusinessPatch({
          sessions: syncResult.sessions || [],
          hands: [syncResult.hand],
          handActions: syncResult.actions || []
        })
        scheduleSocialStatsSyncAfterCloudWrite()
        return {
          hand: syncResult.hand,
          cloudSynced: true,
          cloudSyncError: ''
        }
      }
      return {
        hand: handForCloud,
        cloudSynced: false,
        cloudSyncError: syncResult && syncResult.cloudSyncError || response.reason || 'update hand rejected'
      }
    }
    throw new Error(response.reason || 'update hand rejected')
  }
  const result = response && response.hand
  if (!result) throw new Error('update hand failed')
  mergeRemoteBusinessPatch({
    sessions: response.sessions || [],
    hands: [result],
    handActions: response.actions || []
  })
  scheduleSocialStatsSyncAfterCloudWrite()
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'currentProfit')) {
    store.enqueueAiRemindersForHand(result._id, { includeTextReminders: false })
  }
  dispatchAiReminderSubscribeMessages(result).catch(error => {
    logCloudBackgroundFailure('dispatch ai reminder subscribe failed', error)
  })
  if (config.waitForCloud) {
    return {
      hand: result,
      cloudSynced: true,
      cloudSyncError: ''
    }
  }
  return result
}

async function updateHand(handId, patch) {
  return updateHandInternal(handId, patch)
}

async function updateHandWithCloudSync(handId, patch, syncLabel) {
  return updateHandInternal(handId, patch, {
    waitForCloud: true,
    syncLabel: syncLabel || 'sync update hand failed'
  })
}

async function deleteHand(handId) {
  requireCloudWriteAvailable()
  const mutationPayload = { playerId: getCurrentPlayerId(), handId }
  const response = await runAuthoritativeMutation('delete_hand', handId, mutationPayload, async clientMutationId => {
    const result = await cloudDataApi.deleteHand(Object.assign({}, mutationPayload, { clientMutationId }))
    await runPostDeleteSocialCleanup({
      accountId: mutationPayload.playerId,
      action: 'delete_hand',
      targetId: handId,
      payload: mutationPayload,
      clientMutationId
    }, result)
    return result
  })
  if (response && response.rejected) {
    throw new Error(response.reason || 'delete hand rejected')
  }
  if (response && response.deleted) {
    removeLocalBusinessDocs({ handId })
    if (response.session) mergeRemoteBusinessPatch({ sessions: [response.session] })
    scheduleSocialStatsSyncAfterCloudWrite()
    return true
  }
  return false
}

async function deleteSession(sessionId) {
  requireCloudWriteAvailable()
  const mutationPayload = { playerId: getCurrentPlayerId(), sessionId }
  const response = await runAuthoritativeMutation('delete_session', sessionId, mutationPayload, async clientMutationId => {
    const result = await cloudDataApi.deleteSession(Object.assign({}, mutationPayload, { clientMutationId }))
    await runPostDeleteSocialCleanup({
      accountId: mutationPayload.playerId,
      action: 'delete_session',
      targetId: sessionId,
      payload: mutationPayload,
      clientMutationId
    }, result)
    return result
  })
  if (response && response.rejected) {
    throw new Error(response.reason || 'delete session rejected')
  }
  if (response && response.deleted) {
    removeLocalBusinessDocs({ sessionId, handIds: response.handIds || [] })
    scheduleSocialStatsSyncAfterCloudWrite()
    return true
  }
  return false
}

async function getPendingAiReminders() {
  return getLocalAdapter().getPendingAiReminders()
}

async function getAiRemindersBySessionId(sessionId) {
  return getLocalAdapter().getAiRemindersBySessionId(sessionId)
}

async function markAiReminderShown(reminderId) {
  const result = await getLocalAdapter().markAiReminderShown(reminderId)
  scheduleBusinessDataSync('sync ai reminder shown failed')
  return result
}

async function markAiReminderSubscribeResult(reminderId, result) {
  const updated = await getLocalAdapter().markAiReminderSubscribeResult(reminderId, result)
  scheduleBusinessDataSync('sync ai reminder subscribe status failed')
  return updated
}

module.exports = {
  getDashboardData,
  loginWechatAccount,
  bootstrapCloudSync,
  getSessionListData,
  getSessionDetailData,
  getReviewData,
  getStatsData,
  getCachedStatsData,
  getProfileStatsSnapshot,
  clearStatsDataCache,
  refreshOnboardingGuideContext,
  prefetchStatsData,
  refreshStatsData,
  getRecentHands,
  getProfilePageData,
  createSession,
  updateSession,
  finishSession,
  createHand,
  updateHand,
  updateHandWithCloudSync,
  deleteHand,
  deleteSession,
  getReviewHands,
  getPlayerNotes,
  getPlayerNoteById,
  getPlayerCardImportReceipt,
  beginPlayerCardImportReceipt,
  completePlayerCardImportReceipt,
  getFriendPlayerNote,
  getPlayerNoteBattleHands,
  createPlayerNote,
  ensureFriendPlayerNote,
  detachFriendPlayerNote,
  updatePlayerNote,
  deletePlayerNote,
  previewPbtPlayerNotesCsv,
  importPbtPlayerNotesFromCsv,
  previewPbtBankrollSessionsCsv,
  importPbtBankrollSessionsFromCsv,
  addPlayerNoteBattleHand,
  removePlayerNoteBattleHand,
  getPendingAiReminders,
  getAiRemindersBySessionId,
  markAiReminderShown,
  markAiReminderSubscribeResult,
  getSessionById,
  getHandById,
  getActionsByHandId,
  getAppSettings,
  getCurrentPlayerId,
  captureAccountContext,
  isAccountContextCurrent,
  getCurrentProfile,
  isAccountLoggedOut,
  isTestAccountActive,
  switchToTestAccount,
  exitTestAccount,
  updateProfile,
  logoutAccount,
  updateSettings,
  requestAiReminderSubscribePermission,
  syncBusinessDataNow,
  exportBackup,
  importBackup,
  clearAllData,
  __test: {
    shouldAwaitCloudBootstrap,
    isTimeoutError,
    localBackupHasBusinessData,
    mergeSettingsByUpdatedAt,
    loginWechatAccount,
    requestAiReminderSubscribePermission,
    dispatchAiReminderSubscribeMessages,
    scheduleBusinessDataSync,
    syncBusinessDataNow,
    canonicalizeMutationPayload,
    mutationOutboxDescriptor,
    loadCloudMutationOutbox,
    runAuthoritativeMutation,
    drainCloudMutationOutbox,
    reconcileCloudMutationResult,
    deriveWithdrawMutationId,
    runPostDeleteSocialCleanup,
    hasRealBusinessData,
    getSessionSummaryReadiness
  }
}
