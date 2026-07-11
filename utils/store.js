const STORAGE_KEY = 'pokerLiveMiniappStore'
const SETTINGS_STORAGE_KEY = 'pokerLiveMiniappSettings'
const SPLIT_COLLECTION_KEYS = ['hands', 'handActions']
const SPLIT_INITIAL_CHUNK_SIZE = 50
const LEGACY_PROFILE_ID = '8X2K9M'
const INITIAL_DATA_VERSION = 3
const reviewTags = require('./review-tags')
const sessionRules = require('./session-rules')
const aiReminders = require('./ai-reminders')
const cardUi = require('./card-ui')
const actionLine = require('./action-line')
const handEntryType = require('./hand-entry-type')
let cachedStore = null
const QUICK_DUPLICATE_WINDOW_MS = 10000
const AI_REMINDER_PENDING_VISIBLE_WINDOW_MS = 10 * 60 * 1000

function normalizeAllInStreet(value) {
  const text = String(value || '').trim().toLowerCase()
  if (/^(pre|preflop|pre-flop|pf)$/.test(text)) return 'preflop'
  if (/^(flop|turn|river)$/.test(text)) return text
  return text
}

function isPreRiverAllIn(source) {
  const hand = source || {}
  const street = normalizeAllInStreet(hand.allInStreet || hand.allInRound || hand.allInStage || hand.allInEvStreet)
  if (street === 'river') return false
  return !!hand.isAllIn || !!hand.allInEvEligible || !!street
}

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
  bankrollInitial: 0,
  venues: ['MGM', '威尼斯人', 'Home Game'],
  blindPresets: ['100/200', '200/400', '300/600', '500/1000'],
  lastBlindPreset: '200/400',
  positions: ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB', 'STR'],
  opponentTypes: ['紧弱', '松弱', '激进', '跟注站'],
  playerLeakTags: ['不弃顶对', 'river少诈唬', '跟注过宽'],
  voiceTerms: [],
  aiReminders: aiReminders.DEFAULT_AI_REMINDER_SETTINGS,
  updatedAt: 0
}

const PLAYER_TYPE_COLORS = {
  '紧弱': '#5c8cff',
  '松弱': '#30d87b',
  '激进': '#ff3150',
  '跟注站': '#ffd447',
  '鱼': '#21d4a8',
  '常客': '#aa6cff',
  '职业': '#ff8a34',
  '娱乐玩家': '#2ad8ff',
  '未分类': '#8891a7'
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

function parseDateTimeMs(value) {
  const date = parseDateTimeValue(value)
  return date ? date.getTime() : 0
}

function getRecordMutationMs(item) {
  return Number(item && (item.createdAt || item.updatedAt)) || 0
}

function getSessionBusinessMs(session) {
  const startMs = parseDateTimeMs(session && session.startTime)
  if (startMs) return startMs
  const dateText = String(session && session.date || '').trim()
  if (dateText) {
    const dateMs = parseDateTimeMs(dateText + ' 00:00')
    if (dateMs) return dateMs
  }
  return getRecordMutationMs(session)
}

function compareSessionBusinessDesc(a, b) {
  return getSessionBusinessMs(b) - getSessionBusinessMs(a) ||
    getRecordMutationMs(b) - getRecordMutationMs(a)
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

function getSplitMetaKey(collectionKey) {
  return STORAGE_KEY + ':' + collectionKey + ':meta'
}

function getSplitChunkKey(collectionKey, index) {
  return STORAGE_KEY + ':' + collectionKey + ':' + index
}

function readSplitMeta(collectionKey) {
  try {
    const meta = wx.getStorageSync(getSplitMetaKey(collectionKey))
    return meta && Array.isArray(meta.chunkKeys) ? meta : null
  } catch (error) {
    return null
  }
}

function clearSplitCollection(collectionKey) {
  const meta = readSplitMeta(collectionKey)
  if (meta) {
    meta.chunkKeys.forEach(key => {
      try {
        wx.removeStorageSync(key)
      } catch (error) {}
    })
  }
  try {
    wx.removeStorageSync(getSplitMetaKey(collectionKey))
  } catch (error) {}
}

function writeSplitChunkAdaptive(collectionKey, chunkKeys, items) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return
  const chunkKey = getSplitChunkKey(collectionKey, chunkKeys.length)
  try {
    wx.setStorageSync(chunkKey, list)
    chunkKeys.push(chunkKey)
    return
  } catch (error) {
    if (list.length <= 1) throw error
    const midpoint = Math.ceil(list.length / 2)
    writeSplitChunkAdaptive(collectionKey, chunkKeys, list.slice(0, midpoint))
    writeSplitChunkAdaptive(collectionKey, chunkKeys, list.slice(midpoint))
  }
}

function writeSplitCollection(collectionKey, list) {
  clearSplitCollection(collectionKey)
  const source = Array.isArray(list) ? list : []
  if (!source.length) return
  const chunkKeys = []
  for (let index = 0; index < source.length; index += SPLIT_INITIAL_CHUNK_SIZE) {
    writeSplitChunkAdaptive(collectionKey, chunkKeys, source.slice(index, index + SPLIT_INITIAL_CHUNK_SIZE))
  }
  wx.setStorageSync(getSplitMetaKey(collectionKey), {
    collectionKey,
    chunkKeys,
    total: source.length,
    updatedAt: now()
  })
}

function readSplitCollection(collectionKey) {
  const meta = readSplitMeta(collectionKey)
  if (!meta) return null
  const items = []
  meta.chunkKeys.forEach(key => {
    try {
      const chunk = wx.getStorageSync(key)
      if (Array.isArray(chunk)) {
        items.push.apply(items, chunk)
      }
    } catch (error) {}
  })
  return items
}

function hydrateSplitCollections(data) {
  if (!data) return data
  SPLIT_COLLECTION_KEYS.forEach(key => {
    const split = readSplitCollection(key)
    if (split) data[key] = split
  })
  return data
}

function buildPersistedStore(data) {
  const persisted = Object.assign({}, data)
  SPLIT_COLLECTION_KEYS.forEach(key => {
    writeSplitCollection(key, persisted[key])
    persisted[key] = []
  })
  return persisted
}

function normalizeFingerprintText(value) {
  return String(value == null ? '' : value).trim().toUpperCase()
}

function normalizeFingerprintNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? String(number) : '0'
}

function getBoardCardText(board) {
  const source = board || {}
  return [source.flop, source.turn, source.river]
    .map(item => String(item || '').trim())
    .join('|')
}

function getHandDuplicateKey(hand) {
  const sessionId = normalizeFingerprintText(hand && hand.sessionId)
  const heroCards = normalizeFingerprintText(hand && hand.heroCardsInput)
  if (!sessionId || !heroCards) return ''
  return [
    sessionId,
    normalizeFingerprintText(hand && hand.playedDate),
    normalizeFingerprintText(hand && hand.stakeLevel),
    normalizeFingerprintText(hand && hand.heroPosition),
    normalizeFingerprintText(hand && hand.villainPosition),
    heroCards,
    normalizeFingerprintNumber(hand && hand.currentProfit)
  ].join('::')
}

function getHandCompletenessScore(hand) {
  if (!hand) return 0
  let score = 0
  if (hand.detailBackfilled) score += 100
  if (hand.aiReview) score += 80
  if (hand.voiceExtract) score += 60
  if (hand.streetSummary) score += 30
  if (hand.mindJourney || hand.notes) score += 20
  if (hand.showdown) score += 15
  if (Array.isArray(hand.tags) && hand.tags.length) score += hand.tags.length * 5
  score += getBoardCardText(hand.board).replace(/\|/g, '').length
  return score
}

function chooseDuplicateHandWinner(current, candidate) {
  if (!current) return candidate
  const currentScore = getHandCompletenessScore(current)
  const candidateScore = getHandCompletenessScore(candidate)
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore ? candidate : current
  }
  return (Number(candidate.updatedAt || candidate.createdAt) || 0) > (Number(current.updatedAt || current.createdAt) || 0)
    ? candidate
    : current
}

function getHandCreatedMs(hand) {
  return Number(hand && (hand.createdAt || hand.updatedAt)) || 0
}

function isQuickDuplicateHandGroup(group) {
  const times = (Array.isArray(group) ? group : [])
    .map(getHandCreatedMs)
    .filter(Boolean)
  if (times.length < 2) return false
  return Math.max.apply(null, times) - Math.min.apply(null, times) <= QUICK_DUPLICATE_WINDOW_MS
}

function findRecentDuplicateHand(hands, payload, timestamp) {
  const duplicateKey = getHandDuplicateKey(payload || {})
  if (!duplicateKey) return null
  const createdAt = Number(timestamp) || now()
  return (Array.isArray(hands) ? hands : []).find(item => {
    if (getHandDuplicateKey(item) !== duplicateKey) return false
    const itemCreatedAt = getHandCreatedMs(item)
    return itemCreatedAt && Math.abs(createdAt - itemCreatedAt) <= QUICK_DUPLICATE_WINDOW_MS
  }) || null
}

function rebuildSessionHandCounts(data) {
  const counts = {}
  ;(data.hands || []).forEach(hand => {
    const sessionId = String(hand && hand.sessionId || '')
    if (!sessionId) return
    counts[sessionId] = (counts[sessionId] || 0) + 1
  })
  data.sessions = (data.sessions || []).map(session => {
    const sessionId = String(session && session._id || '')
    return Object.assign({}, session, {
      handCount: counts[sessionId] || 0
    })
  })
}

function repairDuplicateHandsInPlace(data) {
  if (!data || !Array.isArray(data.hands) || data.hands.length < 2) return false
  const groups = {}
  data.hands.forEach(hand => {
    const key = getHandDuplicateKey(hand)
    if (!key) return
    if (!groups[key]) groups[key] = []
    groups[key].push(hand)
  })

  const replaceHandId = {}
  const removeIds = new Set()
  Object.keys(groups).forEach(key => {
    const group = groups[key]
    if (group.length < 2) return
    if (!isQuickDuplicateHandGroup(group)) return
    const winner = group.reduce(chooseDuplicateHandWinner, null)
    if (!winner || !winner._id) return
    group.forEach(hand => {
      if (!hand || hand._id === winner._id) return
      removeIds.add(hand._id)
      replaceHandId[hand._id] = winner._id
    })
  })

  if (!removeIds.size) return false

  data.hands = data.hands.filter(hand => !removeIds.has(hand && hand._id))
  const seenActions = new Set()
  data.handActions = (data.handActions || [])
    .map(action => {
      const nextHandId = replaceHandId[action && action.handId] || (action && action.handId)
      return Object.assign({}, action, { handId: nextHandId })
    })
    .filter(action => {
      const key = [
        action.handId,
        action.street,
        action.actorLabel,
        action.actionType,
        action.amount,
        action.potAfter,
        action.sequence
      ].join('::')
      if (seenActions.has(key)) return false
      seenActions.add(key)
      return true
    })
  rebuildSessionHandCounts(data)
  return true
}

function normalizeReviewStatus(value) {
  const status = String(value || '').trim()
  return ['idle', 'extracted', 'reviewed'].indexOf(status) > -1 ? status : 'idle'
}

function normalizeStringList(list, fallback) {
  const seen = {}
  const next = Array.isArray(list)
    ? list.map(item => String(item || '').trim()).filter(Boolean).filter(item => {
      if (seen[item]) return false
      seen[item] = true
      return true
    })
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
  settings.playerLeakTags = normalizeStringList(settings.playerLeakTags, DEFAULT_SETTINGS.playerLeakTags)
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
  settings.aiReminders = aiReminders.normalizeAiReminderSettings(settings.aiReminders)
  return settings
}

function getPlayerTypeColor(type) {
  const key = String(type || '').trim()
  return PLAYER_TYPE_COLORS[key] || PLAYER_TYPE_COLORS['未分类']
}

function resolvePlayerTypeColor(type, sourceColor) {
  const key = String(type || '').trim()
  if (PLAYER_TYPE_COLORS[key]) return PLAYER_TYPE_COLORS[key]
  return String(sourceColor || '').trim() || PLAYER_TYPE_COLORS['未分类']
}

function normalizePlayerNote(input) {
  const source = input || {}
  const name = String(source.name || '').trim()
  const type = String(source.type || '').trim() || '未分类'
  const timestamp = Number(source.updatedAt || source.createdAt) || now()
  const battleHandIds = normalizeStringList(
    source.battleHandIds || source.linkedHandIds || [],
    []
  )
  return {
    _id: String(source._id || '').trim(),
    playerId: String(source.playerId || '').trim(),
    name,
    alias: normalizeStringList(source.alias, []),
    avatarUrl: String(source.avatarUrl || '').trim(),
    avatarFileId: String(source.avatarFileId || '').trim(),
    avatarText: String(source.avatarText || name.slice(0, 1) || '?').trim().slice(0, 2),
    type,
    typeColor: resolvePlayerTypeColor(type, source.typeColor),
    leakTags: normalizeStringList(source.leakTags, []),
    note: String(source.note || '').trim(),
    lastSeenAt: Number(source.lastSeenAt) || 0,
    lastVenue: String(source.lastVenue || '').trim(),
    lastStake: String(source.lastStake || '').trim(),
    battleHandIds,
    archived: source.archived === true,
    createdAt: Number(source.createdAt) || timestamp,
    updatedAt: Number(source.updatedAt) || timestamp
  }
}

function normalizePlayerNotes(list) {
  return (Array.isArray(list) ? list : [])
    .map(normalizePlayerNote)
    .filter(item => item._id && item.name)
}

function comparePlayerNoteDesc(a, b) {
  const left = Number(a && (a.lastSeenAt || a.updatedAt || a.createdAt)) || 0
  const right = Number(b && (b.lastSeenAt || b.updatedAt || b.createdAt)) || 0
  return right - left
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

function getSessionRecordedProfit(hands, sessionId) {
  return (hands || [])
    .filter(item => item && item.sessionId === sessionId)
    .reduce((sum, item) => sum + (Number(item.currentProfit) || 0), 0)
}

function getSessionRecordedPeakProfit(hands, sessionId) {
  let runningProfit = 0
  let peakProfit = 0
  ;(hands || [])
    .filter(item => item && item.sessionId === sessionId)
    .slice()
    .reverse()
    .forEach(item => {
      runningProfit += Number(item.currentProfit) || 0
      peakProfit = Math.max(peakProfit, runningProfit)
    })
  return peakProfit
}

function refreshSessionRecordedStats(data, sessionId) {
  if (!data || !sessionId) return
  const sessionHands = (data.hands || []).filter(item => item && item.sessionId === sessionId)
  const sessionProfit = getSessionRecordedProfit(data.hands, sessionId)
  const peakProfit = getSessionRecordedPeakProfit(data.hands, sessionId)
  data.sessions = (data.sessions || []).map(item => {
    if (item._id !== sessionId) return item
    return Object.assign({}, item, {
      handCount: sessionHands.length,
      currentProfit: sessionProfit,
      peakProfit,
      updatedAt: now()
    })
  })
}

const AI_REMINDER_ONE_SHOT_TYPES = [
  'profit_target',
  'loss_limit',
  'trailing_profit',
  'post_loss_extra_risk',
  'session_pre_reminder',
  'session_max_hours',
  'consecutive_loss'
]

function isActiveSessionForAiReminder(session) {
  return !!(session && session.status === 'active')
}

function isFreshPendingAiReminder(reminder, nowMs) {
  const createdAt = Number(reminder && reminder.createdAt) || 0
  if (!createdAt) return false
  return Number(nowMs) - createdAt <= AI_REMINDER_PENDING_VISIBLE_WINDOW_MS
}

function isRepeatAiReminder(queue, reminder) {
  if (!reminder || AI_REMINDER_ONE_SHOT_TYPES.indexOf(reminder.type) === -1) return false
  return (Array.isArray(queue) ? queue : []).some(item => item && item.sessionId === reminder.sessionId && item.type === reminder.type)
}

function filterNewAiReminders(queue, reminders) {
  return (Array.isArray(reminders) ? reminders : []).filter(item => !isRepeatAiReminder(queue, item))
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

function hasFullEntryMarker(hand) {
  return handEntryType.isFullEntryHand(hand)
}

function migrateHandEntryMetadata(hand) {
  if (!hand || !hasFullEntryMarker(hand)) return hand
  if (hand.inputMode === 'ledger_full' && hand.reviewSource === 'ledger_full') return hand
  return Object.assign({}, hand, {
    inputMode: 'ledger_full',
    reviewSource: 'ledger_full'
  })
}

function ensureStoreShape(input) {
  const data = migrateInitialData(input || {})
  return {
    initialDataVersion: INITIAL_DATA_VERSION,
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    hands: (Array.isArray(data.hands) ? data.hands : []).map(migrateHandEntryMetadata),
    handActions: Array.isArray(data.handActions) ? data.handActions : [],
    bankrollLogs: Array.isArray(data.bankrollLogs) ? data.bankrollLogs : [],
    aiReminderQueue: Array.isArray(data.aiReminderQueue) ? data.aiReminderQueue : [],
    playerNotes: normalizePlayerNotes(data.playerNotes),
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
    bankrollLogs: [],
    aiReminderQueue: [],
    playerNotes: []
  })
}

function shouldPersistNormalizedStore(raw, next) {
  if (!raw) return true
  if ((Number(raw.initialDataVersion) || 1) !== INITIAL_DATA_VERSION) return true
  if (!raw.profile || !raw.profile.playerId || raw.profile.playerId === LEGACY_PROFILE_ID) return true
  if (!raw.settings || !Array.isArray(raw.settings.voiceTerms)) return true
  return false
}

function readSettingsStore() {
  try {
    const raw = wx.getStorageSync(SETTINGS_STORAGE_KEY)
    return raw ? normalizeSettings(raw) : null
  } catch (error) {
    return null
  }
}

function writeSettingsStore(settings) {
  const next = normalizeSettings(settings)
  wx.setStorageSync(SETTINGS_STORAGE_KEY, next)
  return next
}

function removeSettingsStore() {
  if (typeof wx !== 'undefined' && wx && typeof wx.removeStorageSync === 'function') {
    wx.removeStorageSync(SETTINGS_STORAGE_KEY)
  }
}

function applySettingsStoreOverride(data) {
  if (!data) return data
  const splitSettings = readSettingsStore()
  if (!splitSettings) return data
  const splitUpdatedAt = Number(splitSettings.updatedAt) || 0
  const mainUpdatedAt = Number(data.settings && data.settings.updatedAt) || 0
  if (splitUpdatedAt >= mainUpdatedAt) {
    data.settings = splitSettings
  }
  return data
}

function readStore() {
  if (cachedStore) return cachedStore

  const raw = wx.getStorageSync(STORAGE_KEY)
  if (raw) {
    const next = ensureStoreShape(raw)
    hydrateSplitCollections(next)
    next.hands = (Array.isArray(next.hands) ? next.hands : []).map(migrateHandEntryMetadata)
    applySettingsStoreOverride(next)
    cachedStore = next
    if (shouldPersistNormalizedStore(raw, next)) {
      try {
        wx.setStorageSync(STORAGE_KEY, next)
      } catch (error) {
        // Large legacy stores can exceed WeChat's per-entry storage limit. The
        // normalized in-memory data is still usable, so avoid breaking startup.
      }
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
  applySettingsStoreOverride(next)
  const persisted = buildPersistedStore(next)
  cachedStore = next
  wx.setStorageSync(STORAGE_KEY, persisted)
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

function getBankrollInitial() {
  const value = Number(getSettings().bankrollInitial)
  return Number.isFinite(value) ? value : 0
}

function getDefaultSettings() {
  return clone(DEFAULT_SETTINGS)
}

function updateSettings(patch) {
  const data = readStore()
  data.settings = normalizeSettings(Object.assign({}, data.settings, patch || {}, { updatedAt: now() }))
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'aiReminders')) {
    data.aiReminderQueue = (data.aiReminderQueue || []).filter(item => item && item.status !== 'pending')
  }
  data.settings = writeSettingsStore(data.settings)
  const persisted = buildPersistedStore(data)
  wx.setStorageSync(STORAGE_KEY, persisted)
  cachedStore = data
  return data.settings
}

function replaceSettings(settings) {
  const data = readStore()
  data.settings = writeSettingsStore(settings)
  const persisted = buildPersistedStore(data)
  wx.setStorageSync(STORAGE_KEY, persisted)
  cachedStore = data
  return data.settings
}

function getSessions() {
  return readStore().sessions.slice().sort(compareSessionBusinessDesc)
}

function getActiveSession() {
  return getSessions().find(item => item.status === 'active') || null
}

function getSessionById(id) {
  return getSessions().find(item => item._id === id) || null
}

function createSession(payload) {
  const data = readStore()
  const status = payload && payload.status || 'active'
  if (status === 'active') sessionRules.assertCanCreateSession(data.sessions)
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
    hasStraddle: !!payload.hasStraddle,
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
    timelineEvents: Array.isArray(payload.timelineEvents) ? payload.timelineEvents : [],
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
    .sort((a, b) => getHandDateMs(b) - getHandDateMs(a) || getRecordMutationMs(b) - getRecordMutationMs(a))
}

function getRecentHands(limit) {
  return readStore().hands
    .slice()
    .sort((a, b) => getHandRecordMs(b) - getHandRecordMs(a) || getHandDateMs(b) - getHandDateMs(a))
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

function getHandRecordMs(hand) {
  return Number(hand && (hand.createdAt || hand.updatedAt)) || getHandDateMs(hand)
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
    updatedAsc: (a, b) => getHandRecordMs(a) - getHandRecordMs(b) || getHandDateMs(a) - getHandDateMs(b),
    updatedDesc: (a, b) => getHandRecordMs(b) - getHandRecordMs(a) || getHandDateMs(b) - getHandDateMs(a),
    dateAsc: (a, b) => getHandDateMs(a) - getHandDateMs(b) || getRecordMutationMs(a) - getRecordMutationMs(b),
    dateDesc: (a, b) => getHandDateMs(b) - getHandDateMs(a) || getRecordMutationMs(b) - getRecordMutationMs(a),
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
  const timestamp = now()
  const sourceSession = (data.sessions || []).find(item => item._id === payload.sessionId)
  const hasStraddle = !!(payload.hasStraddle || (sourceSession && sourceSession.hasStraddle))
  const hand = {
    _id: createId('hand'),
    sessionId: payload.sessionId,
    playedDate: payload.playedDate || '',
    stakeLevel: payload.stakeLevel || '',
    heroSeat: Number(payload.heroSeat) || 0,
    heroPosition: payload.heroPosition || '',
    villainPosition: payload.villainPosition || '',
    villainType: payload.villainType || payload.opponentType || '',
    hasStraddle,
    buttonSeat: Number(payload.buttonSeat) || 0,
    heroCardsInput: payload.heroCardsInput || '',
    effectiveStack: Number(payload.effectiveStack) || 0,
    potSize: Number(payload.potSize) || 0,
    currentProfit: Number(payload.currentProfit) || 0,
    isAllIn: isPreRiverAllIn(payload),
    allInEv: payload.allInEv === '' || payload.allInEv == null ? '' : Number(payload.allInEv) || 0,
    allInStreet: payload.allInStreet || '',
    allInPot: payload.allInPot === '' || payload.allInPot == null ? '' : Number(payload.allInPot) || 0,
    resultBB: payload.resultBB || '',
    opponentType: payload.opponentType || '',
    opponentName: payload.opponentName || '',
    board: {
      flop: payload.flop || '',
      turn: payload.turn || '',
      river: payload.river || ''
    },
    opponentCards: payload.opponentCards || '',
    opponentCardsSource: payload.opponentCardsSource || '',
    showdown: payload.opponentCards || payload.showdown || '',
    showdownType: payload.showdownType || '',
    showdownReason: payload.showdownReason || '',
    streetInputs: payload.streetInputs || {},
    ev: payload.ev || '',
    tags: reviewTags.normalizeReviewTags(payload.tags),
    notes: payload.notes || '',
    mindJourney: payload.mindJourney || payload.notes || '',
    streetSummary: payload.streetSummary || '',
    heroQuestion: payload.heroQuestion || '',
    detailBackfilled: !!payload.detailBackfilled,
    inputMode: payload.inputMode || '',
    reviewSource: payload.reviewSource || '',
    ledgerState: payload.ledgerState || null,
    voiceNote: '',
    voiceExtract: null,
    aiReview: null,
    aiReviewStatus: payload.aiReviewStatus || '',
    aiReviewGeneratedAt: payload.aiReviewGeneratedAt || '',
    aiReviewError: payload.aiReviewError || '',
    reviewStatus: normalizeReviewStatus(payload.reviewStatus),
    createdAt: timestamp,
    updatedAt: timestamp
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
  refreshSessionRecordedStats(data, payload.sessionId)
  const session = data.sessions.find(item => item._id === payload.sessionId) || null
  const recentHands = data.hands
    .filter(item => item.sessionId === payload.sessionId)
    .slice()
    .reverse()
  const nextReminders = isActiveSessionForAiReminder(session)
    ? filterNewAiReminders(data.aiReminderQueue, aiReminders.evaluateAiRemindersAfterHand({
      settings: data.settings.aiReminders,
      session: Object.assign({}, session, {
        cashOut: (Number(session.buyIn) || 0) + getSessionRecordedProfit(data.hands, payload.sessionId),
        currentProfit: getSessionRecordedProfit(data.hands, payload.sessionId)
      }),
      hand,
      recentHands,
      nowMs: timestamp
    }))
    : []
  if (nextReminders.length) {
    data.aiReminderQueue = (data.aiReminderQueue || []).concat(nextReminders)
  }
  writeStore(data)
  return hand
}

function updateHand(handId, patch) {
  const data = readStore()
  const previousHand = data.hands.find(item => item._id === handId) || null
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
  const updatedHand = data.hands.find(item => item._id === handId) || null
  const affectedSessionIds = [previousHand && previousHand.sessionId, updatedHand && updatedHand.sessionId]
    .filter((item, index, list) => item && list.indexOf(item) === index)
  affectedSessionIds.forEach(sessionId => refreshSessionRecordedStats(data, sessionId))
  if (updatedHand && patch && Object.prototype.hasOwnProperty.call(patch, 'currentProfit')) {
    const session = data.sessions.find(item => item._id === updatedHand.sessionId) || null
    const recentHands = data.hands
      .filter(item => item.sessionId === updatedHand.sessionId)
      .slice()
      .reverse()
    const nextReminders = isActiveSessionForAiReminder(session)
      ? filterNewAiReminders(data.aiReminderQueue, aiReminders.evaluateAiRemindersAfterHand({
        settings: data.settings.aiReminders,
        session: Object.assign({}, session, {
          cashOut: (Number(session.buyIn) || 0) + getSessionRecordedProfit(data.hands, updatedHand.sessionId),
          currentProfit: getSessionRecordedProfit(data.hands, updatedHand.sessionId)
        }),
        hand: updatedHand,
        recentHands,
        nowMs: now()
      }))
      : []
    if (nextReminders.length) {
      data.aiReminderQueue = (data.aiReminderQueue || []).concat(nextReminders)
    }
  }
  writeStore(data)
  return getHandById(handId)
}

function enqueueAiRemindersForHand(handId, options) {
  const config = options || {}
  const data = readStore()
  const targetHandId = String(handId || '').trim()
  const hand = data.hands.find(item => item && item._id === targetHandId) || null
  if (!hand) return []
  const session = data.sessions.find(item => item._id === hand.sessionId) || null
  if (!isActiveSessionForAiReminder(session)) return []
  const recentHands = data.hands
    .filter(item => item.sessionId === hand.sessionId)
    .slice()
    .reverse()
  let nextReminders = aiReminders.evaluateAiRemindersAfterHand({
    settings: data.settings.aiReminders,
    session: session ? Object.assign({}, session, {
      cashOut: (Number(session.buyIn) || 0) + getSessionRecordedProfit(data.hands, hand.sessionId),
      currentProfit: getSessionRecordedProfit(data.hands, hand.sessionId)
    }) : session,
    hand,
    recentHands,
    nowMs: Number(config.nowMs) || now()
  })
  if (config.includeTextReminders === false) {
    nextReminders = nextReminders.filter(item => item && item.type !== 'text_reminder')
  }
  nextReminders = filterNewAiReminders(data.aiReminderQueue, nextReminders)
  if (nextReminders.length) {
    data.aiReminderQueue = (data.aiReminderQueue || []).concat(nextReminders)
    writeStore(data)
  }
  return nextReminders
}

function deleteHand(handId) {
  const data = readStore()
  const hand = data.hands.find(item => item._id === handId)
  if (!hand) return false

  data.hands = data.hands.filter(item => item._id !== handId)
  data.handActions = data.handActions.filter(item => item.handId !== handId)
  refreshSessionRecordedStats(data, hand.sessionId)
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
  const data = readStore()
  return filterReviewHands(data.hands, filters || {}, now())
}

function getPlayerNotes(filters) {
  const config = filters || {}
  const q = String(config.query || '').trim().toLowerCase()
  const type = String(config.type || '').trim()
  return readStore().playerNotes
    .filter(item => config.includeArchived || !item.archived)
    .filter(item => !type || type === '全部' || item.type === type)
    .filter(item => {
      if (!q) return true
      return [
        item.name,
        item.alias.join(' '),
        item.note,
        item.leakTags.join(' ')
      ].join(' ').toLowerCase().indexOf(q) > -1
    })
    .sort(comparePlayerNoteDesc)
}

function getPlayerNoteById(id) {
  const noteId = String(id || '').trim()
  return readStore().playerNotes.find(item => item._id === noteId) || null
}

function createPlayerNote(payload) {
  const data = readStore()
  const timestamp = now()
  const candidate = normalizePlayerNote(Object.assign({}, payload || {}, {
    _id: createId('player_note'),
    createdAt: timestamp,
    updatedAt: timestamp
  }))
  if (!candidate.name) {
    throw new Error('PLAYER_NOTE_NAME_REQUIRED')
  }
  data.playerNotes.unshift(candidate)
  writeStore(data)
  return candidate
}

function updatePlayerNote(id, patch) {
  const data = readStore()
  const noteId = String(id || '').trim()
  let updated = null
  data.playerNotes = data.playerNotes.map(item => {
    if (item._id !== noteId) return item
    updated = normalizePlayerNote(Object.assign({}, item, patch || {}, {
      _id: item._id,
      createdAt: item.createdAt,
      updatedAt: now()
    }))
    return updated
  })
  if (!updated) return null
  if (!updated.name) {
    throw new Error('PLAYER_NOTE_NAME_REQUIRED')
  }
  writeStore(data)
  return updated
}

function deletePlayerNote(id) {
  return updatePlayerNote(id, { archived: true })
}

function addPlayerNoteBattleHand(noteId, handId) {
  const note = getPlayerNoteById(noteId)
  if (!note) return null
  return updatePlayerNote(noteId, {
    battleHandIds: normalizeStringList(note.battleHandIds.concat(String(handId || '').trim()), [])
  })
}

function removePlayerNoteBattleHand(noteId, handId) {
  const note = getPlayerNoteById(noteId)
  if (!note) return null
  const target = String(handId || '').trim()
  return updatePlayerNote(noteId, {
    battleHandIds: note.battleHandIds.filter(item => item !== target)
  })
}

function getSessionByHand(hand, sessions) {
  return (sessions || []).find(item => item && item._id === hand.sessionId) || null
}

function getHandActionLineSummary(hand) {
  const streets = hand && hand.streetInputs || {}
  const parts = ['preflop', 'flop', 'turn', 'river']
    .map(key => streets[key] && streets[key].actionLine ? actionLine.formatStreetSummary(streets[key].actionLine) : '')
    .filter(Boolean)
  if (parts.length) return parts.join(' / ')
  return actionLine.formatStreetSummary(hand && (hand.actionLine || hand.notes || ''))
}

function hasHandReplayData(hand, actions) {
  return !!(
    hand && (
      hand.ledgerState ||
      hand.handActions ||
      (hand.streetInputs && Object.keys(hand.streetInputs).length) ||
      (Array.isArray(actions) && actions.length)
    )
  )
}

function buildBattleHandSummary(hand, playerNote, sessions, actions) {
  const session = getSessionByHand(hand, sessions)
  const boardCardsVisual = cardUi.parseBoardFlat(hand.board || {})
  return {
    _id: hand._id,
    handId: hand._id,
    heroCardsVisual: cardUi.parseHeroCardsInput(hand.heroCardsInput),
    boardCardsVisual,
    heroPosition: hand.heroPosition || '',
    currentProfit: Number(hand.currentProfit) || 0,
    currentProfitDisplay: displaySignedAmount(Number(hand.currentProfit) || 0),
    playedDate: hand.playedDate || (session && session.date) || '',
    venue: (session && session.venue) || '',
    stakeLevel: hand.stakeLevel || (session && session.smallBlind && session.bigBlind ? session.smallBlind + '/' + session.bigBlind : ''),
    actionLine: getHandActionLineSummary(hand),
    relationshipText: 'Hero vs ' + (playerNote && playerNote.name || '玩家'),
    replayAvailable: hasHandReplayData(hand, actions),
    unavailable: false
  }
}

function displaySignedAmount(value) {
  const number = Number(value) || 0
  return (number >= 0 ? '+' : '') + number
}

function getPlayerNoteBattleHands(noteId) {
  const data = readStore()
  const note = getPlayerNoteById(noteId)
  if (!note) return []
  return note.battleHandIds
    .map(handId => {
      const hand = data.hands.find(item => item && item._id === handId)
      if (!hand) return null
      const actions = data.handActions.filter(item => item && item.handId === handId)
      return buildBattleHandSummary(hand, note, data.sessions, actions)
    })
    .filter(Boolean)
}

function isAiReminderEnabledByCurrentSettings(reminder, settings) {
  if (!reminder) return false
  const current = aiReminders.normalizeAiReminderSettings(settings && settings.aiReminders)
  if (!current.enabled) return false

  const rules = current.rules || {}
  const type = String(reminder.type || '')
  if (type === 'profit_target') {
    return Number(rules.profitTarget && rules.profitTarget.amount) > 0
  }
  if (type === 'loss_limit') {
    return Number(rules.lossLimit && rules.lossLimit.amount) > 0
  }
  if (type === 'trailing_profit') {
    return Number(rules.trailingProfit && rules.trailingProfit.percent) > 0
  }
  if (type === 'post_loss_extra_risk') {
    return Number(rules.lossLimit && rules.lossLimit.amount) > 0 &&
      Number(rules.postLossExtraRisk && rules.postLossExtraRisk.percent) > 0
  }
  if (type === 'session_max_hours') {
    return Number(rules.sessionMaxHours && rules.sessionMaxHours.hours) > 0
  }
  if (type === 'session_pre_reminder') {
    return Number(rules.sessionMaxHours && rules.sessionMaxHours.hours) > 0 &&
      Number(rules.sessionPreReminder && rules.sessionPreReminder.hoursBefore) > 0
  }
  if (type === 'text_reminder') {
    const title = String(reminder.title || '').trim()
    const message = String(reminder.message || '').trim()
    return (current.textReminders || []).some(item => {
      if (!item || item.enabled === false) return false
      return String(item.title || '').trim() === title ||
        String(item.content || item.title || '').trim() === message
    })
  }
  if (type === 'consecutive_loss') {
    return true
  }
  return true
}

function getPendingAiReminders() {
  const data = readStore()
  const currentMs = now()
  const activeSessionIds = new Set((data.sessions || [])
    .filter(isActiveSessionForAiReminder)
    .map(item => item._id))
  return (data.aiReminderQueue || [])
    .filter(item => item && item.status === 'pending')
    .filter(item => activeSessionIds.has(item.sessionId))
    .filter(item => isFreshPendingAiReminder(item, currentMs))
    .filter(item => isAiReminderEnabledByCurrentSettings(item, data.settings))
    .slice()
    .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))
}

function getAiRemindersBySessionId(sessionId) {
  const targetSessionId = String(sessionId || '').trim()
  if (!targetSessionId) return []
  return (readStore().aiReminderQueue || [])
    .filter(item => item && String(item.sessionId || '') === targetSessionId)
    .filter(item => item.status === 'pending' || item.status === 'shown')
    .slice()
    .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))
}

function getAiRemindersByHandId(handId) {
  const targetHandId = String(handId || '').trim()
  if (!targetHandId) return []
  return (readStore().aiReminderQueue || [])
    .filter(item => item && item.handId === targetHandId)
    .slice()
    .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))
}

function markAiReminderShown(reminderId) {
  const data = readStore()
  let updated = null
  data.aiReminderQueue = (data.aiReminderQueue || []).map(item => {
    if (!item || item._id !== reminderId) return item
    updated = Object.assign({}, item, {
      status: 'shown',
      shownAt: now()
    })
    return updated
  })
  writeStore(data)
  return updated
}

function markAiReminderSubscribeResult(reminderId, result) {
  const data = readStore()
  let updated = null
  const source = result || {}
  data.aiReminderQueue = (data.aiReminderQueue || []).map(item => {
    if (!item || item._id !== reminderId) return item
    updated = Object.assign({}, item, {
      subscribeStatus: source.status || 'skipped',
      subscribeMessage: source.message || '',
      subscribeUpdatedAt: now()
    })
    return updated
  })
  writeStore(data)
  return updated
}

function getStatsSummary() {
  const data = readStore()
  const sessionCount = data.sessions.length
  const totalProfit = data.sessions.reduce((sum, item) => {
    return sum + getSessionTotalProfit(item.status, item.buyIn, item.cashOut)
  }, 0)
  const historyHands = data.hands.filter(item => {
    const source = item && item.source || item && item.voiceExtract && item.voiceExtract.source
    return source === 'feishu_base_history_import'
  })
  const historySessions = data.sessions.filter(item => item && item.source && item.source.type === 'feishu_base_history_import')
  const historySessionMinutes = historySessions.reduce((sum, item) => sum + (Number(item.durationMinutes) || 0), 0)
  const historyFallbackMinutes = historyHands.length && historySessionMinutes === 0 ? 360 * 60 : 0
  const totalMinutes = data.sessions.reduce((sum, item) => sum + (Number(item.durationMinutes) || 0), 0) + historyFallbackMinutes
  const bankrollCurrent = getBankrollInitial() + totalProfit
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
  const data = readStore()
  return clone(data)
}

function importBackup(payload) {
  const next = ensureStoreShape(payload)
  writeStore(next)
  writeSettingsStore(next.settings)
  return next
}

function clearAllData() {
  const seed = buildInitialStoreData()
  removeSettingsStore()
  writeStore(seed)
  return seed
}

module.exports = {
  initStore,
  parseBlindPreset,
  getProfile,
  updateProfile,
  getSettings,
  getBankrollInitial,
  getDefaultSettings,
  updateSettings,
  replaceSettings,
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
  enqueueAiRemindersForHand,
  deleteHand,
  deleteSession,
  getReviewHands,
  getPlayerNotes,
  getPlayerNoteById,
  createPlayerNote,
  updatePlayerNote,
  deletePlayerNote,
  addPlayerNoteBattleHand,
  removePlayerNoteBattleHand,
  getPlayerNoteBattleHands,
  getPendingAiReminders,
  getAiRemindersBySessionId,
  getAiRemindersByHandId,
  markAiReminderShown,
  markAiReminderSubscribeResult,
  getStatsSummary,
  exportBackup,
  importBackup,
  clearAllData,
  __test: {
    buildInitialStoreData,
    ensureStoreShape,
    migrateHandEntryMetadata,
    normalizeProfile,
    normalizeSettings,
    normalizePlayerNote,
    getPlayerTypeColor,
    buildBattleHandSummary,
    readSettingsStore,
    filterReviewHands,
    getHandDuplicateKey,
    repairDuplicateHandsInPlace,
    resetCachedStoreForTest
  }
}
