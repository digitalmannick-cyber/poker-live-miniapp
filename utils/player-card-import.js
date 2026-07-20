function normalizePlayerName(value) {
  const source = String(value || '')
  const compatible = typeof source.normalize === 'function' ? source.normalize('NFKC') : source
  return compatible.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
}

function findDuplicateByName(notes, name) {
  const expected = normalizePlayerName(name)
  if (!expected) return null
  return (Array.isArray(notes) ? notes : []).find(note => {
    const source = note || {}
    return source.sourceKind === 'library' && source.archived !== true && normalizePlayerName(source.name) === expected
  }) || null
}

function normalizeStringList(value) {
  const seen = Object.create(null)
  const result = []
  ;(Array.isArray(value) ? value : []).forEach(item => {
    const normalized = String(item || '').trim()
    if (!normalized || seen[normalized]) return
    seen[normalized] = true
    result.push(normalized)
  })
  return result
}

function buildCardOverwritePatch(card, avatar) {
  const source = card || {}
  const copiedAvatar = avatar || {}
  return {
    avatarUrl: String(copiedAvatar.avatarUrl || ''),
    avatarFileId: String(copiedAvatar.avatarFileId || ''),
    name: String(source.name || '').trim(),
    type: String(source.type || '未分类').trim() || '未分类',
    leakTags: normalizeStringList(source.leakTags),
    note: String(source.note || '').trim()
  }
}

function avatarError(code, message, cause) {
  const error = new Error(message)
  error.code = code
  if (cause) error.cause = cause
  return error
}

function requireHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || ''))
    if (parsed.protocol !== 'https:') throw new Error('HTTPS required')
    return parsed.toString()
  } catch (error) {
    throw avatarError('INVALID_CARD_AVATAR', 'player card avatar must be HTTPS', error)
  }
}

function safeCloudSegment(value) {
  return String(value || 'import')
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'import'
}

function downloadAvatar(url, downloadFile) {
  return new Promise((resolve, reject) => {
    if (typeof downloadFile !== 'function') {
      reject(avatarError('CARD_AVATAR_COPY_FAILED', 'avatar download unavailable'))
      return
    }
    downloadFile({
      url,
      success(result) {
        const statusCode = Number(result && result.statusCode) || 0
        const tempFilePath = String(result && result.tempFilePath || '')
        if ((statusCode && (statusCode < 200 || statusCode >= 300)) || !tempFilePath) {
          reject(avatarError('CARD_AVATAR_COPY_FAILED', 'avatar download failed'))
          return
        }
        resolve(tempFilePath)
      },
      fail(error) {
        reject(avatarError('CARD_AVATAR_COPY_FAILED', 'avatar download failed', error))
      }
    })
  })
}

function uploadAvatar(filePath, cloudPath, uploadFile) {
  return new Promise((resolve, reject) => {
    if (typeof uploadFile !== 'function') {
      reject(avatarError('CARD_AVATAR_COPY_FAILED', 'avatar upload unavailable'))
      return
    }
    uploadFile({
      cloudPath,
      filePath,
      success(result) {
        const fileId = String(result && (result.fileID || result.fileId) || '')
        if (!fileId.startsWith('cloud://')) {
          reject(avatarError('CARD_AVATAR_COPY_FAILED', 'avatar upload failed'))
          return
        }
        resolve(fileId)
      },
      fail(error) {
        reject(avatarError('CARD_AVATAR_COPY_FAILED', 'avatar upload failed', error))
      }
    })
  })
}

async function copyCardAvatar(avatarUrl, mutationId, adapters) {
  const source = String(avatarUrl || '').trim()
  if (!source) return { avatarUrl: '', avatarFileId: '' }
  const safeUrl = requireHttpsUrl(source)
  const config = adapters || {}
  const wxApi = typeof wx !== 'undefined' ? wx : {}
  const downloadFile = config.downloadFile || wxApi.downloadFile
  const uploadFile = config.uploadFile || wxApi.cloud && wxApi.cloud.uploadFile
  const tempFilePath = await downloadAvatar(safeUrl, downloadFile)
  const suffixMatch = safeUrl.match(/\.(png|jpe?g|webp)(?:\?|$)/i)
  const suffix = suffixMatch ? suffixMatch[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg'
  const cloudPath = 'player-card-imports/' + safeCloudSegment(mutationId) + '.' + suffix
  const fileId = await uploadAvatar(tempFilePath, cloudPath, uploadFile)
  return { avatarUrl: fileId, avatarFileId: fileId }
}

async function deleteCopiedCardAvatar(avatar, adapters) {
  const fileId = String(avatar && (avatar.avatarFileId || avatar.avatarUrl) || '').trim()
  if (!fileId.startsWith('cloud://')) return false
  const config = adapters || {}
  const wxApi = typeof wx !== 'undefined' ? wx : {}
  const deleteFile = config.deleteFile || wxApi.cloud && wxApi.cloud.deleteFile
  if (typeof deleteFile !== 'function') return false
  try {
    await deleteFile({ fileList: [fileId] })
    return true
  } catch (error) {
    return false
  }
}

module.exports = {
  normalizePlayerName,
  findDuplicateByName,
  buildCardOverwritePatch,
  copyCardAvatar,
  deleteCopiedCardAvatar,
  __test: { requireHttpsUrl, safeCloudSegment }
}
