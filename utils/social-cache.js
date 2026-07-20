const FEED_CACHE_PREFIX = 'socialFeedFirstPage:'
const FEED_CACHE_TTL_MS = 300000
const SOCIAL_CACHE_SCHEMA_VERSION = 1
const FRIENDS_CACHE_PREFIX = 'socialFriendsFirstPage:'
const RANKING_CACHE_PREFIX = 'socialRankingFirstPage:'
const NOTIFICATIONS_CACHE_PREFIX = 'socialNotificationsFirstPage:'
const ACCOUNT_IDENTITY_PREFIX = 'socialCacheAccountIdentity:'
const RANKING_RANGES = Object.freeze(['week', 'month', 'all'])
const PRIVATE_CACHE_KEY_TOKENS = new Set([
  'openid', 'owneropenid', 'playerid', 'privateplayerid',
  'note', 'notes', 'notepreview', 'playernote', 'playernotes', 'leak', 'leaks', 'leaktag', 'leaktags',
  'battlehandids', 'linkedhandids', 'sourcehandid', 'handid', 'sessionid',
  'actions', 'rawhand', 'permission', 'canread', 'avatarfileid'
])
const SCOPE_LABELS = Object.freeze({
  square: '广场',
  friends: '全部好友',
  selected: '指定好友'
})

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = keys.slice().sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function safeString(value) {
  return typeof value === 'string' ? value : null
}

function normalizeCacheFieldName(value) {
  return String(value || '').replace(/[^0-9A-Za-z]/g, '').toLowerCase()
}

function isPrivateCacheFieldName(value) {
  return PRIVATE_CACHE_KEY_TOKENS.has(normalizeCacheFieldName(value))
}

function containsPrivateCacheData(value, seen) {
  if (!value || typeof value !== 'object') return false
  const visited = seen || new Set()
  if (visited.has(value)) return true
  visited.add(value)
  if (!Array.isArray(value) && Object.keys(value).some(isPrivateCacheFieldName)) return true
  return Object.keys(value).some(key => containsPrivateCacheData(value[key], visited))
}

function cloneCacheData(value) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || containsPrivateCacheData(value)) return null
  try {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) return null
    return JSON.parse(encoded)
  } catch (error) {
    return null
  }
}

function getScopedCacheKey(namespace, accountKey) {
  const accountId = safeString(accountKey)
  if (!accountId || !accountId.trim()) return ''
  const encoded = encodeURIComponent(accountId)
  if (namespace === 'friends') return FRIENDS_CACHE_PREFIX + encoded
  if (typeof namespace === 'string' && namespace.startsWith('ranking:')) {
    const range = namespace.slice('ranking:'.length)
    return RANKING_RANGES.includes(range) ? RANKING_CACHE_PREFIX + encoded + ':' + range : ''
  }
  return ''
}

function writeScopedFirstPage(input, now) {
  const source = input || {}
  const accountId = safeString(source.accountKey)
  const schemaVersion = source.schemaVersion
  const key = getScopedCacheKey(source.namespace, accountId)
  const savedAt = now === undefined ? Date.now() : now
  const data = cloneCacheData(source.data)
  if (!key || !Number.isSafeInteger(schemaVersion) || schemaVersion <= 0 ||
    !Number.isSafeInteger(savedAt) || savedAt <= 0 || data === null) return false
  try {
    if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return false
    wx.setStorageSync(key, { accountId, schemaVersion, savedAt, data })
    return true
  } catch (error) {
    return false
  }
}

function readScopedFirstPage(input, now) {
  const source = input || {}
  const accountId = safeString(source.accountKey)
  const schemaVersion = source.schemaVersion
  const key = getScopedCacheKey(source.namespace, accountId)
  const currentTime = now === undefined ? Date.now() : now
  if (!key || !Number.isSafeInteger(schemaVersion) || schemaVersion <= 0 ||
    !Number.isSafeInteger(currentTime) || currentTime <= 0) return null
  let cached
  try {
    if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return null
    cached = wx.getStorageSync(key)
  } catch (error) {
    return null
  }
  if (!exactKeys(cached, ['accountId', 'schemaVersion', 'savedAt', 'data'])) return null
  if (cached.accountId !== accountId || cached.schemaVersion !== schemaVersion ||
    !Number.isSafeInteger(cached.savedAt) || cached.savedAt <= 0 || cached.savedAt > currentTime ||
    currentTime - cached.savedAt > FEED_CACHE_TTL_MS) return null
  return cloneCacheData(cached.data)
}

function removeStorageKey(key) {
  if (!key) return false
  try {
    if (typeof wx === 'undefined' || typeof wx.removeStorageSync !== 'function') return false
    wx.removeStorageSync(key)
    return true
  } catch (error) {
    return false
  }
}

function getAccountIdentityKey(accountId) {
  const value = safeString(accountId)
  return value && value.trim() ? ACCOUNT_IDENTITY_PREFIX + encodeURIComponent(value) : ''
}

const SOCIAL_CACHE_KEY_BUILDERS = Object.freeze({
  notifications: accountId => typeof accountId === 'string' && accountId.trim() ? NOTIFICATIONS_CACHE_PREFIX + accountId : '',
  friends: accountId => getScopedCacheKey('friends', accountId),
  rankingWeek: accountId => getScopedCacheKey('ranking:week', accountId),
  rankingMonth: accountId => getScopedCacheKey('ranking:month', accountId),
  rankingAll: accountId => getScopedCacheKey('ranking:all', accountId),
  identity: accountId => getAccountIdentityKey(accountId),
  feed: socialUserId => getFeedCacheKey(socialUserId)
})

function registerAccountIdentity(input) {
  const source = input || {}
  const accountId = safeString(source.accountId)
  const socialUserId = safeString(source.socialUserId)
  const key = getAccountIdentityKey(accountId)
  if (!key || !socialUserId || !socialUserId.trim()) return false
  try {
    if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return false
    wx.setStorageSync(key, { accountId, socialUserId })
    return true
  } catch (error) {
    return false
  }
}

function readAccountIdentity(accountId) {
  const key = getAccountIdentityKey(accountId)
  if (!key) return null
  let value
  try {
    if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return null
    value = wx.getStorageSync(key)
  } catch (error) {
    return null
  }
  if (!exactKeys(value, ['accountId', 'socialUserId']) || value.accountId !== accountId ||
    typeof value.socialUserId !== 'string' || !value.socialUserId.trim()) return null
  return { accountId, socialUserId: value.socialUserId }
}

function clearAccountCaches(input) {
  const source = input || {}
  const accountId = safeString(source.accountId)
  const explicitSocialUserId = safeString(source.socialUserId)
  const mappedIdentity = accountId && accountId.trim() && (!explicitSocialUserId || !explicitSocialUserId.trim())
    ? readAccountIdentity(accountId)
    : null
  const socialUserId = explicitSocialUserId && explicitSocialUserId.trim()
    ? explicitSocialUserId
    : mappedIdentity && mappedIdentity.socialUserId || ''
  const keys = []
  if (accountId && accountId.trim()) {
    keys.push(SOCIAL_CACHE_KEY_BUILDERS.notifications(accountId))
    keys.push(SOCIAL_CACHE_KEY_BUILDERS.friends(accountId))
    keys.push(SOCIAL_CACHE_KEY_BUILDERS.rankingWeek(accountId))
    keys.push(SOCIAL_CACHE_KEY_BUILDERS.rankingMonth(accountId))
    keys.push(SOCIAL_CACHE_KEY_BUILDERS.rankingAll(accountId))
    keys.push(SOCIAL_CACHE_KEY_BUILDERS.identity(accountId))
  }
  if (socialUserId && socialUserId.trim()) keys.push(SOCIAL_CACHE_KEY_BUILDERS.feed(socialUserId))
  return Array.from(new Set(keys.filter(Boolean))).reduce((count, key) => count + (removeStorageKey(key) ? 1 : 0), 0)
}

function safeAvatarUrl(value) {
  const avatarUrl = safeString(value)
  if (avatarUrl === null || avatarUrl === '') return avatarUrl
  try {
    return new URL(avatarUrl).protocol === 'https:' ? avatarUrl : null
  } catch (error) {
    return null
  }
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function safeNumberOrNull(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0) ? value : undefined
}

function copyStringArray(value) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) return null
  return value.slice()
}

function copyBoard(value, strict) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (strict && !exactKeys(value, ['flop', 'turn', 'river'])) return null
  const flop = copyStringArray(value.flop)
  const turn = copyStringArray(value.turn)
  const river = copyStringArray(value.river)
  if (!flop || !turn || !river) return null
  return { flop, turn, river }
}

function copyPublisher(value, strict) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (strict && !exactKeys(value, ['socialUserId', 'nickname', 'avatarUrl', 'avatarText'])) return null
  const socialUserId = safeString(value.socialUserId)
  const nickname = safeString(value.nickname)
  const avatarUrl = safeAvatarUrl(value.avatarUrl)
  const avatarText = safeString(value.avatarText)
  if (!socialUserId || nickname === null || avatarUrl === null || avatarText === null) return null
  return { socialUserId, nickname, avatarUrl, avatarText }
}

function copySummary(value, strict) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const keys = ['heroCards', 'board', 'potBb', 'effectiveStackBb', 'actionCount', 'playerCount']
  if (strict && !exactKeys(value, keys)) return null
  const heroCards = copyStringArray(value.heroCards)
  const board = copyBoard(value.board, strict)
  const potBb = safeNumberOrNull(value.potBb)
  const effectiveStackBb = safeNumberOrNull(value.effectiveStackBb)
  const actionCount = safeCount(value.actionCount)
  const playerCount = safeCount(value.playerCount)
  if (!heroCards || !board || potBb === undefined || effectiveStackBb === undefined || actionCount === undefined || playerCount === undefined) return null
  return { heroCards, board, potBb, effectiveStackBb, actionCount, playerCount }
}

function copyFeedItem(value, strict) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const keys = ['shareId', 'publisher', 'scope', 'scopeLabel', 'summary', 'likedByMe', 'likeCount', 'commentCount', 'createdAt']
  if (strict && !exactKeys(value, keys)) return null
  const shareId = safeString(value.shareId)
  const publisher = copyPublisher(value.publisher, strict)
  const scope = safeString(value.scope)
  const scopeLabel = safeString(value.scopeLabel)
  const summary = copySummary(value.summary, strict)
  const likeCount = safeCount(value.likeCount)
  const commentCount = safeCount(value.commentCount)
  const createdAt = safeCount(value.createdAt)
  if (!shareId || !publisher || !Object.prototype.hasOwnProperty.call(SCOPE_LABELS, scope) || scopeLabel !== SCOPE_LABELS[scope] || !summary) return null
  if (typeof value.likedByMe !== 'boolean' || likeCount === null || commentCount === null || createdAt === null) return null
  return { shareId, publisher, scope, scopeLabel, summary, likedByMe: value.likedByMe, likeCount, commentCount, createdAt }
}

function copyItems(value, strict) {
  if (!Array.isArray(value)) return null
  const items = []
  for (const entry of value) {
    const item = copyFeedItem(entry, strict)
    if (!item) return null
    items.push(item)
  }
  return items
}

function copyFeedResponse(value) {
  if (!exactKeys(value, ['items', 'nextCursor'])) return null
  const items = copyItems(value.items, true)
  if (!items) return null
  if (value.nextCursor !== null && (typeof value.nextCursor !== 'string' || !value.nextCursor)) return null
  const nextCursor = value.nextCursor === null ? null : value.nextCursor
  return { items, nextCursor }
}

function getFeedCacheKey(socialUserId) {
  const id = safeString(socialUserId)
  return id && id.trim() ? FEED_CACHE_PREFIX + encodeURIComponent(id) : ''
}

function writeFeedFirstPage(socialUserId, response, now) {
  const key = getFeedCacheKey(socialUserId)
  const savedAt = now === undefined ? Date.now() : now
  if (containsPrivateCacheData(response)) return false
  const items = copyItems(response && response.items, false)
  const nextCursor = response && response.nextCursor === null ? '' : safeString(response && response.nextCursor)
  if (!key || !Number.isSafeInteger(savedAt) || savedAt <= 0 || !items || nextCursor === null) return false
  const value = { socialUserId, items, nextCursor, savedAt }
  try {
    if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return false
    wx.setStorageSync(key, value)
    return true
  } catch (error) {
    return false
  }
}

function readFeedFirstPage(socialUserId, now) {
  const key = getFeedCacheKey(socialUserId)
  const currentTime = now === undefined ? Date.now() : now
  if (!key || !Number.isSafeInteger(currentTime) || currentTime <= 0) return null
  let cached
  try {
    if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return null
    cached = wx.getStorageSync(key)
  } catch (error) {
    return null
  }
  if (containsPrivateCacheData(cached)) return null
  if (!exactKeys(cached, ['socialUserId', 'items', 'nextCursor', 'savedAt'])) return null
  if (cached.socialUserId !== socialUserId || typeof cached.nextCursor !== 'string') return null
  if (!Number.isSafeInteger(cached.savedAt) || cached.savedAt <= 0 || cached.savedAt > currentTime || currentTime - cached.savedAt > FEED_CACHE_TTL_MS) return null
  const items = copyItems(cached.items, true)
  if (!items) return null
  return { socialUserId, items, nextCursor: cached.nextCursor, savedAt: cached.savedAt }
}

function removeFeedFirstPage(socialUserId) {
  const key = getFeedCacheKey(socialUserId)
  if (!key) return false
  try {
    if (typeof wx === 'undefined' || typeof wx.removeStorageSync !== 'function') return false
    wx.removeStorageSync(key)
    return true
  } catch (error) {
    return false
  }
}

function clearAllFeedCaches() {
  let keys
  try {
    if (typeof wx === 'undefined' || typeof wx.getStorageInfoSync !== 'function') return 0
    const info = wx.getStorageInfoSync()
    keys = Array.isArray(info && info.keys) ? info.keys.slice() : []
  } catch (error) {
    return 0
  }
  let removed = 0
  for (const key of keys) {
    if (typeof key !== 'string' || !key.startsWith(FEED_CACHE_PREFIX)) continue
    try {
      if (typeof wx.removeStorageSync !== 'function') continue
      wx.removeStorageSync(key)
      removed += 1
    } catch (error) {}
  }
  return removed
}

module.exports = {
  FEED_CACHE_TTL_MS,
  SOCIAL_CACHE_SCHEMA_VERSION,
  SOCIAL_CACHE_KEY_BUILDERS,
  getScopedCacheKey,
  getAccountIdentityKey,
  registerAccountIdentity,
  readScopedFirstPage,
  writeScopedFirstPage,
  clearAccountCaches,
  copyFeedResponse,
  getFeedCacheKey,
  readFeedFirstPage,
  writeFeedFirstPage,
  removeFeedFirstPage,
  clearAllFeedCaches
}
