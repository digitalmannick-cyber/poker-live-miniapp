const STORAGE_KEY = 'pokerLiveMiniappStore'
const LEGACY_PROFILE_ID = '8X2K9M'

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
  chipUnit: 'BB',
  venues: ['永利', '威尼斯人', 'Home Game'],
  blindPresets: ['5/10', '10/20', '25/50'],
  lastBlindPreset: '5/10',
  positions: ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  opponentTypes: ['紧弱', '松弱', '激进', '跟注站'],
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

function normalizeStringList(list, fallback) {
  const next = Array.isArray(list)
    ? list.map(item => String(item || '').trim()).filter(Boolean)
    : []
  return next.length ? next : fallback.slice()
}

function normalizeSettings(input) {
  const settings = Object.assign({}, DEFAULT_SETTINGS, input || {})
  settings.chipUnit = ['BB', 'CNY', 'HKD', 'USD'].includes(settings.chipUnit) ? settings.chipUnit : DEFAULT_SETTINGS.chipUnit
  settings.venues = normalizeStringList(settings.venues, DEFAULT_SETTINGS.venues)
  settings.blindPresets = normalizeStringList(settings.blindPresets, DEFAULT_SETTINGS.blindPresets)
  settings.lastBlindPreset = String(settings.lastBlindPreset || '').trim()
  if (!settings.lastBlindPreset || settings.blindPresets.indexOf(settings.lastBlindPreset) === -1) {
    settings.lastBlindPreset = settings.blindPresets[0] || DEFAULT_SETTINGS.lastBlindPreset
  }
  settings.positions = normalizeStringList(settings.positions, DEFAULT_SETTINGS.positions)
  settings.opponentTypes = normalizeStringList(settings.opponentTypes, DEFAULT_SETTINGS.opponentTypes)
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

function ensureStoreShape(input) {
  const data = input || {}
  return {
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    hands: Array.isArray(data.hands) ? data.hands : [],
    handActions: Array.isArray(data.handActions) ? data.handActions : [],
    bankrollLogs: Array.isArray(data.bankrollLogs) ? data.bankrollLogs : [],
    profile: normalizeProfile(data.profile),
    settings: normalizeSettings(data.settings)
  }
}

function buildSeedData() {
  const sessionId = createId('session')
  const handId = createId('hand')
  return ensureStoreShape({
    sessions: [
      {
        _id: sessionId,
        title: '永利 5/10 晚场',
        date: '2026-04-13',
        startTime: '2026-04-13 19:30',
        endTime: '',
        venue: '永利',
        smallBlind: 5,
        bigBlind: 10,
        tableSize: 8,
        buyIn: 3000,
        cashOut: 3320,
        endingChips: 3320,
        totalProfit: 320,
        durationMinutes: 0,
        handCount: 1,
        status: 'active',
        notes: '样例牌局，可直接体验流程。',
        createdAt: now(),
        updatedAt: now()
      }
    ],
    hands: [
      {
        _id: handId,
        sessionId,
        heroSeat: 4,
        heroPosition: 'CO',
        buttonSeat: 2,
        heroCardsInput: 'AhKd',
        effectiveStack: 1800,
        potSize: 560,
        currentProfit: 320,
        opponentType: '激进',
        board: {
          flop: 'Ts7d2c',
          turn: 'Ad',
          river: '5h'
        },
        showdown: '对手 AQ，Hero AK',
        ev: '',
        tags: ['3bet_pot', 'top_pair'],
        notes: '翻牌持续下注，对手跟注到河牌。',
        streetSummary: '翻前 open 30, BB call；翻牌 bet 80, call；转牌 bet 160',
        voiceNote: '',
        createdAt: now(),
        updatedAt: now()
      }
    ],
    handActions: [
      {
        _id: createId('action'),
        handId,
        street: 'preflop',
        actorSeat: 4,
        actorLabel: 'Hero CO',
        actionType: 'raise',
        amount: 30,
        potAfter: 45,
        sequence: 1
      },
      {
        _id: createId('action'),
        handId,
        street: 'preflop',
        actorSeat: 9,
        actorLabel: 'BB',
        actionType: 'call',
        amount: 30,
        potAfter: 65,
        sequence: 2
      }
    ],
    bankrollLogs: [
      {
        _id: createId('bankroll'),
        sessionId,
        type: 'session_settlement',
        amount: 320,
        balanceAfter: 12320,
        note: '样例结算',
        createdAt: now()
      }
    ]
  })
}

function readStore() {
  const raw = wx.getStorageSync(STORAGE_KEY)
  if (raw) {
    const next = ensureStoreShape(raw)
    if (JSON.stringify(raw) !== JSON.stringify(next)) {
      wx.setStorageSync(STORAGE_KEY, next)
    }
    return next
  }
  const seed = buildSeedData()
  wx.setStorageSync(STORAGE_KEY, seed)
  return seed
}

function writeStore(data) {
  const next = ensureStoreShape(data)
  wx.setStorageSync(STORAGE_KEY, next)
  return next
}

function initStore() {
  readStore()
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
  const buyIn = Number(payload.buyIn) || 0
  const cashOut = Number(payload.cashOut) || 0
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
    endingChips: cashOut || null,
    totalProfit: cashOut - buyIn,
    durationMinutes: calculateDurationMinutes(payload.startTime, payload.endTime),
    handCount: 0,
    status: 'active',
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
    return Object.assign({}, next, {
      updatedAt: now(),
      title: (next.venue || item.venue) + ' ' + (next.smallBlind || item.smallBlind) + '/' + (next.bigBlind || item.bigBlind),
      date: next.date || String(next.startTime || '').split(' ')[0] || item.date || '',
      cashOut: cashOut,
      endingChips: cashOut || null,
      totalProfit: cashOut - buyIn,
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
    tags: payload.tags || [],
    notes: payload.notes || '',
    mindJourney: payload.mindJourney || payload.notes || '',
    streetSummary: payload.streetSummary || '',
    heroQuestion: payload.heroQuestion || '',
    detailBackfilled: !!payload.detailBackfilled,
    voiceNote: '',
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
    return Object.assign({}, item, patch, {
      board,
      updatedAt: now()
    })
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

function getReviewHands(filters) {
  let list = readStore().hands.slice().sort((a, b) => b.updatedAt - a.updatedAt)
  if (filters && filters.sessionId) {
    list = list.filter(item => item.sessionId === filters.sessionId)
  }
  return list
}

function getStatsSummary() {
  const data = readStore()
  const sessionCount = data.sessions.length
  const totalProfit = data.sessions.reduce((sum, item) => sum + (Number(item.totalProfit) || 0), 0)
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
  const seed = buildSeedData()
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
  getReviewHands,
  getStatsSummary,
  exportBackup,
  importBackup,
  clearAllData
}
