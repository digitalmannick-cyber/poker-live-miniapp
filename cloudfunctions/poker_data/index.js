const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const { AsyncLocalStorage } = require('async_hooks')
const agentExport = require('./agent-export')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const AI_REMINDER_SUBSCRIBE_TEMPLATE_ID = String(process.env.AI_REMINDER_SUBSCRIBE_TEMPLATE_ID || '').trim()
const AGENT_EXPORT_TOKEN = String(process.env.AGENT_EXPORT_TOKEN || '').trim()
const AGENT_EXPORT_OWNER_OPENID = String(process.env.AGENT_EXPORT_OWNER_OPENID || '').trim()
const PAGE_SIZE = 100
const ensuredCollections = {}
const businessFenceStorage = new AsyncLocalStorage()
const COLLECTIONS = {
  sessions: 'sessions',
  hands: 'hands',
  handActions: 'hand_actions',
  playerNotes: 'player_notes',
  playerCardImportReceipts: 'player_card_import_receipts',
  bankrollLogs: 'bankroll_logs',
  profiles: 'profiles',
  userSettings: 'user_settings',
  accountLifecycle: 'poker_data_account_lifecycle',
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

const BUSINESS_WRITE_ACTIONS = Object.freeze([
  'login_account',
  'sync_stats',
  'save_settings',
  'backfill_session_durations',
  'begin_player_card_import_receipt',
  'complete_player_card_import_receipt',
  'create_player_note',
  'update_player_note',
  'delete_player_note',
  'create_session',
  'update_session',
  'finish_session',
  'create_hand',
  'update_hand',
  'upsert_hand',
  'delete_hand',
  'delete_session'
])
const BUSINESS_COLLECTIONS = new Set([
  COLLECTIONS.sessions,
  COLLECTIONS.hands,
  COLLECTIONS.handActions,
  COLLECTIONS.playerNotes,
  COLLECTIONS.playerCardImportReceipts,
  COLLECTIONS.bankrollLogs,
  COLLECTIONS.profiles,
  COLLECTIONS.userSettings
])

const HAND_REVISION_INTERNAL_FIELDS = new Set([
  'actionRevision', 'actionRevisionPending', 'actionCommittedAt', 'handVersion',
  'lastClientMutationId', 'lastMutationAttemptId'
])
const MUTATION_SERVER_FIELDS = ['lastClientMutationId', 'lastMutationAttemptId']
const HAND_REVISION_VOLATILE_FIELDS = new Set(['createdAt', 'updatedAt', 'actionCommittedAt'])

function canonicalizeRevisionValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeRevisionValue)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce((result, key) => {
    if (!HAND_REVISION_INTERNAL_FIELDS.has(key) && !HAND_REVISION_VOLATILE_FIELDS.has(key) && key !== 'actions') {
      result[key] = canonicalizeRevisionValue(value[key])
    }
    return result
  }, {})
}

function createHandActionRevision(input) {
  const source = input || {}
  const canonicalActions = (Array.isArray(source.actions) ? source.actions : []).map((action, index) => ({
    id: String(action && action._id || ''),
    street: String(action && action.street || ''),
    actorSeat: Number(action && action.actorSeat) || 0,
    actorLabel: String(action && action.actorLabel || ''),
    actionType: String(action && action.actionType || ''),
    amount: Number(action && action.amount) || 0,
    potAfter: Number(action && action.potAfter) || 0,
    createdAt: Number(action && action.createdAt) || 0,
    updatedAt: Number(action && action.updatedAt) || 0,
    sequence: index + 1
  }))
  return crypto.createHash('sha256').update(JSON.stringify([
    String(source.ownerOpenId || ''), normalizePlayerId(source.playerId), String(source.handId || ''),
    String(source.action || ''), String(source.clientMutationId || ''), canonicalActions, canonicalizeRevisionValue(source.finalDoc || {})
  ])).digest('hex')
}

function createMutationEntityId(prefix, ownerOpenId, playerId, action, clientMutationId) {
  const digest = crypto.createHash('sha256').update(JSON.stringify([
    String(ownerOpenId || ''), normalizePlayerId(playerId), String(action || ''), String(clientMutationId || '')
  ])).digest('hex')
  return String(prefix || 'doc') + '_' + digest.slice(0, 40)
}

function createHandActionRowId(ownerOpenId, playerId, handId, revision, sequence) {
  return 'ha_' + crypto.createHash('sha256').update(JSON.stringify([
    String(ownerOpenId || ''), normalizePlayerId(playerId), String(handId || ''), String(revision || ''), Number(sequence) || 0
  ])).digest('hex')
}

function handWriteEvidence(doc, ownerOpenId) {
  const source = doc || {}
  return JSON.stringify([
    String(source.ownerOpenId || source._openid || ownerOpenId || ''), normalizePlayerId(source.playerId),
    String(source.sessionId || ''), Number(source.updatedAt) || 0, String(source.actionRevision || ''),
    Math.max(0, Math.floor(Number(source.handVersion) || 0))
  ])
}

function prepareHandRevisionClaim(current, expected, revision, playerId, ownerOpenId, allowMissing) {
  if (!current && !allowMissing) throw new Error('hand action revision source missing')
  const base = current || expected
  if (!base || normalizePlayerId(base.playerId) !== normalizePlayerId(playerId) ||
    String(base.ownerOpenId || base._openid || '') !== String(ownerOpenId || '')) throw new Error('hand action revision forbidden')
  if (current && expected && handWriteEvidence(current) !== handWriteEvidence(expected)) throw new Error('hand action revision stale')
  const pending = String(base.actionRevisionPending || '')
  if (pending && pending !== revision) throw new Error('hand action revision busy')
  return withOwnerScope(Object.assign({}, base, { actionRevisionPending: revision }), normalizePlayerId(playerId), ownerOpenId)
}

function prepareHandMetadataWrite(current, expected, finalDoc, playerId, ownerOpenId, allowMissing) {
  if (!current && !allowMissing) throw new Error('hand metadata source missing')
  const base = current || expected
  if (!base || normalizePlayerId(base.playerId) !== normalizePlayerId(playerId) ||
    String(base.ownerOpenId || base._openid || '') !== String(ownerOpenId || '')) throw new Error('hand metadata forbidden')
  if (current && expected && handWriteEvidence(current) !== handWriteEvidence(expected)) throw new Error('hand metadata stale')
  if (String(base.actionRevisionPending || '')) throw new Error('hand action revision busy')
  const next = withOwnerScope(Object.assign({}, finalDoc, {
    actionRevision: base.actionRevision || undefined,
    actionCommittedAt: base.actionCommittedAt || undefined,
    handVersion: Math.max(0, Math.floor(Number(base.handVersion) || 0)) + 1
  }), normalizePlayerId(playerId), ownerOpenId)
  delete next.actionRevisionPending
  return stripUndefined(next)
}

async function executeHandActionRevision(operations, input) {
  const revision = String(input && input.revision || '')
  if (!/^[0-9a-f]{64}$/.test(revision)) throw new Error('invalid hand action revision')
  await operations.claimPending(revision)
  const actions = await operations.replaceActions(revision, Array.isArray(input && input.actions) ? input.actions : [])
  await operations.finalize(revision)
  return actions
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
  const fence = currentBusinessFence()
  if (BUSINESS_COLLECTIONS.has(collectionName) && !fence) {
    throw accountLifecycleError('ACCOUNT_LIFECYCLE_INVALID', 'business write requires account lifecycle fence')
  }
  if (BUSINESS_COLLECTIONS.has(collectionName)) {
    if (normalizePlayerId(data && data.playerId) !== fence.playerId ||
      String(data && (data.ownerOpenId || data._openid) || '') !== fence.ownerOpenId) {
      throw accountLifecycleError('ACCOUNT_DATA_SCOPE_MISMATCH', 'business write account scope mismatch')
    }
    return runFencedBusinessTransaction(fence, transaction => transaction.collection(collectionName).doc(docId).set({
      data: omitId(data)
    }))
  }
  if (fence && [COLLECTIONS.syncOperations, COLLECTIONS.auditLogs].includes(collectionName) &&
    ['result', 'recoveryEvidence', 'before', 'after', 'payload', 'businessPayload'].some(key => Object.prototype.hasOwnProperty.call(data || {}, key))) {
    return runFencedBusinessTransaction(fence, transaction => transaction.collection(collectionName).doc(docId).set({
      data: omitId(data)
    }))
  }
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
  const fence = currentBusinessFence()
  if (fence && collectionName === COLLECTIONS.auditLogs) {
    return runFencedBusinessTransaction(fence, async transaction => {
      const result = await transaction.collection(collectionName).add({ data: stripUndefined(data) })
      return Object.assign({ _id: result._id }, data)
    })
  }
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
    if (isMissingDocumentError(error)) return null
    throw error
  }
}

async function removeDocById(collectionName, docId) {
  const fence = currentBusinessFence()
  if (BUSINESS_COLLECTIONS.has(collectionName) && !fence) {
    throw accountLifecycleError('ACCOUNT_LIFECYCLE_INVALID', 'business remove requires account lifecycle fence')
  }
  if (BUSINESS_COLLECTIONS.has(collectionName)) {
    return runFencedBusinessTransaction(fence, async transaction => {
      const current = await getDocByPointRead(transaction, collectionName, docId)
      if (!current) return true
      if (normalizePlayerId(current.playerId) !== fence.playerId ||
        String(current.ownerOpenId || current._openid || '') !== fence.ownerOpenId) {
        throw accountLifecycleError('ACCOUNT_DATA_SCOPE_MISMATCH', 'business remove account scope mismatch')
      }
      await transaction.collection(collectionName).doc(docId).remove()
      return true
    })
  }
  try {
    await db.collection(collectionName).doc(docId).remove()
    return true
  } catch (error) {
    if (isMissingDocumentError(error)) return true
    throw error
  }
}

async function upsertMany(collectionName, list, playerId, ownerOpenId) {
  const items = Array.isArray(list) ? list : []
  for (let index = 0; index < items.length; index += 1) {
    const item = stripMutationServerFields(items[index])
    if (!item || !item._id) continue
    const existing = await getDocById(collectionName, item._id)
    if (existing && (normalizePlayerId(existing.playerId) !== playerId ||
      String(existing.ownerOpenId || existing._openid || '') !== ownerOpenId)) {
      throw new Error('backup document ownership conflict')
    }
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
    await removeDocById(collectionName, item._id)
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

async function fetchPlayerCardImportReceiptsForClear(playerId, ownerOpenId) {
  const normalizedPlayerId = normalizePlayerId(playerId)
  const command = db && db.command
  if (!command || typeof command.gt !== 'function') {
    throw new Error('player card import receipt keyset query unavailable')
  }

  const list = []
  let lastId = ''
  while (true) {
    const result = await db.collection(COLLECTIONS.playerCardImportReceipts)
      .where({
        ownerOpenId,
        playerId: normalizedPlayerId,
        _id: command.gt(lastId)
      })
      .orderBy('_id', 'asc')
      .limit(PAGE_SIZE)
      .get()
    const batch = result.data || []
    let previousId = lastId
    batch.forEach(doc => {
      const id = String(doc && doc._id || '')
      if (!id || id <= previousId || doc.ownerOpenId !== ownerOpenId || doc.playerId !== normalizedPlayerId) {
        throw new Error('invalid player card import receipt clear page')
      }
      previousId = id
    })
    list.push.apply(list, batch)
    if (batch.length < PAGE_SIZE) break
    lastId = previousId
  }
  return list
}

function cleanCloudDoc(doc) {
  if (Array.isArray(doc)) return doc.map(cleanCloudDoc)
  if (!doc || typeof doc !== 'object') return doc
  return Object.keys(doc).reduce((next, key) => {
    if (key !== 'ownerOpenId' && key !== '_openid' && !HAND_REVISION_INTERNAL_FIELDS.has(key)) {
      next[key] = cleanCloudDoc(doc[key])
    }
    return next
  }, {})
}

function stripMutationServerFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const next = Object.assign({}, value)
  MUTATION_SERVER_FIELDS.forEach(field => { delete next[field] })
  return next
}

async function removeHandActionIdempotently(docId) {
  try {
    await removeDocById(COLLECTIONS.handActions, docId)
    return true
  } catch (error) {
    const code = String(error && (error.errCode || error.code) || '')
    const message = String(error && (error.errMsg || error.message || error) || '')
    if (code === 'DATABASE_DOCUMENT_NOT_EXIST' || /document.*not.*exist|not found/i.test(message)) return true
    throw error
  }
}

async function getDocByPointRead(store, collectionName, docId) {
  try {
    const result = await store.collection(collectionName).doc(docId).get()
    return result.data || null
  } catch (error) {
    if (isMissingDocumentError(error)) return null
    throw error
  }
}

function getAccountLifecycleDocumentId(ownerOpenId, playerId) {
  return 'pdl_' + crypto.createHash('sha256')
    .update(JSON.stringify([String(ownerOpenId || ''), normalizePlayerId(playerId)]))
    .digest('hex')
}

function accountLifecycleError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function normalizeAccountLifecycle(doc, ownerOpenId, playerId) {
  if (!doc) return null
  const generation = Number(doc.generation)
  if (String(doc.ownerOpenId || '') !== ownerOpenId || normalizePlayerId(doc.playerId) !== playerId ||
    !Number.isSafeInteger(generation) || generation < 0 || !['active', 'clearing'].includes(doc.state)) {
    throw accountLifecycleError('ACCOUNT_LIFECYCLE_INVALID', 'account lifecycle invalid')
  }
  return Object.assign({}, doc, { generation })
}

async function captureAccountLifecycle(ownerOpenId, rawPlayerId) {
  const playerId = normalizePlayerId(rawPlayerId)
  const owner = String(ownerOpenId || '')
  if (!owner || !playerId) throw accountLifecycleError('ACCOUNT_LIFECYCLE_INVALID', 'account lifecycle identity invalid')
  const docId = getAccountLifecycleDocumentId(owner, playerId)
  return db.runTransaction(async transaction => {
    let current = normalizeAccountLifecycle(
      await getDocByPointRead(transaction, COLLECTIONS.accountLifecycle, docId), owner, playerId
    )
    if (!current) {
      current = { ownerOpenId: owner, playerId, state: 'active', generation: 0, updatedAt: now() }
      await transaction.collection(COLLECTIONS.accountLifecycle).doc(docId).set({ data: current })
    }
    if (current.state !== 'active') throw accountLifecycleError('ACCOUNT_DATA_NOT_ACTIVE', 'account data is clearing')
    return Object.freeze({ docId, ownerOpenId: owner, playerId, generation: current.generation })
  })
}

async function runFencedBusinessTransaction(fence, callback) {
  if (!fence || typeof callback !== 'function') throw accountLifecycleError('ACCOUNT_LIFECYCLE_INVALID', 'account lifecycle fence invalid')
  return db.runTransaction(async transaction => {
    const requestFences = currentBusinessFences()
    await assertBusinessFenceInTransaction(transaction, requestFences.length ? requestFences : fence)
    return callback(transaction)
  })
}

async function assertBusinessFenceInTransaction(transaction, explicitFence) {
  const fences = explicitFence
    ? (Array.isArray(explicitFence) ? explicitFence : [explicitFence])
    : currentBusinessFences()
  if (!fences.length) throw accountLifecycleError('ACCOUNT_LIFECYCLE_INVALID', 'business transaction requires account lifecycle fence')
  for (const fence of fences) {
    const current = normalizeAccountLifecycle(
      await getDocByPointRead(transaction, COLLECTIONS.accountLifecycle, fence.docId),
      String(fence.ownerOpenId || ''), normalizePlayerId(fence.playerId)
    )
    if (!current || current.state !== 'active') throw accountLifecycleError('ACCOUNT_DATA_NOT_ACTIVE', 'account data is clearing')
    if (current.generation !== fence.generation) {
      throw accountLifecycleError('ACCOUNT_DATA_GENERATION_CHANGED', 'account data generation changed')
    }
  }
  return fences[0]
}

function currentBusinessFence() {
  const context = businessFenceStorage.getStore()
  return context && context.primary || context || null
}

function currentBusinessFences() {
  const context = businessFenceStorage.getStore()
  if (!context) return []
  if (Array.isArray(context.fences)) return context.fences.slice()
  return [context]
}

function runWithBusinessFence(fence, callback) {
  if (!fence || typeof callback !== 'function') throw accountLifecycleError('ACCOUNT_LIFECYCLE_INVALID', 'account lifecycle context invalid')
  return businessFenceStorage.run({ primary: fence, fences: [fence] }, callback)
}

async function addBusinessFence(ownerOpenId, rawPlayerId) {
  const context = businessFenceStorage.getStore()
  if (!context || !context.primary || !Array.isArray(context.fences)) {
    throw accountLifecycleError('ACCOUNT_LIFECYCLE_INVALID', 'additional account lifecycle fence requires request context')
  }
  const playerId = normalizePlayerId(rawPlayerId)
  const existing = context.fences.find(item => item.ownerOpenId === ownerOpenId && item.playerId === playerId)
  if (existing) return existing
  const fence = await captureAccountLifecycle(ownerOpenId, playerId)
  context.fences.push(fence)
  return fence
}

async function assertCurrentBusinessFences() {
  return db.runTransaction(transaction => assertBusinessFenceInTransaction(transaction))
}

function businessWritePlayerId(action, event, ownerOpenId) {
  if (action === 'login_account') return createOpenIdPlayerId(ownerOpenId)
  const playerId = normalizePlayerId(event && (event.playerId || event.profile && event.profile.playerId ||
    event.backup && event.backup.profile && event.backup.profile.playerId))
  if (action === 'sync_stats' && !playerId) return createOpenIdPlayerId(ownerOpenId)
  return playerId
}

async function beginAccountClear(ownerOpenId, rawPlayerId, clientMutationId) {
  const owner = String(ownerOpenId || '')
  const playerId = normalizePlayerId(rawPlayerId)
  const mutationId = String(clientMutationId || '')
  if (!owner || !playerId || !mutationId) throw accountLifecycleError('ACCOUNT_LIFECYCLE_INVALID', 'account clear identity invalid')
  const docId = getAccountLifecycleDocumentId(owner, playerId)
  return db.runTransaction(async transaction => {
    const current = normalizeAccountLifecycle(
      await getDocByPointRead(transaction, COLLECTIONS.accountLifecycle, docId), owner, playerId
    )
    if (current && current.state === 'clearing') {
      if (current.clearMutationId !== mutationId) throw accountLifecycleError('ACCOUNT_CLEAR_IN_PROGRESS', 'account clear in progress')
      return Object.freeze({ docId, ownerOpenId: owner, playerId, generation: current.generation, clearMutationId: mutationId, completed: false })
    }
    if (current && current.lastClearMutationId === mutationId && current.lastClearCompleted === true) {
      return Object.freeze({ docId, ownerOpenId: owner, playerId, generation: current.generation, clearMutationId: mutationId, completed: true })
    }
    const generation = (current ? current.generation : 0) + 1
    const clearing = {
      ownerOpenId: owner, playerId, state: 'clearing', generation,
      clearMutationId: mutationId, clearStartedAt: now(), updatedAt: now()
    }
    await transaction.collection(COLLECTIONS.accountLifecycle).doc(docId).set({ data: clearing })
    return Object.freeze({ docId, ownerOpenId: owner, playerId, generation, clearMutationId: mutationId, completed: false })
  })
}

async function completeAccountClear(clearFence) {
  if (!clearFence) throw accountLifecycleError('ACCOUNT_LIFECYCLE_INVALID', 'account clear fence invalid')
  return db.runTransaction(async transaction => {
    const current = normalizeAccountLifecycle(
      await getDocByPointRead(transaction, COLLECTIONS.accountLifecycle, clearFence.docId),
      String(clearFence.ownerOpenId || ''), normalizePlayerId(clearFence.playerId)
    )
    if (current && current.state === 'active' && current.generation === clearFence.generation &&
      current.lastClearMutationId === clearFence.clearMutationId && current.lastClearCompleted === true) return current
    if (!current || current.state !== 'clearing' || current.generation !== clearFence.generation ||
      current.clearMutationId !== clearFence.clearMutationId) {
      throw accountLifecycleError('ACCOUNT_CLEAR_CHANGED', 'account clear changed')
    }
    const active = {
      ownerOpenId: clearFence.ownerOpenId,
      playerId: clearFence.playerId,
      state: 'active',
      generation: clearFence.generation,
      lastClearMutationId: clearFence.clearMutationId,
      lastClearCompleted: true,
      clearCompletedAt: now(),
      updatedAt: now()
    }
    await transaction.collection(COLLECTIONS.accountLifecycle).doc(clearFence.docId).set({ data: active })
    return active
  })
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
  if (action === 'send_ai_reminder_subscribe') {
    const token = getAuthorizationToken(event)
    const ownerOpenId = String(event && event.ownerOpenId || AGENT_EXPORT_OWNER_OPENID || '').trim()
    if (!AGENT_EXPORT_TOKEN || !ownerOpenId) {
      return { error: { code: 'EXTERNAL_ACTION_NOT_CONFIGURED', message: 'missing AGENT_EXPORT_TOKEN or ownerOpenId' } }
    }
    if (!token || token !== AGENT_EXPORT_TOKEN) {
      return { error: { code: 'EXTERNAL_ACTION_UNAUTHORIZED', message: 'invalid action token' } }
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

function getSyncOperationDocumentId(ownerOpenId, clientMutationId) {
  return 'sync_' + crypto.createHash('sha256').update(String(ownerOpenId || '') + ':' + String(clientMutationId || '')).digest('hex')
}

function getLegacySyncOperationDocumentId(ownerOpenId, clientMutationId) {
  return 'sync_' + String(ownerOpenId || '') + '_' + String(clientMutationId || '').replace(/[^0-9A-Za-z_-]/g, '_')
}

function canonicalizeMutationValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeMutationValue)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce((next, key) => {
    next[key] = canonicalizeMutationValue(value[key])
    return next
  }, {})
}

function createMutationInputFingerprint(ownerOpenId, playerId, action, event) {
  return crypto.createHash('sha256').update(JSON.stringify([
    String(ownerOpenId || ''), normalizePlayerId(playerId), String(action || ''), canonicalizeMutationValue(event || {})
  ])).digest('hex')
}

async function getSyncOperation(ownerOpenId, clientMutationId) {
  if (!clientMutationId) return null
  const docId = getSyncOperationDocumentId(ownerOpenId, clientMutationId)
  const current = await getDocById(COLLECTIONS.syncOperations, docId)
  if (current) return current
  return getDocById(COLLECTIONS.syncOperations, getLegacySyncOperationDocumentId(ownerOpenId, clientMutationId))
}

const MUTATION_LEASE_MS = 30_000
const MUTATION_RECOVERY_RESUME = Symbol('mutation-recovery-resume')

function syncOperationMatches(existing, ownerOpenId, playerId, clientMutationId, action, inputFingerprint) {
  return !!existing && String(existing.ownerOpenId || '') === ownerOpenId && existing.action === action &&
    normalizePlayerId(existing.playerId) === playerId && String(existing.clientMutationId || '') === clientMutationId &&
    (!existing.inputFingerprint || String(existing.inputFingerprint) === inputFingerprint)
}

async function claimSyncOperation(ownerOpenId, playerId, clientMutationId, action, inputFingerprint) {
  const docId = getSyncOperationDocumentId(ownerOpenId, clientMutationId)
  const attemptId = crypto.randomBytes(18).toString('hex')
  const at = now()
  let outcome = null
  await db.runTransaction(async transaction => {
    if (action !== 'clear_all_data') await assertBusinessFenceInTransaction(transaction)
    const existing = await getDocByPointRead(transaction, COLLECTIONS.syncOperations, docId)
    if (existing && !syncOperationMatches(existing, ownerOpenId, playerId, clientMutationId, action, inputFingerprint)) {
      outcome = { kind: 'conflict', clearMode: action === 'clear_all_data' }
      return
    }
    if (existing && existing.result && existing.status === 'applied') {
      outcome = { kind: 'repair', docId, attemptId: existing.attemptId, result: existing.result, clearMode: action === 'clear_all_data' }
      return
    }
    if (existing && existing.result && existing.status !== 'pending') {
      outcome = { kind: 'restore', result: existing.result, clearMode: action === 'clear_all_data' }
      return
    }
    if (existing && existing.status === 'pending' && Number(existing.leaseExpiresAt) > at) {
      outcome = { kind: 'in_progress', clearMode: action === 'clear_all_data' }
      return
    }
    if (existing && existing.status === 'pending' && existing.recoveryEvidence) {
      const recovering = Object.assign({}, existing, {
        leaseExpiresAt: at + MUTATION_LEASE_MS,
        updatedAt: at
      })
      await transaction.collection(COLLECTIONS.syncOperations).doc(docId).set({ data: omitId(recovering) })
      outcome = {
        kind: 'execute',
        docId,
        attemptId: existing.attemptId,
        recovering: true,
        recoveryEvidence: existing.recoveryEvidence,
        clearMode: action === 'clear_all_data'
      }
      return
    }
    const pending = {
      ownerOpenId,
      playerId,
      clientMutationId,
      action,
      inputFingerprint,
      status: 'pending',
      attemptId,
      leaseExpiresAt: at + MUTATION_LEASE_MS,
      createdAt: Number(existing && existing.createdAt) || at,
      updatedAt: at
    }
    if (existing && existing.recoveryEvidence) pending.recoveryEvidence = existing.recoveryEvidence
    await transaction.collection(COLLECTIONS.syncOperations).doc(docId).set({ data: pending })
    outcome = {
      kind: 'execute',
      docId,
      attemptId,
      recovering: !!(existing && existing.status === 'pending'),
      recoveryEvidence: pending.recoveryEvidence || null,
      clearMode: action === 'clear_all_data'
    }
  })
  return outcome
}

async function releaseSyncOperationClaim(claim) {
  await db.runTransaction(async transaction => {
    if (!claim.clearMode) await assertBusinessFenceInTransaction(transaction)
    const current = await getDocByPointRead(transaction, COLLECTIONS.syncOperations, claim.docId)
    if (current && current.status === 'pending' && current.attemptId === claim.attemptId) {
      await transaction.collection(COLLECTIONS.syncOperations).doc(claim.docId).remove()
    }
  })
}

async function renewSyncOperationClaim(claim) {
  let renewed = false
  await db.runTransaction(async transaction => {
    if (!claim.clearMode) await assertBusinessFenceInTransaction(transaction)
    const current = await getDocByPointRead(transaction, COLLECTIONS.syncOperations, claim.docId)
    if (current && current.status === 'pending' && current.attemptId === claim.attemptId) {
      await transaction.collection(COLLECTIONS.syncOperations).doc(claim.docId).set({
        data: omitId(Object.assign({}, current, { leaseExpiresAt: now() + MUTATION_LEASE_MS, updatedAt: now() }))
      })
      renewed = true
    }
  })
  return renewed
}

function startSyncOperationHeartbeat(claim) {
  let stopped = false
  let inFlight = Promise.resolve(true)
  const fenceContext = businessFenceStorage.getStore() || null
  const tick = () => {
    if (stopped) return inFlight
    inFlight = inFlight.catch(() => false).then(() => {
      return fenceContext
        ? businessFenceStorage.run(fenceContext, () => renewSyncOperationClaim(claim))
        : renewSyncOperationClaim(claim)
    }).catch(() => false)
    return inFlight
  }
  const timer = setInterval(tick, Math.max(1000, Math.floor(MUTATION_LEASE_MS / 3)))
  if (timer && typeof timer.unref === 'function') timer.unref()
  return async () => {
    stopped = true
    clearInterval(timer)
    await inFlight.catch(() => false)
  }
}

function sameMutationResult(left, right) {
  return JSON.stringify(canonicalizeMutationValue(left)) === JSON.stringify(canonicalizeMutationValue(right))
}

function sameMutationDocument(left, right) {
  const withoutCloudOwnerAlias = value => {
    const next = Object.assign({}, value || {})
    delete next._openid
    return next
  }
  return sameMutationResult(withoutCloudOwnerAlias(left), withoutCloudOwnerAlias(right))
}

async function stageSyncOperationResultOnce(claim, result) {
  await db.runTransaction(async transaction => {
    if (!claim.clearMode) await assertBusinessFenceInTransaction(transaction)
    const current = await getDocByPointRead(transaction, COLLECTIONS.syncOperations, claim.docId)
    if (current && current.status === 'applied' && current.attemptId === claim.attemptId && sameMutationResult(current.result, result)) {
      return
    }
    if (!current || current.status !== 'pending' || current.attemptId !== claim.attemptId) {
      throw new Error('mutation claim changed')
    }
    const applied = Object.assign({}, current, {
      status: 'applied',
      result,
      leaseExpiresAt: 0,
      updatedAt: now()
    })
    await transaction.collection(COLLECTIONS.syncOperations).doc(claim.docId).set({ data: omitId(applied) })
  })
}

async function stageSyncOperationResult(claim, result) {
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await stageSyncOperationResultOnce(claim, result)
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('mutation result checkpoint failed')
}

async function completeSyncOperationClaim(claim) {
  await db.runTransaction(async transaction => {
    if (!claim.clearMode) await assertBusinessFenceInTransaction(transaction)
    const current = await getDocByPointRead(transaction, COLLECTIONS.syncOperations, claim.docId)
    if (!current || current.status !== 'applied' || current.attemptId !== claim.attemptId || !current.result) {
      throw new Error('mutation claim changed')
    }
    const completed = Object.assign({}, current, {
      status: 'completed',
      leaseExpiresAt: 0,
      updatedAt: now()
    })
    await transaction.collection(COLLECTIONS.syncOperations).doc(claim.docId).set({ data: omitId(completed) })
  })
}

async function writeAuditLog(ownerOpenId, playerId, action, targetId, before, after, clientMutationId) {
  const record = {
    ownerOpenId,
    playerId,
    action,
    targetId,
    before: before || null,
    after: after || null,
    clientMutationId: clientMutationId || '',
    createdAt: now()
  }
  if (clientMutationId) {
    const id = createMutationEntityId('audit', ownerOpenId, playerId, action + ':' + String(targetId || ''), clientMutationId)
    let lastError = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await setDocById(COLLECTIONS.auditLogs, id, Object.assign({ _id: id }, record))
        return
      } catch (error) {
        lastError = error
      }
    }
    if (lastError) lastError.keepMutationClaim = true
    throw lastError || new Error('audit log write failed')
  }
  await addDoc(COLLECTIONS.auditLogs, record)
}

async function persistMutationRecoveryEvidence(claim, evidence) {
  const docId = claim && claim.docId
  if (!docId || !claim.attemptId) throw new Error('missing active mutation claim')
  await db.runTransaction(async transaction => {
    if (!claim.clearMode) await assertBusinessFenceInTransaction(transaction)
    const current = await getDocByPointRead(transaction, COLLECTIONS.syncOperations, docId)
    if (!current || current.status !== 'pending' ||
      current.attemptId !== claim.attemptId ||
      String(current.ownerOpenId || '') !== evidence.ownerOpenId ||
      normalizePlayerId(current.playerId) !== normalizePlayerId(evidence.playerId) ||
      String(current.clientMutationId || '') !== evidence.clientMutationId) {
      throw new Error('mutation claim changed before recovery evidence')
    }
    const next = Object.assign({}, current, {
      recoveryEvidence: canonicalizeMutationValue(evidence),
      updatedAt: now()
    })
    await transaction.collection(COLLECTIONS.syncOperations).doc(docId).set({ data: omitId(next) })
  })
}

async function getMutationAuditLog(ownerOpenId, playerId, action, targetId, clientMutationId) {
  if (!clientMutationId) return null
  const id = createMutationEntityId('audit', ownerOpenId, playerId, action + ':' + String(targetId || ''), clientMutationId)
  const audit = await getDocById(COLLECTIONS.auditLogs, id)
  const auditMatches = audit && String(audit.ownerOpenId || audit._openid || '') === ownerOpenId &&
    normalizePlayerId(audit.playerId) === playerId && audit.action === action &&
    String(audit.targetId || '') === String(targetId || '') && String(audit.clientMutationId || '') === clientMutationId
  const operation = await getDocById(COLLECTIONS.syncOperations, getSyncOperationDocumentId(ownerOpenId, clientMutationId))
  const evidence = operation && operation.recoveryEvidence
  const evidenceMatches = evidence && String(evidence.ownerOpenId || '') === ownerOpenId &&
    normalizePlayerId(evidence.playerId) === playerId && evidence.auditAction === action &&
    String(evidence.targetId || '') === String(targetId || '') && String(evidence.clientMutationId || '') === clientMutationId
  if (auditMatches) {
    if (!evidence) return audit
    if (!evidenceMatches) return null
    return Object.assign({}, audit, {
      bankrollLog: evidence.bankrollLog || null,
      recoveryRevision: String(evidence.recoveryRevision || ''),
      attemptId: String(evidence.attemptId || '')
    })
  }
  if (!evidenceMatches) return null
  return {
    ownerOpenId,
    playerId,
    action,
    targetId,
    before: evidence.before || null,
    after: evidence.after || null,
    bankrollLog: evidence.bankrollLog || null,
    clientMutationId,
    recoveryRevision: String(evidence.recoveryRevision || ''),
    attemptId: String(evidence.attemptId || ''),
    _recoveryEvidence: true
  }
}

function isOwnedMutationDocument(doc, ownerOpenId, playerId) {
  return !!doc && normalizePlayerId(doc.playerId) === playerId &&
    String(doc.ownerOpenId || doc._openid || '') === ownerOpenId
}

async function repairMutationAuditLog(audit) {
  if (!audit || !audit._recoveryEvidence) return
  await writeAuditLog(
    audit.ownerOpenId,
    audit.playerId,
    audit.action,
    audit.targetId,
    audit.before,
    audit.after,
    audit.clientMutationId
  )
}

async function recoverAuditedDocument(ownerOpenId, playerId, action, targetId, clientMutationId, collectionName) {
  const audit = await getMutationAuditLog(ownerOpenId, playerId, action, targetId, clientMutationId)
  if (!audit || !audit.after) return null
  const current = await getDocById(collectionName, targetId)
  if (!current && audit._recoveryEvidence && !audit.before) return MUTATION_RECOVERY_RESUME
  if (!isOwnedMutationDocument(current, ownerOpenId, playerId)) return null
  if (audit._recoveryEvidence && collectionName === COLLECTIONS.hands && String(current.actionRevisionPending || '')) {
    return String(current.actionRevisionPending) === String(audit.recoveryRevision || '')
      ? MUTATION_RECOVERY_RESUME
      : null
  }
  if (audit._recoveryEvidence && (String(current.lastClientMutationId || '') !== clientMutationId ||
    String(current.lastMutationAttemptId || '') !== String(audit.attemptId || ''))) {
    return sameMutationResult(current, audit.before) ? MUTATION_RECOVERY_RESUME : null
  }
  return audit
}

async function recoverSessionMutation(ownerOpenId, playerId, action, sessionId, clientMutationId) {
  const audit = await recoverAuditedDocument(
    ownerOpenId, playerId, action, sessionId, clientMutationId, COLLECTIONS.sessions
  )
  if (audit === MUTATION_RECOVERY_RESUME) return audit
  if (!audit) return null
  const result = { session: cleanCloudDoc(audit.after) }
  if (action === 'finish_session') {
    const bankrollId = createMutationEntityId('bankroll', ownerOpenId, playerId, 'finish_session', clientMutationId)
    const expectedBankrollLog = audit.bankrollLog
    let bankrollLog = await getDocById(COLLECTIONS.bankrollLogs, bankrollId)
    if (expectedBankrollLog) {
      const expectedIsValid = isOwnedMutationDocument(expectedBankrollLog, ownerOpenId, playerId) &&
        String(expectedBankrollLog._id || '') === bankrollId &&
        String(expectedBankrollLog.sessionId || '') === sessionId &&
        String(expectedBankrollLog.lastClientMutationId || '') === clientMutationId &&
        String(expectedBankrollLog.lastMutationAttemptId || '') === String(audit.attemptId || '')
      if (!expectedIsValid) return MUTATION_RECOVERY_RESUME
      const currentMatches = isOwnedMutationDocument(bankrollLog, ownerOpenId, playerId) &&
        String(bankrollLog.lastClientMutationId || '') === clientMutationId &&
        String(bankrollLog.lastMutationAttemptId || '') === String(audit.attemptId || '') &&
        sameMutationDocument(bankrollLog, expectedBankrollLog)
      if (!currentMatches) {
        if (bankrollLog && !isOwnedMutationDocument(bankrollLog, ownerOpenId, playerId)) return MUTATION_RECOVERY_RESUME
        await setDocById(COLLECTIONS.bankrollLogs, bankrollId, expectedBankrollLog)
        bankrollLog = await getDocById(COLLECTIONS.bankrollLogs, bankrollId)
      }
      const repairedMatches = isOwnedMutationDocument(bankrollLog, ownerOpenId, playerId) &&
        String(bankrollLog.lastClientMutationId || '') === clientMutationId &&
        String(bankrollLog.lastMutationAttemptId || '') === String(audit.attemptId || '') &&
        sameMutationDocument(bankrollLog, expectedBankrollLog)
      if (!repairedMatches) return MUTATION_RECOVERY_RESUME
    } else if (audit._recoveryEvidence) {
      return MUTATION_RECOVERY_RESUME
    } else if (!isOwnedMutationDocument(bankrollLog, ownerOpenId, playerId)) {
      return null
    }
    result.bankrollLog = cleanCloudDoc(bankrollLog)
  }
  await repairMutationAuditLog(audit)
  return result
}

async function recoverHandMutation(ownerOpenId, playerId, action, handId, clientMutationId, includeActions) {
  const audit = await recoverAuditedDocument(
    ownerOpenId, playerId, action, handId, clientMutationId, COLLECTIONS.hands
  )
  if (audit === MUTATION_RECOVERY_RESUME) return audit
  if (!audit) return null
  let actions = []
  if (includeActions) {
    const revision = String(audit.after.actionRevision || '')
    const stored = await fetchWhere(COLLECTIONS.handActions, { playerId, ownerOpenId, handId })
    actions = stored
      .filter(row => !revision || String(row.actionRevision || '') === revision)
      .sort((left, right) => Number(left.sequence) - Number(right.sequence))
      .map(cleanCloudDoc)
  }
  const result = { hand: cleanCloudDoc(audit.after), actions }
  const sessionIds = [audit.before && audit.before.sessionId, audit.after.sessionId]
    .filter((value, index, list) => value && list.indexOf(value) === index)
  const sessions = []
  for (const sessionId of sessionIds) {
    const session = await refreshSessionRecordedStatsCloud(playerId, ownerOpenId, sessionId)
    if (session) sessions.push(session)
  }
  if (action === 'update_hand') result.sessions = sessions
  else result.session = sessions.find(session => session._id === audit.after.sessionId) || null
  await repairMutationAuditLog(audit)
  return result
}

async function recoverPlayerNoteMutation(ownerOpenId, playerId, action, noteId, clientMutationId) {
  const audit = await recoverAuditedDocument(
    ownerOpenId, playerId, action, noteId, clientMutationId, COLLECTIONS.playerNotes
  )
  if (audit === MUTATION_RECOVERY_RESUME) return audit
  if (!audit) return null
  await repairMutationAuditLog(audit)
  return {
    playerNote: cleanCloudDoc(audit.after),
    deleted: action === 'delete_player_note',
    noteId
  }
}

async function runMutation(event, ownerOpenId, action, handler, recover) {
  const playerId = normalizePlayerId(event.playerId || event.profile && event.profile.playerId)
  if (!playerId) {
    return { code: 'MISSING_PLAYER_ID', message: 'missing playerId' }
  }
  const clientMutationId = getClientMutationId(event)
  if (!clientMutationId) {
    return { code: 'MISSING_CLIENT_MUTATION_ID', message: 'missing clientMutationId' }
  }
  if (action !== 'clear_all_data' && !currentBusinessFence()) {
    const fence = await captureAccountLifecycle(ownerOpenId, playerId)
    return runWithBusinessFence(fence, () => runMutation(event, ownerOpenId, action, handler, recover))
  }
  const inputFingerprint = createMutationInputFingerprint(ownerOpenId, playerId, action, event)
  const legacyDocId = getLegacySyncOperationDocumentId(ownerOpenId, clientMutationId)
  const legacy = action === 'clear_all_data'
    ? await getDocById(COLLECTIONS.syncOperations, legacyDocId)
    : await db.runTransaction(async transaction => {
      await assertBusinessFenceInTransaction(transaction)
      return getDocByPointRead(transaction, COLLECTIONS.syncOperations, legacyDocId)
    })
  if (legacy) {
    if (!legacy.result || !syncOperationMatches(legacy, ownerOpenId, playerId, clientMutationId, action, inputFingerprint)) {
      return { code: 'MUTATION_CONFLICT', message: 'clientMutationId conflicts with a different mutation' }
    }
    if (action !== 'clear_all_data') await assertCurrentBusinessFences()
    return { code: 0, data: legacy.result }
  }
  const claim = await claimSyncOperation(ownerOpenId, playerId, clientMutationId, action, inputFingerprint)
  if (claim.kind === 'conflict') {
    return { code: 'MUTATION_CONFLICT', message: 'clientMutationId conflicts with a different mutation' }
  }
  if (claim.kind === 'in_progress') {
    return { code: 'MUTATION_IN_PROGRESS', message: 'mutation in progress' }
  }
  if (claim.kind === 'restore') {
    if (!claim.clearMode) await assertCurrentBusinessFences()
    return { code: 0, data: claim.result }
  }
  if (claim.kind === 'repair') {
    await completeSyncOperationClaim(claim)
    if (!claim.clearMode) await assertCurrentBusinessFences()
    return { code: 0, data: claim.result }
  }
  const stopHeartbeat = startSyncOperationHeartbeat(claim)
  let result
  let recoveryIntentWritten = false
  const writeRecoveryIntent = async evidence => {
    const intent = Object.assign({
      ownerOpenId,
      playerId,
      clientMutationId,
      attemptId: claim.attemptId
    }, evidence || {})
    if (intent.after && typeof intent.after === 'object') {
      intent.after.lastClientMutationId = clientMutationId
      intent.after.lastMutationAttemptId = claim.attemptId
    }
    await persistMutationRecoveryEvidence(claim, intent)
    recoveryIntentWritten = true
  }
  writeRecoveryIntent.attemptId = claim.attemptId
  if (claim.recovering && typeof recover === 'function') {
    try {
      result = await recover(playerId, clientMutationId, claim)
      if (result === MUTATION_RECOVERY_RESUME) {
        if (claim.recoveryEvidence) {
          const error = new Error('mutation recovery evidence is unresolved')
          error.keepMutationClaim = true
          throw error
        }
        result = null
      } else if (result == null && claim.recoveryEvidence) {
        const error = new Error('mutation recovery evidence is unresolved')
        error.keepMutationClaim = true
        throw error
      }
    } catch (error) {
      await stopHeartbeat()
      throw error
    }
  }
  try {
    if (result == null) result = await handler(playerId, clientMutationId, writeRecoveryIntent)
  } catch (error) {
    await stopHeartbeat()
    if (!recoveryIntentWritten && (!error || error.keepMutationClaim !== true)) await releaseSyncOperationClaim(claim)
    throw error
  }
  try {
    const renewed = await renewSyncOperationClaim(claim)
    if (!renewed) throw new Error('mutation claim changed')
    await stageSyncOperationResult(claim, result)
  } finally {
    await stopHeartbeat()
  }
  await completeSyncOperationClaim(claim)
  if (!claim.clearMode) await assertCurrentBusinessFences()
  return { code: 0, data: result }
}

function buildSessionDoc(base, patch) {
  const merged = Object.assign({}, base || {}, stripMutationServerFields(patch || {}))
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
  const safePatch = Object.assign({}, patch || {})
  delete safePatch.actionRevision
  delete safePatch.actionRevisionPending
  delete safePatch.actionCommittedAt
  delete safePatch.handVersion
  MUTATION_SERVER_FIELDS.forEach(field => { delete safePatch[field] })
  const merged = Object.assign({}, base || {}, safePatch)
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
  if (base && base.actionRevision) next.actionRevision = base.actionRevision
  else delete next.actionRevision
  if (base && base.actionRevisionPending) next.actionRevisionPending = base.actionRevisionPending
  else delete next.actionRevisionPending
  if (base && base.actionCommittedAt) next.actionCommittedAt = base.actionCommittedAt
  else delete next.actionCommittedAt
  if (base && base.handVersion) next.handVersion = base.handVersion
  else delete next.handVersion
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
  const docId = getProfileDocId(playerId, ownerOpenId)
  const existing = await getDocById(COLLECTIONS.profiles, docId)
  if (existing && (normalizePlayerId(existing.playerId) !== playerId || String(existing.ownerOpenId || existing._openid || '') !== ownerOpenId)) {
    throw new Error('backup document ownership conflict')
  }
  await setDocById(COLLECTIONS.profiles, docId, withOwnerScope(Object.assign({
    updatedAt: now()
  }, stripMutationServerFields(profile)), playerId, ownerOpenId))
}

async function saveSettings(settings, playerId, ownerOpenId) {
  if (!settings) return
  const docId = getSettingsDocId(playerId, ownerOpenId)
  const existing = await getDocById(COLLECTIONS.userSettings, docId)
  if (existing && (normalizePlayerId(existing.playerId) !== playerId || String(existing.ownerOpenId || existing._openid || '') !== ownerOpenId)) {
    throw new Error('backup document ownership conflict')
  }
  await setDocById(COLLECTIONS.userSettings, docId, withOwnerScope(Object.assign({
    updatedAt: now()
  }, stripMutationServerFields(settings)), playerId, ownerOpenId))
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

async function assertBackupOwnership(backup, playerId, ownerOpenId) {
  const data = backup || {}
  const targets = [
    [COLLECTIONS.sessions, data.sessions],
    [COLLECTIONS.hands, data.hands],
    [COLLECTIONS.playerNotes, data.playerNotes],
    [COLLECTIONS.bankrollLogs, data.bankrollLogs],
    [COLLECTIONS.profiles, data.profile && data.profile._id ? [data.profile] : []],
    [COLLECTIONS.userSettings, data.settings && data.settings._id ? [data.settings] : []]
  ]
  for (const [collectionName, values] of targets) {
    for (const item of Array.isArray(values) ? values : []) {
      const id = String(item && item._id || '').trim()
      if (!id) continue
      const existing = await getDocById(collectionName, id)
      if (existing && (normalizePlayerId(existing.playerId) !== playerId ||
        String(existing.ownerOpenId || existing._openid || '') !== ownerOpenId)) {
        throw new Error('backup document ownership conflict')
      }
      if (collectionName === COLLECTIONS.hands && existing && String(existing.actionRevisionPending || '')) {
        throw handSourceUpdatingError()
      }
    }
  }
}

async function mergeBusinessData(backup, playerId, ownerOpenId) {
  const data = backup || {}
  await assertBackupOwnership(data, playerId, ownerOpenId)
  await saveProfile(data.profile, playerId, ownerOpenId)
  await saveSettings(data.settings, playerId, ownerOpenId)
  await syncMany(COLLECTIONS.sessions, data.sessions, playerId, ownerOpenId, false)
  const actionsByHand = {}
  ;(Array.isArray(data.handActions) ? data.handActions : []).forEach(action => {
    const handId = String(action && action.handId || '')
    if (!handId) return
    if (!actionsByHand[handId]) actionsByHand[handId] = []
    actionsByHand[handId].push(action)
  })
  const handledHands = new Set()
  for (const incoming of Array.isArray(data.hands) ? data.hands : []) {
    if (!incoming || !incoming._id) continue
    const current = await getDocById(COLLECTIONS.hands, incoming._id)
    if (current && (normalizePlayerId(current.playerId) !== playerId || String(current.ownerOpenId || current._openid || '') !== ownerOpenId)) continue
    const merged = mergeUpsertDoc(current, incoming)
    const next = withOwnerScope(Object.assign({}, buildHandDoc(current, merged), { _id: incoming._id }), playerId, ownerOpenId)
    if (Object.prototype.hasOwnProperty.call(actionsByHand, incoming._id)) {
      await writeHandAndActionsRevisioned({
        handId: incoming._id, playerId, ownerOpenId, sessionId: next.sessionId,
        actions: actionsByHand[incoming._id], initialDoc: current || next, finalDoc: next,
        action: 'sync_stats', allowMissing: !current
      })
      handledHands.add(incoming._id)
    } else {
      await writeHandMetadataCloud(incoming._id, playerId, ownerOpenId, current || next, next, !current)
    }
  }
  for (const handId of Object.keys(actionsByHand)) {
    if (handledHands.has(handId)) continue
    const current = await getDocById(COLLECTIONS.hands, handId)
    if (!current || normalizePlayerId(current.playerId) !== playerId || String(current.ownerOpenId || current._openid || '') !== ownerOpenId) continue
    await writeHandAndActionsRevisioned({
      handId, playerId, ownerOpenId, sessionId: current.sessionId,
      actions: actionsByHand[handId], initialDoc: current, finalDoc: current,
      action: 'sync_stats'
    })
  }
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

async function listFencedRecoveryCandidates(ownerOpenId) {
  if (!currentBusinessFence()) return listRecoveryCandidates(ownerOpenId)
  const initialProfiles = await getOwnedProfiles(ownerOpenId)
  const playerIds = Array.from(new Set(initialProfiles.map(inferPlayerIdFromProfile).filter(Boolean)))
  const candidates = []
  for (const playerId of playerIds) {
    await addBusinessFence(ownerOpenId, playerId)
    const freshProfiles = await getOwnedProfiles(ownerOpenId)
    const profile = freshProfiles
      .filter(item => inferPlayerIdFromProfile(item) === playerId)
      .sort((a, b) => normalizeNumeric(b.updatedAt) - normalizeNumeric(a.updatedAt))[0]
    if (!profile) continue
    candidates.push(await buildRecoveryCandidate(playerId, ownerOpenId, profile))
  }
  await assertCurrentBusinessFences()
  return candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return (b.updatedAt || 0) - (a.updatedAt || 0)
  })
}

async function fetchStableOwnedHandData(playerId, ownerOpenId) {
  const before = await fetchOwnedByPlayer(COLLECTIONS.hands, playerId, ownerOpenId)
  if (before.some(hand => String(hand && hand.actionRevisionPending || ''))) throw handSourceUpdatingError()
  const handActions = (await fetchOwnedByPlayer(COLLECTIONS.handActions, playerId, ownerOpenId)).filter(action => {
    return normalizePlayerId(action && action.playerId) === normalizePlayerId(playerId) &&
      String(action && (action.ownerOpenId || action._openid) || '') === String(ownerOpenId || '')
  })
  const after = await fetchOwnedByPlayer(COLLECTIONS.hands, playerId, ownerOpenId)
  const beforeEvidence = before.map(handExportEvidence).sort()
  const afterEvidence = after.map(handExportEvidence).sort()
  if (JSON.stringify(beforeEvidence) !== JSON.stringify(afterEvidence) || after.some(hand => String(hand && hand.actionRevisionPending || ''))) {
    throw handSourceUpdatingError()
  }
  const revisions = new Map(after.map(hand => [String(hand._id || ''), String(hand.actionRevision || '')]))
  const consistent = handActions.every(action => {
    const handId = String(action.handId || '')
    if (!revisions.has(handId)) return false
    const revision = revisions.get(handId)
    return revision ? String(action.actionRevision || '') === revision : !String(action.actionRevision || '')
  })
  if (!consistent) throw handSourceUpdatingError()
  return { hands: after, handActions }
}

function handExportEvidence(hand) {
  return JSON.stringify([
    String(hand && hand._id || ''), String(hand && (hand.ownerOpenId || hand._openid) || ''),
    normalizePlayerId(hand && hand.playerId), String(hand && hand.sessionId || ''),
    Number(hand && hand.updatedAt) || 0, String(hand && hand.actionRevision || ''), String(hand && hand.actionRevisionPending || '')
  ])
}

function handSourceUpdatingError() {
  const error = new Error('hand source updating')
  error.code = 'HAND_SOURCE_UPDATING'
  return error
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
  const stableHandData = await fetchStableOwnedHandData(normalizedPlayerId, ownerOpenId)

  return {
    profile: Object.assign({}, cleanCloudDoc(profile), { playerId: normalizedPlayerId }),
    settings: cleanCloudDoc(settings),
    sessions: (await fetchOwnedByPlayer(COLLECTIONS.sessions, normalizedPlayerId, ownerOpenId)).map(cleanCloudDoc),
    hands: stableHandData.hands.map(cleanCloudDoc),
    handActions: stableHandData.handActions.map(cleanCloudDoc),
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
  const accountPlayerId = createOpenIdPlayerId(ownerOpenId)
  const targetFence = currentBusinessFence()
  const allowLegacyRecovery = !!targetFence && targetFence.playerId === accountPlayerId && targetFence.generation === 0
  const candidates = allowLegacyRecovery ? await listFencedRecoveryCandidates(ownerOpenId) : []
  const bestWithData = candidates.find(item => item.playerId !== accountPlayerId &&
    (item.sessionCount > 0 || item.handCount > 0 || item.bankrollLogCount > 0))
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

  await assertCurrentBusinessFences()

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
  let rawItems = await fetchPage(collectionName, filters, offset, limit)
  let sourceUpdating = false
  if (collection === 'hands' && rawItems.some(hand => String(hand && hand.actionRevisionPending || ''))) {
    sourceUpdating = true
  }
  if (collection === 'handActions') {
    const handIds = Array.from(new Set(rawItems.map(action => String(action && action.handId || '')).filter(Boolean)))
    const hands = new Map()
    for (const handId of handIds) hands.set(handId, await getDocById(COLLECTIONS.hands, handId))
    const consistent = rawItems.every(action => {
      const hand = hands.get(String(action.handId || ''))
      if (!hand || normalizePlayerId(hand.playerId) !== playerId || String(hand.ownerOpenId || hand._openid || '') !== ownerOpenId ||
        String(hand.actionRevisionPending || '')) return false
      const revision = String(hand.actionRevision || '')
      return revision ? String(action.actionRevision || '') === revision : !String(action.actionRevision || '')
    })
    if (!consistent) sourceUpdating = true
  }
  if (sourceUpdating) return { code: 'HAND_SOURCE_UPDATING', message: 'hand source updating' }
  const items = rawItems.map(cleanCloudDoc)
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
  const targetFence = currentBusinessFence()
  const allowLegacyRecovery = !!targetFence && targetFence.playerId === playerId && targetFence.generation === 0

  if (hasMeaningfulBackup(event.backup)) {
    await mergeBusinessData(event.backup || {}, playerId, ownerOpenId)
  }

  async function loadStatsHands(targetPlayerId) {
    const stable = await fetchStableOwnedHandData(targetPlayerId, ownerOpenId)
    return stable.hands.map(cleanCloudDoc)
  }

  let sessions = (await fetchOwnedByPlayer(COLLECTIONS.sessions, playerId, ownerOpenId)).map(cleanCloudDoc)
  let hands = await loadStatsHands(playerId)

  const shouldResolveCandidate = !hasMeaningfulBackup(event.backup) && sessions.length < 5 && hands.length < 20

  if (allowLegacyRecovery && shouldResolveCandidate) {
    const openIdPlayerId = createOpenIdPlayerId(ownerOpenId)
    if (playerId !== openIdPlayerId) {
      await addBusinessFence(ownerOpenId, openIdPlayerId)
      const openIdSessions = (await fetchOwnedByPlayer(COLLECTIONS.sessions, openIdPlayerId, ownerOpenId)).map(cleanCloudDoc)
      const openIdHands = await loadStatsHands(openIdPlayerId)
      if (openIdSessions.length * 1000 + openIdHands.length * 10 > sessions.length * 1000 + hands.length * 10) {
        playerId = openIdPlayerId
        sessions = openIdSessions
        hands = openIdHands
      }
    }
  }

  if (allowLegacyRecovery && !hasMeaningfulBackup(event.backup) && sessions.length < 5 && hands.length < 20) {
    recoveryCandidates = recoveryCandidates || await listFencedRecoveryCandidates(ownerOpenId)
    const requestedCandidate = recoveryCandidates.find(item => item.playerId === playerId)
    const requestedScore = requestedCandidate
      ? requestedCandidate.score
      : sessions.length * 1000 + hands.length * 10
    const bestCandidate = recoveryCandidates[0]
    if (bestCandidate && bestCandidate.playerId !== playerId && bestCandidate.score > requestedScore) {
      await addBusinessFence(ownerOpenId, bestCandidate.playerId)
      playerId = bestCandidate.playerId
      sessions = (await fetchOwnedByPlayer(COLLECTIONS.sessions, playerId, ownerOpenId)).map(cleanCloudDoc)
      hands = await loadStatsHands(playerId)
    }
  }

  const settings = await getSettings(playerId, ownerOpenId, event.backup && event.backup.settings)
  await assertCurrentBusinessFences()

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
  const stableHandData = await fetchStableOwnedHandData(playerId, ownerOpenId)
  const hands = stableHandData.hands.map(cleanCloudDoc)
  const handActions = stableHandData.handActions.map(cleanCloudDoc)
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
  return runMutation(event, ownerOpenId, 'create_session', async (playerId, clientMutationId, writeRecoveryIntent) => {
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
    const requestedId = String(session._id || '').trim()
    const id = clientMutationId
      ? createMutationEntityId('session', ownerOpenId, playerId, 'create_session', clientMutationId)
      : (requestedId || createId('session'))
    const existing = await getDocById(COLLECTIONS.sessions, id)
    if (existing && (normalizePlayerId(existing.playerId) !== playerId || String(existing.ownerOpenId || existing._openid || '') !== ownerOpenId)) {
      return { session: null, rejected: true, reason: 'SESSION_ID_CONFLICT' }
    }
    const doc = withOwnerScope(Object.assign({}, session, {
      _id: id,
      lastClientMutationId: clientMutationId || '',
      lastMutationAttemptId: writeRecoveryIntent.attemptId || ''
    }), playerId, ownerOpenId)
    if (clientMutationId) await writeRecoveryIntent({ auditAction: 'create_session', targetId: id, before: existing || null, after: doc })
    await setDocById(COLLECTIONS.sessions, id, doc)
    await writeAuditLog(ownerOpenId, playerId, 'create_session', id, null, doc, clientMutationId)
    return { session: cleanCloudDoc(Object.assign({}, doc, { _id: id })) }
  }, async (playerId, clientMutationId) => {
    const id = createMutationEntityId('session', ownerOpenId, playerId, 'create_session', clientMutationId)
    return recoverSessionMutation(ownerOpenId, playerId, 'create_session', id, clientMutationId)
  })
}

async function updateSessionAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'update_session', async (playerId, clientMutationId, writeRecoveryIntent) => {
    const sessionId = String(event.sessionId || '').trim()
    const current = await getDocById(COLLECTIONS.sessions, sessionId)
    if (!current || normalizePlayerId(current.playerId) !== playerId || current.ownerOpenId !== ownerOpenId) {
      return { session: null, rejected: true, reason: 'SESSION_NOT_FOUND' }
    }
    const next = withOwnerScope(Object.assign({}, buildSessionDoc(current, event.patch || {}), {
      _id: sessionId,
      lastClientMutationId: clientMutationId || '',
      lastMutationAttemptId: writeRecoveryIntent.attemptId || ''
    }), playerId, ownerOpenId)
    if (clientMutationId) await writeRecoveryIntent({ auditAction: 'update_session', targetId: sessionId, before: current, after: next })
    await setDocById(COLLECTIONS.sessions, sessionId, next)
    await writeAuditLog(ownerOpenId, playerId, 'update_session', sessionId, current, next, clientMutationId)
    return { session: cleanCloudDoc(next) }
  }, async (playerId, clientMutationId) => {
    const sessionId = String(event.sessionId || '').trim()
    return recoverSessionMutation(ownerOpenId, playerId, 'update_session', sessionId, clientMutationId)
  })
}

async function finishSessionAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'finish_session', async (playerId, clientMutationId, writeRecoveryIntent) => {
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
    }), {
      _id: sessionId,
      lastClientMutationId: clientMutationId || '',
      lastMutationAttemptId: writeRecoveryIntent.attemptId || ''
    }), playerId, ownerOpenId)
    const requestedBankrollId = String(payload.bankrollLogId || '').trim()
    const bankrollId = clientMutationId
      ? createMutationEntityId('bankroll', ownerOpenId, playerId, 'finish_session', clientMutationId)
      : (requestedBankrollId || 'bankroll_' + sessionId)
    const existingBankroll = await getDocById(COLLECTIONS.bankrollLogs, bankrollId)
    if (existingBankroll && (normalizePlayerId(existingBankroll.playerId) !== playerId || String(existingBankroll.ownerOpenId || existingBankroll._openid || '') !== ownerOpenId)) {
      return { session: null, bankrollLog: null, rejected: true, reason: 'BANKROLL_LOG_ID_CONFLICT' }
    }
    const bankrollLog = withOwnerScope({
      _id: bankrollId,
      sessionId,
      type: 'session_settlement',
      amount: Number(next.totalProfit) || 0,
      balanceAfter: 0,
      note: (next.title || 'Session') + ' 结算',
      createdAt: now(),
      updatedAt: now(),
      lastClientMutationId: clientMutationId || '',
      lastMutationAttemptId: writeRecoveryIntent.attemptId || ''
    }, playerId, ownerOpenId)
    if (clientMutationId) await writeRecoveryIntent({
      auditAction: 'finish_session', targetId: sessionId, before: current, after: next, bankrollLog
    })
    await setDocById(COLLECTIONS.sessions, sessionId, next)
    await setDocById(COLLECTIONS.bankrollLogs, bankrollId, bankrollLog)
    await writeAuditLog(ownerOpenId, playerId, 'finish_session', sessionId, current, next, clientMutationId)
    return { session: cleanCloudDoc(next), bankrollLog: cleanCloudDoc(bankrollLog) }
  }, async (playerId, clientMutationId) => {
    const sessionId = String(event.sessionId || '').trim()
    return recoverSessionMutation(ownerOpenId, playerId, 'finish_session', sessionId, clientMutationId)
  })
}

async function replaceHandActionsCloud(playerId, ownerOpenId, handId, sessionId, actions, actionRevision) {
  if (!/^[0-9a-f]{64}$/.test(String(actionRevision || ''))) throw new Error('invalid hand action revision')
  const list = Array.isArray(actions) ? actions : []
  const expectedIds = new Set(list.map((action, index) => createHandActionRowId(ownerOpenId, playerId, handId, actionRevision, index + 1)))
  const existing = await fetchWhere(COLLECTIONS.handActions, { playerId, ownerOpenId, handId })
  for (let index = 0; index < existing.length; index += 1) {
    const row = existing[index]
    if (String(row.actionRevision || '') !== actionRevision || !expectedIds.has(String(row._id || ''))) {
      await removeHandActionIdempotently(row._id)
    }
  }
  const nextActions = []
  for (let index = 0; index < list.length; index += 1) {
    const action = list[index] || {}
    const id = createHandActionRowId(ownerOpenId, playerId, handId, actionRevision, index + 1)
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
      createdAt: Number(action.createdAt) || 0,
      updatedAt: Number(action.updatedAt) || 0,
      actionRevision
    }, playerId, ownerOpenId)
    await setDocById(COLLECTIONS.handActions, id, doc)
    nextActions.push(cleanCloudDoc(doc))
  }
  return nextActions
}

async function claimHandActionRevision(handId, playerId, ownerOpenId, revision, initialDoc, allowMissing) {
  return db.runTransaction(async transaction => {
    await assertBusinessFenceInTransaction(transaction)
    const current = await getDocByPointRead(transaction, COLLECTIONS.hands, handId)
    const claimed = prepareHandRevisionClaim(current, initialDoc, revision, playerId, ownerOpenId, allowMissing)
    await transaction.collection(COLLECTIONS.hands).doc(handId).set({ data: omitId(Object.assign({}, claimed, { _id: handId })) })
    return claimed
  })
}

async function finalizeHandActionRevision(handId, playerId, ownerOpenId, revision, finalDoc) {
  return db.runTransaction(async transaction => {
    await assertBusinessFenceInTransaction(transaction)
    const current = await getDocByPointRead(transaction, COLLECTIONS.hands, handId)
    if (!current || normalizePlayerId(current.playerId) !== playerId || String(current.ownerOpenId || current._openid || '') !== ownerOpenId ||
      String(current.actionRevisionPending || '') !== revision) throw new Error('hand action revision changed')
    const committed = withOwnerScope(Object.assign({}, finalDoc, {
      _id: handId,
      actionRevision: revision,
      actionCommittedAt: now(),
      handVersion: Math.max(0, Math.floor(Number(current.handVersion) || 0)) + 1,
      updatedAt: now()
    }), playerId, ownerOpenId)
    delete committed.actionRevisionPending
    await transaction.collection(COLLECTIONS.hands).doc(handId).set({ data: omitId(committed) })
    return committed
  })
}

async function writeHandMetadataCloud(handId, playerId, ownerOpenId, expected, finalDoc, allowMissing) {
  return db.runTransaction(async transaction => {
    await assertBusinessFenceInTransaction(transaction)
    const current = await getDocByPointRead(transaction, COLLECTIONS.hands, handId)
    const next = prepareHandMetadataWrite(current, expected, finalDoc, playerId, ownerOpenId, allowMissing)
    await transaction.collection(COLLECTIONS.hands).doc(handId).set({ data: omitId(Object.assign({}, next, { _id: handId })) })
    return next
  })
}

async function writeHandAndActionsRevisioned(input) {
  const revision = createHandActionRevision(input)
  let committed = null
  const actions = await executeHandActionRevision({
    claimPending: token => claimHandActionRevision(input.handId, input.playerId, input.ownerOpenId, token, input.initialDoc, !!input.allowMissing),
    replaceActions: token => replaceHandActionsCloud(input.playerId, input.ownerOpenId, input.handId, input.sessionId, input.actions, token),
    finalize: async token => { committed = await finalizeHandActionRevision(input.handId, input.playerId, input.ownerOpenId, token, input.finalDoc) }
  }, { revision, actions: input.actions })
  return { hand: committed, actions }
}

async function createHandAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'create_hand', async (playerId, clientMutationId, writeRecoveryIntent) => {
    const payload = event.payload || {}
    const sessionId = String(payload.sessionId || '').trim()
    const targetSession = sessionId ? await getDocById(COLLECTIONS.sessions, sessionId) : null
    const targetOwnerOpenId = String(targetSession && (targetSession.ownerOpenId || targetSession._openid) || '').trim()
    if (!targetSession || normalizePlayerId(targetSession.playerId) !== playerId || targetOwnerOpenId !== ownerOpenId) {
      return { hand: null, rejected: true, reason: 'SESSION_NOT_FOUND' }
    }
    const requestedId = String(payload._id || '').trim()
    const id = requestedId || (clientMutationId
      ? createMutationEntityId('hand', ownerOpenId, playerId, 'create_hand', clientMutationId)
      : createId('hand'))
    const existing = await getDocById(COLLECTIONS.hands, id)
    if (existing && (normalizePlayerId(existing.playerId) !== playerId || String(existing.ownerOpenId || existing._openid || '') !== ownerOpenId)) {
      return { hand: null, rejected: true, reason: 'HAND_ID_CONFLICT' }
    }
    const hand = buildHandDoc(existing, applySessionHandDefaults(payload, targetSession))
    const doc = withOwnerScope(Object.assign({}, hand, {
      _id: id,
      lastClientMutationId: clientMutationId || '',
      lastMutationAttemptId: writeRecoveryIntent.attemptId || ''
    }), playerId, ownerOpenId)
    const recoveryRevision = Object.prototype.hasOwnProperty.call(payload, 'actions')
      ? createHandActionRevision({
          handId: id, playerId, ownerOpenId, actions: payload.actions || [],
          finalDoc: doc, action: 'create_hand', clientMutationId
        })
      : ''
    if (clientMutationId) await writeRecoveryIntent({
      auditAction: 'create_hand', targetId: id, before: existing || null, after: doc, recoveryRevision
    })
    const written = await writeHandAndActionsRevisioned({
      handId: id, playerId, ownerOpenId, sessionId: doc.sessionId,
      actions: payload.actions || [], initialDoc: existing || doc, finalDoc: doc,
      action: 'create_hand', clientMutationId, allowMissing: !existing
    })
    const session = await refreshSessionRecordedStatsCloud(playerId, ownerOpenId, doc.sessionId)
    await writeAuditLog(ownerOpenId, playerId, 'create_hand', id, null, written.hand, clientMutationId)
    return { hand: cleanCloudDoc(written.hand), actions: written.actions, session }
  }, async (playerId, clientMutationId) => {
    const payload = event.payload || {}
    const requestedId = String(payload._id || '').trim()
    const id = requestedId || createMutationEntityId('hand', ownerOpenId, playerId, 'create_hand', clientMutationId)
    return recoverHandMutation(
      ownerOpenId, playerId, 'create_hand', id, clientMutationId,
      Object.prototype.hasOwnProperty.call(payload, 'actions')
    )
  })
}

async function updateHandAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'update_hand', async (playerId, clientMutationId, writeRecoveryIntent) => {
    const handId = String(event.handId || '').trim()
    const current = await getDocById(COLLECTIONS.hands, handId)
    if (!current || normalizePlayerId(current.playerId) !== playerId || current.ownerOpenId !== ownerOpenId) {
      return { hand: null, rejected: true, reason: 'HAND_NOT_FOUND' }
    }
    const patch = event.patch || {}
    const next = withOwnerScope(Object.assign({}, buildHandDoc(current, patch), {
      _id: handId,
      lastClientMutationId: clientMutationId || '',
      lastMutationAttemptId: writeRecoveryIntent.attemptId || ''
    }), playerId, ownerOpenId)
    const recoveryRevision = Object.prototype.hasOwnProperty.call(patch, 'actions')
      ? createHandActionRevision({
          handId, playerId, ownerOpenId, actions: patch.actions || [],
          finalDoc: next, action: 'update_hand', clientMutationId
        })
      : ''
    if (clientMutationId) await writeRecoveryIntent({
      auditAction: 'update_hand', targetId: handId, before: current, after: next, recoveryRevision
    })
    let actions = []
    if (Object.prototype.hasOwnProperty.call(patch, 'actions')) {
      const written = await writeHandAndActionsRevisioned({
        handId, playerId, ownerOpenId, sessionId: next.sessionId,
        actions: patch.actions || [], initialDoc: current, finalDoc: next,
        action: 'update_hand', clientMutationId
      })
      actions = written.actions
      Object.assign(next, written.hand)
    } else {
      Object.assign(next, await writeHandMetadataCloud(handId, playerId, ownerOpenId, current, next, false))
    }
    const sessionIds = [current.sessionId, next.sessionId].filter((item, index, list) => item && list.indexOf(item) === index)
    const sessions = []
    for (let index = 0; index < sessionIds.length; index += 1) {
      const session = await refreshSessionRecordedStatsCloud(playerId, ownerOpenId, sessionIds[index])
      if (session) sessions.push(session)
    }
    await writeAuditLog(ownerOpenId, playerId, 'update_hand', handId, current, next, clientMutationId)
    return { hand: cleanCloudDoc(next), actions, sessions }
  }, async (playerId, clientMutationId) => {
    const handId = String(event.handId || '').trim()
    return recoverHandMutation(
      ownerOpenId, playerId, 'update_hand', handId, clientMutationId,
      Object.prototype.hasOwnProperty.call(event.patch || {}, 'actions')
    )
  })
}

async function upsertHandAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'upsert_hand', async (playerId, clientMutationId, writeRecoveryIntent) => {
    const payload = event.payload || {}
    const handId = String(event.handId || payload._id || '').trim()
    if (!handId) {
      return { hand: null, rejected: true, reason: 'MISSING_HAND_ID' }
    }
    const current = await getDocById(COLLECTIONS.hands, handId)
    if (current && (normalizePlayerId(current.playerId) !== playerId || String(current.ownerOpenId || current._openid || '') !== ownerOpenId)) {
      return { hand: null, rejected: true, reason: 'HAND_ID_CONFLICT' }
    }
    const base = current && normalizePlayerId(current.playerId) === playerId && String(current.ownerOpenId || current._openid || '') === ownerOpenId
      ? current
      : null
    const next = withOwnerScope(Object.assign({}, buildHandDoc(base, payload), {
      _id: handId,
      lastClientMutationId: clientMutationId || '',
      lastMutationAttemptId: writeRecoveryIntent.attemptId || ''
    }), playerId, ownerOpenId)
    const recoveryRevision = Object.prototype.hasOwnProperty.call(payload, 'actions')
      ? createHandActionRevision({
          handId, playerId, ownerOpenId, actions: payload.actions || [],
          finalDoc: next, action: 'upsert_hand', clientMutationId
        })
      : ''
    if (clientMutationId) await writeRecoveryIntent({
      auditAction: 'upsert_hand', targetId: handId, before: base, after: next, recoveryRevision
    })
    let actions = []
    if (Object.prototype.hasOwnProperty.call(payload, 'actions')) {
      const written = await writeHandAndActionsRevisioned({
        handId, playerId, ownerOpenId, sessionId: next.sessionId,
        actions: payload.actions || [], initialDoc: current || next, finalDoc: next,
        action: 'upsert_hand', clientMutationId, allowMissing: !current
      })
      actions = written.actions
      Object.assign(next, written.hand)
    } else {
      Object.assign(next, await writeHandMetadataCloud(handId, playerId, ownerOpenId, current || next, next, !current))
    }
    const session = next.sessionId ? await refreshSessionRecordedStatsCloud(playerId, ownerOpenId, next.sessionId) : null
    await writeAuditLog(ownerOpenId, playerId, 'upsert_hand', handId, base, next, clientMutationId)
    return { hand: cleanCloudDoc(next), actions, session }
  }, async (playerId, clientMutationId) => {
    const payload = event.payload || {}
    const handId = String(event.handId || payload._id || '').trim()
    return recoverHandMutation(
      ownerOpenId, playerId, 'upsert_hand', handId, clientMutationId,
      Object.prototype.hasOwnProperty.call(payload, 'actions')
    )
  })
}

async function deleteHandAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'delete_hand', async (playerId, clientMutationId, writeRecoveryIntent) => {
    const handId = String(event.handId || '').trim()
    const current = await getDocById(COLLECTIONS.hands, handId)
    if (!current || normalizePlayerId(current.playerId) !== playerId || current.ownerOpenId !== ownerOpenId) {
      return { deleted: false, rejected: true, reason: 'HAND_NOT_FOUND' }
    }
    if (clientMutationId) await writeRecoveryIntent({
      auditAction: 'delete_hand', targetId: handId, before: current,
      after: { deleted: true, sessionId: String(current.sessionId || '') }
    })
    const actions = await fetchWhere(COLLECTIONS.handActions, { playerId, ownerOpenId, handId })
    for (let index = 0; index < actions.length; index += 1) {
      await removeDocById(COLLECTIONS.handActions, actions[index]._id)
    }
    await removeDocById(COLLECTIONS.hands, handId)
    const session = await refreshSessionRecordedStatsCloud(playerId, ownerOpenId, current.sessionId)
    await writeAuditLog(ownerOpenId, playerId, 'delete_hand', handId, current, {
      deleted: true,
      sessionId: String(current.sessionId || '')
    }, clientMutationId)
    return { deleted: true, handId, session }
  }, async (playerId, clientMutationId) => {
    const handId = String(event.handId || '').trim()
    const audit = await getMutationAuditLog(ownerOpenId, playerId, 'delete_hand', handId, clientMutationId)
    if (!audit || !audit.after || audit.after.deleted !== true) return null
    const current = await getDocById(COLLECTIONS.hands, handId)
    if (current) {
      if (audit._recoveryEvidence && sameMutationResult(current, audit.before)) return MUTATION_RECOVERY_RESUME
      return null
    }
    const sessionId = String(audit.after.sessionId || audit.before && audit.before.sessionId || '')
    const session = sessionId ? await refreshSessionRecordedStatsCloud(playerId, ownerOpenId, sessionId) : null
    await repairMutationAuditLog(audit)
    return { deleted: true, handId, session }
  })
}

async function deleteSessionAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'delete_session', async (playerId, clientMutationId, writeRecoveryIntent) => {
    const sessionId = String(event.sessionId || '').trim()
    const current = await getDocById(COLLECTIONS.sessions, sessionId)
    if (!current || normalizePlayerId(current.playerId) !== playerId || current.ownerOpenId !== ownerOpenId) {
      return { deleted: false, rejected: true, reason: 'SESSION_NOT_FOUND' }
    }
    const hands = await fetchWhere(COLLECTIONS.hands, { playerId, ownerOpenId, sessionId })
    const handIds = hands.map(item => item._id)
    if (clientMutationId) await writeRecoveryIntent({
      auditAction: 'delete_session', targetId: sessionId, before: current,
      after: { deleted: true, handIds }
    })
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
    await writeAuditLog(ownerOpenId, playerId, 'delete_session', sessionId, current, { deleted: true, handIds }, clientMutationId)
    return { deleted: true, sessionId, handIds }
  }, async (playerId, clientMutationId) => {
    const sessionId = String(event.sessionId || '').trim()
    const audit = await getMutationAuditLog(ownerOpenId, playerId, 'delete_session', sessionId, clientMutationId)
    if (!audit || !audit.after || audit.after.deleted !== true) return null
    const current = await getDocById(COLLECTIONS.sessions, sessionId)
    if (current) {
      if (audit._recoveryEvidence && sameMutationResult(current, audit.before)) return MUTATION_RECOVERY_RESUME
      return null
    }
    await repairMutationAuditLog(audit)
    return { deleted: true, sessionId, handIds: Array.isArray(audit.after.handIds) ? audit.after.handIds : [] }
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

function getFriendPlayerNoteDocumentId(ownerOpenId, playerId, linkedFriendUserId) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([
      String(ownerOpenId || '').trim(),
      normalizePlayerId(playerId),
      String(linkedFriendUserId || '').trim()
    ]))
    .digest('hex')
}

function getPlayerCardImportReceiptDocumentId(ownerOpenId, playerId, shareId) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([
      String(ownerOpenId || '').trim(),
      normalizePlayerId(playerId),
      String(shareId || '').trim()
    ]))
    .digest('hex')
}

function buildPlayerCardImportReceiptDto(receipt) {
  if (!receipt) return null
  return {
    shareId: String(receipt.shareId || '').trim(),
    mode: receipt.mode === 'overwrite' ? 'overwrite' : 'new',
    targetPlayerNoteId: String(receipt.targetPlayerNoteId || '').trim(),
    status: receipt.status === 'completed' ? 'completed' : 'pending'
  }
}

function isMissingDocumentError(error) {
  const code = String(error && (error.errCode || error.code || '') || '')
  const message = String(error && (error.errMsg || error.message || error) || '')
  return code === '-502001' || /not found|does not exist|document.*not exist/i.test(message)
}

async function getReceiptDocByPointRead(store, docId) {
  try {
    const result = await store.collection(COLLECTIONS.playerCardImportReceipts).doc(docId).get()
    return result && result.data || null
  } catch (error) {
    if (isMissingDocumentError(error)) return null
    throw error
  }
}

function validateReceiptActionInput(event, requireMutation) {
  const playerId = normalizePlayerId(event && event.playerId)
  const shareId = String(event && event.shareId || '').trim()
  const clientMutationId = getClientMutationId(event)
  if (!playerId) return { error: { code: 'MISSING_PLAYER_ID', message: 'missing playerId' } }
  if (!shareId) return { error: { code: 'MISSING_SHARE_ID', message: 'missing shareId' } }
  if (requireMutation && !clientMutationId) {
    return { error: { code: 'MISSING_CLIENT_MUTATION_ID', message: 'missing clientMutationId' } }
  }
  return { playerId, shareId, clientMutationId }
}

async function getPlayerCardImportReceiptAction(event, ownerOpenId) {
  const input = validateReceiptActionInput(event, false)
  if (input.error) return input.error
  const docId = getPlayerCardImportReceiptDocumentId(ownerOpenId, input.playerId, input.shareId)
  const receipt = await getReceiptDocByPointRead(db, docId)
  if (!receipt || receipt.ownerOpenId !== ownerOpenId || normalizePlayerId(receipt.playerId) !== input.playerId || receipt.shareId !== input.shareId) {
    return { code: 0, data: { receipt: null } }
  }
  return { code: 0, data: { receipt: buildPlayerCardImportReceiptDto(receipt) } }
}

async function beginPlayerCardImportReceiptAction(event, ownerOpenId) {
  const input = validateReceiptActionInput(event, true)
  if (input.error) return input.error
  const mode = event.mode === 'overwrite' ? 'overwrite' : (event.mode === 'new' ? 'new' : '')
  const targetPlayerNoteId = String(event.targetPlayerNoteId || '').trim()
  if (!mode || !targetPlayerNoteId) return { code: 'INVALID_RECEIPT', message: 'invalid receipt mode or target' }
  const docId = getPlayerCardImportReceiptDocumentId(ownerOpenId, input.playerId, input.shareId)
  await ensureCollection(COLLECTIONS.playerCardImportReceipts)
  const result = await db.runTransaction(async transaction => {
    await assertBusinessFenceInTransaction(transaction)
    const current = await getReceiptDocByPointRead(transaction, docId)
    if (current) {
      if (current.ownerOpenId !== ownerOpenId || normalizePlayerId(current.playerId) !== input.playerId ||
        current.shareId !== input.shareId || current.mode !== mode || current.targetPlayerNoteId !== targetPlayerNoteId) {
        return { conflict: true }
      }
      return { receipt: current }
    }
    const receipt = {
      ownerOpenId,
      playerId: input.playerId,
      shareId: input.shareId,
      mode,
      targetPlayerNoteId,
      status: 'pending',
      beginMutationId: input.clientMutationId,
      createdAt: now(),
      updatedAt: now()
    }
    await transaction.collection(COLLECTIONS.playerCardImportReceipts).doc(docId).set({ data: receipt })
    return { receipt }
  })
  if (result && result.conflict) return { code: 'CONFLICT', message: 'receipt mode or target conflicts with existing import' }
  return { code: 0, data: { receipt: buildPlayerCardImportReceiptDto(result && result.receipt) } }
}

async function completePlayerCardImportReceiptAction(event, ownerOpenId) {
  const input = validateReceiptActionInput(event, true)
  if (input.error) return input.error
  const docId = getPlayerCardImportReceiptDocumentId(ownerOpenId, input.playerId, input.shareId)
  await ensureCollection(COLLECTIONS.playerCardImportReceipts)
  const result = await db.runTransaction(async transaction => {
    await assertBusinessFenceInTransaction(transaction)
    const current = await getReceiptDocByPointRead(transaction, docId)
    if (!current || current.ownerOpenId !== ownerOpenId || normalizePlayerId(current.playerId) !== input.playerId || current.shareId !== input.shareId) {
      return { missing: true }
    }
    if (current.status === 'completed') return { receipt: current }
    const receipt = Object.assign({}, current, {
      status: 'completed',
      completeMutationId: input.clientMutationId,
      completedAt: now(),
      updatedAt: now()
    })
    await transaction.collection(COLLECTIONS.playerCardImportReceipts).doc(docId).set({ data: omitId(receipt) })
    return { receipt }
  })
  if (result && result.missing) return { code: 'RECEIPT_NOT_FOUND', message: 'receipt not found' }
  return { code: 0, data: { receipt: buildPlayerCardImportReceiptDto(result && result.receipt) } }
}

const PRIVATE_CLEAR_COLLECTIONS = [
  COLLECTIONS.handActions,
  COLLECTIONS.hands,
  COLLECTIONS.sessions,
  COLLECTIONS.playerNotes,
  COLLECTIONS.playerCardImportReceipts,
  COLLECTIONS.bankrollLogs,
  COLLECTIONS.userSettings,
  COLLECTIONS.profiles
]

async function assertClearFenceInTransaction(transaction, clearFence) {
  if (!clearFence || !PRIVATE_CLEAR_COLLECTIONS.includes(clearFence.collectionName || '')) {
    throw accountLifecycleError('ACCOUNT_CLEAR_SCOPE_INVALID', 'account clear collection unavailable')
  }
  return assertClearLifecycleInTransaction(transaction, clearFence)
}

async function assertClearLifecycleInTransaction(transaction, clearFence) {
  if (!clearFence) throw accountLifecycleError('ACCOUNT_CLEAR_SCOPE_INVALID', 'account clear fence unavailable')
  const current = normalizeAccountLifecycle(
    await getDocByPointRead(transaction, COLLECTIONS.accountLifecycle, clearFence.docId),
    String(clearFence.ownerOpenId || ''), normalizePlayerId(clearFence.playerId)
  )
  if (!current || current.state !== 'clearing' || current.generation !== clearFence.generation ||
    current.clearMutationId !== clearFence.clearMutationId) {
    throw accountLifecycleError('ACCOUNT_CLEAR_CHANGED', 'account clear changed')
  }
}

async function removeClearBusinessDocById(clearFence, collectionName, docId) {
  if (!PRIVATE_CLEAR_COLLECTIONS.includes(collectionName)) {
    throw accountLifecycleError('ACCOUNT_CLEAR_SCOPE_INVALID', 'account clear collection unavailable')
  }
  const scopedFence = Object.assign({}, clearFence, { collectionName })
  return db.runTransaction(async transaction => {
    await assertClearFenceInTransaction(transaction, scopedFence)
    const current = await getDocByPointRead(transaction, collectionName, docId)
    if (!current) return true
    if (normalizePlayerId(current.playerId) !== clearFence.playerId ||
      String(current.ownerOpenId || current._openid || '') !== clearFence.ownerOpenId) {
      throw accountLifecycleError('ACCOUNT_CLEAR_SCOPE_INVALID', 'account clear document ownership changed')
    }
    await transaction.collection(collectionName).doc(docId).remove()
    return true
  })
}

async function setClearMetadataDocById(clearFence, collectionName, docId, data) {
  if (![COLLECTIONS.syncOperations, COLLECTIONS.auditLogs].includes(collectionName)) {
    throw accountLifecycleError('ACCOUNT_CLEAR_SCOPE_INVALID', 'account clear metadata collection unavailable')
  }
  return db.runTransaction(async transaction => {
    await assertClearLifecycleInTransaction(transaction, clearFence)
    const current = await getDocByPointRead(transaction, collectionName, docId)
    if (!current) return true
    if (normalizePlayerId(current.playerId) !== clearFence.playerId ||
      String(current.ownerOpenId || current._openid || '') !== clearFence.ownerOpenId) {
      throw accountLifecycleError('ACCOUNT_CLEAR_SCOPE_INVALID', 'account clear metadata ownership changed')
    }
    await transaction.collection(collectionName).doc(docId).set({ data: omitId(data) })
    return true
  })
}

function redactOperationBusinessPayload(doc) {
  const next = Object.assign({}, doc || {})
  ;['result', 'recoveryEvidence', 'before', 'after', 'payload', 'businessPayload'].forEach(key => { delete next[key] })
  return next
}

async function clearOwnedCollection(collectionName, playerId, ownerOpenId, clearFence) {
  // Import receipts have always used the canonical ownerOpenId schema. Keep this
  // delete path aligned with its exact compound index and avoid offset pagination.
  const docs = collectionName === COLLECTIONS.playerCardImportReceipts
    ? await fetchPlayerCardImportReceiptsForClear(playerId, ownerOpenId)
    : await fetchOwnedByPlayer(collectionName, playerId, ownerOpenId)
  for (const doc of docs) {
    if (doc && doc._id) await removeClearBusinessDocById(clearFence, collectionName, doc._id)
  }
}

async function redactOwnedOperationHistory(collectionName, playerId, ownerOpenId, clearFence) {
  const docs = await fetchOwnedByPlayer(collectionName, playerId, ownerOpenId)
  for (const doc of docs) {
    if (doc && doc._id) await setClearMetadataDocById(clearFence, collectionName, doc._id, redactOperationBusinessPayload(doc))
  }
}

async function clearAllDataAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'clear_all_data', async (playerId, clientMutationId) => {
    const clearFence = await beginAccountClear(ownerOpenId, playerId, clientMutationId)
    if (clearFence.completed) return { completed: true }
    for (const collectionName of PRIVATE_CLEAR_COLLECTIONS) {
      await clearOwnedCollection(collectionName, playerId, ownerOpenId, clearFence)
    }
    await redactOwnedOperationHistory(COLLECTIONS.syncOperations, playerId, ownerOpenId, clearFence)
    await redactOwnedOperationHistory(COLLECTIONS.auditLogs, playerId, ownerOpenId, clearFence)
    await completeAccountClear(clearFence)
    return { completed: true }
  })
}

function hasOwnField(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key)
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
  return runMutation(event, ownerOpenId, 'create_player_note', async (playerId, clientMutationId, writeRecoveryIntent) => {
    const doc = buildPlayerNoteDoc(null, event.payload || {})
    if (!doc.name) {
      return { playerNote: null, rejected: true, reason: 'MISSING_NAME' }
    }
    if (doc.sourceKind === 'friend') {
      if (!doc.linkedFriendUserId) {
        return { playerNote: null, rejected: true, reason: 'FRIEND_LINK_REQUIRED' }
      }
      const existingFriendNote = (await fetchWhere(COLLECTIONS.playerNotes, { playerId, ownerOpenId }))
        .find(item => item && item.sourceKind === 'friend' && item.linkedFriendUserId === doc.linkedFriendUserId)
      if (existingFriendNote) {
        const existingUpdatedAt = Number(existingFriendNote.updatedAt || existingFriendNote.createdAt) || 0
        const incomingUpdatedAt = Number(event.payload && (event.payload.updatedAt || event.payload.createdAt)) || 0
        if (existingFriendNote.archived) {
          const restored = withOwnerScope(Object.assign({}, buildPlayerNoteDoc(existingFriendNote, { archived: false }), {
            _id: existingFriendNote._id,
            lastClientMutationId: clientMutationId || '',
            lastMutationAttemptId: writeRecoveryIntent.attemptId || ''
          }), playerId, ownerOpenId)
          if (clientMutationId) await writeRecoveryIntent({
            auditAction: 'restore_friend_player_note', targetId: existingFriendNote._id,
            before: existingFriendNote, after: restored
          })
          await setDocById(COLLECTIONS.playerNotes, existingFriendNote._id, restored)
          await writeAuditLog(ownerOpenId, playerId, 'restore_friend_player_note', existingFriendNote._id, existingFriendNote, restored, clientMutationId)
          return { playerNote: cleanCloudDoc(restored) }
        }
        if (incomingUpdatedAt >= existingUpdatedAt) {
          const mergedPatch = Object.assign({}, event.payload || {}, { archived: false })
          const next = withOwnerScope(Object.assign({}, buildPlayerNoteDoc(existingFriendNote, mergedPatch), {
            _id: existingFriendNote._id,
            lastClientMutationId: clientMutationId || '',
            lastMutationAttemptId: writeRecoveryIntent.attemptId || ''
          }), playerId, ownerOpenId)
          if (clientMutationId) await writeRecoveryIntent({
            auditAction: 'merge_friend_player_note', targetId: existingFriendNote._id,
            before: existingFriendNote, after: next
          })
          await setDocById(COLLECTIONS.playerNotes, existingFriendNote._id, next)
          await writeAuditLog(ownerOpenId, playerId, 'merge_friend_player_note', existingFriendNote._id, existingFriendNote, next, clientMutationId)
          return { playerNote: cleanCloudDoc(next) }
        }
        return { playerNote: cleanCloudDoc(existingFriendNote) }
      }
      const id = getFriendPlayerNoteDocumentId(ownerOpenId, playerId, doc.linkedFriendUserId)
      const next = withOwnerScope(Object.assign({}, doc, {
        _id: id,
        lastClientMutationId: clientMutationId || '',
        lastMutationAttemptId: writeRecoveryIntent.attemptId || ''
      }), playerId, ownerOpenId)
      if (clientMutationId) await writeRecoveryIntent({ auditAction: 'create_player_note', targetId: id, before: null, after: next })
      await setDocById(COLLECTIONS.playerNotes, id, next)
      await writeAuditLog(ownerOpenId, playerId, 'create_player_note', id, null, next, clientMutationId)
      return { playerNote: cleanCloudDoc(next) }
    }
    const requestedId = String(doc._id || '').trim()
    const id = clientMutationId
      ? createMutationEntityId('player_note', ownerOpenId, playerId, 'create_player_note', clientMutationId)
      : (requestedId || createId('player_note'))
    const existing = await getDocById(COLLECTIONS.playerNotes, id)
    if (existing && (normalizePlayerId(existing.playerId) !== playerId || String(existing.ownerOpenId || existing._openid || '') !== ownerOpenId)) {
      return { playerNote: null, rejected: true, reason: 'PLAYER_NOTE_ID_CONFLICT' }
    }
    const next = withOwnerScope(Object.assign({}, doc, {
      _id: id,
      lastClientMutationId: clientMutationId || '',
      lastMutationAttemptId: writeRecoveryIntent.attemptId || ''
    }), playerId, ownerOpenId)
    if (clientMutationId) await writeRecoveryIntent({ auditAction: 'create_player_note', targetId: id, before: existing || null, after: next })
    await setDocById(COLLECTIONS.playerNotes, id, next)
    await writeAuditLog(ownerOpenId, playerId, 'create_player_note', id, null, next, clientMutationId)
    return { playerNote: cleanCloudDoc(next) }
  }, async (playerId, clientMutationId, claim) => {
    const doc = buildPlayerNoteDoc(null, event.payload || {})
    const evidence = claim && claim.recoveryEvidence
    const evidenceTargetId = evidence && [
      'create_player_note', 'restore_friend_player_note', 'merge_friend_player_note'
    ].includes(evidence.auditAction)
      ? String(evidence.targetId || '').trim()
      : ''
    const noteId = evidenceTargetId || (doc.sourceKind === 'friend'
      ? getFriendPlayerNoteDocumentId(ownerOpenId, playerId, doc.linkedFriendUserId)
      : createMutationEntityId('player_note', ownerOpenId, playerId, 'create_player_note', clientMutationId))
    const created = await recoverPlayerNoteMutation(
      ownerOpenId, playerId, 'create_player_note', noteId, clientMutationId
    )
    if (created) return created
    if (doc.sourceKind !== 'friend') return null
    for (const auditAction of ['restore_friend_player_note', 'merge_friend_player_note']) {
      const recovered = await recoverPlayerNoteMutation(
        ownerOpenId, playerId, auditAction, noteId, clientMutationId
      )
      if (recovered) return { playerNote: recovered.playerNote }
    }
    const current = await getDocById(COLLECTIONS.playerNotes, noteId)
    if (!isOwnedMutationDocument(current, ownerOpenId, playerId) ||
      String(current.linkedFriendUserId || '') !== String(doc.linkedFriendUserId || '')) return null
    return { playerNote: cleanCloudDoc(current) }
  })
}

async function updatePlayerNoteAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'update_player_note', async (playerId, clientMutationId, writeRecoveryIntent) => {
    const noteId = String(event.noteId || event.playerNoteId || '').trim()
    const current = await getDocById(COLLECTIONS.playerNotes, noteId)
    if (!current || normalizePlayerId(current.playerId) !== playerId || current.ownerOpenId !== ownerOpenId) {
      return { playerNote: null, rejected: true, reason: 'PLAYER_NOTE_NOT_FOUND' }
    }
    const patch = event.patch || {}
    const requestedSourceKind = hasOwnField(patch, 'sourceKind')
      ? (patch.sourceKind === 'friend' ? 'friend' : 'library')
      : ''
    const currentSourceKind = current.sourceKind === 'friend' ? 'friend' : 'library'
    if (currentSourceKind === 'library' && requestedSourceKind === 'friend') {
      return { playerNote: null, rejected: true, reason: 'FRIEND_SOURCE_KIND_IMMUTABLE' }
    }
    if (currentSourceKind === 'friend' && requestedSourceKind !== 'library' && hasOwnField(patch, 'linkedFriendUserId')) {
      const requestedFriendUserId = String(patch.linkedFriendUserId || '').trim()
      if (requestedFriendUserId !== String(current.linkedFriendUserId || '').trim()) {
        return { playerNote: null, rejected: true, reason: 'FRIEND_LINK_IMMUTABLE' }
      }
    }
    const nextDoc = buildPlayerNoteDoc(current, patch)
    if (nextDoc.sourceKind === 'friend' && !nextDoc.linkedFriendUserId) {
      return { playerNote: null, rejected: true, reason: 'FRIEND_LINK_REQUIRED' }
    }
    const next = withOwnerScope(Object.assign({}, nextDoc, {
      _id: noteId,
      lastClientMutationId: clientMutationId || '',
      lastMutationAttemptId: writeRecoveryIntent.attemptId || ''
    }), playerId, ownerOpenId)
    if (clientMutationId) await writeRecoveryIntent({ auditAction: 'update_player_note', targetId: noteId, before: current, after: next })
    await setDocById(COLLECTIONS.playerNotes, noteId, next)
    await writeAuditLog(ownerOpenId, playerId, 'update_player_note', noteId, current, next, clientMutationId)
    return { playerNote: cleanCloudDoc(next) }
  }, async (playerId, clientMutationId) => {
    const noteId = String(event.noteId || event.playerNoteId || '').trim()
    return recoverPlayerNoteMutation(ownerOpenId, playerId, 'update_player_note', noteId, clientMutationId)
  })
}

async function deletePlayerNoteAction(event, ownerOpenId) {
  return runMutation(event, ownerOpenId, 'delete_player_note', async (playerId, clientMutationId, writeRecoveryIntent) => {
    const noteId = String(event.noteId || event.playerNoteId || '').trim()
    const current = await getDocById(COLLECTIONS.playerNotes, noteId)
    if (!current || normalizePlayerId(current.playerId) !== playerId || current.ownerOpenId !== ownerOpenId) {
      return { deleted: false, rejected: true, reason: 'PLAYER_NOTE_NOT_FOUND' }
    }
    const next = withOwnerScope(Object.assign({}, buildPlayerNoteDoc(current, { archived: true }), {
      _id: noteId,
      lastClientMutationId: clientMutationId || '',
      lastMutationAttemptId: writeRecoveryIntent.attemptId || ''
    }), playerId, ownerOpenId)
    if (clientMutationId) await writeRecoveryIntent({ auditAction: 'delete_player_note', targetId: noteId, before: current, after: next })
    await setDocById(COLLECTIONS.playerNotes, noteId, next)
    await writeAuditLog(ownerOpenId, playerId, 'delete_player_note', noteId, current, next, clientMutationId)
    return { deleted: true, noteId, playerNote: cleanCloudDoc(next) }
  }, async (playerId, clientMutationId) => {
    const noteId = String(event.noteId || event.playerNoteId || '').trim()
    return recoverPlayerNoteMutation(ownerOpenId, playerId, 'delete_player_note', noteId, clientMutationId)
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
    .filter(hand => hand && !String(hand.actionRevisionPending || ''))
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
  if (!hand || normalizePlayerId(hand.playerId) !== playerId || hand.ownerOpenId !== ownerOpenId || String(hand.actionRevisionPending || '')) {
    return { code: 0, data: { hand: null, actions: [], rejected: true, reason: 'HAND_NOT_FOUND' } }
  }
  const actions = await fetchWhere(COLLECTIONS.handActions, { playerId, ownerOpenId, handId })
  const after = await getDocById(COLLECTIONS.hands, handId)
  const committed = String(hand.actionRevision || '')
  const stable = after && !String(after.actionRevisionPending || '') && handWriteEvidence(hand) === handWriteEvidence(after)
  const consistent = committed
    ? actions.every(action => String(action.actionRevision || '') === committed)
    : actions.every(action => !String(action.actionRevision || ''))
  if (!stable || !consistent) {
    return { code: 0, data: { hand: null, actions: [], rejected: true, reason: 'HAND_NOT_FOUND' } }
  }
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

function formatSubscribeTime(value) {
  const date = new Date(Number(value) || Date.now())
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return year + '-' + month + '-' + day + ' ' + hour + ':' + minute
}

function getReminderPlanName(reminder) {
  const type = String(reminder && reminder.type || '').trim()
  if (type === 'profit_target') return 'AI止盈提醒'
  if (type === 'loss_limit') return 'AI止损提醒'
  if (type === 'trailing_profit') return 'AI回撤提醒'
  if (type === 'post_loss_extra_risk') return 'AI风控提醒'
  if (type === 'session_max_hours' || type === 'session_pre_reminder') return 'AI时长提醒'
  if (type === 'text_reminder') return truncateSubscribeValue(reminder && reminder.title || 'AI纪律提醒', 20)
  return truncateSubscribeValue(reminder && reminder.title || 'AI自动提醒', 20)
}

function getReminderPlanContent(reminder) {
  return truncateSubscribeValue(reminder && (reminder.message || reminder.title) || '牌局状态提醒已触发', 20)
}

function getReminderWarmTip() {
  return '仅供参考，具体操作自己把控'
}

async function sendAiReminderSubscribeMessageLegacy(event, ownerOpenId) {
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
        value: getReminderPlanName(reminder)
      },
      thing3: {
        value: getReminderPlanContent(reminder)
      },
      time2: {
        value: formatSubscribeTime(reminder.createdAt)
      },
      thing4: {
        value: getReminderWarmTip()
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
    if (BUSINESS_WRITE_ACTIONS.includes(action) && !currentBusinessFence()) {
      const playerId = businessWritePlayerId(action, event, ownerOpenId)
      if (playerId) {
        const fence = await captureAccountLifecycle(ownerOpenId, playerId)
        return await runWithBusinessFence(fence, () => exports.main(rawEvent))
      }
    }
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
    if (action === 'get_player_card_import_receipt') {
      return await getPlayerCardImportReceiptAction(event || {}, ownerOpenId)
    }
    if (action === 'begin_player_card_import_receipt') {
      return await beginPlayerCardImportReceiptAction(event || {}, ownerOpenId)
    }
    if (action === 'complete_player_card_import_receipt') {
      return await completePlayerCardImportReceiptAction(event || {}, ownerOpenId)
    }
    if (action === 'clear_all_data') {
      return await clearAllDataAction(event || {}, ownerOpenId)
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
    if (error && [
      'ACCOUNT_DATA_NOT_ACTIVE', 'ACCOUNT_DATA_GENERATION_CHANGED', 'ACCOUNT_LIFECYCLE_INVALID',
      'ACCOUNT_CLEAR_IN_PROGRESS', 'ACCOUNT_CLEAR_CHANGED'
    ].includes(error.code)) {
      return { code: error.code, message: error.message }
    }
    if (error && error.code === 'HAND_SOURCE_UPDATING') {
      return { code: 'HAND_SOURCE_UPDATING', message: 'hand source updating' }
    }
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
  exportAgentData,
  getFriendPlayerNoteDocumentId,
  getPlayerCardImportReceiptDocumentId,
  buildPlayerCardImportReceiptDto,
  cleanCloudDoc,
  createMutationEntityId,
  createHandActionRowId,
  getSyncOperationDocumentId,
  getLegacySyncOperationDocumentId,
  createMutationInputFingerprint,
  BUSINESS_WRITE_ACTIONS,
  getAccountLifecycleDocumentId,
  captureAccountLifecycle,
  runFencedBusinessTransaction,
  beginAccountClear,
  completeAccountClear,
  currentBusinessFence,
  currentBusinessFences,
  runWithBusinessFence,
  addBusinessFence,
  setDocById,
  removeDocById,
  assertBusinessFenceInTransaction,
  runMutation,
  claimSyncOperation,
  renewSyncOperationClaim,
  createHandActionRevision,
  prepareHandRevisionClaim,
  prepareHandMetadataWrite,
  claimHandActionRevision,
  finalizeHandActionRevision,
  writeHandMetadataCloud,
  replaceHandActionsCloud,
  fetchStableOwnedHandData,
  executeHandActionRevision
}
