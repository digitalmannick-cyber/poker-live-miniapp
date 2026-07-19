const socialService = require('../../services/social-service')
const dataService = require('../../services/data-service')
const socialMutation = require('../../utils/social-mutation')
const importer = require('../../utils/player-card-import')

function safeDecode(value) {
  const source = String(value || '')
  try { return decodeURIComponent(source).trim() } catch (error) { return source.trim() }
}

function unavailableError(error) {
  const code = String(error && error.code || '')
  return [
    'PLAYER_CARD_UNAVAILABLE', 'CONTENT_UNAVAILABLE', 'FORBIDDEN',
    'FRIENDSHIP_REQUIRED', 'SOCIAL_PROFILE_REQUIRED'
  ].indexOf(code) > -1
}

function errorMessage(error) {
  if (unavailableError(error)) return '这张玩家名片已失效或不可访问。'
  if (String(error && error.code || '') === 'CARD_AVATAR_COPY_FAILED') return '头像保存失败，请检查网络后重试。'
  return String(error && (error.message || error.errMsg) || '暂时无法完成导入，请稍后重试。')
}

function pendingStorageKey(shareId) {
  return 'playerCardImportPending:' + String(shareId || '')
}

function readPendingImport(shareId) {
  if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return null
  const value = wx.getStorageSync(pendingStorageKey(shareId))
  if (!value || value.shareId !== shareId || !value.mutationId) return null
  return value
}

function writePendingImport(value) {
  if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return
  wx.setStorageSync(pendingStorageKey(value && value.shareId), value)
}

function clearPendingImport(shareId) {
  if (typeof wx === 'undefined' || typeof wx.removeStorageSync !== 'function') return
  wx.removeStorageSync(pendingStorageKey(shareId))
}

function markPendingServerConfirmed(pending) {
  const current = readPendingImport(pending && pending.shareId)
  if (current && current.mutationId !== pending.mutationId) return false
  pending.serverConfirmed = true
  writePendingImport(pending)
  return true
}

function clearMatchingPendingImport(shareId, mutationId) {
  const current = readPendingImport(shareId)
  if (current && current.mutationId !== mutationId) return false
  clearPendingImport(shareId)
  return true
}

function completedStorageKey(shareId) {
  return 'playerCardImportCompleted:' + String(shareId || '')
}

function readCompletedImport(shareId) {
  if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return null
  const value = wx.getStorageSync(completedStorageKey(shareId))
  if (!value || value.shareId !== shareId || !value.playerId) return null
  return value
}

function writeCompletedImport(value) {
  if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return
  wx.setStorageSync(completedStorageKey(value && value.shareId), value)
}

function stableImportedPlayerId(shareId) {
  const token = String(shareId || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 96)
  return 'player_note_card_' + (token || Date.now())
}

Page({
  data: {
    shareId: '',
    share: null,
    duplicate: null,
    status: 'loading',
    errorMessage: '',
    importing: false,
    importMode: '',
    importMutationId: '',
    serverConfirmed: false,
    copiedAvatar: null,
    createdPlayerNoteId: '',
    importedPlayerId: '',
    overwriteTargetMissing: false,
    receiptCheckFailed: false
  },

  async onLoad(options) {
    this._cardPreviewAttached = true
    this._cardPreviewRequestId = Number(this._cardPreviewRequestId) || 0
    this._cardPreviewOperationSeq = Number(this._cardPreviewOperationSeq) || 0
    const shareId = safeDecode(options && options.shareId)
    const pending = readPendingImport(shareId)
    const importMutationId = pending && pending.mutationId || socialMutation.createMutationId('import_player_card')
    this.setData({
      shareId,
      share: null,
      duplicate: null,
      status: 'loading',
      errorMessage: '',
      importing: false,
      copiedAvatar: null,
      importedPlayerId: '',
      overwriteTargetMissing: false,
      receiptCheckFailed: false,
      importMutationId,
      serverConfirmed: !!(pending && pending.serverConfirmed),
      importMode: String(pending && pending.mode || ''),
      createdPlayerNoteId: String(pending && pending.createdPlayerNoteId || '')
    })
    await this.loadShare()
  },

  onUnload() {
    this._cardPreviewAttached = false
    this._cardPreviewRequestId = (this._cardPreviewRequestId || 0) + 1
    this._cardPreviewOperationSeq = (this._cardPreviewOperationSeq || 0) + 1
  },

  isCurrentOperation(sequence, shareId) {
    return !!this._cardPreviewAttached &&
      sequence === this._cardPreviewOperationSeq &&
      String(this.data.shareId || '') === String(shareId || '')
  },

  async loadShare() {
    const shareId = String(this.data.shareId || '')
    this._cardPreviewOperationSeq = (this._cardPreviewOperationSeq || 0) + 1
    const requestId = (this._cardPreviewRequestId || 0) + 1
    this._cardPreviewRequestId = requestId
    if (!shareId) {
      this.setData({ status: 'unavailable', errorMessage: '这张玩家名片已失效或不可访问。' })
      return
    }
    this.setData({ status: 'loading', errorMessage: '' })
    try {
      const share = await socialService.getPlayerCardShare(shareId)
      if (!this._cardPreviewAttached || requestId !== this._cardPreviewRequestId) return
      const pending = readPendingImport(shareId)
      let notes
      if (share && share.imported) {
        const completed = readCompletedImport(shareId)
        if (completed) {
          this.setData({ share, status: 'imported', importedPlayerId: String(completed.playerId), receiptCheckFailed: false })
          return
        }
        try {
          notes = await dataService.refreshPlayerNotesFromCloud()
        } catch (error) {
          if (!this._cardPreviewAttached || requestId !== this._cardPreviewRequestId) return
          this.setData({
            share,
            serverConfirmed: true,
            status: 'error',
            receiptCheckFailed: true,
            errorMessage: '暂时无法确认这张名片是否已写入玩家库，请联网后重试。'
          })
          return
        }
        if (!this._cardPreviewAttached || requestId !== this._cardPreviewRequestId) return
        const cloudReceipt = (Array.isArray(notes) ? notes : []).find(item => item && item.importedCardShareId === shareId)
        if (cloudReceipt) {
          this.setData({ share, status: 'imported', importedPlayerId: String(cloudReceipt._id), receiptCheckFailed: false })
          return
        }
      } else {
        notes = await dataService.getPlayerNotes({ sourceKind: 'library' })
      }
      if (!this._cardPreviewAttached || requestId !== this._cardPreviewRequestId) return
      const nameDuplicate = importer.findDuplicateByName(notes, share && share.card && share.card.name)
      let duplicate = nameDuplicate
      let overwriteTargetMissing = false
      if (pending && pending.mode === 'overwrite' && pending.overwriteTargetId) {
        const storedTarget = (Array.isArray(notes) ? notes : []).find(item => {
          return item && item._id === pending.overwriteTargetId && item.sourceKind === 'library' && item.archived !== true
        })
        if (storedTarget) duplicate = storedTarget
        else overwriteTargetMissing = true
      }
      const needsResume = !!(pending && pending.serverConfirmed)
      const serverConfirmed = !!(pending && pending.serverConfirmed || share && share.imported)
      const createdPlayerNoteId = String(pending && pending.createdPlayerNoteId || (share && share.imported ? stableImportedPlayerId(shareId) : ''))
      this.setData({
        share,
        duplicate,
        serverConfirmed,
        createdPlayerNoteId,
        overwriteTargetMissing,
        receiptCheckFailed: false,
        status: needsResume && !overwriteTargetMissing ? 'error' : 'ready',
        errorMessage: overwriteTargetMissing
          ? '上次选择覆盖的玩家已不存在，请重新明确选择。'
          : (needsResume ? '上次导入尚未写入玩家库，请继续完成。' : '')
      })
    } catch (error) {
      if (!this._cardPreviewAttached || requestId !== this._cardPreviewRequestId) return
      this.setData({
        status: unavailableError(error) ? 'unavailable' : 'error',
        errorMessage: errorMessage(error)
      })
    }
  },

  retryLoad() {
    if (this.data.importing) return
    return this.loadShare()
  },

  importAsNew() {
    return this.runImport('new')
  },

  requestOverwrite() {
    if (this.data.importing || !this.data.duplicate) return
    const shareId = String(this.data.shareId || '')
    const operationSequence = this._cardPreviewOperationSeq || 0
    wx.showModal({
      title: '整体覆盖已有玩家',
      content: '将替换头像、名称、玩家类型、Leak 标签和 Note；保留玩家 ID 和对战手牌。',
      confirmText: '确认覆盖',
      confirmColor: '#e60012',
      success: result => {
        if (result && result.confirm && this.isCurrentOperation(operationSequence, shareId)) this.overwriteExisting()
      }
    })
  },

  overwriteExisting() {
    return this.runImport('overwrite')
  },

  async runImport(mode) {
    if (this.data.importing || this.data.status === 'imported') return
    if (this.data.receiptCheckFailed) return
    if (!this.data.share || !this.data.share.card) return
    if (mode === 'overwrite' && !this.data.duplicate) return
    const shareId = String(this.data.share.shareId || this.data.shareId)
    const operationSequence = (this._cardPreviewOperationSeq || 0) + 1
    this._cardPreviewOperationSeq = operationSequence
    const createdPlayerNoteId = mode === 'new'
      ? (this.data.createdPlayerNoteId || stableImportedPlayerId(this.data.share.shareId || this.data.shareId))
      : ''
    const pending = {
      shareId: this.data.share.shareId || this.data.shareId,
      mutationId: this.data.importMutationId,
      mode,
      serverConfirmed: !!this.data.serverConfirmed,
      createdPlayerNoteId,
      overwriteTargetId: mode === 'overwrite' ? String(this.data.duplicate._id || '') : ''
    }
    writePendingImport(pending)
    this.setData({ importing: true, importMode: mode, status: this.data.serverConfirmed ? 'importing' : 'confirming', errorMessage: '' })
    try {
      if (!this.data.serverConfirmed) {
        await socialService.confirmPlayerCardImport({
          shareId: this.data.share.shareId || this.data.shareId,
          clientMutationId: this.data.importMutationId
        })
        markPendingServerConfirmed(pending)
        if (!this.isCurrentOperation(operationSequence, shareId)) return
        this.setData({ serverConfirmed: true, status: 'importing', createdPlayerNoteId })
      }
      if (!this.isCurrentOperation(operationSequence, shareId)) return
      let copiedAvatar = this.data.copiedAvatar
      if (!copiedAvatar) {
        copiedAvatar = await importer.copyCardAvatar(
          this.data.share.card.avatarUrl,
          this.data.importMutationId
        )
        if (!this.isCurrentOperation(operationSequence, shareId)) return
        this.setData({ copiedAvatar })
      }
      if (!this.isCurrentOperation(operationSequence, shareId)) return
      const patch = Object.assign(importer.buildCardOverwritePatch(this.data.share.card, copiedAvatar), {
        importedCardShareId: shareId,
        importedCardMode: mode
      })
      let saved
      if (mode === 'overwrite') {
        const targetId = String(pending.overwriteTargetId || '')
        const currentTarget = (await dataService.getPlayerNotes({ sourceKind: 'library', includeArchived: true })).find(item => {
          return item && item._id === targetId && item.sourceKind === 'library' && item.archived !== true
        })
        if (!this.isCurrentOperation(operationSequence, shareId)) return
        if (!currentTarget) {
          const error = new Error('上次选择覆盖的玩家已不存在，请重新明确选择。')
          error.code = 'OVERWRITE_TARGET_MISSING'
          throw error
        }
        saved = await dataService.updatePlayerNote(targetId, patch, { waitForCloud: true })
      } else {
        saved = await dataService.createPlayerNote(Object.assign({ _id: createdPlayerNoteId }, patch), { waitForCloud: true })
      }
      if (!saved || !saved._id) throw new Error('玩家保存失败，请重试。')
      writeCompletedImport({ shareId, playerId: String(saved._id), mode })
      clearMatchingPendingImport(pending.shareId, pending.mutationId)
      if (!this.isCurrentOperation(operationSequence, shareId)) return
      this.setData({
        importing: false,
        status: 'imported',
        importedPlayerId: String(saved._id),
        errorMessage: ''
      })
    } catch (error) {
      if (!this.isCurrentOperation(operationSequence, shareId)) return
      if (unavailableError(error) && !this.data.serverConfirmed) clearPendingImport(pending.shareId)
      this.setData({
        importing: false,
        status: String(error && error.code || '') === 'OVERWRITE_TARGET_MISSING' ? 'ready' : (unavailableError(error) ? 'unavailable' : 'error'),
        overwriteTargetMissing: String(error && error.code || '') === 'OVERWRITE_TARGET_MISSING',
        errorMessage: errorMessage(error)
      })
    }
  },

  openImportedPlayer() {
    const playerId = String(this.data.importedPlayerId || this.data.createdPlayerNoteId || '')
    if (!playerId || typeof wx === 'undefined' || !wx.navigateTo) return
    wx.navigateTo({ url: '/pages/player-note-detail/player-note-detail?id=' + encodeURIComponent(playerId) })
  },

  goBack() {
    if (typeof wx !== 'undefined' && wx.navigateBack) wx.navigateBack()
  }
})
