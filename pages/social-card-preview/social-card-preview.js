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

function stableImportedPlayerId(mutationId) {
  const token = String(mutationId || '')
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
    importedPlayerId: ''
  },

  async onLoad(options) {
    this._cardPreviewAttached = true
    this._cardPreviewRequestId = 0
    const shareId = safeDecode(options && options.shareId)
    const pending = readPendingImport(shareId)
    const importMutationId = pending && pending.mutationId || socialMutation.createMutationId('import_player_card')
    this.setData({
      shareId,
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
  },

  async loadShare() {
    const shareId = String(this.data.shareId || '')
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
      if (share && share.imported && !pending) {
        this.setData({ share, status: 'imported', errorMessage: '' })
        return
      }
      const notes = await dataService.getPlayerNotes({ sourceKind: 'library' })
      if (!this._cardPreviewAttached || requestId !== this._cardPreviewRequestId) return
      const duplicate = importer.findDuplicateByName(notes, share && share.card && share.card.name)
      const needsResume = !!(pending && pending.serverConfirmed)
      this.setData({
        share,
        duplicate,
        status: needsResume ? 'error' : 'ready',
        errorMessage: needsResume ? '上次导入尚未写入玩家库，请继续完成。' : ''
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
    wx.showModal({
      title: '整体覆盖已有玩家',
      content: '将替换头像、名称、玩家类型、Leak 标签和 Note；保留玩家 ID 和对战手牌。',
      confirmText: '确认覆盖',
      confirmColor: '#e60012',
      success: result => {
        if (result && result.confirm) this.overwriteExisting()
      }
    })
  },

  overwriteExisting() {
    return this.runImport('overwrite')
  },

  async runImport(mode) {
    if (this.data.importing || this.data.status === 'imported') return
    if (!this.data.share || !this.data.share.card) return
    if (mode === 'overwrite' && !this.data.duplicate) return
    const createdPlayerNoteId = mode === 'new'
      ? (this.data.createdPlayerNoteId || stableImportedPlayerId(this.data.importMutationId))
      : ''
    const pending = {
      shareId: this.data.share.shareId || this.data.shareId,
      mutationId: this.data.importMutationId,
      mode,
      serverConfirmed: !!this.data.serverConfirmed,
      createdPlayerNoteId
    }
    writePendingImport(pending)
    this.setData({ importing: true, importMode: mode, status: this.data.serverConfirmed ? 'importing' : 'confirming', errorMessage: '' })
    try {
      if (!this.data.serverConfirmed) {
        await socialService.confirmPlayerCardImport({
          shareId: this.data.share.shareId || this.data.shareId,
          clientMutationId: this.data.importMutationId
        })
        pending.serverConfirmed = true
        writePendingImport(pending)
        this.setData({ serverConfirmed: true, status: 'importing', createdPlayerNoteId })
      }
      if (!this._cardPreviewAttached) return
      let copiedAvatar = this.data.copiedAvatar
      if (!copiedAvatar) {
        copiedAvatar = await importer.copyCardAvatar(
          this.data.share.card.avatarUrl,
          this.data.importMutationId
        )
        this.setData({ copiedAvatar })
      }
      if (!this._cardPreviewAttached) return
      const patch = importer.buildCardOverwritePatch(this.data.share.card, copiedAvatar)
      let saved
      if (mode === 'overwrite') {
        saved = await dataService.updatePlayerNote(this.data.duplicate._id, patch)
      } else if (this.data.createdPlayerNoteId) {
        const existing = typeof dataService.getPlayerNoteById === 'function'
          ? await dataService.getPlayerNoteById(this.data.createdPlayerNoteId)
          : null
        saved = existing || await dataService.createPlayerNote(Object.assign({ _id: this.data.createdPlayerNoteId }, patch))
      } else {
        saved = await dataService.createPlayerNote(Object.assign({ _id: createdPlayerNoteId }, patch))
        this.setData({ createdPlayerNoteId: String(saved && saved._id || '') })
      }
      if (!saved || !saved._id) throw new Error('玩家保存失败，请重试。')
      clearPendingImport(pending.shareId)
      if (!this._cardPreviewAttached) return
      this.setData({
        importing: false,
        status: 'imported',
        importedPlayerId: String(saved._id),
        errorMessage: ''
      })
    } catch (error) {
      if (!this._cardPreviewAttached) return
      if (unavailableError(error) && !this.data.serverConfirmed) clearPendingImport(pending.shareId)
      this.setData({
        importing: false,
        status: unavailableError(error) ? 'unavailable' : 'error',
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
