const STORAGE_KEY = 'pokerLiveMiniappStore'
const LEGACY_PROFILE_ID = '8X2K9M'
const INITIAL_DATA_VERSION = 2
const reviewTags = require('./review-tags')
const sessionRules = require('./session-rules')
let cachedStore = null

function createProfileId() {
  const time = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).slice(2, 8).toUpperCase()
  return 'PLR-' + time.slice(-4) + '-' + random
}

const DEFAULT_PROFILE = {
  name: '玩家',
  playerId: '',
  title: '怪盗团新兵',
  avatarText: 'PL',
  avatarUrl: '',
  updatedAt: 0
}

const DEFAULT_SETTINGS = {
  chipUnit: 'HKD',
  venues: ['MGM', '威尼斯人', 'Home Game'],
  blindPresets: ['100/200', '200/400', '300/600', '500/1000'],
  lastBlindPreset: '200/400',
  positions: ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB', 'STR'],
  opponentTypes: ['紧弱', '松弱', '激进', '跟注站'],
  voiceTerms: [],
  updatedAt: 0
}

function now() {
  return Date.now()
}

function parseDateTimeValue(value) {
  const text = String(value || '').trim()
  if (!text) return null
  const normalized = text.replace(' ', 'T')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function calculateDurationMinutes(startTime, endTime) {
  const start = parseDateTimeValue(startTime)
  const end = parseDateTimeValue(endTime)
  if (!start || !end) return 0
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
}

function createId(prefix) {
  return prefix + '_' + now() + '_' + Math.floor(Math.random() * 10000)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeReviewStatus(value) {
  const status = String(value || '').trim()
  return ['idle', 'extracted', 'reviewed'].indexOf(status) > -1 ? status : 'idle'
}

function normalizeStringList(list, fallback) {
  const next = Array.isArray(list)
    ? list.map(item => String(item || '').trim()).filter(Boolean)
    : []
  return next.length ? next : fallback.slice()
}

function normalizeSettings(input) {
  const settings = Object.assign({}, DEFAULT_SETTINGS, input || {})
  settings.chipUnit = ['BB', 'CNY', 'HKD', 'USD'].indexOf(settings.chipUnit) > -1 ? settings.chipUnit : DEFAULT_SETTINGS.chipUnit
  settings.venues = normalizeStringList(settings.venues, DEFAULT_SETTINGS.venues)
  settings.blindPresets = normalizeStringList(settings.blindPresets, DEFAULT_SETTINGS.blindPresets)
  settings.lastBlindPreset = String(settings.lastBlindPreset || '').trim()
  if (!settings.lastBlindPreset || settings.blindPresets.indexOf(settings.lastBlindPreset) === -1) {
    settings.lastBlindPreset = settings.blindPresets[0] || DEFAULT_SETTINGS.lastBlindPreset
  }
  settings.positions = normalizeStringList(settings.positions, DEFAULT_SETTINGS.positions)
  settings.opponentTypes = normalizeStringList(settings.opponentTypes, DEFAULT_SETTINGS.opponentTypes)
  settings.voiceTerms = Array.isArray(settings.voiceTerms)
    ? settings.voiceTerms
      .map(item => ({
        from: String(item && item.from || '').trim(),
        to: String(item && item.to || '').trim(),
        type: String(item && item.type || 'custom').trim() || 'custom',
        updatedAt: Number(item && item.updatedAt) || 0
      }))
      .filter(item => item.from && item.to)
    : []
  return settings
}

function normalizeProfile(input) {
  const profile = Object.assign({}, DEFAULT_PROFILE, input || {})
  profile.name = String(profile.name || DEFAULT_PROFILE.name).trim() || DEFAULT_PROFILE.name
  profile.playerId = String(profile.playerId || '').trim().toUpperCase()
  if (!profile.playerId || profile.playerId === LEGACY_PROFILE_ID) {
    profile.playerId = createProfileId()
  }
  profile.title = String(profile.title || DEFAULT_PROFILE.title).trim() || DEFAULT_PROFILE.title
  profile.avatarText = String(profile.avatarText || profile.name.slice(0, 2) || DEFAULT_PROFILE.avatarText).trim().slice(0, 2) || DEFAULT_PROFILE.avatarText
  profile.avatarUrl = String(profile.avatarUrl || '').trim()
  return profile
}

function getSessionTotalProfit(status, buyIn, cashOut) {
  if (status !== 'finished') return 0
  return (Number(cashOut) || 0) - (Number(buyIn) || 0)
}

function isLegacyDemoSession(session) {
  return String(session && session.title || '') === '永利 5/10 晚场' &&
    String(session && session.venue || '') === '永利' &&
    Number(session && session.smallBlind) === 5 &&
    Number(session && session.bigBlind) === 10 &&
    String(session && session.notes || '') === '样例牌局，可直接体验流程。'
}

function isLegacyDemoHand(hand, legacySessionIds) {
  return legacySessionIds.indexOf(String(hand && hand.sessionId || '')) > -1 &&
    String(hand && hand.heroCardsInput || '') === 'AhKd' &&
    String(hand && hand.notes || '') === '翻牌持续下注，对手跟注到河牌。'
}

function migrateInitialData(data) {
  const next = data || {}
  const version = Number(next.initialDataVersion) || 1
  if (version >= INITIAL_DATA_VERSION) {
    next.initialDataVersion = INITIAL_DATA_VERSION
    return next
  }

  const legacySessionIds = (Array.isArray(next.sessions) ? next.sessions : [])
    .filter(isLegacyDemoSession)
    .map(item => String(item._id || ''))
    .filter(Boolean)
  const legacyHandIds = (Array.isArray(next.hands) ? next.hands : [])
    .filter(item => isLegacyDemoHand(item, legacySessionIds))
    .map(item => String(item._id || ''))
    .filter(Boolean)

  next.sessions = (Array.isArray(next.sessions) ? next.sessions : [])
    .filter(item => legacySessionIds.indexOf(String(item._id || '')) === -1)
  next.hands = (Array.isArray(next.hands) ? next.hands : [])
    .filter(item => legacyHandIds.indexOf(String(item._id || '')) === -1)
  next.handActions = (Array.isArray(next.handActions) ? next.handActions : [])
    .filter(item => legacyHandIds.indexOf(String(item.handId || '')) === -1)
  next.bankrollLogs = (Array.isArray(next.bankrollLogs) ? next.bankrollLogs : [])
    .filter(item => legacySessionIds.indexOf(String(item.sessionId || '')) === -1)
  next.initialDataVersion = INITIAL_DATA_VERSION
  return next
}

function ensureStoreShape(input) {
  const data = migrateInitialData(input || {})
  return {
    initialDataVersion: INITIAL_DATA_VERSION,
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    hands: Array.isArray(data.hands) ? data.hands : [],
    handActions: Array.isArray(data.handActions) ? data.handActions : [],
    bankrollLogs: Array.isArray(data.bankrollLogs) ? data.bankrollLogs : [],
    profile: normalizeProfile(data.profile),
    settings: normalizeSettings(data.settings)
  }
}

function buildInitialStoreData() {
  return ensureStoreShape({
    initialDataVersion: INITIAL_DATA_VERSION,
    sessions: [],
    hands: [],
    handActions: [],
    bankrollLogs: []
  })
}

function shouldPersistNormalizedStore(raw, next) {
  if (!raw) return true
  if ((Number(raw.initialDataVersion) || 1) !== INITIAL_DATA_VERSION) return true
  if (!raw.profile || !raw.profile.playerId || raw.profile.playerId === LEGACY_PROFILE_ID) return true
  if (!raw.settings || !Array.isArray(raw.settings.voiceTerms)) return true
  return false
}

function readStore() {
  if (cachedStore) return cachedStore

  const raw = wx.getStorageSync(STORAGE_KEY)
  if (raw) {
    const next = ensureStoreShape(raw)
    cachedStore = next
    if (shouldPersistNormalizedStore(raw, next)) {
      wx.setStorageSync(STORAGE_KEY, next)
    }
    return cachedStore
  }
  const seed = buildInitialStoreData()
  cachedStore = seed
  wx.setStorageSync(STORAGE_KEY, seed)
  return cachedStore
}

function writeStore(data) {
  const next = ensureStoreShape(data)
  cachedStore = next
  wx.setStorageSync(STORAGE_KEY, next)
  return cachedStore
}

function initStore() {
  readStore()
}

function resetCachedStoreForTest() {
  cachedStore = null
}

function parseBlindPreset(value) {
  const text = String(value || '').trim()
  const match = text.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (!match) {
    return { smallBlind: 0, bigBlind: 0 }
  }
  return {
    smallBlind: Number(match[1]) || 0,
    bigBlind: Number(match[2]) || 0
  }
}

function getProfile() {
  return readStore().profile
}

function updateProfile(patch) {
  const data = readStore()
  data.profile = normalizeProfile(Object.assign({}, data.profile, patch || {}, { updatedAt: now() }))
  writeStore(data)
  return data.profile
}

function getSettings() {
  return readStore().settings
}

function getDefaultSettings() {
  return clone(DEFAULT_SETTINGS)
}

function updateSettings(patch) {
  const data = readStore()
  data.settings = normalizeSettings(Object.assign({}, data.settings, patch || {}, { updatedAt: now() }))
  writeStore(data)
  return data.settings
}

function getSessions() {
  return readStore().sessions.slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

function getActiveSession() {
  return getSessions().find(item => item.status === 'active') || null
}

function getSessionById(id) {
  return getSessions().find(item => item._id === id) || null
}

function createSession(payload) {
  const data = readStore()
  sessionRules.assertCanCreateSession(data.sessions)
  const buyIn = Number(payload.buyIn) || 0
  const cashOut = Number(payload.cashOut) || 0
  const status = 'active'
  const session = {
    _id: createId('session'),
    title: payload.venue + ' ' + payload.smallBlind + '/' + payload.bigBlind,
    date: payload.date || String(payload.startTime || '').split(' ')[0] || '',
    startTime: payload.startTime || '',
    endTime: payload.endTime || '',
    venue: payload.venue,
    smallBlind: Number(payload.smallBlind) || 0,
    bigBlind: Number(payload.bigBlind) || 0,
    tableSize: Number(payload.tableSize) || 8,
    buyIn: buyIn,
    cashOut: cashOut,
    endingChips: status === 'finished' && cashOut ? cashOut : null,
    totalProfit: getSessionTotalProfit(status, buyIn, cashOut),
    durationMinutes: calculateDurationMinutes(payload.startTime, payload.endTime),
    timerPausedAt: payload.timerPausedAt || '',
    handCount: 0,
    status: status,
    notes: payload.notes || '',
    createdAt: now(),
    updatedAt: now()
  }
  data.sessions.unshift(session)
  writeStore(data)
  return session
}

function updateSession(sessionId, patch) {
  const data = readStore()
  data.sessions = data.sessions.map(item => {
    if (item._id !== sessionId) return item
    const next = Object.assign({}, item, patch)
    const buyIn = Number(next.buyIn) || 0
    const cashOut = Number(next.cashOut) || 0
    const status = next.status || 'active'
    return Object.assign({}, next, {
      updatedAt: now(),
      title: (next.venue || item.venue) + ' ' + (next.smallBlind || item.smallBlind) + '/' + (next.bigBlind || item.bigBlind),
      date: next.date || String(next.startTime || '').split(' ')[0] || item.date || '',
      cashOut: cashOut,
      endingChips: status === 'finished' && cashOut ? cashOut : null,
      totalProfit: getSessionTotalProfit(status, buyIn, cashOut),
      durationMinutes: calculateDurationMinutes(next.startTime, next.endTime)
    })
  })
  writeStore(data)
  return getSessionById(sessionId)
}

function finishSession(sessionId, payload) {
  const session = getSessionById(sessionId)
  if (!session) return null
  const patch = typeof payload === 'object' && payload !== null
    ? payload
    : { cashOut: payload }
  const cashOut = Number(patch.cashOut != null ? patch.cashOut : session.cashOut) || 0
  const endTime = String(patch.endTime || session.endTime || '').trim()
  const profit = cashOut - (Number(session.buyIn) || 0)
  const updated = updateSession(sessionId, {
    cashOut: cashOut,
    endTime: endTime,
    timerPausedAt: '',
    totalProfit: profit,
    status: 'finished'
  })
  const data = readStore()
  data.bankrollLogs.unshift({
    _id: createId('bankroll'),
    sessionId,
    type: 'session_settlement',
    amount: profit,
    balanceAfter: getStatsSummary().bankrollCurrent,
    note: (updated ? updated.title : 'Session') + ' 结算',
    createdAt: now()
  })
  writeStore(data)
  return updated
}

function getHandsBySessionId(sessionId) {
  return readStore().hands
    .filter(item => item.sessionId === sessionId)
    .sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0))
}

function getRecentHands(limit) {
  return readStore().hands
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit || 5)
}

function getHandById(handId) {
  return readStore().hands.find(item => item._id === handId) || null
}

function getActionsByHandId(handId) {
  return readStore().handActions
    .filter(item => item.handId === handId)
    .sort((a, b) => a.sequence - b.sequence)
}

function getHandDateMs(hand) {
  const dateText = String((hand && hand.playedDate) || '').trim()
  if (dateText) {
    const parsed = new Date(dateText + 'T00:00:00')
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime()
  }
  return Number((hand && (hand.createdAt || hand.updatedAt)) || 0)
}

function getEndOfDateMs(value) {
  const text = String(value || '').trim()
  if (!text) return 0
  const parsed = new Date(text + 'T23:59:59.999')
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime()
}

function getStartOfDateMs(value) {
  const text = String(value || '').trim()
  if (!text) return 0
  const parsed = new Date(text + 'T00:00:00')
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime()
}

function getBigBlindFromStakeLevel(value) {
  const match = String(value || '').trim().match(/^(\d+)\s*\/\s*(\d+)$/)
  return match ? Number(match[2]) || 0 : 0
}

function parseResultBbText(value) {
  const match = String(value || '').match(/[+-]?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) || 0 : 0
}

function getHandResultBb(hand) {
  const bigBlind = getBigBlindFromStakeLevel(hand && hand.stakeLevel)
  const profit = Number(hand && hand.currentProfit)
  if (bigBlind && !Number.isNaN(profit)) {
    return profit / bigBlind
  }
  return parseResultBbText(hand && hand.resultBB)
}

function getRelativeDateStartMs(range, nowMs) {
  const nowDate = new Date(nowMs || now())
  nowDate.setHours(0, 0, 0, 0)
  const days = range === 'last1d' ? 1 : range === 'last7d' ? 7 : range === 'last30d' ? 30 : 0
  if (!days) return 0
  return nowDate.getTime() - ((days - 1) * 24 * 60 * 60 * 1000)
}

function filterReviewHands(hands, filters, nowMs) {
  const config = filters || {}
  let list = (Array.isArray(hands) ? hands : []).slice()

  if (config.sessionId) {
    list = list.filter(item => item.sessionId === config.sessionId)
  }

  if (config.dateRange === 'custom') {
    const startMs = getStartOfDateMs(config.startDate)
    const endMs = getEndOfDateMs(config.endDate)
    list = list.filter(item => {
      const dateMs = getHandDateMs(item)
      return (!startMs || dateMs >= startMs) && (!endMs || dateMs <= endMs)
    })
  } else {
    const startMs = getRelativeDateStartMs(config.dateRange, nowMs)
    if (startMs) {
      list = list.filter(item => getHandDateMs(item) >= startMs)
    }
  }

  const resultFilter = String(config.resultFilter || 'all')
  if (resultFilter !== 'all') {
    const threshold = resultFilter.indexOf('100') > -1 ? 100 : 50
    const wantsWin = resultFilter.indexOf('win') === 0
    const wantsLose = resultFilter.indexOf('lose') === 0
    list = list.filter(item => {
      const bb = getHandResultBb(item)
      if (wantsWin) return bb >= threshold
      if (wantsLose) return bb <= -threshold
      return true
    })
  }

  const tagFilter = String(config.tagFilter || 'all')
  if (tagFilter !== 'all') {
    list = list.filter(item => reviewTags.matchesTagFilter(item.tags, tagFilter))
  }

  const sortBy = String(config.sortBy || 'updatedDesc')
  const sorters = {
    updatedAsc: (a, b) => (Number(a.updatedAt) || 0) - (Number(b.updatedAt) || 0),
    updatedDesc: (a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0),
    dateAsc: (a, b) => getHandDateMs(a) - getHandDateMs(b),
    dateDesc: (a, b) => getHandDateMs(b) - getHandDateMs(a),
    profitAsc: (a, b) => (Number(a.currentProfit) || 0) - (Number(b.currentProfit) || 0),
    profitDesc: (a, b) => (Number(b.currentProfit) || 0) - (Number(a.currentProfit) || 0),
    resultBbAsc: (a, b) => getHandResultBb(a) - getHandResultBb(b),
    resultBbDesc: (a, b) => getHandResultBb(b) - getHandResultBb(a),
    potAsc: (a, b) => (Number(a.potSize) || 0) - (Number(b.potSize) || 0),
    potDesc: (a, b) => (Number(b.potSize) || 0) - (Number(a.potSize) || 0)
  }
  return list.sort(sorters[sortBy] || sorters.updatedDesc)
}

function createHand(payload) {
  const data = readStore()
  const hand = {
    _id: createId('hand'),
    sessionId: payload.sessionId,
    playedDate: payload.playedDate || '',
    stakeLevel: payload.stakeLevel || '',
    heroSeat: Number(payload.heroSeat) || 0,
    heroPosition: payload.heroPosition || '',
    villainPosition: payload.villainPosition || '',
    villainType: payload.villainType || payload.opponentType || '',
    hasStraddle: !!payload.hasStraddle,
    buttonSeat: Number(payload.buttonSeat) || 0,
    heroCardsInput: payload.heroCardsInput || '',
    effectiveStack: Number(payload.effectiveStack) || 0,
    potSize: Number(payload.potSize) || 0,
    currentProfit: Number(payload.currentProfit) || 0,
    resultBB: payload.resultBB || '',
    opponentType: payload.opponentType || '',
    opponentName: payload.opponentName || '',
    board: {
      flop: payload.flop || '',
      turn: payload.turn || '',
      river: payload.river || ''
    },
    showdown: payload.showdown || '',
    streetInputs: payload.streetInputs || {},
    ev: payload.ev || '',
    tags: reviewTags.normalizeReviewTags(payload.tags),
    notes: payload.notes || '',
    mindJourney: payload.mindJourney || payload.notes || '',
    streetSummary: payload.streetSummary || '',
    heroQuestion: payload.heroQuestion || '',
    detailBackfilled: !!payload.detailBackfilled,
    voiceNote: '',
    voiceExtract: null,
    aiReview: null,
    reviewStatus: 'idle',
    createdAt: now(),
    updatedAt: now()
  }
  data.hands.unshift(hand)
  ;(payload.actions || []).forEach((action, index) => {
    data.handActions.push({
      _id: createId('action'),
      handId: hand._id,
      street: action.street,
      actorSeat: Number(action.actorSeat) || 0,
      actorLabel: action.actorLabel || '',
      actionType: action.actionType || '',
      amount: Number(action.amount) || 0,
      potAfter: Number(action.potAfter) || 0,
      sequence: index + 1
    })
  })
  data.sessions = data.sessions.map(item => {
    if (item._id !== payload.sessionId) return item
    return Object.assign({}, item, {
      handCount: (item.handCount || 0) + 1,
      updatedAt: now()
    })
  })
  writeStore(data)
  return hand
}

function updateHand(handId, patch) {
  const data = readStore()
  data.hands = data.hands.map(item => {
    if (item._id !== handId) return item
    const board = Object.assign({}, item.board, patch.board || {})
    const next = Object.assign({}, item, patch, {
      board,
      updatedAt: now()
    })
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'tags')) {
      next.tags = reviewTags.normalizeReviewTags(patch.tags)
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'reviewStatus')) {
      next.reviewStatus = normalizeReviewStatus(patch.reviewStatus)
    }
    return next
  })
  if (patch.actions) {
    data.handActions = data.handActions.filter(item => item.handId !== handId)
    patch.actions.forEach((action, index) => {
      data.handActions.push({
        _id: createId('action'),
        handId,
        street: action.street,
        actorSeat: Number(action.actorSeat) || 0,
        actorLabel: action.actorLabel || '',
        actionType: action.actionType || '',
        amount: Number(action.amount) || 0,
        potAfter: Number(action.potAfter) || 0,
        sequence: index + 1
      })
    })
  }
  writeStore(data)
  return getHandById(handId)
}

function deleteHand(handId) {
  const data = readStore()
  const hand = data.hands.find(item => item._id === handId)
  if (!hand) return false

  data.hands = data.hands.filter(item => item._id !== handId)
  data.handActions = data.handActions.filter(item => item.handId !== handId)
  data.sessions = data.sessions.map(item => {
    if (item._id !== hand.sessionId) return item
    return Object.assign({}, item, {
      handCount: Math.max(0, (item.handCount || 0) - 1),
      updatedAt: now()
    })
  })
  writeStore(data)
  return true
}

function deleteSession(sessionId) {
  const data = readStore()
  const session = data.sessions.find(item => item._id === sessionId)
  if (!session) return false
  const handIds = new Set(
    data.hands
      .filter(item => item.sessionId === sessionId)
      .map(item => item._id)
  )
  data.handActions = data.handActions.filter(item => !handIds.has(item.handId))
  data.hands = data.hands.filter(item => item.sessionId !== sessionId)
  data.bankrollLogs = data.bankrollLogs.filter(item => item.sessionId !== sessionId)
  data.sessions = data.sessions.filter(item => item._id !== sessionId)
  writeStore(data)
  return true
}

function getReviewHands(filters) {
  return filterReviewHands(readStore().hands, filters || {}, now())
}

function getStatsSummary() {
  const data = readStore()
  const sessionCount = data.sessions.length
  const totalProfit = data.sessions.reduce((sum, item) => {
    return sum + getSessionTotalProfit(item.status, item.buyIn, item.cashOut)
  }, 0)
  const totalMinutes = data.sessions.reduce((sum, item) => sum + (Number(item.durationMinutes) || 0), 0)
  const bankrollCurrent = 12000 + totalProfit
  return {
    sessionCount,
    handCount: data.hands.length,
    totalProfit,
    bankrollCurrent,
    totalHours: (totalMinutes / 60).toFixed(1),
    hourlyRate: totalMinutes ? (totalProfit / (totalMinutes / 60)).toFixed(1) : '0.0'
  }
}

function exportBackup() {
  return clone(readStore())
}

function importBackup(payload) {
  const next = ensureStoreShape(payload)
  writeStore(next)
  return next
}

function clearAllData() {
  const seed = buildInitialStoreData()
  writeStore(seed)
  return seed
}

module.exports = {
  initStore,
  parseBlindPreset,
  getProfile,
  updateProfile,
  getSettings,
  getDefaultSettings,
  updateSettings,
  getSessions,
  getActiveSession,
  getSessionById,
  createSession,
  updateSession,
  finishSession,
  getHandsBySessionId,
  getRecentHands,
  getHandById,
  getActionsByHandId,
  createHand,
  updateHand,
  deleteHand,
  deleteSession,
  getReviewHands,
  getStatsSummary,
  exportBackup,
  importBackup,
  clearAllData,
  __test: {
    buildInitialStoreData,
    ensureStoreShape,
    normalizeProfile,
    normalizeSettings,
    filterReviewHands,
    resetCachedStoreForTest
  }
}
