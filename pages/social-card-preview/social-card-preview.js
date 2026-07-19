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
    receiptStatus: '',
    receiptMode: '',
    receiptTargetPlayerNoteId: '',
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
      receiptStatus: '',
      receiptMode: '',
      receiptTargetPlayerNoteId: '',
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
      let receipt
      try {
        receipt = await dataService.getPlayerCardImportReceipt(shareId)
      } catch (error) {
        if (!this._cardPreviewAttached || requestId !== this._cardPreviewRequestId) return
        this.setData({
          status: 'error',
          receiptCheckFailed: true,
          errorMessage: '暂时无法确认这张名片的导入状态，请联网后重试。'
        })
        return
      }
      if (!this._cardPreviewAttached || requestId !== this._cardPreviewRequestId) return
      const share = await socialService.getPlayerCardShare(shareId)
      if (!this._cardPreviewAttached || requestId !== this._cardPreviewRequestId) return
      const pending = readPendingImport(shareId)
      if (receipt && receipt.status === 'completed') {
        this.setData({
          share,
          status: 'imported',
          importedPlayerId: String(receipt.targetPlayerNoteId || ''),
          receiptStatus: 'completed',
          receiptMode: receipt.mode,
          receiptTargetPlayerNoteId: String(receipt.targetPlayerNoteId || ''),
          receiptCheckFailed: false
        })
        return
      }
      const notes = await dataService.getPlayerNotes({ sourceKind: 'library' })
      if (!this._cardPreviewAttached || requestId !== this._cardPreviewRequestId) return
      const nameDuplicate = importer.findDuplicateByName(notes, share && share.card && share.card.name)
      let duplicate = nameDuplicate
      let overwriteTargetMissing = false
      const resumeMode = receipt && receipt.status === 'pending' ? receipt.mode : (pending && pending.mode)
      const resumeTargetId = receipt && receipt.status === 'pending'
        ? String(receipt.targetPlayerNoteId || '')
        : String(pending && pending.overwriteTargetId || '')
      if (resumeMode === 'overwrite' && resumeTargetId) {
        const storedTarget = (Array.isArray(notes) ? notes : []).find(item => {
          return item && item._id === resumeTargetId && item.sourceKind === 'library' && item.archived !== true
        })
        if (storedTarget) duplicate = storedTarget
        else {
          duplicate = null
          overwriteTargetMissing = true
        }
      }
      const needsResume = !!(receipt && receipt.status === 'pending' || pending && pending.serverConfirmed)
      const serverConfirmed = !!(needsResume || share && share.imported)
      const createdPlayerNoteId = String(
        receipt && receipt.status === 'pending' && receipt.mode === 'new' && receipt.targetPlayerNoteId ||
        pending && pending.createdPlayerNoteId ||
        (share && share.imported ? stableImportedPlayerId(shareId) : '')
      )
      this.setData({
        share,
        duplicate,
        serverConfirmed,
        createdPlayerNoteId,
        importMode: String(resumeMode || ''),
        receiptStatus: String(receipt && receipt.status || ''),
        receiptMode: String(receipt && receipt.mode || ''),
        receiptTargetPlayerNoteId: String(receipt && receipt.targetPlayerNoteId || ''),
        overwriteTargetMissing,
        receiptCheckFailed: false,
        status: receipt && receipt.status === 'pending' && overwriteTargetMissing
          ? 'error'
          : (needsResume && !overwriteTargetMissing ? 'error' : 'ready'),
        errorMessage: overwriteTargetMissing
          ? '原覆盖目标已不存在或已归档，无法继续覆盖。'
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
    if (this.data.receiptStatus === 'pending' && this.data.receiptMode !== mode) return
    if (mode === 'overwrite' && !this.data.duplicate) return
    const shareId = String(this.data.share.shareId || this.data.shareId)
    const operationSequence = (this._cardPreviewOperationSeq || 0) + 1
    this._cardPreviewOperationSeq = operationSequence
    const createdPlayerNoteId = mode === 'new'
      ? (this.data.receiptTargetPlayerNoteId || this.data.createdPlayerNoteId || stableImportedPlayerId(this.data.share.shareId || this.data.shareId))
      : ''
    const overwriteTargetId = mode === 'overwrite'
      ? String(this.data.receiptTargetPlayerNoteId || this.data.duplicate._id || '')
      : ''
    const pending = {
      shareId: this.data.share.shareId || this.data.shareId,
      mutationId: this.data.importMutationId,
      mode,
      serverConfirmed: !!this.data.serverConfirmed,
      createdPlayerNoteId,
      overwriteTargetId
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
      if (this.data.receiptStatus !== 'pending') {
        const targetPlayerNoteId = mode === 'overwrite' ? overwriteTargetId : createdPlayerNoteId
        const begunReceipt = await dataService.beginPlayerCardImportReceipt({
          shareId,
          mode,
          targetPlayerNoteId,
          clientMutationId: this.data.importMutationId + ':begin-receipt'
        })
        if (!this.isCurrentOperation(operationSequence, shareId)) return
        if (!begunReceipt || begunReceipt.status !== 'pending') throw new Error('导入回执创建失败，请重试。')
        this.setData({
          receiptStatus: 'pending',
          receiptMode: begunReceipt.mode,
          receiptTargetPlayerNoteId: String(begunReceipt.targetPlayerNoteId || '')
        })
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
      const patch = importer.buildCardOverwritePatch(this.data.share.card, copiedAvatar)
      let saved
      if (mode === 'overwrite') {
        const targetId = String(pending.overwriteTargetId || '')
        const currentTarget = (await dataService.getPlayerNotes({ sourceKind: 'library', includeArchived: true })).find(item => {
          return item && item._id === targetId && item.sourceKind === 'library' && item.archived !== true
        })
        if (!this.isCurrentOperation(operationSequence, shareId)) return
        if (!currentTarget) {
          const error = new Error('原覆盖目标已不存在或已归档，无法继续覆盖。')
          error.code = 'OVERWRITE_TARGET_MISSING'
          throw error
        }
        saved = await dataService.updatePlayerNote(targetId, patch, { waitForCloud: true })
      } else {
        saved = await dataService.createPlayerNote(Object.assign({ _id: createdPlayerNoteId }, patch), { waitForCloud: true })
      }
      if (!saved || !saved._id) throw new Error('玩家保存失败，请重试。')
      if (!this.isCurrentOperation(operationSequence, shareId)) return
      const completedReceipt = await dataService.completePlayerCardImportReceipt(
        shareId,
        this.data.importMutationId + ':complete-receipt'
      )
      if (!this.isCurrentOperation(operationSequence, shareId)) return
      if (!completedReceipt || completedReceipt.status !== 'completed') throw new Error('导入回执完成失败，请重试。')
      clearMatchingPendingImport(pending.shareId, pending.mutationId)
      this.setData({
        importing: false,
        status: 'imported',
        importedPlayerId: String(saved._id),
        receiptStatus: 'completed',
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
