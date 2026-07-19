const socialService = require('../../services/social-service')

const SCOPES = ['square', 'friends', 'selected']
const SCOPE_LABELS = { square: '广场', friends: '全部好友', selected: '指定好友' }
const UNAVAILABLE_CODES = [
  'CONTENT_UNAVAILABLE', 'FORBIDDEN', 'FRIENDSHIP_REQUIRED',
  'SOCIAL_PROFILE_REQUIRED', 'NOT_FOUND'
]

function text(value) {
  return String(value == null ? '' : value).trim()
}

function safeDecode(value) {
  const source = text(value)
  try { return decodeURIComponent(source).trim() } catch (error) { return source }
}

function contractError() {
  const error = new Error('invalid hand share detail')
  error.code = 'SOCIAL_CONTRACT_ERROR'
  return error
}

function protocolText(value) {
  if (typeof value !== 'string') throw contractError()
  return value.trim()
}

function assertExactObject(value, allowed, required) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw contractError()
  const keys = Object.keys(value)
  if (keys.some(key => allowed.indexOf(key) < 0)) throw contractError()
  if ((required || []).some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw contractError()
  return value
}

function copyCards(value) {
  if (!Array.isArray(value) || value.some(card => typeof card !== 'string')) throw contractError()
  return value.map(protocolText)
}

function copySnapshotNumber(value, integer) {
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) throw contractError()
  return value
}

function copyHero(value) {
  const source = assertExactObject(value, ['label', 'seat', 'position', 'cards', 'stackBb'], ['label', 'seat', 'position', 'cards'])
  const result = { label: protocolText(source.label), seat: copySnapshotNumber(source.seat, true), position: protocolText(source.position), cards: copyCards(source.cards) }
  if (Object.prototype.hasOwnProperty.call(source, 'stackBb')) result.stackBb = copySnapshotNumber(source.stackBb, false)
  return result
}

function copyPlayer(value) {
  const source = assertExactObject(value, ['label', 'seat', 'position', 'stackBb'], ['label', 'seat', 'position'])
  const result = { label: protocolText(source.label), seat: copySnapshotNumber(source.seat, true), position: protocolText(source.position) }
  if (Object.prototype.hasOwnProperty.call(source, 'stackBb')) result.stackBb = copySnapshotNumber(source.stackBb, false)
  return result
}

function copyBoard(value) {
  const source = assertExactObject(value, ['flop', 'turn', 'river'], ['flop', 'turn', 'river'])
  return { flop: copyCards(source.flop), turn: copyCards(source.turn), river: copyCards(source.river) }
}

function copyAction(value) {
  const source = assertExactObject(value, ['street', 'actor', 'type', 'amountBb'], ['street', 'actor', 'type'])
  const result = { street: protocolText(source.street), actor: protocolText(source.actor), type: protocolText(source.type) }
  if (Object.prototype.hasOwnProperty.call(source, 'amountBb')) result.amountBb = copySnapshotNumber(source.amountBb, false)
  return result
}

function copyShowdown(value) {
  const source = assertExactObject(value, ['actor', 'cards'], ['actor', 'cards'])
  return { actor: protocolText(source.actor), cards: copyCards(source.cards) }
}

function copySnapshot(value) {
  const allowed = ['version', 'hero', 'players', 'board', 'actions', 'effectiveStackBb', 'potBb', 'allInPotBb', 'showdown']
  const source = assertExactObject(value, allowed, ['version', 'hero', 'players', 'board', 'actions', 'showdown'])
  if (source.version !== 1 || !Array.isArray(source.players) || !Array.isArray(source.actions) || !Array.isArray(source.showdown)) throw contractError()
  const result = {
    version: source.version,
    hero: copyHero(source.hero),
    players: source.players.map(copyPlayer),
    board: copyBoard(source.board),
    actions: source.actions.map(copyAction),
    showdown: source.showdown.map(copyShowdown)
  }
  ;['effectiveStackBb', 'potBb', 'allInPotBb'].forEach(key => {
    if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = copySnapshotNumber(source[key], false)
  })
  return result
}

function copyPublisher(value) {
  const source = assertExactObject(value, ['socialUserId', 'nickname', 'avatarUrl', 'avatarText'], ['socialUserId', 'nickname', 'avatarUrl', 'avatarText'])
  return {
    socialUserId: protocolText(source.socialUserId),
    nickname: protocolText(source.nickname),
    avatarUrl: protocolText(source.avatarUrl),
    avatarText: protocolText(source.avatarText)
  }
}

function copyDetail(value) {
  const keys = ['shareId', 'publisher', 'scope', 'scopeLabel', 'handSnapshot', 'likedByMe', 'likeCount', 'commentCount', 'createdAt', 'isMine']
  const source = assertExactObject(value, keys, keys)
  const scope = protocolText(source.scope)
  const shareId = protocolText(source.shareId)
  if (!shareId || SCOPES.indexOf(scope) < 0 || protocolText(source.scopeLabel) !== SCOPE_LABELS[scope] ||
    typeof source.likedByMe !== 'boolean' || typeof source.isMine !== 'boolean' ||
    !Number.isSafeInteger(source.likeCount) || source.likeCount < 0 ||
    !Number.isSafeInteger(source.commentCount) || source.commentCount < 0 ||
    !Number.isSafeInteger(source.createdAt) || source.createdAt <= 0) throw contractError()
  return {
    shareId,
    publisher: copyPublisher(source.publisher),
    scope,
    scopeLabel: SCOPE_LABELS[scope],
    handSnapshot: copySnapshot(source.handSnapshot),
    likedByMe: source.likedByMe,
    likeCount: source.likeCount,
    commentCount: source.commentCount,
    createdAt: source.createdAt,
    isMine: source.isMine
  }
}

function unavailableError(error) {
  return UNAVAILABLE_CODES.indexOf(text(error && error.code)) >= 0
}

Page({
  data: {
    shareId: '',
    detail: null,
    status: 'loading',
    errorMessage: ''
  },

  onLoad(options) {
    this._detailAttached = true
    this._detailVisible = true
    this._detailHasShown = false
    this._detailGeneration = Number(this._detailGeneration) || 0
    this._detailFlight = null
    const shareId = safeDecode(options && options.shareId)
    this.invalidateDetail()
    this.setData({ shareId, detail: null, status: 'loading', errorMessage: '' })
    return this.loadDetail()
  },

  onShow() {
    if (!this._detailHasShown) {
      this._detailHasShown = true
      this._detailAttached = true
      this._detailVisible = true
      return Promise.resolve()
    }
    if (this._detailVisible) return Promise.resolve()
    this._detailAttached = true
    this._detailVisible = true
    this.invalidateDetail()
    return this.loadDetail()
  },

  onHide() {
    this._detailVisible = false
    this.invalidateDetail()
  },

  onUnload() {
    this._detailAttached = false
    this._detailVisible = false
    this.invalidateDetail()
  },

  invalidateDetail() {
    this._detailGeneration = (Number(this._detailGeneration) || 0) + 1
    this._detailFlight = null
  },

  isCurrentDetail(generation, shareId) {
    return this._detailAttached !== false && this._detailVisible !== false &&
      generation === this._detailGeneration && shareId === text(this.data.shareId)
  },

  loadDetail() {
    if (this._detailFlight) return this._detailFlight
    const shareId = text(this.data.shareId)
    const generation = this._detailGeneration
    if (!shareId) {
      this.setData({ detail: null, status: 'unavailable', errorMessage: '这手分享已失效或不可访问。' })
      return Promise.resolve()
    }
    this.setData({ detail: null, status: 'loading', errorMessage: '' })
    const flight = (async () => {
      try {
        const detail = copyDetail(await socialService.getHandShare(shareId))
        if (!this.isCurrentDetail(generation, shareId)) return
        this.setData({ detail, status: 'ready', errorMessage: '' })
      } catch (error) {
        if (!this.isCurrentDetail(generation, shareId)) return
        this.setData({
          detail: null,
          status: unavailableError(error) ? 'unavailable' : 'error',
          errorMessage: unavailableError(error) ? '这手分享已失效或不可访问。' : '暂时无法读取分享，请检查网络后重试。'
        })
      }
    })()
    this._detailFlight = flight
    flight.then(() => {
      if (this._detailFlight === flight) this._detailFlight = null
    }, () => {
      if (this._detailFlight === flight) this._detailFlight = null
    })
    return flight
  },

  retry() {
    if (this.data.status === 'loading') return this._detailFlight || Promise.resolve()
    this.invalidateDetail()
    return this.loadDetail()
  },

  retryLoad() {
    return this.retry()
  }
})
