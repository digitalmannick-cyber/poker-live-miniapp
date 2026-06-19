const cloudUtils = require('../utils/cloud')
const store = require('../utils/store')

const COLLECTIONS = {
  sessions: 'sessions',
  hands: 'hands',
  handActions: 'hand_actions',
  bankrollLogs: 'bankroll_logs',
  profiles: 'profiles',
  userSettings: 'user_settings'
}

const PAGE_SIZE = 100

function now() {
  return Date.now()
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizePlayerId(value) {
  return String(value || '').trim().toUpperCase()
}

function getCurrentPlayerId() {
  return normalizePlayerId(store.getProfile().playerId)
}

function requireCurrentPlayerId() {
  const playerId = getCurrentPlayerId()
  if (!playerId) {
    throw new Error('missing current playerId')
  }
  return playerId
}

function withPlayerScope(doc, playerId) {
  return Object.assign({}, doc || {}, {
    playerId: normalizePlayerId(playerId)
  })
}

function isOwnedByCurrentPlayer(doc, playerId) {
  return normalizePlayerId(doc && doc.playerId) === normalizePlayerId(playerId)
}

function parseDateTimeValue(value) {
  const text = String(value || '').trim()
  if (!text) return null
  const normalized = text.replace(' ', 'T')
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function calculateDurationMinutes(startTime, endTime) {
  const start = parseDateTimeValue(startTime)
  const end = parseDateTimeValue(endTime)
  if (!start || !end) return 0
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
}

function stripUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(stripUndefined)
  }
  if (value && typeof value === 'object') {
    const next = {}
    Object.keys(value).forEach(key => {
      const item = stripUndefined(value[key])
      if (item !== undefined) {
        next[key] = item
      }
    })
    return next
  }
  return value === undefined ? undefined : value
}

function omitId(doc) {
  const next = Object.assign({}, doc || {})
  delete next._id
  return stripUndefined(next)
}

function getProfileDocId(playerId) {
  return 'profile_' + String(playerId || '').replace(/[^0-9A-Za-z_-]/g, '_')
}

function getSettingsDocId(playerId) {
  return 'settings_' + String(playerId || '').replace(/[^0-9A-Za-z_-]/g, '_')
}

function getDbOrThrow() {
  const db = cloudUtils.getDb()
  if (!db) {
    throw new Error('cloud database unavailable')
  }
  return db
}

async function getDocById(collectionName, docId) {
  const db = getDbOrThrow()
  try {
    const result = await db.collection(collectionName).doc(docId).get()
    return result.data || null
  } catch (error) {
    return null
  }
}

async function setDocById(collectionName, docId, data) {
  const db = getDbOrThrow()
  await db.collection(collectionName).doc(docId).set({
    data: omitId(data)
  })
}

async function fetchAll(buildQuery) {
  let offset = 0
  const list = []
  while (true) {
    const result = await buildQuery(offset).get()
    const batch = result.data || []
    list.push.apply(list, batch)
    if (batch.length < PAGE_SIZE) {
      break
    }
    offset += batch.length
  }
  return list
}

function formatSession(doc) {
  const session = Object.assign(
    {
      title: '',
      date: '',
      startTime: '',
      endTime: '',
      venue: '',
      smallBlind: 0,
      bigBlind: 0,
      tableSize: 8,
      buyIn: 0,
      cashOut: 0,
      endingChips: null,
      totalProfit: 0,
      durationMinutes: 0,
      timerPausedAt: '',
      handCount: 0,
      status: 'active',
      notes: '',
      createdAt: 0,
      updatedAt: 0
    },
    doc
  )
  if (session.status !== 'finished') {
    session.totalProfit = 0
    session.endingChips = null
  }
  return session
}

function formatHand(doc) {
  return Object.assign(
    {
      playedDate: '',
      stakeLevel: '',
      heroSeat: 0,
      heroPosition: '',
      villainPosition: '',
      villainType: '',
      hasStraddle: false,
      buttonSeat: 0,
      heroCardsInput: '',
      effectiveStack: 0,
      potSize: 0,
      currentProfit: 0,
      resultBB: '',
      opponentType: '',
      opponentName: '',
      board: { flop: '', turn: '', river: '' },
      showdown: '',
      streetInputs: {},
      ev: '',
      tags: [],
      notes: '',
      mindJourney: '',
      streetSummary: '',
      heroQuestion: '',
      detailBackfilled: false,
      voiceNote: '',
      voiceExtract: null,
      aiReview: null,
      reviewStatus: 'idle',
      createdAt: 0,
      updatedAt: 0
    },
    doc
  )
}

function buildSessionDoc(base, patch) {
  const merged = Object.assign({}, base || {}, patch || {})
  const smallBlind = Number(merged.smallBlind) || 0
  const bigBlind = Number(merged.bigBlind) || 0
  const buyIn = Number(merged.buyIn) || 0
  const cashOut = Number(merged.cashOut) || 0
  const status = merged.status || 'active'
  const title = ((merged.venue || '') + ' ' + smallBlind + '/' + bigBlind).trim()
  return stripUndefined({
    title,
    date: merged.date || String(merged.startTime || '').split(' ')[0] || '',
    startTime: merged.startTime || '',
    endTime: merged.endTime || '',
    venue: merged.venue || '',
    smallBlind,
    bigBlind,
    tableSize: Number(merged.tableSize) || 8,
    buyIn,
    cashOut,
    endingChips: status === 'finished' && cashOut ? cashOut : null,
    totalProfit: status === 'finished' ? (cashOut - buyIn) : 0,
    durationMinutes: calculateDurationMinutes(merged.startTime, merged.endTime),
    timerPausedAt: merged.timerPausedAt || '',
    handCount: Number(merged.handCount) || 0,
    status: status,
    notes: merged.notes || '',
    createdAt: merged.createdAt || now(),
    updatedAt: now()
  })
}

function buildHandDoc(base, patch) {
  const merged = Object.assign({}, base || {}, patch || {})
  return stripUndefined({
    sessionId: merged.sessionId,
    playedDate: merged.playedDate || '',
    stakeLevel: merged.stakeLevel || '',
    heroSeat: Number(merged.heroSeat) || 0,
    heroPosition: merged.heroPosition || '',
    villainPosition: merged.villainPosition || '',
    villainType: merged.villainType || merged.opponentType || '',
    hasStraddle: !!merged.hasStraddle,
    buttonSeat: Number(merged.buttonSeat) || 0,
    heroCardsInput: merged.heroCardsInput || '',
    effectiveStack: Number(merged.effectiveStack) || 0,
    potSize: Number(merged.potSize) || 0,
    currentProfit: Number(merged.currentProfit) || 0,
    resultBB: merged.resultBB || '',
    opponentType: merged.opponentType || '',
    opponentName: merged.opponentName || '',
    board: Object.assign({ flop: '', turn: '', river: '' }, merged.board || {}, {
      flop: merged.flop != null ? merged.flop : undefined,
      turn: merged.turn != null ? merged.turn : undefined,
      river: merged.river != null ? merged.river : undefined
    }),
    showdown: merged.showdown || '',
    streetInputs: Object.assign({}, base && base.streetInputs ? base.streetInputs : {}, patch && patch.streetInputs ? patch.streetInputs : {}),
    ev: merged.ev || '',
    tags: Array.isArray(merged.tags) ? merged.tags : [],
    notes: merged.notes || '',
    mindJourney: merged.mindJourney || merged.notes || '',
    streetSummary: merged.streetSummary || '',
    heroQuestion: merged.heroQuestion || '',
    detailBackfilled: !!merged.detailBackfilled,
    voiceNote: merged.voiceNote || '',
    voiceExtract: merged.voiceExtract || null,
    aiReview: merged.aiReview || null,
    reviewStatus: ['idle', 'extracted', 'reviewed'].indexOf(merged.reviewStatus) > -1 ? merged.reviewStatus : 'idle',
    createdAt: merged.createdAt || now(),
    updatedAt: now()
  })
}

function buildProfileDoc(profile) {
  const source = Object.assign({}, profile || {})
  return stripUndefined({
    playerId: String(source.playerId || '').trim().toUpperCase(),
    name: source.name || '玩家',
    title: source.title || '',
    avatarText: source.avatarText || '',
    avatarUrl: source.avatarUrl || '',
    updatedAt: Number(source.updatedAt) || now()
  })
}

function buildSettingsOverrideDoc(playerId, settings) {
  const defaults = store.getDefaultSettings()
  const merged = Object.assign({}, defaults, settings || {})
  const doc = {
    playerId: String(playerId || '').trim().toUpperCase(),
    updatedAt: Number(merged.updatedAt) || now()
  }

  if (merged.chipUnit !== defaults.chipUnit) {
    doc.chipUnit = merged.chipUnit
  }
  if (JSON.stringify(merged.venues || []) !== JSON.stringify(defaults.venues || [])) {
    doc.venues = clone(merged.venues || [])
  }
  if (JSON.stringify(merged.blindPresets || []) !== JSON.stringify(defaults.blindPresets || [])) {
    doc.blindPresets = clone(merged.blindPresets || [])
  }
  if (merged.lastBlindPreset !== defaults.lastBlindPreset) {
    doc.lastBlindPreset = merged.lastBlindPreset
  }
  if (JSON.stringify(merged.positions || []) !== JSON.stringify(defaults.positions || [])) {
    doc.positions = clone(merged.positions || [])
  }
  if (JSON.stringify(merged.opponentTypes || []) !== JSON.stringify(defaults.opponentTypes || [])) {
    doc.opponentTypes = clone(merged.opponentTypes || [])
  }

  return stripUndefined(doc)
}

function mergeSettingsDoc(doc) {
  const defaults = store.getDefaultSettings()
  const merged = Object.assign({}, defaults, doc || {})
  delete merged._id
  delete merged.playerId
  return merged
}

async function collectionHasAny(collectionName, playerIdOverride) {
  const db = getDbOrThrow()
  const playerId = normalizePlayerId(playerIdOverride) || requireCurrentPlayerId()
  try {
    const result = await db.collection(collectionName).where({ playerId }).limit(1).get()
    return !!((result.data || []).length)
  } catch (error) {
    return false
  }
}

async function upsertMany(collectionName, list, playerIdOverride) {
  const db = getDbOrThrow()
  const playerId = normalizePlayerId(playerIdOverride) || requireCurrentPlayerId()
  const items = Array.isArray(list) ? list : []
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!item || !item._id) continue
    await db.collection(collectionName).doc(item._id).set({
      data: omitId(withPlayerScope(item, playerId))
    })
  }
}

async function listCollectionDocs(collectionName, playerIdOverride) {
  const playerId = normalizePlayerId(playerIdOverride) || requireCurrentPlayerId()
  return fetchAll(offset =>
    getDbOrThrow().collection(collectionName).where({ playerId }).skip(offset).limit(PAGE_SIZE)
  )
}

async function clearCollection(collectionName, playerIdOverride) {
  const db = getDbOrThrow()
  const docs = await listCollectionDocs(collectionName, playerIdOverride)
  for (let index = 0; index < docs.length; index += 1) {
    await db.collection(collectionName).doc(docs[index]._id).remove()
  }
}

async function getProfile(playerId) {
  const doc = await getDocById(COLLECTIONS.profiles, getProfileDocId(playerId))
  if (!doc) return null
  return buildProfileDoc(doc)
}

async function saveProfile(profile) {
  const doc = buildProfileDoc(profile)
  if (!doc.playerId) {
    throw new Error('missing playerId')
  }
  await setDocById(COLLECTIONS.profiles, getProfileDocId(doc.playerId), doc)
  return getProfile(doc.playerId)
}

async function getSettings(playerId) {
  const doc = await getDocById(COLLECTIONS.userSettings, getSettingsDocId(playerId))
  if (!doc) return null
  return mergeSettingsDoc(doc)
}

async function saveSettings(playerId, settings) {
  const normalizedPlayerId = String(playerId || '').trim().toUpperCase()
  if (!normalizedPlayerId) {
    throw new Error('missing playerId')
  }
  const doc = buildSettingsOverrideDoc(normalizedPlayerId, settings)
  await setDocById(COLLECTIONS.userSettings, getSettingsDocId(normalizedPlayerId), doc)
  return getSettings(normalizedPlayerId)
}

async function seedBusinessData(backup) {
  const data = backup || {}
  const playerId = normalizePlayerId(data.profile && data.profile.playerId) || requireCurrentPlayerId()
  const hasCloudData = await Promise.all([
    collectionHasAny(COLLECTIONS.sessions, playerId),
    collectionHasAny(COLLECTIONS.hands, playerId),
    collectionHasAny(COLLECTIONS.handActions, playerId),
    collectionHasAny(COLLECTIONS.bankrollLogs, playerId)
  ])

  if (hasCloudData.some(Boolean)) {
    return false
  }

  await upsertMany(COLLECTIONS.sessions, data.sessions, playerId)
  await upsertMany(COLLECTIONS.hands, data.hands, playerId)
  await upsertMany(COLLECTIONS.handActions, data.handActions, playerId)
  await upsertMany(COLLECTIONS.bankrollLogs, data.bankrollLogs, playerId)
  return true
}

async function replaceBusinessData(backup) {
  const data = backup || {}
  const playerId = normalizePlayerId(data.profile && data.profile.playerId) || requireCurrentPlayerId()
  await clearCollection(COLLECTIONS.handActions, playerId)
  await clearCollection(COLLECTIONS.hands, playerId)
  await clearCollection(COLLECTIONS.bankrollLogs, playerId)
  await clearCollection(COLLECTIONS.sessions, playerId)
  await upsertMany(COLLECTIONS.sessions, data.sessions, playerId)
  await upsertMany(COLLECTIONS.hands, data.hands, playerId)
  await upsertMany(COLLECTIONS.handActions, data.handActions, playerId)
  await upsertMany(COLLECTIONS.bankrollLogs, data.bankrollLogs, playerId)
  return true
}

async function clearAllData(playerId) {
  const targetPlayerId = normalizePlayerId(playerId) || requireCurrentPlayerId()
  await clearCollection(COLLECTIONS.handActions, targetPlayerId)
  await clearCollection(COLLECTIONS.hands, targetPlayerId)
  await clearCollection(COLLECTIONS.bankrollLogs, targetPlayerId)
  await clearCollection(COLLECTIONS.sessions, targetPlayerId)

  if (targetPlayerId) {
    const db = getDbOrThrow()
    try {
      await db.collection(COLLECTIONS.profiles).doc(getProfileDocId(targetPlayerId)).remove()
    } catch (error) {}
    try {
      await db.collection(COLLECTIONS.userSettings).doc(getSettingsDocId(targetPlayerId)).remove()
    } catch (error) {}
  }

  return true
}

async function getSessions() {
  const db = getDbOrThrow()
  const playerId = requireCurrentPlayerId()
  const list = await fetchAll(offset =>
    db.collection(COLLECTIONS.sessions).where({ playerId }).orderBy('updatedAt', 'desc').skip(offset).limit(PAGE_SIZE)
  )
  return list.map(formatSession)
}

async function getSessionById(sessionId) {
  const db = getDbOrThrow()
  const playerId = requireCurrentPlayerId()
  try {
    const result = await db.collection(COLLECTIONS.sessions).doc(sessionId).get()
    return result.data && isOwnedByCurrentPlayer(result.data, playerId) ? formatSession(result.data) : null
  } catch (error) {
    return null
  }
}

async function getHandsBySessionId(sessionId) {
  const db = getDbOrThrow()
  const playerId = requireCurrentPlayerId()
  const list = await fetchAll(offset =>
    db.collection(COLLECTIONS.hands).where({ playerId, sessionId }).orderBy('updatedAt', 'desc').skip(offset).limit(PAGE_SIZE)
  )
  return list.map(formatHand)
}

async function getRecentHands(limit) {
  const db = getDbOrThrow()
  const playerId = requireCurrentPlayerId()
  const result = await db.collection(COLLECTIONS.hands).where({ playerId }).orderBy('updatedAt', 'desc').limit(limit || 5).get()
  return (result.data || []).map(formatHand)
}

async function getHandById(handId) {
  const db = getDbOrThrow()
  const playerId = requireCurrentPlayerId()
  try {
    const result = await db.collection(COLLECTIONS.hands).doc(handId).get()
    return result.data && isOwnedByCurrentPlayer(result.data, playerId) ? formatHand(result.data) : null
  } catch (error) {
    return null
  }
}

async function getActionsByHandId(handId) {
  const db = getDbOrThrow()
  const playerId = requireCurrentPlayerId()
  const list = await fetchAll(offset =>
    db.collection(COLLECTIONS.handActions).where({ playerId, handId }).orderBy('sequence', 'asc').skip(offset).limit(PAGE_SIZE)
  )
  return list
}

async function createSession(payload) {
  const db = getDbOrThrow()
  const playerId = requireCurrentPlayerId()
  const doc = withPlayerScope(buildSessionDoc(null, Object.assign({}, payload, { createdAt: now() })), playerId)
  const result = await db.collection(COLLECTIONS.sessions).add({ data: doc })
  return Object.assign({ _id: result._id }, doc)
}

async function updateSession(sessionId, patch) {
  const db = getDbOrThrow()
  const current = await getSessionById(sessionId)
  if (!current) return null
  const data = withPlayerScope(buildSessionDoc(current, patch), current.playerId)
  await db.collection(COLLECTIONS.sessions).doc(sessionId).update({ data })
  return getSessionById(sessionId)
}

async function finishSession(sessionId, payload) {
  const session = await getSessionById(sessionId)
  if (!session) return null
  const patch = typeof payload === 'object' && payload !== null ? payload : { cashOut: payload }
  const updated = await updateSession(sessionId, {
    cashOut: patch.cashOut != null ? patch.cashOut : session.cashOut,
    endTime: patch.endTime || session.endTime || '',
    status: 'finished'
  })
  const stats = await getStatsSummary()
  const db = getDbOrThrow()
  const playerId = requireCurrentPlayerId()
  await db.collection(COLLECTIONS.bankrollLogs).add({
    data: withPlayerScope({
      sessionId,
      type: 'session_settlement',
      amount: Number(updated.totalProfit) || 0,
      balanceAfter: stats.bankrollCurrent,
      note: (updated ? updated.title : 'Session') + ' 结算',
      createdAt: now(),
      updatedAt: now()
    }, playerId)
  })
  return updated
}

async function replaceActions(handId, sessionId, actions) {
  const db = getDbOrThrow()
  const playerId = requireCurrentPlayerId()
  const existing = await getActionsByHandId(handId)
  const removals = existing.map(item => db.collection(COLLECTIONS.handActions).doc(item._id).remove())
  if (removals.length) {
    await Promise.all(removals)
  }
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index]
    await db.collection(COLLECTIONS.handActions).add({
      data: withPlayerScope({
        handId,
        sessionId,
        street: action.street,
        actorSeat: Number(action.actorSeat) || 0,
        actorLabel: action.actorLabel || '',
        actionType: action.actionType || '',
        amount: Number(action.amount) || 0,
        potAfter: Number(action.potAfter) || 0,
        sequence: index + 1,
        createdAt: now(),
        updatedAt: now()
      }, playerId)
    })
  }
}

async function createHand(payload) {
  const db = getDbOrThrow()
  const playerId = requireCurrentPlayerId()
  const handDoc = withPlayerScope(buildHandDoc(null, Object.assign({}, payload, { createdAt: now() })), playerId)
  const handResult = await db.collection(COLLECTIONS.hands).add({ data: handDoc })
  const handId = handResult._id
  await replaceActions(handId, payload.sessionId, payload.actions || [])

  const session = await getSessionById(payload.sessionId)
  if (session) {
    await updateSession(payload.sessionId, {
      handCount: (session.handCount || 0) + 1
    })
  }

  return Object.assign({ _id: handId }, handDoc)
}

async function updateHand(handId, patch) {
  const db = getDbOrThrow()
  const current = await getHandById(handId)
  if (!current) return null
  const data = withPlayerScope(buildHandDoc(current, patch), current.playerId)
  delete data.sessionId
  await db.collection(COLLECTIONS.hands).doc(handId).update({ data })

  if (patch.actions) {
    await replaceActions(handId, current.sessionId, patch.actions)
  }

  return getHandById(handId)
}

async function deleteHand(handId) {
  const db = getDbOrThrow()
  const hand = await getHandById(handId)
  if (!hand) return false

  const existing = await getActionsByHandId(handId)
  const removals = existing.map(item => db.collection(COLLECTIONS.handActions).doc(item._id).remove())
  if (removals.length) {
    await Promise.all(removals)
  }
  await db.collection(COLLECTIONS.hands).doc(handId).remove()

  const session = await getSessionById(hand.sessionId)
  if (session) {
    await updateSession(hand.sessionId, {
      handCount: Math.max(0, (session.handCount || 0) - 1)
    })
  }

  return true
}

async function deleteSession(sessionId) {
  const session = await getSessionById(sessionId)
  if (!session) return false
  const db = getDbOrThrow()
  const playerId = requireCurrentPlayerId()
  const hands = await getHandsBySessionId(sessionId)

  for (let index = 0; index < hands.length; index += 1) {
    const hand = hands[index]
    const actions = await getActionsByHandId(hand._id)
    if (actions.length) {
      await Promise.all(actions.map(item => db.collection(COLLECTIONS.handActions).doc(item._id).remove()))
    }
    await db.collection(COLLECTIONS.hands).doc(hand._id).remove()
  }

  const bankrollLogs = await fetchAll(offset =>
    db.collection(COLLECTIONS.bankrollLogs).where({ playerId, sessionId }).skip(offset).limit(PAGE_SIZE)
  )
  if (bankrollLogs.length) {
    await Promise.all(bankrollLogs.map(item => db.collection(COLLECTIONS.bankrollLogs).doc(item._id).remove()))
  }
  await db.collection(COLLECTIONS.sessions).doc(sessionId).remove()
  return true
}

async function getReviewHands(filters) {
  const db = getDbOrThrow()
  const playerId = requireCurrentPlayerId()
  if (filters && filters.sessionId) {
    const list = await fetchAll(offset =>
      db.collection(COLLECTIONS.hands).where({ playerId, sessionId: filters.sessionId }).orderBy('updatedAt', 'desc').skip(offset).limit(PAGE_SIZE)
    )
    return list.map(formatHand)
  }
  const list = await fetchAll(offset =>
    db.collection(COLLECTIONS.hands).where({ playerId }).orderBy('updatedAt', 'desc').skip(offset).limit(PAGE_SIZE)
  )
  return list.map(formatHand)
}

async function getStatsSummary() {
  const sessions = await getSessions()
  const hands = await getReviewHands()
  const sessionCount = sessions.length
  const totalProfit = sessions.reduce((sum, item) => sum + (Number(item.totalProfit) || 0), 0)
  const totalMinutes = sessions.reduce((sum, item) => sum + (Number(item.durationMinutes) || 0), 0)
  const bankrollCurrent = 12000 + totalProfit
  return {
    sessionCount,
    handCount: hands.length,
    totalProfit,
    bankrollCurrent,
    totalHours: (totalMinutes / 60).toFixed(1),
    hourlyRate: totalMinutes ? (totalProfit / (totalMinutes / 60)).toFixed(1) : '0.0'
  }
}

module.exports = {
  getProfile,
  saveProfile,
  getSettings,
  saveSettings,
  seedBusinessData,
  replaceBusinessData,
  clearAllData,
  getSessions,
  getSessionById,
  getHandsBySessionId,
  getRecentHands,
  getHandById,
  getActionsByHandId,
  createSession,
  updateSession,
  finishSession,
  createHand,
  updateHand,
  deleteHand,
  deleteSession,
  getReviewHands,
  getStatsSummary,
  __test: {
    buildHandDoc,
    normalizePlayerId,
    withPlayerScope,
    isOwnedByCurrentPlayer
  }
}
