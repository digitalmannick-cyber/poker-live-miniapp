const AVATAR_CACHE_KEY = 'pokerLiveMiniappPlayerAvatarCache'
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

function clearAvatarCacheForTest() {
  writeCache({})
}

module.exports = {
  getAvatarDisplayUrl,
  rememberAvatarDisplay,
  cacheLocalAvatar,
  warmPlayerAvatar,
  warmPlayerAvatars,
  __test: {
    clearAvatarCacheForTest
  }
}
