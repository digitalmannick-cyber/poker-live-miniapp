const PENDING_VERSION = 2
const INDEX_VERSION = 1
const PENDING_PREFIX = 'playerCardImportPending:v2:'
const INDEX_PREFIX = 'playerCardImportPendingIndex:v1:'
const LEGACY_PREFIX = 'playerCardImportPending:'

function token(value) {
  return encodeURIComponent(String(value || '').trim())
}

function storageKey(accountId, shareId) {
  return PENDING_PREFIX + token(accountId) + ':' + token(shareId)
}

function indexKey(accountId) {
  return INDEX_PREFIX + token(accountId)
}

function hasStorage(method) {
  return typeof wx !== 'undefined' && typeof wx[method] === 'function'
}

function validIdentity(accountId, shareId) {
  return !!String(accountId || '').trim() && !!String(shareId || '').trim()
}

function isCanonicalShareId(shareId) {
  return /^pcs_[0-9a-f]{32}$/.test(String(shareId || '').trim())
}

function validPending(value, accountId, shareId) {
  return !!value && value.version === PENDING_VERSION &&
    value.accountId === accountId && value.shareId === shareId &&
    !!String(value.mutationId || '').trim()
}

function validIndex(value, accountId) {
  if (!value || value.version !== INDEX_VERSION || value.accountId !== accountId || !Array.isArray(value.keys)) return false
  const exactPrefix = PENDING_PREFIX + token(accountId) + ':'
  return value.keys.every(key => typeof key === 'string' && key.indexOf(exactPrefix) === 0) &&
    new Set(value.keys).size === value.keys.length
}

function readIndex(accountId) {
  if (!hasStorage('getStorageSync') || !String(accountId || '').trim()) return { ok: false, value: null }
  try {
    const value = wx.getStorageSync(indexKey(accountId))
    if (value == null) return { ok: true, exists: false, value: { version: INDEX_VERSION, accountId, keys: [] } }
    return validIndex(value, accountId) ? { ok: true, exists: true, value } : { ok: false, exists: true, value: null }
  } catch (error) {
    return { ok: false, value: null }
  }
}

function read(accountId, shareId) {
  const result = readPendingResult(accountId, shareId)
  return result.ok ? result.value : null
}

function readPendingResult(accountId, shareId) {
  if (!hasStorage('getStorageSync') || !validIdentity(accountId, shareId)) return { ok: false, value: null }
  try {
    const value = wx.getStorageSync(storageKey(accountId, shareId))
    if (value == null) return { ok: true, value: null }
    return validPending(value, accountId, shareId) ? { ok: true, value } : { ok: false, value: null }
  } catch (error) {
    return { ok: false, value: null }
  }
}

function write(value) {
  const accountId = String(value && value.accountId || '').trim()
  const shareId = String(value && value.shareId || '').trim()
  if (!hasStorage('setStorageSync') || !validPending(value, accountId, shareId)) return false
  const indexed = readIndex(accountId)
  if (!indexed.ok) return false
  const key = storageKey(accountId, shareId)
  const existing = readPendingResult(accountId, shareId)
  if (!existing || !existing.ok) return false
  const keys = indexed.value.keys.indexOf(key) > -1 ? indexed.value.keys.slice() : indexed.value.keys.concat(key)
  try {
    wx.setStorageSync(indexKey(accountId), { version: INDEX_VERSION, accountId, keys })
    wx.setStorageSync(key, Object.assign({}, value, { version: PENDING_VERSION, accountId, shareId }))
    return true
  } catch (error) {
    return false
  }
}

function clear(accountId, shareId, mutationId) {
  if (!hasStorage('removeStorageSync') || !validIdentity(accountId, shareId)) return false
  const indexed = readIndex(accountId)
  if (!indexed.ok) return false
  const key = storageKey(accountId, shareId)
  const pending = readPendingResult(accountId, shareId)
  if (!pending || !pending.ok) return false
  const current = pending.value
  if (current && mutationId && current.mutationId !== mutationId) return false
  if (!current && indexed.value.keys.indexOf(key) < 0) return true
  try {
    wx.removeStorageSync(key)
    const keys = indexed.value.keys.filter(item => item !== key)
    if (keys.length) wx.setStorageSync(indexKey(accountId), { version: INDEX_VERSION, accountId, keys })
    else wx.removeStorageSync(indexKey(accountId))
    return true
  } catch (error) {
    return false
  }
}

function clearAccount(accountId) {
  if (!hasStorage('removeStorageSync') || !String(accountId || '').trim()) return false
  const indexed = readIndex(accountId)
  if (!indexed.ok) return false
  if (!indexed.exists) return true
  try {
    for (const key of indexed.value.keys) {
      const value = wx.getStorageSync(key)
      if (value == null) continue
      if (!validPending(value, accountId, value.shareId) || storageKey(accountId, value.shareId) !== key) return false
    }
    indexed.value.keys.forEach(key => wx.removeStorageSync(key))
    wx.removeStorageSync(indexKey(accountId))
    return true
  } catch (error) {
    return false
  }
}

function clearLegacy(shareId) {
  const normalizedShareId = String(shareId || '').trim()
  if (!hasStorage('removeStorageSync') || !isCanonicalShareId(normalizedShareId)) return false
  try {
    wx.removeStorageSync(LEGACY_PREFIX + normalizedShareId)
    return true
  } catch (error) {
    return false
  }
}

module.exports = {
  storageKey,
  indexKey,
  read,
  write,
  clear,
  clearAccount,
  clearLegacy,
  isCanonicalShareId
}
