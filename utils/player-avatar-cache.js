const AVATAR_CACHE_KEY = 'pokerLiveMiniappPlayerAvatarCache'
const REMOTE_AVATAR_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const inFlight = {}

function readCache() {
  if (typeof wx === 'undefined' || !wx || typeof wx.getStorageSync !== 'function') return {}
  try {
    const cache = wx.getStorageSync(AVATAR_CACHE_KEY)
    return cache && typeof cache === 'object' ? cache : {}
  } catch (error) {
    return {}
  }
}

function writeCache(cache) {
  if (typeof wx === 'undefined' || !wx || typeof wx.setStorageSync !== 'function') return
  try {
    wx.setStorageSync(AVATAR_CACHE_KEY, cache || {})
  } catch (error) {}
}

function rememberAvatarDisplay(fileId, localPath) {
  const key = String(fileId || '').trim()
  const path = String(localPath || '').trim()
  if (!key || !path) return ''
  const cache = readCache()
  cache[key] = {
    localPath: path,
    updatedAt: Date.now()
  }
  writeCache(cache)
  return path
}

function getAvatarDisplayUrl(fileId, fallbackUrl) {
  const key = String(fileId || '').trim()
  const fallback = String(fallbackUrl || '').trim()
  if (!key) return fallback
  const item = readCache()[key]
  return item && item.localPath ? item.localPath : fallback
}

function socialAvatarKey(socialUserId) {
  const id = String(socialUserId || '').trim()
  return id ? `social-avatar:${id}` : ''
}

function getCachedAvatar(key) {
  const normalized = String(key || '').trim()
  if (!normalized) return null
  const item = readCache()[normalized]
  return item && item.localPath ? item : null
}

function cacheLocalAvatar(fileId, tempFilePath) {
  const key = String(fileId || '').trim()
  const path = String(tempFilePath || '').trim()
  if (!key || !path) return Promise.resolve('')
  if (typeof wx === 'undefined' || !wx || typeof wx.saveFile !== 'function') {
    return Promise.resolve(rememberAvatarDisplay(key, path))
  }
  return new Promise(resolve => {
    wx.saveFile({
      tempFilePath: path,
      success: result => resolve(rememberAvatarDisplay(key, result.savedFilePath || path)),
      fail: () => resolve(path)
    })
  })
}

function warmPlayerAvatar(note) {
  const item = note || {}
  const fileId = String(item.avatarFileId || item.avatarUrl || '').trim()
  if (!fileId || getAvatarDisplayUrl(fileId, '') || inFlight[fileId]) {
    return Promise.resolve(getAvatarDisplayUrl(fileId, ''))
  }
  if (typeof wx === 'undefined' || !wx || !wx.cloud || typeof wx.cloud.downloadFile !== 'function') {
    return Promise.resolve('')
  }
  inFlight[fileId] = true
  return new Promise(resolve => {
    wx.cloud.downloadFile({
      fileID: fileId,
      success: async result => {
        const localPath = await cacheLocalAvatar(fileId, result.tempFilePath || '')
        delete inFlight[fileId]
        resolve(localPath)
      },
      fail: () => {
        delete inFlight[fileId]
        resolve('')
      }
    })
  })
}

function warmPlayerAvatars(notes, onCached) {
  ;(Array.isArray(notes) ? notes : []).forEach(note => {
    warmPlayerAvatar(note).then(localPath => {
      if (localPath && typeof onCached === 'function') onCached()
    })
  })
}

function warmRemoteAvatar(cacheKey, remoteUrl) {
  const key = String(cacheKey || '').trim()
  const url = String(remoteUrl || '').trim()
  if (!key || !url) return Promise.resolve('')
  const cached = getCachedAvatar(key)
  if (cached && Date.now() - Number(cached.updatedAt || 0) < REMOTE_AVATAR_CACHE_MAX_AGE_MS) {
    return Promise.resolve(cached.localPath)
  }
  if (inFlight[key]) return inFlight[key]
  if (typeof wx === 'undefined' || !wx || typeof wx.downloadFile !== 'function') {
    return Promise.resolve(cached ? cached.localPath : '')
  }
  const request = new Promise(resolve => {
    wx.downloadFile({
      url,
      success: async result => resolve(await cacheLocalAvatar(key, result.tempFilePath || '')),
      fail: () => resolve(cached ? cached.localPath : '')
    })
  }).finally(() => {
    if (inFlight[key] === request) delete inFlight[key]
  })
  inFlight[key] = request
  return request
}

function warmRemoteAvatars(items, onCached) {
  const tasks = (Array.isArray(items) ? items : [])
    .map(item => ({
      cacheKey: String(item && item.avatarCacheKey || '').trim(),
      avatarUrl: String(item && item.avatarUrl || '').trim()
    }))
    .filter(item => item.cacheKey && item.avatarUrl)
    .map(item => warmRemoteAvatar(item.cacheKey, item.avatarUrl))
  return Promise.all(tasks).then(paths => {
    if (paths.some(Boolean) && typeof onCached === 'function') onCached()
    return paths
  })
}

function clearAvatarCacheForTest() {
  writeCache({})
}

module.exports = {
  getAvatarDisplayUrl,
  rememberAvatarDisplay,
  cacheLocalAvatar,
  warmPlayerAvatar,
  warmPlayerAvatars,
  socialAvatarKey,
  warmRemoteAvatar,
  warmRemoteAvatars,
  __test: {
    clearAvatarCacheForTest
  }
}
