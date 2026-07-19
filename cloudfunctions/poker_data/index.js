const cloud = require('wx-server-sdk')
const agentExport = require('./agent-export')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const AI_REMINDER_SUBSCRIBE_TEMPLATE_ID = String(process.env.AI_REMINDER_SUBSCRIBE_TEMPLATE_ID || '').trim()
const AGENT_EXPORT_TOKEN = String(process.env.AGENT_EXPORT_TOKEN || '').trim()
const AGENT_EXPORT_OWNER_OPENID = String(process.env.AGENT_EXPORT_OWNER_OPENID || '').trim()
const PAGE_SIZE = 100
const ensuredCollections = {}
const COLLECTIONS = {
  sessions: 'sessions',
  hands: 'hands',
  handActions: 'hand_actions',
  playerNotes: 'player_notes',
  bankrollLogs: 'bankroll_logs',
  profiles: 'profiles',
  userSettings: 'user_settings',
  syncOperations: 'sync_operations',
  auditLogs: 'audit_logs'
}

function normalizePlayerId(value) {
  return String(value || '').trim().toUpperCase()
}

function createOpenIdPlayerId(ownerOpenId) {
  const text = String(ownerOpenId || '')
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return 'WX-' + (hash >>> 0).toString(36).toUpperCase().padStart(7, '0')
}

function now() {
  return Date.now()
}

function parseDateTimeValue(value) {
  const text = String(value || '').trim()
  if (!text) return null
  const date = new Date(text.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

function calculateDurationMinutes(startTime, endTime) {
  const start = parseDateTimeValue(startTime)
  const end = parseDateTimeValue(endTime)
  if (!start || !end) return 0
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
}

function getSessionDurationBackfill(session) {
  const item = session || {}
  if (item.status !== 'finished') return null
  if (isHistoryImportSession(item)) return null
  const current = Number(item.durationMinutes) || 0
  if (current > 0) return null
  const durationMinutes = calculateDurationMinutes(item.startTime, item.endTime)
  if (durationMinutes <= 0) return null
  return {
    sessionId: item._id || '',
    title: item.title || '',
    startTime: item.startTime || '',
    endTime: item.endTime || '',
    beforeDurationMinutes: current,
    durationMinutes,
    addedMinutes: durationMinutes - current
  }
}

function normalizeAllInStreet(value) {
  const text = String(value || '').trim().toLowerCase()
  if (/^(pre|preflop|pre-flop|pf)$/.test(text)) return 'preflop'
  if (/^(flop|turn|river)$/.test(text)) return text
  return text
}

function isPreRiverAllIn(source) {
  const hand = source || {}
  const status = String(hand.allInEvStatus || '').trim().toLowerCase()
  if (status === 'all_in_not_terminal' || status === 'hero_not_all_in' || status === 'not_all_in') return false
  const street = normalizeAllInStreet(hand.allInStreet || hand.allInRound || hand.allInStage || hand.allInEvStreet)
  if (street === 'river') return false
  return !!hand.isAllIn || !!hand.allInEvEligible || !!street
}

function createId(prefix) {
  return prefix + '_' + now() + '_' + Math.floor(Math.random() * 10000)
}

function stripUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(stripUndefined)
  }
  if (value && typeof value === 'object') {
    const next = {}
    Object.keys(value).forEach(key => {
      const item = stripUndefined(value[key])
      if (item !== undefined) next[key] = item
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

function withOwnerScope(doc, playerId, ownerOpenId) {
  return Object.assign({}, doc || {}, {
    playerId,
    ownerOpenId
  })
}

function getProfileDocId(playerId, ownerOpenId) {
  return 'profile_' + ownerOpenId + '_' + playerId.replace(/[^0-9A-Za-z_-]/g, '_')
}

function getSettingsDocId(playerId, ownerOpenId) {
  return 'settings_' + ownerOpenId + '_' + playerId.replace(/[^0-9A-Za-z_-]/g, '_')
}

function isMissingCollectionError(error) {
  const message = String(error && (error.errMsg || error.message || error) || '').toLowerCase()
  const code = String(error && (error.errCode || error.code || '') || '')
  return code === '-502005' ||
    message.indexOf('collection not exists') > -1 ||
    message.indexOf('resourcenotfound') > -1
}

async function ensureCollection(collectionName) {
  if (ensuredCollections[collectionName]) return true
  if (typeof db.createCollection !== 'function') return false
  try {
    await db.createCollection(collectionName)
  } catch (error) {
    if (!isMissingCollectionError(error) && !/already exists|collection exists/i.test(String(error && (error.errMsg || error.message || error) || ''))) {
      throw error
    }
  }
  ensuredCollections[collectionName] = true
  return true
}

async function setDocById(collectionName, docId, data) {
  try {
    await db.collection(collectionName).doc(docId).set({
      data: omitId(data)
    })
  } catch (error) {
    if (!isMissingCollectionError(error) || !(await ensureCollection(collectionName))) {
      throw error
    }
    await db.collection(collectionName).doc(docId).set({
      data: omitId(data)
    })
  }
}

async function addDoc(collectionName, data) {
  let result
  try {
    result = await db.collection(collectionName).add({
      data: stripUndefined(data)
    })
  } catch (error) {
    if (!isMissingCollectionError(error) || !(await ensureCollection(collectionName))) {
      throw error
    }
    result = await db.collection(collectionName).add({
      data: stripUndefined(data)
    })
  }
  return Object.assign({ _id: result._id }, data)
}

async function getDocById(collectionName, docId) {
  try {
    const result = await db.collection(collectionName).doc(docId).get()
    return result.data || null
  } catch (error) {
    return null
  }
}

async function removeDocById(collectionName, docId) {
  try {
    await db.collection(collectionName).doc(docId).remove()
    return true
  } catch (error) {
    return false
  }
}

async function upsertMany(collectionName, list, playerId, ownerOpenId) {
  const items = Array.isArray(list) ? list : []
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!item || !item._id) continue
    const existing = await getDocById(collectionName, item._id)
    const merged = mergeUpsertDoc(existing, item)
    await setDocById(collectionName, item._id, withOwnerScope(merged, playerId, ownerOpenId))
  }
}

function mergeUpsertDoc(existing, incoming) {
  if (!existing) return incoming
  const existingUpdatedAt = normalizeNumeric(existing.updatedAt || existing.createdAt)
  const incomingUpdatedAt = normalizeNumeric(incoming && (incoming.updatedAt || incoming.createdAt))
  if (incomingUpdatedAt && incomingUpdatedAt >= existingUpdatedAt) {
    return Object.assign({}, existing, incoming)
  }
  return Object.assign({}, incoming || {}, existing)
}

async function removeMissingOwnedDocs(collectionName, list, playerId, ownerOpenId) {
  const items = Array.isArray(list) ? list : []
  const keepIds = new Set(items.filter(item => item && item._id).map(item => item._id))
  const existing = await fetchOwnedByPlayer(collectionName, playerId, ownerOpenId)
  for (let index = 0; index < existing.length; index += 1) {
    const item = existing[index]
    if (!item || !item._id || keepIds.has(item._id)) continue
    await db.collection(collectionName).doc(item._id).remove()
  }
}

async function syncMany(collectionName, list, playerId, ownerOpenId, authoritative) {
  if (authoritative) {
    await removeMissingOwnedDocs(collectionName, list, playerId, ownerOpenId)
  }
  await upsertMany(collectionName, list, playerId, ownerOpenId)
}

async function fetchAll(collectionName, playerId, ownerOpenId) {
  let offset = 0
  const list = []
  while (true) {
    const result = await db.collection(collectionName)
      .where({ playerId, ownerOpenId })
      .orderBy('updatedAt', 'desc')
      .skip(offset)
      .limit(PAGE_SIZE)
      .get()
    const batch = result.data || []
    list.push.apply(list, batch)
    if (batch.length < PAGE_SIZE) break
    offset += batch.length
  }
  return list
}

async function fetchWhere(collectionName, filters) {
  let offset = 0
  const list = []
  while (true) {
    const result = await db.collection(collectionName)
      .where(filters || {})
      .skip(offset)
      .limit(PAGE_SIZE)
      .get()
    const batch = result.data || []
    list.push.apply(list, batch)
    if (batch.length < PAGE_SIZE) break
    offset += batch.length
  }
  return list
}

async function fetchPage(collectionName, filters, offset, limit) {
  const result = await db.collection(collectionName)
    .where(filters || {})
    .skip(Number(offset) || 0)
    .limit(Math.max(1, Math.min(Number(limit) || PAGE_SIZE, PAGE_SIZE)))
    .get()
  return result.data || []
}

async function countWhere(collectionName, filters) {
  const result = await db.collection(collectionName)
    .where(filters || {})
    .count()
  return Number(result.total) || 0
}

function mergeDocs(left, right) {
  const map = {}
  ;(Array.isArray(left) ? left : []).concat(Array.isArray(right) ? right : []).forEach(item => {
    if (!item) return
    const key = item._id || JSON.stringify(item)
    map[key] = item
  })
  return Object.keys(map).map(key => map[key])
}

async function fetchOwnedByPlayer(collectionName, playerId, ownerOpenId) {
  const normalizedPlayerId = normalizePlayerId(playerId)
  const ownerScoped = await fetchWhere(collectionName, { playerId: normalizedPlayerId, ownerOpenId })
  const legacyScoped = await fetchWhere(collectionName, { playerId: normalizedPlayerId, _openid: ownerOpenId })
  return mergeDocs(ownerScoped, legacyScoped)
}

function cleanCloudDoc(doc) {
  const next = Object.assign({}, doc || {})
  delete next.ownerOpenId
  delete next._openid
  return next
}

function newerDoc(left, right) {
  if (!left) return right
  if (!right) return left
  const leftUpdatedAt = normalizeNumeric(left.updatedAt || left.createdAt)
  const rightUpdatedAt = normalizeNumeric(right.updatedAt || right.createdAt)
  return rightUpdatedAt >= leftUpdatedAt ? right : left
}

function mergeBackupListById(left, right, playerId) {
  const map = {}
  ;(Array.isArray(left) ? left : []).concat(Array.isArray(right) ? right : []).forEach(item => {
    if (!item || !item._id) return
    const next = Object.assign({}, cleanCloudDoc(item), { playerId })
    map[item._id] = newerDoc(map[item._id], next)
  })
  return Object.keys(map).map(key => map[key])
}

function normalizeBackupForPlayer(backup, playerId) {
  const source = backup || {}
  return {
    profile: Object.assign({}, cleanCloudDoc(source.profile || {}), { playerId }),
    settings: cleanCloudDoc(source.settings || {}),
    sessions: mergeBackupListById([], source.sessions, playerId),
    hands: mergeBackupListById([], source.hands, playerId),
    handActions: mergeBackupListById([], source.handActions, playerId),
    playerNotes: mergeBackupListById([], source.playerNotes, playerId),
    bankrollLogs: mergeBackupListById([], source.bankrollLogs, playerId)
  }
}

function mergeBackupPayload(left, right, playerId) {
  const base = normalizeBackupForPlayer(left, playerId)
  const next = normalizeBackupForPlayer(right, playerId)
  return {
    profile: Object.assign({}, newerDoc(base.profile, next.profile), { playerId }),
    settings: newerDoc(base.settings, next.settings) || {},
    sessions: mergeBackupListById(base.sessions, next.sessions, playerId),
    hands: mergeBackupListById(base.hands, next.hands, playerId),
    handActions: mergeBackupListById(base.handActions, next.handActions, playerId),
    playerNotes: mergeBackupListById(base.playerNotes, next.playerNotes, playerId),
    bankrollLogs: mergeBackupListById(base.bankrollLogs, next.bankrollLogs, playerId)
  }
}

function normalizeNumeric(value) {
  if (value && typeof value === 'object') {
    if (value.$numberInt != null) return Number(value.$numberInt) || 0
    if (value.$numberLong != null) return Number(value.$numberLong) || 0
    if (value.$numberDouble != null) return Number(value.$numberDouble) || 0
  }
  return Number(value) || 0
}

function getClientMutationId(event) {
  return String(event && event.clientMutationId || '').trim()
}

function parseIncomingEvent(event) {
  if (!event || typeof event !== 'object') return {}
  const query = event.queryStringParameters && typeof event.queryStringParameters === 'object'
    ? event.queryStringParameters
    : {}
  if (event.body && typeof event.body === 'string') {
    try {
      return Object.assign({}, event, query, JSON.parse(event.body))
    } catch (error) {
      return Object.assign({}, event, query)
    }
  }
  return Object.assign({}, event, query)
}

function getAuthorizationToken(event) {
  const headers = event && (event.headers || event.header) || {}
  const authorization = String(headers.authorization || headers.Authorization || '').trim()
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)
  if (bearer) return bearer[1].trim()
  return String(event && (event.token || event.agentToken || event.queryStringParameters && event.queryStringParameters.token) || '').trim()
}

function resolveOwnerOpenId(event, identity) {
  const wxOpenId = String(identity && identity.OPENID || '').trim()
  if (wxOpenId) return { ownerOpenId: wxOpenId, externalAgent: false }
  const action = normalizeAction(event)
  if (action === 'agent_export') {
    const token = getAuthorizationToken(event)
    if (!AGENT_EXPORT_TOKEN || !AGENT_EXPORT_OWNER_OPENID) {
      return { error: { code: 'AGENT_EXPORT_NOT_CONFIGURED', message: 'missing AGENT_EXPORT_TOKEN or AGENT_EXPORT_OWNER_OPENID' } }
    }
    if (!token || token !== AGENT_EXPORT_TOKEN) {
      return { error: { code: 'AGENT_EXPORT_UNAUTHORIZED', message: 'invalid agent export token' } }
    }
    return { ownerOpenId: AGENT_EXPORT_OWNER_OPENID, externalAgent: true }
  }
  if (action === 'backfill_session_durations') {
    const token = getAuthorizationToken(event)
    const ownerOpenId = String(event && event.ownerOpenId || AGENT_EXPORT_OWNER_OPENID || '').trim()
    if (!AGENT_EXPORT_TOKEN || !ownerOpenId) {
      return { error: { code: 'BACKFILL_NOT_CONFIGURED', message: 'missing AGENT_EXPORT_TOKEN or ownerOpenId' } }
    }
    if (!token || token !== AGENT_EXPORT_TOKEN) {
      return { error: { code: 'BACKFILL_UNAUTHORIZED', message: 'invalid backfill token' } }
    }
    return { ownerOpenId, externalAgent: true }
  }
  return { error: { code: 'MISSING_OPENID', message: 'missing openid' } }
}

function normalizeAction(event) {
  const action = String(event && event.action || '').trim()
  if (action === 'agent_export' || action === 'agentExport' || action === 'export') {
    return 'agent_export'
  }
  if (!action && getAuthorizationToken(event) && (event.playerId || event.rangeKey || event.days || event.from || event.to)) {
    return 'agent_export'
  }
  return action
}

async function getSyncOperation(ownerOpenId, clientMutationId) {
  if (!clientMutationId) return null
  const docId = 'sync_' + ownerOpenId + '_' + clientMutationId.replace(/[^0-9A-Za-z_-]/g, '_')
  return getDocById(COLLECTIONS.syncOperations, docId)
}

async function saveSyncOperation(ownerOpenId, playerId, clientMutationId, action, result) {
  if (!clientMutationId) return
  const docId = 'sync_' + ownerOpenId + '_' + clientMutationId.replace(/[^0-9A-Za-z_-]/g, '_')
  await setDocById(COLLECTIONS.syncOperations, docId, {
    ownerOpenId,
    playerId,
    clientMutationId,
    action,
    result,
    createdAt: now(),
    updatedAt: now()
  })
}

async function writeAuditLog(ownerOpenId, playerId, action, targetId, before, after, clientMutationId) {
  await addDoc(COLLECTIONS.auditLogs, {
    ownerOpenId,
    playerId,
    action,
    targetId,
    before: before || null,
    after: after || null,
    clientMutationId: clientMutationId || '',
    createdAt: now()
  })
}

async function runMutation(event, ownerOpenId, action, handler) {
  const playerId = normalizePlayerId(event.playerId || event.profile && event.profile.playerId)
  if (!playerId) {
    return { code: 'MISSING_PLAYER_ID', message: 'missing playerId' }
  }
  const clientMutationId = getClientMutationId(event)
  const existing = await getSyncOperation(ownerOpenId, clientMutationId)
  if (existing && existing.result) {
    return { code: 0, data: existing.result }
  }
  const result = await handler(playerId, clientMutationId)
  await saveSyncOperation(ownerOpenId, playerId, clientMutationId, action, result)
  return { code: 0, data: result }
}

function buildSessionDoc(base, patch) {
  const merged = Object.assign({}, base || {}, patch || {})
  const smallBlind = Number(merged.smallBlind) || 0
  const bigBlind = Number(merged.bigBlind) || 0
  const buyIn = Number(merged.buyIn) || 0
  const cashOut = Number(merged.cashOut) || 0
  const status = merged.status || 'active'
  const startTime = merged.startTime || ''
  const endTime = merged.endTime || ''
  const explicitDuration = Number(merged.durationMinutes)
  const durationMinutes = Number.isFinite(explicitDuration) && explicitDuration > 0
    ? explicitDuration
    : calculateDurationMinutes(startTime, endTime)
  return stripUndefined(Object.assign({}, merged, {
    title: merged.title || (((merged.venue || '') + ' ' + smallBlind + '/' + bigBlind).trim()),
    date: merged.date || String(startTime).split(' ')[0] || '',
    startTime,
    endTime,
    venue: merged.venue || '',
    smallBlind,
    bigBlind,
    tableSize: Number(merged.tableSize) || 8,
    buyIn,
    cashOut,
    endingChips: status === 'finished' && cashOut ? cashOut : null,
    totalProfit: status === 'finished' ? (cashOut - buyIn) : (Number(merged.totalProfit) || 0),
    durationMinutes,
    timerPausedAt: merged.timerPausedAt || '',
    handCount: Number(merged.handCount) || 0,
    status,
    notes: merged.notes || '',
    timelineEvents: Array.isArray(merged.timelineEvents) ? merged.timelineEvents : [],
    createdAt: Number(merged.createdAt) || now(),
    updatedAt: now()
  }))
}

function normalizeReviewStatus(value) {
  const status = String(value || '').trim()
  return ['idle', 'extracted', 'reviewed'].indexOf(status) > -1 ? status : 'idle'
}

function buildHandDoc(base, patch) {
  const merged = Object.assign({}, base || {}, patch || {})
  const next = stripUndefined(Object.assign({}, merged, {
    sessionId: merged.sessionId || '',
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
    isAllIn: isPreRiverAllIn(merged),
    allInEv: merged.allInEv === '' || merged.allInEv == null ? '' : Number(merged.allInEv) || 0,
    resultBB: merged.resultBB || '',
    opponentType: merged.opponentType || '',
    opponentName: merged.opponentName || '',
    board: Object.assign({ flop: '', turn: '', river: '' }, merged.board || {}),
    opponentCards: merged.opponentCards || '',
    opponentCardsSource: merged.opponentCardsSource || '',
    showdown: merged.showdown || merged.opponentCards || '',
    showdownType: merged.showdownType || '',
    showdownReason: merged.showdownReason || '',
    streetInputs: merged.streetInputs || {},
    ev: merged.ev || '',
    tags: Array.isArray(merged.tags) ? merged.tags : [],
    notes: merged.notes || '',
    mindJourney: merged.mindJourney || merged.notes || '',
    streetSummary: merged.streetSummary || '',
    heroQuestion: merged.heroQuestion || '',
    detailBackfilled: !!merged.detailBackfilled,
    inputMode: merged.inputMode || '',
    reviewSource: merged.reviewSource || '',
    ledgerState: merged.ledgerState || null,
    playerSnapshots: Array.isArray(merged.playerSnapshots) ? merged.playerSnapshots : [],
    voiceNote: merged.voiceNote || '',
    voiceExtract: merged.voiceExtract || null,
    aiReview: merged.aiReview || null,
    aiReviewStatus: merged.aiReviewStatus || '',
    aiReviewGeneratedAt: merged.aiReviewGeneratedAt || '',
    aiReviewError: merged.aiReviewError || '',
    reviewStatus: normalizeReviewStatus(merged.reviewStatus),
    createdAt: Number(merged.createdAt) || now(),
    updatedAt: now()
  }))
  delete next.actions
  return next
}

function applySessionHandDefaults(payload, session) {
  if (!session || !session.hasStraddle) return payload
  return Object.assign({}, payload || {}, { hasStraddle: true })
}

async function fetchSessionHands(playerId, ownerOpenId, sessionId) {
  return fetchWhere(COLLECTIONS.hands, { playerId, ownerOpenId, sessionId })
}

async function refreshSessionRecordedStatsCloud(playerId, ownerOpenId, sessionId) {
  if (!sessionId) return null
  const session = await getDocById(COLLECTIONS.sessions, sessionId)
  const sessionOwnerOpenId = String(session && (session.ownerOpenId || session._openid) || '').trim()
  if (!session || sessionOwnerOpenId !== ownerOpenId) return null
  const hands = await fetchSessionHands(playerId, ownerOpenId, sessionId)
  if (!hands.length && normalizePlayerId(session.playerId) !== playerId) return null
  const currentProfit = hands.reduce((sum, item) => sum + (Number(item.currentProfit) || 0), 0)
  const next = withOwnerScope(Object.assign({}, session, {
    handCount: hands.length,
    currentProfit,
    updatedAt: now()
  }), playerId, ownerOpenId)
  delete next._openid
  if (session.status !== 'finished') {
    next.cashOut = (Number(session.buyIn) || 0) + currentProfit
    next.endingChips = next.cashOut
    next.totalProfit = currentProfit
  }
  await setDocById(COLLECTIONS.sessions, sessionId, next)
  return cleanCloudDoc(next)
}

function inferPlayerIdFromProfile(doc) {
  const direct = normalizePlayerId(doc && doc.playerId)
  if (direct) return direct
  const id = String(doc && doc._id || '')
  const match = id.match(/(PLR-[0-9A-Z]+-[0-9A-Z]+)/i)
  return match ? normalizePlayerId(match[1]) : ''
}

async function saveProfile(profile, playerId, ownerOpenId) {
  if (!profile) return
  await setDocById(COLLECTIONS.profiles, getProfileDocId(playerId, ownerOpenId), withOwnerScope(Object.assign({
    updatedAt: now()
  }, profile), playerId, ownerOpenId))
}

async function saveSettings(settings, playerId, ownerOpenId) {
  if (!settings) return
  await setDocById(COLLECTIONS.userSettings, getSettingsDocId(playerId, ownerOpenId), withOwnerScope(Object.assign({
    updatedAt: now()
  }, settings), playerId, ownerOpenId))
}

async function getSettings(playerId, ownerOpenId, fallback) {
  try {
    const result = await db.collection(COLLECTIONS.userSettings)
      .doc(getSettingsDocId(playerId, ownerOpenId))
      .get()
    const data = result.data || null
    if (!data) return fallback || {}
    const next = Object.assign({}, data)
    delete next._id
    delete next.playerId
    delete next.ownerOpenId
    return next
  } catch (error) {
    return fallback || {}
  }
}

async function mergeBusinessData(backup, playerId, ownerOpenId) {
  const data = backup || {}
  await saveProfile(data.profile, playerId, ownerOpenId)
  await saveSettings(data.settings, playerId, ownerOpenId)
  await syncMany(COLLECTIONS.sessions, data.sessions, playerId, ownerOpenId, false)
  await syncMany(COLLECTIONS.hands, data.hands, playerId, ownerOpenId, false)
  await syncMany(COLLECTIONS.handActions, data.handActions, playerId, ownerOpenId, false)
  await syncMany(COLLECTIONS.playerNotes, data.playerNotes, playerId, ownerOpenId, false)
  await syncMany(COLLECTIONS.bankrollLogs, data.bankrollLogs, playerId, ownerOpenId, false)
}

function hasMeaningfulBackup(backup) {
  const data = backup || {}
  if (data.profile && Object.keys(data.profile).length) return true
  if (data.settings && Object.keys(data.settings).length) return true
  return ['sessions', 'hands', 'handActions', 'playerNotes', 'bankrollLogs'].some(key => Array.isArray(data[key]) && data[key].length > 0)
}

function getSessionTotalProfit(session) {
  if (!session || session.status !== 'finished') return 0
  if (session.totalProfit != null) return Number(session.totalProfit) || 0
  return (Number(session.cashOut) || 0) - (Number(session.buyIn) || 0)
}

function isHistoryImportHand(hand) {
  const source = hand && hand.source || hand && hand.voiceExtract && hand.voiceExtract.source
  return source === 'feishu_base_history_import'
}

function isHistoryImportSession(session) {
  const source = session && session.source
  return source && source.type === 'feishu_base_history_import'
}

function historyImportMinutes(sessions, hands) {
  const historyHands = (Array.isArray(hands) ? hands : []).filter(isHistoryImportHand)
  if (!historyHands.length) return 0
  const historySessions = (Array.isArray(sessions) ? sessions : []).filter(isHistoryImportSession)
  const existingMinutes = historySessions.reduce((sum, item) => sum + (Number(item.durationMinutes) || 0), 0)
  return existingMinutes > 0 ? 0 : 360 * 60
}

function buildStatsSummary(sessions, hands, settings) {
  const totalProfit = sessions.reduce((sum, item) => sum + getSessionTotalProfit(item), 0)
  const totalMinutes = sessions.reduce((sum, item) => sum + (Number(item.durationMinutes) || 0), 0) + historyImportMinutes(sessions, hands)
  const bankrollValue = settings && settings.bankrollInitial
  const parsedBankrollInitial = Number(bankrollValue)
  const bankrollInitial = bankrollValue !== '' && bankrollValue != null && Number.isFinite(parsedBankrollInitial)
    ? parsedBankrollInitial
    : 12000
  return {
    sessionCount: sessions.length,
    handCount: hands.length,
    totalProfit,
    bankrollCurrent: bankrollInitial + totalProfit,
    totalHours: (totalMinutes / 60).toFixed(1),
    hourlyRate: totalMinutes ? (totalProfit / (totalMinutes / 60)).toFixed(1) : '0.0'
  }
}

function compactStatsSession(session) {
  const item = session || {}
  return stripUndefined({
    _id: item._id,
    playerId: item.playerId,
    status: item.status,
    title: item.title,
    venue: item.venue,
    date: item.date,
    startTime: item.startTime,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    source: item.source,
    buyIn: item.buyIn,
    cashOut: item.cashOut,
    totalProfit: item.totalProfit,
    durationMinutes: item.durationMinutes,
    handCount: item.handCount,
    smallBlind: item.smallBlind,
    bigBlind: item.bigBlind,
    blindPreset: item.blindPreset
  })
}

function compactStatsHand(hand) {
  const item = hand || {}
  const voiceExtract = item.voiceExtract || {}
  return stripUndefined({
    _id: item._id,
    playerId: item.playerId,
    sessionId: item.sessionId,
    playedDate: item.playedDate,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    source: item.source,
    voiceExtract: {
      source: voiceExtract.source,
      opponentCards: voiceExtract.opponentCards,
      showdown: voiceExtract.showdown,
      streetSummary: voiceExtract.streetSummary
    },
    currentProfit: item.currentProfit,
    potSize: item.potSize,
    stakeLevel: item.stakeLevel,
    heroPosition: item.heroPosition,
    villainPosition: item.villainPosition,
    opponentType: item.opponentType,
    villainType: item.villainType,
    hasStraddle: item.hasStraddle,
    tags: item.tags,
    detailBackfilled: item.detailBackfilled,
    reviewStatus: item.reviewStatus,
    aiReview: item.aiReview ? true : null,
    cumulativeHours: item.cumulativeHours,
    elapsedHours: item.elapsedHours,
    sessionElapsedHours: item.sessionElapsedHours,
    totalHours: item.totalHours,
    showdown: item.showdown,
    showdownText: item.showdownText,
    showdownType: item.showdownType,
    showdownReason: item.showdownReason,
    wentToShowdown: item.wentToShowdown,
    opponentCards: item.opponentCards,
    opponentCardsSource: item.opponentCardsSource,
    opponentCardsVerified: item.opponentCardsVerified,
    villainCardsInput: item.villainCardsInput,
    villainCardsSource: item.villainCardsSource,
    villainCardsVerified: item.villainCardsVerified,
    showdownVerified: item.showdownVerified,
    streetSummary: item.streetSummary,
    streetInputs: item.streetInputs,
    inputMode: item.inputMode,
    reviewSource: item.reviewSource,
    playerSnapshots: item.playerSnapshots,
    actionLine: item.actionLine,
    isAllIn: item.isAllIn,
    allInEvEligible: item.allInEvEligible,
    allInStreet: item.allInStreet,
    allInRound: item.allInRound,
    allInStage: item.allInStage,
    allInEvStreet: item.allInEvStreet,
    allInEv: item.allInEv,
    allInEvProfit: item.allInEvProfit,
    allInEvAdjustedProfit: item.allInEvAdjustedProfit,
    allInEvSource: item.allInEvSource,
    allInEvStatus: item.allInEvStatus,
    allInPot: item.allInPot,
    heroInvested: item.heroInvested,
    heroEquityPct: item.heroEquityPct
  })
}

async function getOwnedProfiles(ownerOpenId) {
  const ownerProfiles = await fetchWhere(COLLECTIONS.profiles, { ownerOpenId })
  const legacyProfiles = await fetchWhere(COLLECTIONS.profiles, { _openid: ownerOpenId })
  return mergeDocs(ownerProfiles, legacyProfiles)
}

async function buildRecoveryCandidate(playerId, ownerOpenId, profile) {
  const sessions = await fetchOwnedByPlayer(COLLECTIONS.sessions, playerId, ownerOpenId)
  const hands = await fetchOwnedByPlayer(COLLECTIONS.hands, playerId, ownerOpenId)
  const handActions = await fetchOwnedByPlayer(COLLECTIONS.handActions, playerId, ownerOpenId)
  const playerNotes = await fetchOwnedByPlayer(COLLECTIONS.playerNotes, playerId, ownerOpenId)
  const bankrollLogs = await fetchOwnedByPlayer(COLLECTIONS.bankrollLogs, playerId, ownerOpenId)
  const updatedAt = Math.max(
    normalizeNumeric(profile && profile.updatedAt),
    sessions.reduce((max, item) => Math.max(max, normalizeNumeric(item.updatedAt || item.createdAt)), 0),
    hands.reduce((max, item) => Math.max(max, normalizeNumeric(item.updatedAt || item.createdAt)), 0),
    playerNotes.reduce((max, item) => Math.max(max, normalizeNumeric(item.updatedAt || item.createdAt)), 0),
    bankrollLogs.reduce((max, item) => Math.max(max, normalizeNumeric(item.updatedAt || item.createdAt)), 0)
  )
  return {
    playerId,
    name: profile && profile.name || '',
    avatarText: profile && profile.avatarText || '',
    sessionCount: sessions.length,
    handCount: hands.length,
    handActionCount: handActions.length,
    playerNoteCount: playerNotes.length,
    bankrollLogCount: bankrollLogs.length,
    updatedAt,
    score: sessions.length * 1000 + hands.length * 10 + bankrollLogs.length
  }
}

async function listRecoveryCandidates(ownerOpenId) {
  const profiles = await getOwnedProfiles(ownerOpenId)
  const profileByPlayer = {}
  profiles.forEach(profile => {
    const playerId = inferPlayerIdFromProfile(profile)
    if (!playerId) return
    const previous = profileByPlayer[playerId]
    if (!previous || normalizeNumeric(profile.updatedAt) > normalizeNumeric(previous.updatedAt)) {
      profileByPlayer[playerId] = profile
    }
  })

  const candidates = []
  const playerIds = Object.keys(profileByPlayer)
  for (let index = 0; index < playerIds.length; index += 1) {
    const playerId = playerIds[index]
    candidates.push(await buildRecoveryCandidate(playerId, ownerOpenId, profileByPlayer[playerId]))
  }
  return candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return (b.updatedAt || 0) - (a.updatedAt || 0)
  })
}

async function exportBackupForPlayer(playerId, ownerOpenId) {
  const normalizedPlayerId = normalizePlayerId(playerId)
  if (!normalizedPlayerId) {
    return null
  }
  const candidates = await listRecoveryCandidates(ownerOpenId)
  const candidate = candidates.find(item => item.playerId === normalizedPlayerId)
  if (!candidate) {
    return null
  }

  const profiles = await getOwnedProfiles(ownerOpenId)
  const profile = profiles
    .filter(item => inferPlayerIdFromProfile(item) === normalizedPlayerId)
    .sort((a, b) => normalizeNumeric(b.updatedAt) - normalizeNumeric(a.updatedAt))[0] || {}
  const settingsDocs = await fetchOwnedByPlayer(COLLECTIONS.userSettings, normalizedPlayerId, ownerOpenId)
  const settings = settingsDocs
    .sort((a, b) => normalizeNumeric(b.updatedAt) - normalizeNumeric(a.updatedAt))[0] || {}

  return {
    profile: Object.assign({}, cleanCloudDoc(profile), { playerId: normalizedPlayerId }),
    settings: cleanCloudDoc(settings),
    sessions: (await fetchOwnedByPlayer(COLLECTIONS.sessions, normalizedPlayerId, ownerOpenId)).map(cleanCloudDoc),
    hands: (await fetchOwnedByPlayer(COLLECTIONS.hands, normalizedPlayerId, ownerOpenId)).map(cleanCloudDoc),
    handActions: (await fetchOwnedByPlayer(COLLECTIONS.handActions, normalizedPlayerId, ownerOpenId)).map(cleanCloudDoc),
    playerNotes: (await fetchOwnedByPlayer(COLLECTIONS.playerNotes, normalizedPlayerId, ownerOpenId)).map(cleanCloudDoc),
    bankrollLogs: (await fetchOwnedByPlayer(COLLECTIONS.bankrollLogs, normalizedPlayerId, ownerOpenId)).map(cleanCloudDoc)
  }
}

async function recoverBestBackup(event, ownerOpenId) {
  const currentPlayerId = normalizePlayerId(event.currentPlayerId)
  const candidates = await listRecoveryCandidates(ownerOpenId)
  const best = candidates.find(item => {
    return item.playerId !== currentPlayerId && (item.sessionCount > 0 || item.handCount > 0 || item.bankrollLogCount > 0)
  }) || candidates.find(item => item.sessionCount > 0 || item.handCount > 0 || item.bankrollLogCount > 0)
  if (!best) {
    return { code: 0, data: { candidates, backup: null } }
  }
  const backup = await exportBackupForPlayer(best.playerId, ownerOpenId)
  return {
    code: 0,
    data: {
      recoveredPlayerId: best.playerId,
      candidates,
      backup
    }
  }
}

async function loginAccount(event, ownerOpenId) {
  const localBackup = event && event.backup || {}
  const localProfile = event && event.profile || localBackup.profile || {}
  const localSettings = localBackup.settings || event && event.settings || {}
  const candidates = await listRecoveryCandidates(ownerOpenId)
  const bestWithData = candidates.find(item => item.sessionCount > 0 || item.handCount > 0 || item.bankrollLogCount > 0)
  const accountPlayerId = createOpenIdPlayerId(ownerOpenId)
  const recoveredPlayerId = bestWithData && bestWithData.playerId || ''
  let backup = null

  if (localProfile && Object.keys(localProfile).length) {
    await saveProfile(Object.assign({}, localProfile, {
      playerId: accountPlayerId,
      updatedAt: Math.max(normalizeNumeric(localProfile.updatedAt), now())
    }), accountPlayerId, ownerOpenId)
  }

  if (localSettings && Object.keys(localSettings).length) {
    await saveSettings(localSettings, accountPlayerId, ownerOpenId)
  } else if (recoveredPlayerId) {
    const settingsDocs = await fetchOwnedByPlayer(COLLECTIONS.userSettings, recoveredPlayerId, ownerOpenId)
    const recoveredSettings = settingsDocs
      .sort((a, b) => normalizeNumeric(b.updatedAt) - normalizeNumeric(a.updatedAt))[0]
    if (recoveredSettings) {
      await saveSettings(cleanCloudDoc(recoveredSettings), accountPlayerId, ownerOpenId)
    }
  }

  if (event && event.includeBackup === true && recoveredPlayerId) {
    backup = await exportBackupForPlayer(recoveredPlayerId, ownerOpenId)
  }

  return {
    code: 0,
    data: {
      accountPlayerId,
      hasHistory: !!bestWithData,
      recoveredPlayerId,
      candidates,
      backup
    }
  }
}

async function exportBackupPage(event, ownerOpenId) {
  const playerId = normalizePlayerId(event && event.playerId)
  const collection = String(event && event.collection || '').trim()
  const offset = Math.max(0, Number(event && event.offset) || 0)
  const limit = Math.max(1, Math.min(Number(event && event.limit) || PAGE_SIZE, PAGE_SIZE))
  const collectionMap = {
    sessions: COLLECTIONS.sessions,
    hands: COLLECTIONS.hands,
    handActions: COLLECTIONS.handActions,
    playerNotes: COLLECTIONS.playerNotes,
    bankrollLogs: COLLECTIONS.bankrollLogs
  }

  if (!playerId) {
    return { code: 'MISSING_PLAYER_ID', message: 'missing playerId' }
  }

  if (collection === 'profile') {
    const profiles = await getOwnedProfiles(ownerOpenId)
    const profile = profiles
      .filter(item => inferPlayerIdFromProfile(item) === playerId)
      .sort((a, b) => normalizeNumeric(b.updatedAt) - normalizeNumeric(a.updatedAt))[0] || {}
    return { code: 0, data: { items: [Object.assign({}, cleanCloudDoc(profile), { playerId })], total: 1, hasMore: false } }
  }

  if (collection === 'settings') {
    const settingsDocs = await fetchOwnedByPlayer(COLLECTIONS.userSettings, playerId, ownerOpenId)
    const settings = settingsDocs
      .sort((a, b) => normalizeNumeric(b.updatedAt) - normalizeNumeric(a.updatedAt))[0] || {}
    return { code: 0, data: { items: [cleanCloudDoc(settings)], total: 1, hasMore: false } }
  }

  const collectionName = collectionMap[collection]
  if (!collectionName) {
    return { code: 'UNKNOWN_COLLECTION', message: 'unknown backup collection' }
  }

  const filters = { playerId, ownerOpenId }
  const items = (await fetchPage(collectionName, filters, offset, limit)).map(cleanCloudDoc)
  const total = await countWhere(collectionName, filters)
  return {
    code: 0,
    data: {
      items,
      total,
      offset,
      limit,
      hasMore: offset + items.length < total
    }
  }
}

async function syncStats(event, ownerOpenId) {
  let playerId = normalizePlayerId(event.playerId || event.backup && event.backup.profile && event.backup.profile.playerId)
  let recoveryCandidates = null

  if (!playerId) {
    playerId = createOpenIdPlayerId(ownerOpenId)
  }

  if (hasMeaningfulBackup(event.backup)) {
    await mergeBusinessData(event.backup || {}, playerId, ownerOpenId)
  }

  let sessions = (await fetchOwnedByPlayer(COLLECTIONS.sessions, playerId, ownerOpenId)).map(cleanCloudDoc)
  let hands = (await fetchOwnedByPlayer(COLLECTIONS.hands, playerId, ownerOpenId)).map(cleanCloudDoc)

  const shouldResolveCandidate = !hasMeaningfulBackup(event.backup) && sessions.length < 5 && hands.length < 20

  if (shouldResolveCandidate) {
    const openIdPlayerId = createOpenIdPlayerId(ownerOpenId)
    if (playerId !== openIdPlayerId) {
      const openIdSessions = (await fetchOwnedByPlayer(COLLECTIONS.sessions, openIdPlayerId, ownerOpenId)).map(cleanCloudDoc)
      const openIdHands = (await fetchOwnedByPlayer(COLLECTIONS.hands, openIdPlayerId, ownerOpenId)).map(cleanCloudDoc)
      if (openIdSessions.length * 1000 + openIdHands.length * 10 > sessions.length * 1000 + hands.length * 10) {
        playerId = openIdPlayerId
        sessions = openIdSessions
        hands = openIdHands
      }
    }
  }

  if (!hasMeaningfulBackup(event.backup) && sessions.length < 5 && hands.length < 20) {
    recoveryCandidates = recoveryCandidates || await listRecoveryCandidates(ownerOpenId)
    const requestedCandidate = recoveryCandidates.find(item => item.playerId === playerId)
    const requestedScore = requestedCandidate
      ? requestedCandidate.score
      : sessions.length * 1000 + hands.length * 10
    const bestCandidate = recoveryCandidates[0]
    if (bestCandidate && bestCandidate.playerId !== playerId && bestCandidate.score > requestedScore) {
      playerId = bestCandidate.playerId
      sessions = (await fetchOwnedByPlayer(COLLECTIONS.sessions, playerId, ownerOpenId)).map(cleanCloudDoc)
      hands = (await fetchOwnedByPlayer(COLLECTIONS.hands, playerId, ownerOpenId)).map(cleanCloudDoc)
    }
  }

  const settings = await getSettings(playerId, ownerOpenId, event.backup && event.backup.settings)

  return {
    code: 0,
    data: {
      stats: buildStatsSummary(sessions, hands, settings),
      sessions: sessions.map(compactStatsSession),
      hands: hands.map(compactStatsHand),
      settings,
      resolvedPlayerId: playerId
    }
  }
}

async function exportAgentData(event, ownerOpenId) {
  const playerId = normalizePlayerId(event.playerId)
  if (!playerId) {
    return { code: 'MISSING_PLAYER_ID', message: 'missing playerId' }
  }

  const profiles = await getOwnedProfiles(ownerOpenId)
  const profile = profiles
    .filter(item => inferPlayerIdFromProfile(item) === playerId)
    .sort((a, b) => normalizeNumeric(b.updatedAt) - normalizeNumeric(a.updatedAt))[0] || { playerId }
  const settings = await getSettings(playerId, ownerOpenId, {})
  const sessions = (await fetchOwnedByPlayer(COLLECTIONS.sessions, playerId, ownerOpenId)).map(cleanCloudDoc)
  const hands = (await fetchOwnedByPlayer(COLLECTIONS.hands, playerId, ownerOpenId)).map(cleanCloudDoc)
  const handActions = (await fetchOwnedByPlayer(COLLECTIONS.handActions, playerId, ownerOpenId)).map(cleanCloudDoc)
  const bankrollLogs = (await fetchOwnedByPlayer(COLLECTIONS.bankrollLogs, playerId, ownerOpenId)).map(cleanCloudDoc)

  return {
    code: 0,
    data: agentExport.buildAgentExport({
      profile: Object.assign({}, cleanCloudDoc(profile), { playerId }),
      settings,
      sessions,
      hands,
      handActions,
      bankrollLogs,
      rangeKey: normalizeAgentExportRangeKey(event),
      range: normalizeAgentExportRange(event),
      nowMs: event.nowMs
    })
  }
}

function normalizeAgentExportRangeKey(event) {
  const days = Number(event && event.days)
  if (days === 7) return 'last7'
  if (days === 30) return 'last30'
  return event && event.rangeKey || 'last7'
}

function normalizeAgentExportRange(event) {
  if (event && event.range) return event.range
  if (event && (event.from || event.to)) {
    return {
      from: event.from || '',
      to: event.to || ''
    }
  }
  return null
}


async function createSessionAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'create_session', async (playerId, clientMutationId) => {
    const payload = event.payload || {}
    if (!payload.status || payload.status === 'active') {
      const existingActive = (await fetchWhere(COLLECTIONS.sessions, { playerId, ownerOpenId, status: 'active' }))[0]
      if (existingActive) {
        return {
          session: cleanCloudDoc(existingActive),
          rejected: true,
          reason: 'ACTIVE_SESSION_EXISTS'
        }
      }
    }
    const session = buildSessionDoc(null, payload)
    const id = session._id || createId('session')
    const doc = withOwnerScope(Object.assign({}, session, { _id: id }), playerId, ownerOpenId)
    await setDocById(COLLECTIONS.sessions, id, doc)
    await writeAuditLog(ownerOpenId, playerId, 'create_session', id, null, doc, clientMutationId)
    return { session: cleanCloudDoc(Object.assign({}, doc, { _id: id })) }
  })
}

async function updateSessionAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'update_session', async (playerId, clientMutationId) => {
    const sessionId = String(event.sessionId || '').trim()
    const current = await getDocById(COLLECTIONS.sessions, sessionId)
    if (!current || normalizePlayerId(current.playerId) !== playerId || current.ownerOpenId !== ownerOpenId) {
      return { session: null, rejected: true, reason: 'SESSION_NOT_FOUND' }
    }
    const next = withOwnerScope(Object.assign({}, buildSessionDoc(current, event.patch || {}), { _id: sessionId }), playerId, ownerOpenId)
    await setDocById(COLLECTIONS.sessions, sessionId, next)
    await writeAuditLog(ownerOpenId, playerId, 'update_session', sessionId, current, next, clientMutationId)
    return { session: cleanCloudDoc(next) }
  })
}

async function finishSessionAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'finish_session', async (playerId, clientMutationId) => {
    const sessionId = String(event.sessionId || '').trim()
    const current = await getDocById(COLLECTIONS.sessions, sessionId)
    if (!current || normalizePlayerId(current.playerId) !== playerId || current.ownerOpenId !== ownerOpenId) {
      return { session: null, rejected: true, reason: 'SESSION_NOT_FOUND' }
    }
    const payload = event.payload || {}
    const cashOut = Number(payload.cashOut != null ? payload.cashOut : current.cashOut) || 0
    const next = withOwnerScope(Object.assign({}, buildSessionDoc(current, {
      cashOut,
      endTime: payload.endTime || current.endTime || '',
      timerPausedAt: '',
      status: 'finished'
    }), { _id: sessionId }), playerId, ownerOpenId)
    await setDocById(COLLECTIONS.sessions, sessionId, next)
    const bankrollId = payload.bankrollLogId || 'bankroll_' + sessionId
    const bankrollLog = withOwnerScope({
      _id: bankrollId,
      sessionId,
      type: 'session_settlement',
      amount: Number(next.totalProfit) || 0,
      balanceAfter: 0,
      note: (next.title || 'Session') + ' 结算',
      createdAt: now(),
      updatedAt: now()
    }, playerId, ownerOpenId)
    await setDocById(COLLECTIONS.bankrollLogs, bankrollId, bankrollLog)
    await writeAuditLog(ownerOpenId, playerId, 'finish_session', sessionId, current, next, clientMutationId)
    return { session: cleanCloudDoc(next), bankrollLog: cleanCloudDoc(bankrollLog) }
  })
}

async function replaceHandActionsCloud(playerId, ownerOpenId, handId, sessionId, actions) {
  const existing = await fetchWhere(COLLECTIONS.handActions, { playerId, ownerOpenId, handId })
  for (let index = 0; index < existing.length; index += 1) {
    await removeDocById(COLLECTIONS.handActions, existing[index]._id)
  }
  const nextActions = []
  const list = Array.isArray(actions) ? actions : []
  for (let index = 0; index < list.length; index += 1) {
    const action = list[index] || {}
    const id = action._id || createId('action')
    const doc = withOwnerScope({
      _id: id,
      handId,
      sessionId,
      street: action.street || '',
      actorSeat: Number(action.actorSeat) || 0,
      actorLabel: action.actorLabel || '',
      actionType: action.actionType || '',
      amount: Number(action.amount) || 0,
      potAfter: Number(action.potAfter) || 0,
      sequence: index + 1,
      createdAt: Number(action.createdAt) || now(),
      updatedAt: now()
    }, playerId, ownerOpenId)
    await setDocById(COLLECTIONS.handActions, id, doc)
    nextActions.push(cleanCloudDoc(doc))
  }
  return nextActions
}

async function createHandAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'create_hand', async (playerId, clientMutationId) => {
    const payload = event.payload || {}
    const sessionId = String(payload.sessionId || '').trim()
    const targetSession = sessionId ? await getDocById(COLLECTIONS.sessions, sessionId) : null
    const targetOwnerOpenId = String(targetSession && (targetSession.ownerOpenId || targetSession._openid) || '').trim()
    if (!targetSession || normalizePlayerId(targetSession.playerId) !== playerId || targetOwnerOpenId !== ownerOpenId) {
      return { hand: null, rejected: true, reason: 'SESSION_NOT_FOUND' }
    }
    const hand = buildHandDoc(null, applySessionHandDefaults(payload, targetSession))
    const id = hand._id || createId('hand')
    const doc = withOwnerScope(Object.assign({}, hand, { _id: id }), playerId, ownerOpenId)
    await setDocById(COLLECTIONS.hands, id, doc)
    const actions = await replaceHandActionsCloud(playerId, ownerOpenId, id, doc.sessionId, payload.actions || [])
    const session = await refreshSessionRecordedStatsCloud(playerId, ownerOpenId, doc.sessionId)
    await writeAuditLog(ownerOpenId, playerId, 'create_hand', id, null, doc, clientMutationId)
    return { hand: cleanCloudDoc(doc), actions, session }
  })
}

async function updateHandAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'update_hand', async (playerId, clientMutationId) => {
    const handId = String(event.handId || '').trim()
    const current = await getDocById(COLLECTIONS.hands, handId)
    if (!current || normalizePlayerId(current.playerId) !== playerId || current.ownerOpenId !== ownerOpenId) {
      return { hand: null, rejected: true, reason: 'HAND_NOT_FOUND' }
    }
    const patch = event.patch || {}
    const next = withOwnerScope(Object.assign({}, buildHandDoc(current, patch), { _id: handId }), playerId, ownerOpenId)
    await setDocById(COLLECTIONS.hands, handId, next)
    let actions = []
    if (Object.prototype.hasOwnProperty.call(patch, 'actions')) {
      actions = await replaceHandActionsCloud(playerId, ownerOpenId, handId, next.sessionId, patch.actions || [])
    }
    const sessionIds = [current.sessionId, next.sessionId].filter((item, index, list) => item && list.indexOf(item) === index)
    const sessions = []
    for (let index = 0; index < sessionIds.length; index += 1) {
      const session = await refreshSessionRecordedStatsCloud(playerId, ownerOpenId, sessionIds[index])
      if (session) sessions.push(session)
    }
    await writeAuditLog(ownerOpenId, playerId, 'update_hand', handId, current, next, clientMutationId)
    return { hand: cleanCloudDoc(next), actions, sessions }
  })
}

async function upsertHandAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'upsert_hand', async (playerId, clientMutationId) => {
    const payload = event.payload || {}
    const handId = String(event.handId || payload._id || '').trim()
    if (!handId) {
      return { hand: null, rejected: true, reason: 'MISSING_HAND_ID' }
    }
    const current = await getDocById(COLLECTIONS.hands, handId)
    const base = current && normalizePlayerId(current.playerId) === playerId && current.ownerOpenId === ownerOpenId
      ? current
      : null
    const next = withOwnerScope(Object.assign({}, buildHandDoc(base, payload), { _id: handId }), playerId, ownerOpenId)
    await setDocById(COLLECTIONS.hands, handId, next)
    let actions = []
    if (Object.prototype.hasOwnProperty.call(payload, 'actions')) {
      actions = await replaceHandActionsCloud(playerId, ownerOpenId, handId, next.sessionId, payload.actions || [])
    }
    const session = next.sessionId ? await refreshSessionRecordedStatsCloud(playerId, ownerOpenId, next.sessionId) : null
    await writeAuditLog(ownerOpenId, playerId, 'upsert_hand', handId, base, next, clientMutationId)
    return { hand: cleanCloudDoc(next), actions, session }
  })
}

async function deleteHandAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'delete_hand', async (playerId, clientMutationId) => {
    const handId = String(event.handId || '').trim()
    const current = await getDocById(COLLECTIONS.hands, handId)
    if (!current || normalizePlayerId(current.playerId) !== playerId || current.ownerOpenId !== ownerOpenId) {
      return { deleted: false, rejected: true, reason: 'HAND_NOT_FOUND' }
    }
    const actions = await fetchWhere(COLLECTIONS.handActions, { playerId, ownerOpenId, handId })
    for (let index = 0; index < actions.length; index += 1) {
      await removeDocById(COLLECTIONS.handActions, actions[index]._id)
    }
    await removeDocById(COLLECTIONS.hands, handId)
    const session = await refreshSessionRecordedStatsCloud(playerId, ownerOpenId, current.sessionId)
    await writeAuditLog(ownerOpenId, playerId, 'delete_hand', handId, current, null, clientMutationId)
    return { deleted: true, handId, session }
  })
}

async function deleteSessionAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'delete_session', async (playerId, clientMutationId) => {
    const sessionId = String(event.sessionId || '').trim()
    const current = await getDocById(COLLECTIONS.sessions, sessionId)
    if (!current || normalizePlayerId(current.playerId) !== playerId || current.ownerOpenId !== ownerOpenId) {
      return { deleted: false, rejected: true, reason: 'SESSION_NOT_FOUND' }
    }
    const hands = await fetchWhere(COLLECTIONS.hands, { playerId, ownerOpenId, sessionId })
    for (let index = 0; index < hands.length; index += 1) {
      const actions = await fetchWhere(COLLECTIONS.handActions, { playerId, ownerOpenId, handId: hands[index]._id })
      for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
        await removeDocById(COLLECTIONS.handActions, actions[actionIndex]._id)
      }
      await removeDocById(COLLECTIONS.hands, hands[index]._id)
    }
    const bankrollLogs = await fetchWhere(COLLECTIONS.bankrollLogs, { playerId, ownerOpenId, sessionId })
    for (let index = 0; index < bankrollLogs.length; index += 1) {
      await removeDocById(COLLECTIONS.bankrollLogs, bankrollLogs[index]._id)
    }
    await removeDocById(COLLECTIONS.sessions, sessionId)
    await writeAuditLog(ownerOpenId, playerId, 'delete_session', sessionId, current, null, clientMutationId)
    return { deleted: true, sessionId, handIds: hands.map(item => item._id) }
  })
}

const PLAYER_TYPE_COLORS = {
  '紧弱': '#5c8cff',
  '松弱': '#30d87b',
  '激进': '#ff3150',
  '跟注站': '#ffd447',
  '常客': '#aa6cff',
  '娱乐玩家': '#2ad8ff',
  '未分类': '#8891a7'
}

function normalizePlayerNoteStringList(list) {
  const seen = {}
  return (Array.isArray(list) ? list : [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .filter(item => {
      if (seen[item]) return false
      seen[item] = true
      return true
    })
}

function getPlayerTypeColor(type) {
  return PLAYER_TYPE_COLORS[String(type || '').trim()] || PLAYER_TYPE_COLORS['未分类']
}

function buildPlayerNoteDoc(base, patch) {
  const merged = Object.assign({}, base || {}, patch || {})
  const name = String(merged.name || '').trim()
  const type = String(merged.type || '未分类').trim() || '未分类'
  const sourceKind = merged.sourceKind === 'friend' ? 'friend' : 'library'
  const linkedFriendUserId = sourceKind === 'friend'
    ? String(merged.linkedFriendUserId || '').trim()
    : ''
  return stripUndefined({
    _id: String(merged._id || '').trim(),
    name,
    alias: normalizePlayerNoteStringList(merged.alias),
    avatarUrl: String(merged.avatarUrl || '').trim(),
    avatarFileId: String(merged.avatarFileId || '').trim(),
    avatarText: String(merged.avatarText || name.slice(0, 1) || '玩').trim(),
    type,
    typeColor: getPlayerTypeColor(type),
    leakTags: normalizePlayerNoteStringList(merged.leakTags),
    note: String(merged.note || '').trim(),
    lastSeenAt: Number(merged.lastSeenAt) || 0,
    lastVenue: String(merged.lastVenue || '').trim(),
    lastStake: String(merged.lastStake || '').trim(),
    battleHandIds: normalizePlayerNoteStringList(merged.battleHandIds || merged.linkedHandIds),
    sourceKind,
    linkedFriendUserId,
    archived: !!merged.archived,
    createdAt: Number(merged.createdAt) || now(),
    updatedAt: now()
  })
}

async function listPlayerNotesAction(event, ownerOpenId) {
  const playerId = normalizePlayerId(event.playerId)
  if (!playerId) {
    return { code: 'MISSING_PLAYER_ID', message: 'missing playerId' }
  }
  const includeArchived = !!event.includeArchived
  const notes = await fetchWhere(COLLECTIONS.playerNotes, { playerId, ownerOpenId })
  return {
    code: 0,
    data: {
      playerNotes: notes
        .filter(item => includeArchived || !item.archived)
        .map(cleanCloudDoc)
        .sort((a, b) => normalizeNumeric(b.updatedAt || b.createdAt) - normalizeNumeric(a.updatedAt || a.createdAt))
    }
  }
}

async function createPlayerNoteAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'create_player_note', async (playerId, clientMutationId) => {
    const doc = buildPlayerNoteDoc(null, event.payload || {})
    if (!doc.name) {
      return { playerNote: null, rejected: true, reason: 'MISSING_NAME' }
    }
    if (doc.sourceKind === 'friend' && doc.linkedFriendUserId) {
      const existingFriendNote = (await fetchWhere(COLLECTIONS.playerNotes, { playerId, ownerOpenId }))
        .find(item => item && item.sourceKind === 'friend' && item.linkedFriendUserId === doc.linkedFriendUserId)
      if (existingFriendNote) {
        return { playerNote: cleanCloudDoc(existingFriendNote) }
      }
    }
    const id = doc._id || createId('player_note')
    const next = withOwnerScope(Object.assign({}, doc, { _id: id }), playerId, ownerOpenId)
    await setDocById(COLLECTIONS.playerNotes, id, next)
    await writeAuditLog(ownerOpenId, playerId, 'create_player_note', id, null, next, clientMutationId)
    return { playerNote: cleanCloudDoc(next) }
  })
}

async function updatePlayerNoteAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'update_player_note', async (playerId, clientMutationId) => {
    const noteId = String(event.noteId || event.playerNoteId || '').trim()
    const current = await getDocById(COLLECTIONS.playerNotes, noteId)
    if (!current || normalizePlayerId(current.playerId) !== playerId || current.ownerOpenId !== ownerOpenId) {
      return { playerNote: null, rejected: true, reason: 'PLAYER_NOTE_NOT_FOUND' }
    }
    const next = withOwnerScope(Object.assign({}, buildPlayerNoteDoc(current, event.patch || {}), { _id: noteId }), playerId, ownerOpenId)
    await setDocById(COLLECTIONS.playerNotes, noteId, next)
    await writeAuditLog(ownerOpenId, playerId, 'update_player_note', noteId, current, next, clientMutationId)
    return { playerNote: cleanCloudDoc(next) }
  })
}

async function deletePlayerNoteAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'delete_player_note', async (playerId, clientMutationId) => {
    const noteId = String(event.noteId || event.playerNoteId || '').trim()
    const current = await getDocById(COLLECTIONS.playerNotes, noteId)
    if (!current || normalizePlayerId(current.playerId) !== playerId || current.ownerOpenId !== ownerOpenId) {
      return { deleted: false, rejected: true, reason: 'PLAYER_NOTE_NOT_FOUND' }
    }
    const next = withOwnerScope(Object.assign({}, buildPlayerNoteDoc(current, { archived: true }), { _id: noteId }), playerId, ownerOpenId)
    await setDocById(COLLECTIONS.playerNotes, noteId, next)
    await writeAuditLog(ownerOpenId, playerId, 'delete_player_note', noteId, current, next, clientMutationId)
    return { deleted: true, noteId, playerNote: cleanCloudDoc(next) }
  })
}

function buildPlayerNoteBattleHandSummary(hand, note) {
  return stripUndefined({
    _id: hand._id,
    handId: hand._id,
    relationshipText: 'Hero vs ' + (note && note.name || '玩家'),
    heroCardsInput: hand.heroCardsInput || '',
    heroPosition: hand.heroPosition || '',
    board: hand.board || {},
    currentProfit: Number(hand.currentProfit) || 0,
    playedDate: hand.playedDate || '',
    stakeLevel: hand.stakeLevel || '',
    streetInputs: hand.streetInputs || {},
    actionLine: hand.actionLine || hand.streetSummary || ''
  })
}

async function listPlayerNoteHandsAction(event, ownerOpenId) {
  const playerId = normalizePlayerId(event.playerId)
  if (!playerId) {
    return { code: 'MISSING_PLAYER_ID', message: 'missing playerId' }
  }
  const noteId = String(event.noteId || event.playerNoteId || '').trim()
  const current = await getDocById(COLLECTIONS.playerNotes, noteId)
  if (!current || normalizePlayerId(current.playerId) !== playerId || current.ownerOpenId !== ownerOpenId) {
    return { code: 0, data: { hands: [], rejected: true, reason: 'PLAYER_NOTE_NOT_FOUND' } }
  }
  const handIds = normalizePlayerNoteStringList(current.battleHandIds || current.linkedHandIds)
  const hands = await fetchWhere(COLLECTIONS.hands, { playerId, ownerOpenId })
  const summaries = handIds
    .map(handId => hands.find(item => item && item._id === handId))
    .filter(Boolean)
    .map(hand => buildPlayerNoteBattleHandSummary(cleanCloudDoc(hand), current))
  return { code: 0, data: { hands: summaries } }
}

async function getPlayerNoteHandReplayAction(event, ownerOpenId) {
  const playerId = normalizePlayerId(event.playerId)
  if (!playerId) {
    return { code: 'MISSING_PLAYER_ID', message: 'missing playerId' }
  }
  const noteId = String(event.noteId || event.playerNoteId || '').trim()
  const handId = String(event.handId || '').trim()
  const current = await getDocById(COLLECTIONS.playerNotes, noteId)
  if (!current || normalizePlayerId(current.playerId) !== playerId || current.ownerOpenId !== ownerOpenId) {
    return { code: 0, data: { hand: null, actions: [], rejected: true, reason: 'PLAYER_NOTE_NOT_FOUND' } }
  }
  const handIds = normalizePlayerNoteStringList(current.battleHandIds || current.linkedHandIds)
  if (handIds.indexOf(handId) === -1) {
    return { code: 0, data: { hand: null, actions: [], rejected: true, reason: 'HAND_NOT_LINKED' } }
  }
  const hand = await getDocById(COLLECTIONS.hands, handId)
  if (!hand || normalizePlayerId(hand.playerId) !== playerId || hand.ownerOpenId !== ownerOpenId) {
    return { code: 0, data: { hand: null, actions: [], rejected: true, reason: 'HAND_NOT_FOUND' } }
  }
  const actions = await fetchWhere(COLLECTIONS.handActions, { playerId, ownerOpenId, handId })
  return { code: 0, data: { hand: cleanCloudDoc(hand), actions: actions.map(cleanCloudDoc) } }
}

async function saveSettingsAction(event, ownerOpenId) {
  const playerId = normalizePlayerId(event.playerId)
  if (!playerId) {
    return { code: 'MISSING_PLAYER_ID', message: 'missing playerId' }
  }
  await saveSettings(event.settings, playerId, ownerOpenId)
  const settings = await getSettings(playerId, ownerOpenId, event.settings || {})
  return {
    code: 0,
    data: {
      settings
    }
  }
}

async function backfillSessionDurationsAction(event, ownerOpenId) {
  const playerId = normalizePlayerId(event.playerId)
  if (!playerId) {
    return { code: 'MISSING_PLAYER_ID', message: 'missing playerId' }
  }
  const dryRun = event.dryRun !== false
  const sessions = await fetchOwnedByPlayer(COLLECTIONS.sessions, playerId, ownerOpenId)
  const candidates = sessions
    .map(getSessionDurationBackfill)
    .filter(Boolean)
  const addedMinutes = candidates.reduce((sum, item) => sum + item.addedMinutes, 0)

  if (!dryRun) {
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]
      const current = await getDocById(COLLECTIONS.sessions, candidate.sessionId)
      if (!current || normalizePlayerId(current.playerId) !== playerId) continue
      const currentOwnerOpenId = String(current.ownerOpenId || current._openid || '').trim()
      if (currentOwnerOpenId !== ownerOpenId) continue
      const latestBackfill = getSessionDurationBackfill(current)
      if (!latestBackfill) continue
      const next = withOwnerScope(Object.assign({}, current, {
        durationMinutes: latestBackfill.durationMinutes,
        durationBackfilledAt: now()
      }), playerId, ownerOpenId)
      await setDocById(COLLECTIONS.sessions, candidate.sessionId, next)
      await writeAuditLog(ownerOpenId, playerId, 'backfill_session_duration', candidate.sessionId, current, next, '')
    }
  }

  return {
    code: 0,
    data: {
      dryRun,
      scanned: sessions.length,
      matched: candidates.length,
      updated: dryRun ? 0 : candidates.length,
      addedMinutes,
      addedHours: Number((addedMinutes / 60).toFixed(1)),
      samples: candidates.slice(0, 10)
    }
  }
}

function truncateSubscribeValue(value, maxLength) {
  const text = String(value || '').trim()
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

async function sendAiReminderSubscribeMessage(event, ownerOpenId) {
  const reminder = event && event.reminder || {}
  const templateId = String(event && event.templateId || AI_REMINDER_SUBSCRIBE_TEMPLATE_ID).trim()
  if (!templateId) {
    return { code: 'MISSING_TEMPLATE_ID', message: 'missing AI_REMINDER_SUBSCRIBE_TEMPLATE_ID' }
  }
  if (!cloud.openapi || !cloud.openapi.subscribeMessage || typeof cloud.openapi.subscribeMessage.send !== 'function') {
    return { code: 'SUBSCRIBE_API_UNAVAILABLE', message: 'subscribeMessage.send unavailable' }
  }

  const result = await cloud.openapi.subscribeMessage.send({
    touser: ownerOpenId,
    templateId,
    page: 'pages/profile/profile',
    miniprogramState: 'developer',
    data: {
      thing1: {
        value: truncateSubscribeValue(reminder.title || 'EV脑提醒', 20)
      },
      thing3: {
        value: truncateSubscribeValue(reminder.message || '有一条新的牌局状态提醒', 20)
      },
      time2: {
        value: new Date(Number(reminder.createdAt) || Date.now()).toISOString().slice(0, 16).replace('T', ' ')
      }
    }
  })

  return {
    code: 0,
    data: {
      sent: true,
      result
    }
  }
}

exports.main = async function main(rawEvent) {
  const event = parseIncomingEvent(rawEvent)
  const identity = typeof cloud.getWXContext === 'function' ? cloud.getWXContext() : {}
  const ownerResult = resolveOwnerOpenId(event, identity)
  if (ownerResult.error) {
    return ownerResult.error
  }
  const ownerOpenId = ownerResult.ownerOpenId
  const action = normalizeAction(event)

  try {
    if (action === 'login_account') {
      return await loginAccount(event || {}, ownerOpenId)
    }
    if (action === 'recover_best_backup') {
      return await recoverBestBackup(event || {}, ownerOpenId)
    }
    if (action === 'export_backup_page') {
      return await exportBackupPage(event || {}, ownerOpenId)
    }
    if (action === 'sync_stats') {
      return await syncStats(event || {}, ownerOpenId)
    }
    if (action === 'agent_export') {
      return await exportAgentData(event || {}, ownerOpenId)
    }
    if (action === 'save_settings') {
      return await saveSettingsAction(event || {}, ownerOpenId)
    }
    if (action === 'backfill_session_durations') {
      return await backfillSessionDurationsAction(event || {}, ownerOpenId)
    }
    if (action === 'list_player_notes') {
      return await listPlayerNotesAction(event || {}, ownerOpenId)
    }
    if (action === 'create_player_note') {
      return await createPlayerNoteAction(event || {}, ownerOpenId)
    }
    if (action === 'update_player_note') {
      return await updatePlayerNoteAction(event || {}, ownerOpenId)
    }
    if (action === 'delete_player_note') {
      return await deletePlayerNoteAction(event || {}, ownerOpenId)
    }
    if (action === 'list_player_note_hands') {
      return await listPlayerNoteHandsAction(event || {}, ownerOpenId)
    }
    if (action === 'get_player_note_hand_replay') {
      return await getPlayerNoteHandReplayAction(event || {}, ownerOpenId)
    }
    if (action === 'create_session') {
      return await createSessionAction(event || {}, ownerOpenId)
    }
    if (action === 'update_session') {
      return await updateSessionAction(event || {}, ownerOpenId)
    }
    if (action === 'finish_session') {
      return await finishSessionAction(event || {}, ownerOpenId)
    }
    if (action === 'create_hand') {
      return await createHandAction(event || {}, ownerOpenId)
    }
    if (action === 'update_hand') {
      return await updateHandAction(event || {}, ownerOpenId)
    }
    if (action === 'upsert_hand') {
      return await upsertHandAction(event || {}, ownerOpenId)
    }
    if (action === 'delete_hand') {
      return await deleteHandAction(event || {}, ownerOpenId)
    }
    if (action === 'delete_session') {
      return await deleteSessionAction(event || {}, ownerOpenId)
    }
    if (action === 'send_ai_reminder_subscribe') {
      return await sendAiReminderSubscribeMessage(event || {}, ownerOpenId)
    }
    return { code: 'UNKNOWN_ACTION', message: 'unknown data action' }
  } catch (error) {
    return {
      code: 'POKER_DATA_ERROR',
      message: error && (error.message || error.errMsg) || String(error)
    }
  }
}

exports.__test = {
  normalizePlayerId,
  buildStatsSummary,
  inferPlayerIdFromProfile,
  createOpenIdPlayerId,
  sendAiReminderSubscribeMessage,
  parseIncomingEvent,
  getAuthorizationToken,
  resolveOwnerOpenId,
  normalizeAction,
  normalizeAgentExportRangeKey,
  normalizeAgentExportRange,
  getSessionDurationBackfill,
  exportAgentData
}
