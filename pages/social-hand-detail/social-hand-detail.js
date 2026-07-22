const socialService = require('../../services/social-service')
const socialMutation = require('../../utils/social-mutation')
const handReplay = require('../../utils/hand-replay')
const cardUi = require('../../utils/card-ui')
const { safeHttpsUrl } = require('../../utils/https-url')
const socialHandPrefetch = require('../../utils/social-hand-prefetch')
const { POKER_STICKER_IDS, POKER_STICKERS, POKER_STICKER_BY_ID } = require('../../utils/poker-stickers')

const SCOPES = ['square', 'friends', 'selected']
const MAX_SELECTED = 50
const SCOPE_LABELS = { square: '广场', friends: '全部好友', selected: '指定好友' }
const UNAVAILABLE_CODES = [
  'CONTENT_UNAVAILABLE', 'FORBIDDEN', 'FRIENDSHIP_REQUIRED',
  'SOCIAL_PROFILE_REQUIRED', 'NOT_FOUND'
]
const COMMENT_KEYS = ['commentId', 'shareId', 'parentCommentId', 'author', 'kind', 'text', 'stickerId', 'deleted', 'createdAt']
const COMMENT_AUTHOR_KEYS = ['socialUserId', 'nickname', 'avatarUrl', 'avatarText']
const COMMENT_PAGE_KEYS = ['items', 'nextCursor']
const EMOJIS = Object.freeze(['👍', '🔥', '👏', '😂', '🤔', '😮'])
const MODERATION_OPTIONS = Object.freeze([
  { label: '垃圾广告', reason: 'spam' },
  { label: '骚扰或攻击', reason: 'abuse' },
  { label: '泄露隐私', reason: 'privacy' },
  { label: '违法或欺诈', reason: 'illegal' },
  { label: '其他违规', reason: 'other' }
])
let mutationSequence = 0

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

function protocolAvatarUrl(value) {
  const source = protocolText(value)
  if (!source) return ''
  const safe = safeHttpsUrl(source)
  if (safe === null) throw contractError()
  return safe
}

function decorateCards(value, limit, street) {
  return cardUi.parseCardsInput((Array.isArray(value) ? value : []).join(''), limit).map(card => Object.assign({}, card, {
    token: card.rank + card.suit,
    street: street || ''
  }))
}

const ACTION_LABELS = Object.freeze({
  fold: '弃牌', check: '过牌', call: '跟注', bet: '下注', raise: '加注', all_in: '全下', allin: '全下'
})
const STREET_LABELS = Object.freeze({ preflop: '翻前', flop: '翻牌', turn: '转牌', river: '河牌' })

function roundedBb(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function bbLabel(value) {
  const rounded = roundedBb(value)
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : String(rounded)} BB`
}

function buildActionTimeline(snapshot) {
  const source = snapshot || {}
  const actions = Array.isArray(source.actions) ? source.actions : []
  const positionsByActor = Object.create(null)
  ;[source.hero].concat(Array.isArray(source.players) ? source.players : []).forEach(player => {
    const label = text(player && player.label)
    const position = text(player && player.position).toUpperCase()
    if (label && position) positionsByActor[label] = position
  })
  const actionTotal = actions.reduce((sum, action) => sum + (Number.isFinite(action.amountBb) ? action.amountBb : 0), 0)
  const finalPot = Number(source.potBb)
  let runningPot = Number.isFinite(finalPot) ? Math.max(0, roundedBb(finalPot - actionTotal)) : 0
  let previousStreet = ''
  return actions.map((action, index) => {
    const street = String(action.street || 'preflop').toLowerCase()
    const type = String(action.type || '').toLowerCase()
    const amount = Number.isFinite(action.amountBb) ? action.amountBb : 0
    runningPot = roundedBb(runningPot + amount)
    const streetStart = street !== previousStreet
    previousStreet = street
    return Object.assign({}, action, {
      key: `${street}-${index}`,
      streetStart,
      streetLabel: STREET_LABELS[street] || street.toUpperCase(),
      actorPosition: positionsByActor[text(action.actor)] || '',
      typeLabel: ACTION_LABELS[type] || type,
      amountLabel: amount > 0 ? bbLabel(amount) : '',
      potAfterLabel: bbLabel(runningPot),
      tone: type === 'raise' || type === 'bet' || type === 'all_in' || type === 'allin' ? 'aggressive' : (type === 'fold' ? 'fold' : 'passive')
    })
  })
}

function buildDetailVisuals(value) {
  const detail = value || {}
  const snapshot = detail.handSnapshot || {}
  const board = snapshot.board || {}
  return {
    heroCardsVisual: decorateCards(snapshot.hero && snapshot.hero.cards, 2, 'hero'),
    boardCardsVisual: []
      .concat(decorateCards(board.flop, 3, 'flop'))
      .concat(decorateCards(board.turn, 1, 'turn'))
      .concat(decorateCards(board.river, 1, 'river')),
    actionTimeline: buildActionTimeline(snapshot)
  }
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
    avatarUrl: protocolAvatarUrl(source.avatarUrl),
    avatarText: protocolText(source.avatarText)
  }
}

function copyDetail(value) {
  const keys = ['shareId', 'publisher', 'scope', 'scopeLabel', 'handSnapshot', 'likedByMe', 'likeCount', 'commentCount', 'createdAt', 'isMine', 'canModerateComments']
  const source = assertExactObject(value, keys, keys)
  const scope = protocolText(source.scope)
  const shareId = protocolText(source.shareId)
  if (!shareId || SCOPES.indexOf(scope) < 0 || protocolText(source.scopeLabel) !== SCOPE_LABELS[scope] ||
    typeof source.likedByMe !== 'boolean' || typeof source.isMine !== 'boolean' || typeof source.canModerateComments !== 'boolean' ||
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
    isMine: source.isMine,
    canModerateComments: source.canModerateComments
  }
}

function copyComment(value, shareId, mySocialUserId, canModerateComments) {
  const source = assertExactObject(value, COMMENT_KEYS, COMMENT_KEYS)
  const author = assertExactObject(source.author, COMMENT_AUTHOR_KEYS, COMMENT_AUTHOR_KEYS)
  const commentId = protocolText(source.commentId)
  const commentShareId = protocolText(source.shareId)
  const parentCommentId = protocolText(source.parentCommentId)
  const kind = protocolText(source.kind)
  const content = protocolText(source.text)
  const stickerId = protocolText(source.stickerId)
  const deleted = source.deleted
  if (!commentId || commentShareId !== shareId || typeof deleted !== 'boolean' ||
    !Number.isSafeInteger(source.createdAt) || source.createdAt <= 0) throw contractError()
  if (deleted) {
    if (kind !== 'text' || (content !== '该评论已删除' && content !== '该评论已被管理员移除') || stickerId) throw contractError()
  } else if (kind === 'text') {
    const length = Array.from(content).length
    if (!length || length > 300 || stickerId) throw contractError()
  } else if (kind === 'sticker') {
    if (content || POKER_STICKER_IDS.indexOf(stickerId) < 0) throw contractError()
  } else {
    throw contractError()
  }
  const copiedAuthor = {
    socialUserId: protocolText(author.socialUserId),
    nickname: protocolText(author.nickname),
    avatarUrl: protocolAvatarUrl(author.avatarUrl),
    avatarText: protocolText(author.avatarText)
  }
  if (!copiedAuthor.socialUserId) throw contractError()
  return {
    commentId,
    shareId: commentShareId,
    parentCommentId,
    author: copiedAuthor,
    kind,
    text: content,
    stickerId,
    deleted,
    createdAt: source.createdAt,
    isReply: !!parentCommentId,
    canDelete: !deleted && !!mySocialUserId && copiedAuthor.socialUserId === mySocialUserId,
    canModerate: !deleted && canModerateComments === true && !!mySocialUserId && copiedAuthor.socialUserId !== mySocialUserId,
    sticker: kind === 'sticker' ? POKER_STICKER_BY_ID[stickerId] : null
  }
}

function copyCommentPage(value, shareId, mySocialUserId, canModerateComments) {
  const source = assertExactObject(value, COMMENT_PAGE_KEYS, COMMENT_PAGE_KEYS)
  if (!Array.isArray(source.items)) throw contractError()
  let nextCursor = null
  if (source.nextCursor !== null) {
    nextCursor = protocolText(source.nextCursor)
    if (!nextCursor || nextCursor.length > 2048) throw contractError()
  }
  return {
    items: source.items.map(item => copyComment(item, shareId, mySocialUserId, canModerateComments)),
    nextCursor
  }
}

function copyMySocialUserId(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.socialUserId !== 'string') return ''
  return value.socialUserId.trim()
}

function copyInteractionResult(value, keys, shareId, mySocialUserId, canModerateComments) {
  const source = assertExactObject(value, keys, keys)
  if (!Number.isSafeInteger(source.commentCount) || source.commentCount < 0) throw contractError()
  return { comment: copyComment(source.comment, shareId, mySocialUserId, canModerateComments), commentCount: source.commentCount }
}

function copyDeleteResult(value, shareId, mySocialUserId, canModerateComments) {
  const source = assertExactObject(value, ['comment', 'commentCount'], ['comment'])
  const result = { comment: copyComment(source.comment, shareId, mySocialUserId, canModerateComments) }
  if (Object.prototype.hasOwnProperty.call(source, 'commentCount')) {
    if (!Number.isSafeInteger(source.commentCount) || source.commentCount < 0) throw contractError()
    result.commentCount = source.commentCount
  }
  return result
}

function copyLikeResult(value, shareId) {
  const keys = ['shareId', 'likedByMe', 'likeCount']
  const source = assertExactObject(value, keys, keys)
  if (protocolText(source.shareId) !== shareId || typeof source.likedByMe !== 'boolean' ||
    !Number.isSafeInteger(source.likeCount) || source.likeCount < 0) throw contractError()
  return { shareId, likedByMe: source.likedByMe, likeCount: source.likeCount }
}

function mergeComments(current, incoming, prepend) {
  const seen = Object.create(null)
  const merged = []
  const values = prepend ? incoming.concat(current) : current.concat(incoming)
  values.forEach(item => {
    if (!item || seen[item.commentId]) return
    seen[item.commentId] = true
    merged.push(item)
  })
  return merged
}

function mutationChain(page, action, shareId, payload) {
  if (!page._interactionMutationChains) page._interactionMutationChains = Object.create(null)
  const slot = JSON.stringify([action, shareId])
  const fingerprint = JSON.stringify([action, shareId].concat(payload))
  const existing = page._interactionMutationChains[slot]
  if (existing && existing.fingerprint === fingerprint) return existing
  mutationSequence += 1
  const entry = {
    fingerprint,
    id: ['ui', action, Date.now(), mutationSequence].join('_')
  }
  page._interactionMutationChains[slot] = entry
  return entry
}

function clearMutationChain(page, action, shareId, entry) {
  if (!page._interactionMutationChains) return
  const slot = JSON.stringify([action, shareId])
  if (page._interactionMutationChains[slot] === entry) delete page._interactionMutationChains[slot]
}

function unavailableError(error) {
  return UNAVAILABLE_CODES.indexOf(text(error && error.code)) >= 0
}

function commentErrorMessage(error) {
  const code = text(error && error.code)
  if (code === 'COMMENT_CONTENT_BLOCKED') return '评论可能含有不适宜内容，请修改后重试'
  if (code === 'COMMENT_CHECK_UNAVAILABLE') return '内容检测暂不可用，请稍后重试'
  return '评论发送失败'
}

function eventValue(event, key) {
  return text(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset[key])
}

function confirmModal(options) {
  return new Promise(resolve => {
    if (typeof wx === 'undefined' || typeof wx.showModal !== 'function') return resolve(false)
    wx.showModal(Object.assign({}, options, {
      success: result => resolve(!!(result && result.confirm)),
      fail: () => resolve(false)
    }))
  })
}

Page({
  data: {
    shareId: '',
    detail: null,
    heroCardsVisual: [],
    boardCardsVisual: [],
    actionTimeline: [],
    replayData: null,
    replayVisible: false,
    status: 'loading',
    errorMessage: '',
    mySocialUserId: '',
    comments: [],
    commentsStatus: 'idle',
    commentsNextCursor: null,
    commentsLoadingMore: false,
    commentDraft: '',
    commentSubmitting: false,
    replyTo: null,
    emojiPanelVisible: false,
    stickerPanelVisible: false,
    likeSubmitting: false,
    manageVisible: false,
    manageScope: 'friends',
    manageFriends: [],
    manageFriendLoading: false,
    manageSelectedTargetUserIds: [],
    manageSubmitting: false,
    manageError: '',
    emojis: EMOJIS,
    stickers: POKER_STICKERS
  },

  onLoad(options) {
    this._detailAttached = true
    this._detailVisible = true
    this._detailHasShown = false
    this._detailGeneration = Number(this._detailGeneration) || 0
    this._detailFlight = null
    this._commentsFlight = null
    this._likeFlight = null
    this._commentWriteFlight = null
    this._pendingCommentUi = null
    const shareId = safeDecode(options && options.shareId)
    this._openReplayAfterLoad = text(options && (options.replay || options.autoplay)) === '1'
    this._openCommentsAfterLoad = text(options && options.section) === 'comments'
    this.invalidateDetail()
    this.setData({ shareId, detail: null, heroCardsVisual: [], boardCardsVisual: [], actionTimeline: [], replayData: null, replayVisible: false, status: 'loading', errorMessage: '' })
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
    this.rollbackPendingCommentUi()
    this.setData({ manageVisible: false, manageSubmitting: false, replayVisible: false })
    this.invalidateDetail()
  },

  onUnload() {
    this._detailAttached = false
    this._detailVisible = false
    this.rollbackPendingCommentUi()
    this.setData({ manageVisible: false, manageSubmitting: false, replayVisible: false })
    this.invalidateDetail()
  },

  invalidateDetail() {
    this._detailGeneration = (Number(this._detailGeneration) || 0) + 1
    this._detailFlight = null
    this._commentsFlight = null
    this._likeFlight = null
    this._commentWriteFlight = null
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
    this.setData({
      detail: null,
      heroCardsVisual: [],
      boardCardsVisual: [],
      actionTimeline: [],
      status: 'loading',
      errorMessage: '',
      mySocialUserId: '',
      comments: [],
      commentsStatus: 'loading',
      commentsNextCursor: null,
      commentsLoadingMore: false,
      commentSubmitting: false,
      likeSubmitting: false,
      replyTo: null
    })
    const flight = (async () => {
      try {
        const prefetched = socialHandPrefetch.consume(shareId)
        const detail = copyDetail(prefetched || await socialService.getHandShare(shareId))
        if (!this.isCurrentDetail(generation, shareId)) return
        const replayData = handReplay.buildSocialReplayView(detail.handSnapshot, 'share-' + shareId)
        const detailVisuals = buildDetailVisuals(detail)
        this.setData({
          detail,
          heroCardsVisual: detailVisuals.heroCardsVisual,
          boardCardsVisual: detailVisuals.boardCardsVisual,
          actionTimeline: detailVisuals.actionTimeline,
          replayData,
          replayVisible: !!(this._openReplayAfterLoad && replayData.available),
          status: 'ready',
          errorMessage: ''
        })
        await this.loadInitialInteractions(generation, shareId)
        if (this._openCommentsAfterLoad && typeof wx !== 'undefined' && wx.pageScrollTo) {
          const scrollToComments = () => wx.pageScrollTo({ selector: '.comments-card', duration: 0 })
          if (wx.nextTick) wx.nextTick(scrollToComments)
          else scrollToComments()
          this._openCommentsAfterLoad = false
        }
      } catch (error) {
        if (!this.isCurrentDetail(generation, shareId)) return
        this.setData({
          detail: null,
          heroCardsVisual: [],
          boardCardsVisual: [],
          status: unavailableError(error) ? 'unavailable' : 'error',
          comments: [],
          commentsStatus: unavailableError(error) ? 'unavailable' : 'error',
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

  loadInitialInteractions(generation, shareId) {
    const profileTask = Promise.resolve()
      .then(() => socialService.getMySocialProfile())
      .then(copyMySocialUserId, () => '')
    const commentsTask = Promise.resolve()
      .then(() => socialService.listComments({ shareId, cursor: '', limit: 20 }))
    return Promise.all([profileTask, commentsTask]).then(values => {
      if (!this.isCurrentDetail(generation, shareId)) return
      const mySocialUserId = values[0]
      const page = copyCommentPage(values[1], shareId, mySocialUserId, this.data.detail && this.data.detail.canModerateComments)
      this.setData({
        mySocialUserId,
        comments: page.items,
        commentsStatus: 'ready',
        commentsNextCursor: page.nextCursor,
        commentsLoadingMore: false
      })
    }).catch(error => {
      if (!this.isCurrentDetail(generation, shareId)) return
      if (unavailableError(error)) {
        this.setData({ detail: null, status: 'unavailable', comments: [], commentsStatus: 'unavailable', commentsNextCursor: null })
        return
      }
      this.setData({ mySocialUserId: '', comments: [], commentsStatus: 'error', commentsNextCursor: null, commentsLoadingMore: false })
    })
  },

  loadMoreComments() {
    if (this._commentsFlight) return this._commentsFlight
    const shareId = text(this.data.shareId)
    const cursor = this.data.commentsNextCursor
    const generation = this._detailGeneration
    if (!shareId || typeof cursor !== 'string' || !cursor || this.data.commentsStatus !== 'ready') return Promise.resolve(this.data.comments)
    this.setData({ commentsLoadingMore: true })
    const flight = (async () => {
      try {
        const page = copyCommentPage(
          await socialService.listComments({ shareId, cursor, limit: 20 }),
          shareId,
          this.data.mySocialUserId,
          this.data.detail && this.data.detail.canModerateComments
        )
        if (!this.isCurrentDetail(generation, shareId)) return this.data.comments
        const comments = mergeComments(this.data.comments, page.items, false)
        this.setData({ comments, commentsNextCursor: page.nextCursor, commentsLoadingMore: false })
        return comments
      } catch (error) {
        if (this.isCurrentDetail(generation, shareId)) {
          if (unavailableError(error)) this.setData({ detail: null, status: 'unavailable', comments: [], commentsStatus: 'unavailable' })
          else this.setData({ commentsLoadingMore: false })
          if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: '评论加载失败', icon: 'none' })
        }
        return this.data.comments
      }
    })()
    this._commentsFlight = flight
    flight.then(() => { if (this._commentsFlight === flight) this._commentsFlight = null }, () => { if (this._commentsFlight === flight) this._commentsFlight = null })
    return flight
  },

  openShareManagement() {
    const detail = this.data.detail
    if (!detail || !detail.isMine || this.data.status !== 'ready') return Promise.resolve()
    const manageScope = detail.scope
    this._manageGeneration = this._detailGeneration
    this._manageShareId = text(detail.shareId)
    this._manageRequestSequence = (Number(this._manageRequestSequence) || 0) + 1
    this.setData({
      manageVisible: true,
      manageScope,
      manageFriends: [],
      manageFriendLoading: manageScope === 'selected',
      manageSelectedTargetUserIds: [],
      manageSubmitting: false,
      manageError: ''
    })
    return manageScope === 'selected' ? this.loadManageFriends() : Promise.resolve()
  },

  closeShareManagement() {
    if (this.data.manageSubmitting) return
    this._manageRequestSequence = (Number(this._manageRequestSequence) || 0) + 1
    this.setData({ manageVisible: false, manageFriends: [], manageSelectedTargetUserIds: [], manageError: '' })
  },

  isCurrentManagement(generation, shareId) {
    return this.data.manageVisible === true && this.isCurrentDetail(generation, shareId) &&
      this._manageGeneration === generation && this._manageShareId === shareId &&
      text(this.data.detail && this.data.detail.shareId) === shareId && this.data.detail.isMine === true
  },

  stopModalTap() {},

  openReplay() {
    if (!this.data.replayData || !this.data.replayData.available) return
    this.setData({ replayVisible: true })
  },

  rollbackPendingCommentUi() {
    const pending = this._pendingCommentUi
    if (!pending) return
    this._pendingCommentUi = null
    this.setData({
      comments: (this.data.comments || []).filter(item => item.commentId !== pending.optimisticId),
      detail: this.data.detail ? Object.assign({}, this.data.detail, { commentCount: pending.previousCount }) : this.data.detail,
      commentDraft: pending.previousDraft,
      replyTo: pending.previousReplyTo,
      commentSubmitting: false
    })
  },

  closeReplay() {
    this.setData({ replayVisible: false })
  },

  changeManageScope(event) {
    if (this.data.manageSubmitting) return Promise.resolve()
    const scope = eventValue(event, 'scope')
    if (SCOPES.indexOf(scope) < 0 || scope === this.data.manageScope) return Promise.resolve()
    this._manageRequestSequence = (Number(this._manageRequestSequence) || 0) + 1
    this.setData({
      manageScope: scope,
      manageSelectedTargetUserIds: [],
      manageFriends: [],
      manageFriendLoading: scope === 'selected',
      manageError: ''
    })
    return scope === 'selected' ? this.loadManageFriends() : Promise.resolve()
  },

  async loadManageFriends() {
    if (!this.data.manageVisible || this.data.manageScope !== 'selected') return
    const generation = this._manageGeneration
    const shareId = this._manageShareId
    const requestSequence = this._manageRequestSequence
    this.setData({ manageFriendLoading: true, manageError: '' })
    try {
      const result = await socialService.listFriends({ offset: 0, limit: 50 })
      if (!this.isCurrentManagement(generation, shareId) || this.data.manageScope !== 'selected' || requestSequence !== this._manageRequestSequence) return
      const seen = Object.create(null)
      const manageFriends = (Array.isArray(result && result.items) ? result.items : []).reduce((items, item) => {
        const socialUserId = text(item && item.socialUserId)
        if (!socialUserId || seen[socialUserId]) return items
        seen[socialUserId] = true
        items.push(Object.assign({}, item, { socialUserId, selected: false }))
        return items
      }, [])
      this.setData({ manageFriends, manageFriendLoading: false })
    } catch (error) {
      if (this.isCurrentManagement(generation, shareId) && requestSequence === this._manageRequestSequence) this.setData({ manageFriendLoading: false, manageError: '好友列表加载失败，请重试。' })
    }
  },

  toggleManageTarget(event) {
    if (this.data.manageSubmitting || this.data.manageScope !== 'selected') return
    const targetUserId = eventValue(event, 'id')
    if (!targetUserId || !this.data.manageFriends.some(item => item.socialUserId === targetUserId)) return
    const targets = this.data.manageSelectedTargetUserIds.slice()
    const index = targets.indexOf(targetUserId)
    if (index >= 0) targets.splice(index, 1)
    else if (targets.length >= MAX_SELECTED) return wx.showToast({ title: '最多选择 50 位好友', icon: 'none' })
    else targets.push(targetUserId)
    const selected = Object.create(null)
    targets.forEach(id => { selected[id] = true })
    this.setData({
      manageSelectedTargetUserIds: targets,
      manageFriends: this.data.manageFriends.map(item => Object.assign({}, item, { selected: !!selected[item.socialUserId] })),
      manageError: ''
    })
  },

  async saveShareScope() {
    if (this.data.manageSubmitting || !this.data.manageVisible || !this.data.detail || !this.data.detail.isMine) return
    const scope = this.data.manageScope
    const generation = this._manageGeneration
    const shareId = this._manageShareId
    const targetUserIds = scope === 'selected' ? this.data.manageSelectedTargetUserIds.slice().sort() : []
    if (scope === 'selected' && !targetUserIds.length) {
      this.setData({ manageError: '请至少选择 1 位好友。' })
      return
    }
    const isPublic = scope === 'square'
    const confirmed = await confirmModal({
      title: isPublic ? '确认公开到广场？' : '确认修改发布范围？',
      content: isPublic
        ? '非好友也可以查看、点赞和评论；手牌仍保持 BB 化及匿名化。'
        : `修改后将立即按“${SCOPE_LABELS[scope]}”重新鉴权。`,
      confirmText: '确认修改',
      confirmColor: '#e60012'
    })
    if (!confirmed || !this.isCurrentManagement(generation, shareId)) return
    this.setData({ manageSubmitting: true, manageError: '' })
    try {
      await socialService.updateHandShareScope({
        shareId,
        scope,
        targetUserIds,
        publicShareConfirmed: isPublic,
        clientMutationId: socialMutation.createMutationId('update_hand_share_scope')
      })
      if (!this.isCurrentManagement(generation, shareId)) return
      this.setData({ manageVisible: false, manageSubmitting: false })
      this.invalidateDetail()
      await this.loadDetail()
      if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: '发布范围已更新', icon: 'success' })
    } catch (error) {
      if (!this.isCurrentManagement(generation, shareId)) return
      if (unavailableError(error)) {
        this.setData({ manageVisible: false, manageSubmitting: false, detail: null, status: 'unavailable' })
      } else this.setData({ manageSubmitting: false, manageError: '修改失败，请确认好友关系后重试。' })
    }
  },

  async withdrawShare() {
    if (this.data.manageSubmitting || !this.data.detail || !this.data.detail.isMine) return
    const generation = this._manageGeneration
    const shareId = this._manageShareId
    const confirmed = await confirmModal({
      title: '撤回这条分享？',
      content: '撤回后，手牌、评论和点赞将不再展示。原始手牌不会被删除。',
      confirmText: '确认撤回',
      confirmColor: '#e60012'
    })
    if (!confirmed || !this.isCurrentManagement(generation, shareId)) return
    this.setData({ manageSubmitting: true, manageError: '' })
    try {
      await socialService.withdrawHandShare({
        shareId,
        clientMutationId: socialMutation.createMutationId('withdraw_hand_share')
      })
      if (!this.isCurrentManagement(generation, shareId)) return
      this.setData({ manageVisible: false, manageSubmitting: false, detail: null, status: 'unavailable' })
      if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: '分享已撤回', icon: 'success' })
    } catch (error) {
      if (!this.isCurrentManagement(generation, shareId)) return
      if (unavailableError(error)) this.setData({ manageVisible: false, manageSubmitting: false, detail: null, status: 'unavailable' })
      else this.setData({ manageSubmitting: false, manageError: '撤回失败，请稍后重试。' })
    }
  },

  toggleLike() {
    if (this._likeFlight) return this._likeFlight
    const shareId = text(this.data.shareId)
    const generation = this._detailGeneration
    const detail = this.data.detail
    if (!shareId || !detail || this.data.status !== 'ready' || this.data.commentsStatus !== 'ready') return Promise.resolve()
    const liked = !detail.likedByMe
    const mutation = mutationChain(this, 'set_like', shareId, [liked])
    const previous = { likedByMe: detail.likedByMe, likeCount: detail.likeCount }
    this.setData({
      detail: Object.assign({}, detail, {
        likedByMe: liked,
        likeCount: Math.max(0, detail.likeCount + (liked ? 1 : -1))
      }),
      likeSubmitting: true
    })
    const flight = (async () => {
      try {
        const result = copyLikeResult(await socialService.setLike({
          shareId,
          liked,
          clientMutationId: mutation.id
        }), shareId)
        clearMutationChain(this, 'set_like', shareId, mutation)
        if (!this.isCurrentDetail(generation, shareId)) return
        this.setData({ detail: Object.assign({}, this.data.detail, result), likeSubmitting: false })
      } catch (error) {
        if (!this.isCurrentDetail(generation, shareId)) return
        if (unavailableError(error)) this.setData({ detail: null, status: 'unavailable', comments: [], commentsStatus: 'unavailable', likeSubmitting: false })
        else {
          this.setData({ detail: Object.assign({}, this.data.detail, previous), likeSubmitting: false })
          if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: '操作失败，请重试', icon: 'none' })
        }
      }
    })()
    this._likeFlight = flight
    flight.then(() => { if (this._likeFlight === flight) this._likeFlight = null }, () => { if (this._likeFlight === flight) this._likeFlight = null })
    return flight
  },

  onCommentInput(event) {
    const value = event && event.detail && event.detail.value
    this.setData({ commentDraft: typeof value === 'string' ? Array.from(value).slice(0, 300).join('') : '' })
  },

  toggleEmojiPanel() {
    this.setData({ emojiPanelVisible: !this.data.emojiPanelVisible, stickerPanelVisible: false })
  },

  toggleStickerPanel() {
    this.setData({ stickerPanelVisible: !this.data.stickerPanelVisible, emojiPanelVisible: false })
  },

  appendEmoji(event) {
    const emoji = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.emoji
    if (typeof emoji !== 'string' || EMOJIS.indexOf(emoji) < 0) return
    const next = Array.from(String(this.data.commentDraft || '') + emoji).slice(0, 300).join('')
    this.setData({ commentDraft: next, emojiPanelVisible: false })
  },

  replyToComment(event) {
    const commentId = text(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.commentId)
    const target = this.data.comments.find(item => item.commentId === commentId)
    if (!target || target.deleted || target.parentCommentId) return
    this.setData({ replyTo: { commentId: target.commentId, nickname: target.author.nickname }, stickerPanelVisible: false, emojiPanelVisible: false })
  },

  cancelReply() {
    this.setData({ replyTo: null })
  },

  submitComment() {
    const content = typeof this.data.commentDraft === 'string' ? this.data.commentDraft.trim() : ''
    const length = Array.from(content).length
    if (!length || length > 300) return Promise.resolve()
    return this.createCommentRequest({
      parentCommentId: this.data.replyTo && this.data.replyTo.commentId || '',
      kind: 'text',
      text: content,
      stickerId: ''
    })
  },

  chooseSticker(event) {
    const stickerId = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.stickerId
    if (typeof stickerId !== 'string' || POKER_STICKER_IDS.indexOf(stickerId) < 0) return Promise.resolve()
    return this.createCommentRequest({
      parentCommentId: this.data.replyTo && this.data.replyTo.commentId || '',
      kind: 'sticker',
      text: '',
      stickerId
    })
  },

  createCommentRequest(input) {
    if (this._commentWriteFlight) return this._commentWriteFlight
    const shareId = text(this.data.shareId)
    const generation = this._detailGeneration
    if (!shareId || !this.data.detail || this.data.status !== 'ready' || this.data.commentsStatus !== 'ready') return Promise.resolve()
    const mutation = mutationChain(this, 'create_comment', shareId, [input.parentCommentId, input.kind, input.text, input.stickerId])
    const previousDraft = this.data.commentDraft
    const previousReplyTo = this.data.replyTo
    const previousCount = this.data.detail.commentCount
    const optimisticId = `pending-${mutation.id}`
    const optimisticComment = {
      commentId: optimisticId,
      shareId,
      parentCommentId: input.parentCommentId,
      author: { socialUserId: this.data.mySocialUserId || 'me', nickname: '我', avatarUrl: '', avatarText: '我' },
      kind: input.kind,
      text: input.text,
      stickerId: input.stickerId,
      sticker: input.stickerId ? POKER_STICKER_BY_ID[input.stickerId] : null,
      deleted: false,
      createdAt: Date.now(),
      isReply: !!input.parentCommentId,
      canDelete: false,
      canModerate: false,
      pending: true
    }
    this._pendingCommentUi = { optimisticId, previousDraft, previousReplyTo, previousCount }
    this.setData({
      comments: mergeComments(this.data.comments, [optimisticComment], true),
      detail: Object.assign({}, this.data.detail, { commentCount: previousCount + 1 }),
      commentDraft: '',
      commentSubmitting: true,
      replyTo: null,
      emojiPanelVisible: false,
      stickerPanelVisible: false
    })
    const flight = (async () => {
      try {
        const result = copyInteractionResult(await socialService.createComment({
          shareId,
          parentCommentId: input.parentCommentId,
          kind: input.kind,
          text: input.text,
          stickerId: input.stickerId,
          clientMutationId: mutation.id
        }), ['comment', 'commentCount'], shareId, this.data.mySocialUserId, this.data.detail && this.data.detail.canModerateComments)
        if (!this.isCurrentDetail(generation, shareId)) return
        this._pendingCommentUi = null
        this.setData({
          comments: mergeComments(this.data.comments.filter(item => item.commentId !== optimisticId), [result.comment], true),
          detail: Object.assign({}, this.data.detail, { commentCount: result.commentCount }),
          commentDraft: '',
          commentSubmitting: false,
          replyTo: null,
          emojiPanelVisible: false,
          stickerPanelVisible: false
        })
        clearMutationChain(this, 'create_comment', shareId, mutation)
      } catch (error) {
        if (!this.isCurrentDetail(generation, shareId)) return
        this._pendingCommentUi = null
        if (unavailableError(error)) this.setData({ detail: null, status: 'unavailable', comments: [], commentsStatus: 'unavailable', commentSubmitting: false })
        else {
          this.setData({
            comments: this.data.comments.filter(item => item.commentId !== optimisticId),
            detail: Object.assign({}, this.data.detail, { commentCount: previousCount }),
            commentDraft: input.kind === 'text' ? previousDraft : '',
            replyTo: previousReplyTo,
            commentSubmitting: false
          })
          if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: commentErrorMessage(error), icon: 'none' })
        }
      }
    })()
    this._commentWriteFlight = flight
    flight.then(() => { if (this._commentWriteFlight === flight) this._commentWriteFlight = null }, () => { if (this._commentWriteFlight === flight) this._commentWriteFlight = null })
    return flight
  },

  deleteComment(event) {
    if (this._commentWriteFlight) return this._commentWriteFlight
    const commentId = text(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.commentId)
    const target = this.data.comments.find(item => item.commentId === commentId)
    const shareId = text(this.data.shareId)
    const generation = this._detailGeneration
    if (!target || !target.canDelete || target.deleted || !shareId || this.data.commentsStatus !== 'ready') return Promise.resolve()
    const mutation = mutationChain(this, 'delete_comment', shareId, [commentId])
    this.setData({ commentSubmitting: true })
    const flight = (async () => {
      try {
        const result = copyDeleteResult(await socialService.deleteComment({
          commentId,
          clientMutationId: mutation.id
        }), shareId, this.data.mySocialUserId, this.data.detail && this.data.detail.canModerateComments)
        if (result.comment.commentId !== commentId || !result.comment.deleted) throw contractError()
        if (!this.isCurrentDetail(generation, shareId)) return
        clearMutationChain(this, 'delete_comment', shareId, mutation)
        if (!Object.prototype.hasOwnProperty.call(result, 'commentCount')) {
          this.setData({
            detail: null,
            status: 'unavailable',
            comments: [],
            commentsStatus: 'unavailable',
            commentsNextCursor: null,
            commentSubmitting: false
          })
          return
        }
        this.setData({
          comments: this.data.comments.map(item => item.commentId === commentId ? result.comment : item),
          detail: Object.assign({}, this.data.detail, { commentCount: result.commentCount }),
          commentSubmitting: false
        })
      } catch (error) {
        if (!this.isCurrentDetail(generation, shareId)) return
        if (unavailableError(error)) this.setData({ detail: null, status: 'unavailable', comments: [], commentsStatus: 'unavailable', commentSubmitting: false })
        else {
          this.setData({ commentSubmitting: false })
          if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: '删除失败', icon: 'none' })
        }
      }
    })()
    this._commentWriteFlight = flight
    flight.then(() => { if (this._commentWriteFlight === flight) this._commentWriteFlight = null }, () => { if (this._commentWriteFlight === flight) this._commentWriteFlight = null })
    return flight
  },

  moderateComment(event) {
    if (this._moderationSheetOpen || this._commentWriteFlight) return this._commentWriteFlight || Promise.resolve()
    const commentId = text(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.commentId)
    const shareId = text(this.data.shareId)
    const generation = this._detailGeneration
    const target = this.data.comments.find(item => item.commentId === commentId)
    if (!target || !target.canModerate || target.deleted || !shareId || this.data.commentsStatus !== 'ready' ||
      typeof wx === 'undefined' || typeof wx.showActionSheet !== 'function') return Promise.resolve()
    this._moderationSheetOpen = true
    return new Promise(resolve => {
      wx.showActionSheet({
        itemList: MODERATION_OPTIONS.map(item => item.label),
        success: resolve,
        fail: () => resolve(null)
      })
    }).then(selection => {
      if (!selection || !Number.isInteger(selection.tapIndex) || !MODERATION_OPTIONS[selection.tapIndex]) return
      if (!this.isCurrentDetail(generation, shareId)) return
      const current = this.data.comments.find(item => item.commentId === commentId)
      if (!current || !current.canModerate || current.deleted) return
      return this.adminDeleteCommentRequest(commentId, MODERATION_OPTIONS[selection.tapIndex].reason, generation, shareId)
    }).finally(() => {
      this._moderationSheetOpen = false
    })
  },

  adminDeleteCommentRequest(commentId, reason, generation, shareId) {
    if (this._commentWriteFlight || !this.isCurrentDetail(generation, shareId)) return this._commentWriteFlight || Promise.resolve()
    const target = this.data.comments.find(item => item.commentId === commentId)
    if (!target || !target.canModerate || target.deleted) return Promise.resolve()
    const mutation = mutationChain(this, 'admin_delete_comment', shareId, [commentId, reason])
    this.setData({ commentSubmitting: true })
    const flight = (async () => {
      try {
        const result = copyDeleteResult(await socialService.adminDeleteComment({
          commentId,
          reason,
          clientMutationId: mutation.id
        }), shareId, this.data.mySocialUserId, this.data.detail && this.data.detail.canModerateComments)
        if (result.comment.commentId !== commentId || !result.comment.deleted || result.comment.text !== '该评论已被管理员移除') throw contractError()
        if (!this.isCurrentDetail(generation, shareId)) return
        clearMutationChain(this, 'admin_delete_comment', shareId, mutation)
        if (!Object.prototype.hasOwnProperty.call(result, 'commentCount')) {
          this.setData({
            detail: null,
            status: 'unavailable',
            comments: [],
            commentsStatus: 'unavailable',
            commentsNextCursor: null,
            commentSubmitting: false
          })
          return
        }
        this.setData({
          comments: this.data.comments.map(item => item.commentId === commentId ? result.comment : item),
          detail: Object.assign({}, this.data.detail, { commentCount: result.commentCount }),
          commentSubmitting: false
        })
      } catch (error) {
        if (!this.isCurrentDetail(generation, shareId)) return
        if (text(error && error.code) === 'FORBIDDEN') {
          this.setData({ commentSubmitting: false })
          if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: '管理权限已变化', icon: 'none' })
          this.invalidateDetail()
          await this.loadDetail()
        } else if (unavailableError(error)) this.setData({ detail: null, status: 'unavailable', comments: [], commentsStatus: 'unavailable', commentSubmitting: false })
        else {
          this.setData({ commentSubmitting: false })
          if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: '移除失败', icon: 'none' })
        }
      }
    })()
    this._commentWriteFlight = flight
    flight.then(() => { if (this._commentWriteFlight === flight) this._commentWriteFlight = null }, () => { if (this._commentWriteFlight === flight) this._commentWriteFlight = null })
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
    this._manageRequestSequence = (Number(this._manageRequestSequence) || 0) + 1
