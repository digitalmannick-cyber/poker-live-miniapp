const socialService = require('../../services/social-service')
const socialMutation = require('../../utils/social-mutation')

const SCOPES = ['square', 'friends', 'selected']
const FRIEND_PAGE_SIZE = 20
const MAX_SELECTED = 50

function text(value) {
  return String(value || '').trim()
}

function safeDecodeURIComponent(value) {
  const raw = text(value)
  try {
    return decodeURIComponent(raw)
  } catch (error) {
    return raw
  }
}

function normalizeScope(value) {
  const scope = text(value)
  return SCOPES.indexOf(scope) >= 0 ? scope : ''
}

function eventValue(event, key) {
  const dataset = event && event.currentTarget && event.currentTarget.dataset
  return text(dataset && dataset[key])
}

function uniqueFriends(left, right) {
  const seen = {}
  return (Array.isArray(left) ? left : []).concat(Array.isArray(right) ? right : []).reduce((result, item) => {
    const socialUserId = text(item && item.socialUserId)
    if (!socialUserId || seen[socialUserId]) return result
    seen[socialUserId] = true
    result.push(Object.assign({}, item, { socialUserId, selected: !!(item && item.selected) }))
    return result
  }, [])
}

function sortedTargets(values) {
  const seen = {}
  return (Array.isArray(values) ? values : []).map(text).filter(value => {
    if (!value || seen[value]) return false
    seen[value] = true
    return true
  }).sort()
}

function publishKey(input) {
  return JSON.stringify([
    text(input.handId),
    text(input.previewHash),
    text(input.scope),
    sortedTargets(input.targetUserIds)
  ])
}

function errorCode(error) {
  return text(error && error.code) || 'SOCIAL_ERROR'
}

function previewErrorMessage(code) {
  if (code === 'NETWORK_ERROR' || code === 'SOCIAL_UNAVAILABLE' || code === 'SOCIAL_ERROR') return '网络暂时不可用，请稍后重试。'
  if (code === 'HAND_SOURCE_UPDATING') return '手牌正在同步，请稍后重新预览。'
  return '这手牌暂时无法发布。'
}

function publishErrorMessage(code) {
  if (code === 'INVALID_SHARE_SCOPE') return '发布范围已变化，请检查范围和好友选择。'
  if (code === 'RATE_LIMITED') return '发布太频繁，请稍后再试。'
  if (code === 'HAND_ALREADY_SHARED') return '这手牌已经发布过了。'
  if (code === 'NETWORK_ERROR' || code === 'SOCIAL_UNAVAILABLE' || code === 'SOCIAL_ERROR') return '发布失败，请检查网络后重试。'
  return '发布条件已变化，请重新确认。'
}

function isUnavailableCode(code) {
  return ['CONTENT_UNAVAILABLE', 'FORBIDDEN', 'HAND_NOT_FOUND', 'INVALID_HAND_SNAPSHOT'].indexOf(code) >= 0
}

Page({
  data: {
    handId: '',
    status: 'loading',
    snapshot: null,
    previewHash: '',
    scope: '',
    friends: [],
    nextFriendOffset: null,
    friendLoading: false,
    friendLoadingMore: false,
    friendLoadMoreError: '',
    selectedTargetUserIds: [],
    publishLoading: false,
    errorCode: '',
    errorMessage: '',
    shareId: ''
  },

  onLoad(options) {
    this._pageAttached = true
    this._pageVisible = true
    this._hasShown = false
    this._lifecycleSequence = Number(this._lifecycleSequence) || 0
    this._previewSequence = Number(this._previewSequence) || 0
    this._friendSequence = Number(this._friendSequence) || 0
    this._publishSequence = Number(this._publishSequence) || 0
    const handId = safeDecodeURIComponent(options && options.handId)
    this.invalidateLifecycle()
    this.setData({ handId })
    return this.loadPreview()
  },

  onShow() {
    if (!this._hasShown) {
      this._hasShown = true
      this._pageAttached = true
      this._pageVisible = true
      return Promise.resolve()
    }
    if (this._pageVisible) return Promise.resolve()
    this._pageAttached = true
    this._pageVisible = true
    this.invalidateLifecycle()
    return this.loadPreview()
  },

  onHide() {
    this._pageVisible = false
    this.invalidateLifecycle()
  },

  onUnload() {
    this._pageAttached = false
    this._pageVisible = false
    this.invalidateLifecycle()
  },

  invalidateLifecycle() {
    this._lifecycleSequence = (Number(this._lifecycleSequence) || 0) + 1
    this._previewSequence = (Number(this._previewSequence) || 0) + 1
    this._friendSequence = (Number(this._friendSequence) || 0) + 1
    this._publishSequence = (Number(this._publishSequence) || 0) + 1
    this._friendFlight = null
  },

  isPreviewCurrent(sequence, lifecycle, handId) {
    return this._pageAttached !== false && this._pageVisible !== false && sequence === this._previewSequence &&
      lifecycle === this._lifecycleSequence && handId === text(this.data.handId)
  },

  retryPreview() {
    this._previewSequence = (Number(this._previewSequence) || 0) + 1
    this._friendSequence = (Number(this._friendSequence) || 0) + 1
    this._publishSequence = (Number(this._publishSequence) || 0) + 1
    this._friendFlight = null
    return this.loadPreview()
  },

  async loadPreview() {
    const handId = text(this.data.handId)
    const lifecycle = this._lifecycleSequence
    const sequence = (Number(this._previewSequence) || 0) + 1
    this._previewSequence = sequence
    this.setData({
      status: 'loading',
      snapshot: null,
      previewHash: '',
      scope: '',
      friends: [],
      nextFriendOffset: null,
      friendLoading: false,
      friendLoadingMore: false,
      friendLoadMoreError: '',
      selectedTargetUserIds: [],
      publishLoading: false,
      errorCode: '',
      errorMessage: '',
      shareId: ''
    })
    if (!handId) {
      if (this.isPreviewCurrent(sequence, lifecycle, handId)) {
        this.setData({ status: 'unavailable', errorCode: 'CONTENT_UNAVAILABLE', errorMessage: '缺少手牌 ID。' })
      }
      return
    }
    try {
      const result = await socialService.previewHandShare({ handId })
      if (!this.isPreviewCurrent(sequence, lifecycle, handId)) return
      const previewHash = text(result && result.previewHash)
      const snapshot = result && result.snapshot
      if (!previewHash || !snapshot || typeof snapshot !== 'object') {
        this.setData({ status: 'unavailable', errorCode: 'CONTENT_UNAVAILABLE', errorMessage: '服务端预览不可用。' })
        return
      }
      this.setData({
        status: 'ready',
        snapshot,
        previewHash,
        scope: '',
        errorCode: '',
        errorMessage: ''
      })
    } catch (error) {
      if (!this.isPreviewCurrent(sequence, lifecycle, handId)) return
      const code = errorCode(error)
      this.setData({
        status: isUnavailableCode(code) ? 'unavailable' : 'error',
        errorCode: code,
        errorMessage: previewErrorMessage(code)
      })
    }
  },

  changeScope(event) {
    const requested = eventValue(event, 'scope')
    if (this.data.publishLoading || SCOPES.indexOf(requested) < 0 || requested === this.data.scope) return Promise.resolve()
    const leavingSelected = this.data.scope === 'selected' && requested !== 'selected'
    this._publishSequence = (Number(this._publishSequence) || 0) + 1
    if (leavingSelected) {
      this._friendSequence = (Number(this._friendSequence) || 0) + 1
      this._friendFlight = null
    }
    this.setData({
      scope: requested,
      selectedTargetUserIds: leavingSelected ? [] : this.data.selectedTargetUserIds,
      friends: leavingSelected ? this.data.friends.map(item => Object.assign({}, item, { selected: false })) : this.data.friends,
      errorCode: '',
      errorMessage: ''
    })
    if (requested === 'selected' && !this.data.friends.length) return this.loadFirstFriends()
    return Promise.resolve()
  },

  loadFirstFriends() {
    this._friendSequence = (Number(this._friendSequence) || 0) + 1
    this._friendFlight = null
    this.setData({
      friends: [],
      nextFriendOffset: null,
      friendLoading: true,
      friendLoadingMore: false,
      friendLoadMoreError: '',
      selectedTargetUserIds: []
    })
    return this.loadFriendPage(0, false)
  },

  loadMoreFriends() {
    if (this._friendFlight) return this._friendFlight
    const offset = this.data.nextFriendOffset
    if (this.data.scope !== 'selected' || offset === null || offset === undefined) return Promise.resolve()
    this.setData({ friendLoadingMore: true, friendLoadMoreError: '' })
    return this.loadFriendPage(Math.max(0, Number(offset) || 0), true)
  },

  loadFriendPage(offset, append) {
    if (this._friendFlight) return this._friendFlight
    const lifecycle = this._lifecycleSequence
    const sequence = this._friendSequence
    const handId = text(this.data.handId)
    const flight = (async () => {
      try {
        const result = await socialService.listFriends({ offset, limit: FRIEND_PAGE_SIZE })
        if (!this.isFriendCurrent(sequence, lifecycle, handId)) return
        const selected = {}
        this.data.selectedTargetUserIds.forEach(id => { selected[id] = true })
        const incoming = (Array.isArray(result && result.items) ? result.items : []).map(item =>
          Object.assign({}, item, { selected: !!selected[text(item && item.socialUserId)] })
        )
        const friends = uniqueFriends(append ? this.data.friends : [], incoming)
        const candidateOffset = result && result.nextOffset !== null && result.nextOffset !== undefined
          ? Number(result.nextOffset)
          : NaN
        const nextOffset = Number.isFinite(candidateOffset) && candidateOffset > offset
          ? candidateOffset
          : null
        this.setData({
          friends,
          nextFriendOffset: nextOffset,
          friendLoading: false,
          friendLoadingMore: false,
          friendLoadMoreError: ''
        })
      } catch (error) {
        if (!this.isFriendCurrent(sequence, lifecycle, handId)) return
        this.setData({
          friendLoading: false,
          friendLoadingMore: false,
          friendLoadMoreError: append ? '加载更多失败，请重试。' : '好友列表加载失败，请重试。'
        })
      }
    })()
    this._friendFlight = flight
    flight.then(() => {
      if (this._friendFlight === flight) this._friendFlight = null
    }, () => {
      if (this._friendFlight === flight) this._friendFlight = null
    })
    return flight
  },

  isFriendCurrent(sequence, lifecycle, handId) {
    return this._pageAttached !== false && this._pageVisible !== false && sequence === this._friendSequence &&
      lifecycle === this._lifecycleSequence && handId === text(this.data.handId) && this.data.scope === 'selected'
  },

  toggleTarget(event) {
    if (this.data.scope !== 'selected' || this.data.publishLoading) return
    const targetUserId = eventValue(event, 'id')
    if (!targetUserId || !this.data.friends.some(item => text(item.socialUserId) === targetUserId)) return
    const targets = sortedTargets(this.data.selectedTargetUserIds)
    const existingIndex = targets.indexOf(targetUserId)
    if (existingIndex >= 0) targets.splice(existingIndex, 1)
    else if (targets.length >= MAX_SELECTED) {
      wx.showToast({ title: '最多选择 50 位好友', icon: 'none' })
      return
    } else targets.push(targetUserId)
    targets.sort()
    const selected = {}
    targets.forEach(id => { selected[id] = true })
    this._publishSequence = (Number(this._publishSequence) || 0) + 1
    this.setData({
      selectedTargetUserIds: targets,
      friends: this.data.friends.map(item => Object.assign({}, item, { selected: !!selected[text(item.socialUserId)] })),
      errorCode: '',
      errorMessage: ''
    })
  },

  submitPublish() {
    if (this._publishFlight) return this._publishFlight
    const flight = this.performPublish()
    this._publishFlight = flight
    flight.then(() => {
      if (this._publishFlight === flight) this._publishFlight = null
    }, () => {
      if (this._publishFlight === flight) this._publishFlight = null
    })
    return flight
  },

  async performPublish() {
    const handId = text(this.data.handId)
    const previewHash = text(this.data.previewHash)
    const scope = normalizeScope(this.data.scope)
    const targetUserIds = scope === 'selected' ? sortedTargets(this.data.selectedTargetUserIds) : []
    if (!handId || !previewHash || !this.data.snapshot) {
      this.setData({ status: 'error', errorCode: 'CONTENT_UNAVAILABLE', errorMessage: '请先重新读取手牌预览。' })
      return
    }
    if (!scope) {
      this.setData({ status: 'ready', errorCode: 'INVALID_SHARE_SCOPE', errorMessage: '请选择本次手牌的发布范围。' })
      return
    }
    if (scope === 'selected' && (targetUserIds.length < 1 || targetUserIds.length > MAX_SELECTED)) {
      this.setData({ status: 'ready', errorCode: 'INVALID_SHARE_SCOPE', errorMessage: '请至少选择 1 位好友，最多 50 位。' })
      return
    }
    const lifecycle = this._lifecycleSequence
    const sequence = (Number(this._publishSequence) || 0) + 1
    this._publishSequence = sequence
    let publicShareConfirmed = false
    if (scope === 'square') {
      const confirmed = await this.requestPublicConfirmation()
      if (!this.isPublishCurrent(sequence, lifecycle, handId, previewHash) || !confirmed) return
      publicShareConfirmed = true
    }
    if (!this.isPublishCurrent(sequence, lifecycle, handId, previewHash)) return
    const normalized = { handId, previewHash, scope, targetUserIds }
    const key = publishKey(normalized)
    if (this._publishMutationKey !== key || !this._publishMutationId) {
      this._publishMutationKey = key
      this._publishMutationId = socialMutation.createMutationId('publish_hand')
    }
    const input = Object.assign({}, normalized, {
      publicShareConfirmed,
      clientMutationId: this._publishMutationId
    })
    this.setData({ publishLoading: true, errorCode: '', errorMessage: '' })
    try {
      const result = await socialService.publishHand(input)
      if (!this.isPublishCurrent(sequence, lifecycle, handId, previewHash)) return
      const shareId = text(result && result.shareId)
      if (!shareId) {
        this.setData({ publishLoading: false, status: 'error', errorCode: 'SOCIAL_ERROR', errorMessage: '服务端未返回分享 ID。' })
        return
      }
      this.setData({
        publishLoading: false,
        status: 'success',
        shareId,
        errorCode: '',
        errorMessage: ''
      })
    } catch (error) {
      if (!this.isPublishCurrent(sequence, lifecycle, handId, previewHash)) return
      const code = errorCode(error)
      if (code === 'HAND_PREVIEW_STALE') {
        this.setData({ publishLoading: false, previewHash: '', errorCode: code, errorMessage: '手牌已变化，正在重新预览。' })
        await this.retryPreview()
        return
      }
      this.setData({
        publishLoading: false,
        status: isUnavailableCode(code) ? 'unavailable' : (code === 'INVALID_SHARE_SCOPE' ? 'ready' : 'error'),
        errorCode: code,
        errorMessage: publishErrorMessage(code)
      })
    }
  },

  isPublishCurrent(sequence, lifecycle, handId, previewHash) {
    return this._pageAttached !== false && this._pageVisible !== false && sequence === this._publishSequence &&
      lifecycle === this._lifecycleSequence && handId === text(this.data.handId) &&
      previewHash === text(this.data.previewHash)
  },

  requestPublicConfirmation() {
    return new Promise(resolve => {
      wx.showModal({
        title: '确认发布到广场',
        content: '广场内容对所有用户可见。请确认这份匿名 BB 手牌可以公开分享。',
        confirmText: '确认发布',
        cancelText: '取消',
        success(result) { resolve(!!(result && result.confirm)) },
        fail() { resolve(false) }
      })
    })
  },

  goBack() {
    wx.navigateBack()
  }
})
